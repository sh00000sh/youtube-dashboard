// ===================================================================
// 📡 이슈 레이더 — 카드뉴스로 만들 만한 소식을 계속 모은다
//   10/26 사용자: "삼성SDI 미국 ESS 계약 같은 소식을 빨리 잡고 싶다. 계약뿐 아니라 합병, 속보로 뜨는 이슈도
//   다 모니터링하다가 카드뉴스로 만들면 좋겠다" → DART 공시(가장 빠른 공식 출처) + 뉴스 RSS
//   - DART: Railway 변수 DART_API_KEY (opendart.fss.or.kr 무료 인증키). 평일 07~20시 10분마다
//           공급계약·합병·인수·분할 같은 큰 공시만 고르고, 공급계약·인수는 본문에 '미국'이 나오는지 확인
//   - 뉴스: 구글 뉴스 RSS(키 없음) 15분마다 — 미국 계약·수주, 인수합병, [속보], 미국 기업 M&A·급등락
//   - 저장: 시트 '이슈후보' 탭. /api/issues 로 대시보드·예약 작업이 읽는다
// ===================================================================
const zlib = require("zlib");
const TAB = process.env.ISSUE_TAB || "이슈후보";
const COLS = ["수집시각", "발표시각", "출처", "분류", "회사", "제목", "링크", "미국관련", "키"];

// 큰 공시만 (보고서명에 들어 있는 말)
const DART_KINDS = [
  [/단일판매.?공급계약/, "계약"],
  [/회사합병결정|합병결정/, "합병·인수"],
  [/회사분할|분할합병/, "합병·인수"],
  [/영업양수|영업양도|자산양수/, "합병·인수"],
  [/타법인주식및출자증권취득/, "합병·인수"],
  [/주식교환|주식이전/, "합병·인수"],
  [/공개매수/, "합병·인수"],
  [/유상증자결정/, "자금조달"],
];
const US_RE = /미국|美|USA|U\.S\.|United States|텍사스|캘리포니아|조지아|인디애나|애리조나|테네시|뉴욕|나스닥|NYSE|Nasdaq/i;

// 구글 뉴스 RSS 검색어 (when:1d = 최근 하루)
const NEWS_Q = [
  ["ko", "미국 공급계약 OR 미국 수주 when:1d"],
  ["ko", "美 공급계약 OR 美 수주 when:1d"],
  ["ko", "인수합병 미국 when:1d"],
  ["ko", "\"[속보]\" 미국 when:1d"],
  ["ko", "\"[속보]\" 뉴욕증시 OR 나스닥 when:1d"],
  ["en", "\"to acquire\" OR \"merger agreement\" when:1d"],
  ["en", "stock soars OR plunges after when:1d"],
];
const ECON_RE = /증시|주가|코스피|코스닥|나스닥|뉴욕|다우|S&P|금리|연준|Fed|환율|달러|유가|금값|관세|실적|반도체|배터리|AI|상장|인수|합병|계약|수주|급등|급락|폭락|폭등|테슬라|엔비디아|애플|삼성|SK|현대|LG/i;
const tagOf = (t) => /합병|인수|M&A|acquire|acquisition|merger|takeover|매각/i.test(t) ? "합병·인수"
  : /공급계약|수주|계약|contract|deal to supply/i.test(t) ? "계약"
  : /실적|earnings|revenue|guidance/i.test(t) ? "실적"
  : /속보|breaking/i.test(t) ? "속보" : "기타";
const keyOf = (t) => String(t || "").replace(/\s*-\s*[^-]+$/, "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 40).toLowerCase();
const kst = (d) => new Date(d.getTime() + 9 * 3600e3);
const ymd = (d) => kst(d).toISOString().slice(0, 10).replace(/-/g, "");

// ZIP(DART 원문) 안 파일들을 글자로 — 로컬 헤더를 차례로 읽는 최소 구현
function unzipText(buf) {
  let p = 0, out = "";
  while (p + 30 < buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), csize = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const start = p + 30 + nlen + xlen, data = buf.subarray(start, start + csize);
    try { out += (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8"); } catch (_) {}
    p = start + csize;
  }
  return out;
}
const decodeXml = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();

module.exports = function setupIssues({ app, getSheetsClient, ensureTab, SHEET_ID }) {
  const DART_KEY = process.env.DART_API_KEY || "";
  const state = { dart: { configured: !!DART_KEY, lastRun: null, error: null, found: 0 }, news: { lastRun: null, error: null, found: 0 } };
  const seen = new Set();          // 키(제목·접수번호) 중복 막기
  let rows = [];                   // 메모리 사본 (최근 것 위주)
  let loaded = false;

  async function load() {
    if (loaded || !SHEET_ID) return;
    try {
      const sheets = getSheetsClient();
      await ensureTab(sheets, TAB, COLS);
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A2:I` });
      rows = (r.data.values || []).filter((x) => x[8]).map((x) => Object.fromEntries(COLS.map((k, i) => [k, x[i] ?? ""])));
      rows.forEach((x) => seen.add(x["키"]));
      loaded = true;
    } catch (e) { state.news.error = "시트 읽기 실패: " + e.message; }
  }
  async function save(items) {
    if (!items.length || !SHEET_ID) return;
    const sheets = getSheetsClient();
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!I2:I` });
    let last = 1; (r.data.values || []).forEach((x, i) => { if (x && x[0]) last = i + 2; });
    const next = last + 1;
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${TAB}!A${next}:I${next + items.length - 1}`, valueInputOption: "RAW",
      requestBody: { values: items.map((o) => COLS.map((k) => o[k] ?? "")) } });
    rows.push(...items);
    if (rows.length > 1500) rows = rows.slice(-1500);
  }
  const add = (list, o) => { if (!o["키"] || seen.has(o["키"])) return; seen.add(o["키"]); list.push(o); };

  // ── DART ──
  async function runDart() {
    if (!DART_KEY) return;
    const now = new Date(), h = kst(now).getUTCHours(), dow = kst(now).getUTCDay();
    if (dow === 0 || dow === 6 || h < 7 || h > 20) return;
    await load();
    const found = [];
    try {
      const q = new URLSearchParams({ crtfc_key: DART_KEY, bgn_de: ymd(now), end_de: ymd(now), page_count: "100", last_reprt_at: "Y" });
      const j = await (await fetch(`https://opendart.fss.or.kr/api/list.json?${q}`)).json();
      if (j.status && j.status !== "000" && j.status !== "013") throw new Error(`DART ${j.status} ${j.message || ""}`);
      for (const d of j.list || []) {
        if (!["Y", "K"].includes(d.corp_cls)) continue;   // 코스피·코스닥만
        if (/기재정정|첨부정정/.test(d.report_nm) || /스팩|SPAC/i.test(d.corp_name)) continue;   // 정정 공시·스팩 합병은 뺀다
        const kind = DART_KINDS.find(([re]) => re.test(d.report_nm));
        if (!kind || seen.has("dart:" + d.rcept_no)) continue;
        let us = "";
        if (kind[1] !== "자금조달") {
          try {
            const buf = Buffer.from(await (await fetch(`https://opendart.fss.or.kr/api/document.xml?crtfc_key=${DART_KEY}&rcept_no=${d.rcept_no}`)).arrayBuffer());
            const txt = unzipText(buf).replace(/<[^>]+>/g, " ");
            const m = txt.match(US_RE); if (m) us = m[0];
          } catch (_) {}
        }
        add(found, { "수집시각": new Date().toISOString(), "발표시각": `${d.rcept_dt.slice(0, 4)}-${d.rcept_dt.slice(4, 6)}-${d.rcept_dt.slice(6, 8)}`, "출처": "DART",
          "분류": kind[1], "회사": d.corp_name, "제목": `${d.corp_name} · ${d.report_nm.trim()}`, "링크": `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`,
          "미국관련": us ? "Y" : "", "키": "dart:" + d.rcept_no });
      }
      await save(found);
      state.dart = { ...state.dart, lastRun: new Date().toISOString(), error: null, found: state.dart.found + found.length };
    } catch (e) { state.dart = { ...state.dart, lastRun: new Date().toISOString(), error: e.message }; }
  }

  // ── 뉴스 RSS ──
  async function runNews() {
    await load();
    const found = [];
    try {
      for (const [lang, q] of NEWS_Q) {
        const loc = lang === "ko" ? "hl=ko&gl=KR&ceid=KR:ko" : "hl=en-US&gl=US&ceid=US:en";
        const xml = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
        for (const it of xml.split("<item>").slice(1, 26)) {
          const title = decodeXml((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
          const link = decodeXml((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
          const pub = decodeXml((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
          const src = decodeXml((it.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
          if (!title) continue;
          const t = pub ? new Date(pub) : new Date();
          if (Date.now() - t.getTime() > 36 * 3600e3) continue;
          const tag = tagOf(title);
          if (tag === "기타" && !/속보|breaking/i.test(q)) continue;
          // 속보는 시장·기업 얘기만 (정치·사회 속보 제외)
          if (/속보/.test(q) && !ECON_RE.test(title)) continue;
          // 영어 인수합병은 금액이 나온 큰 거래만
          if (lang === "en" && tag === "합병·인수" && !/\$\s?\d|billion|million/i.test(title)) continue;
          add(found, { "수집시각": new Date().toISOString(), "발표시각": t.toISOString(), "출처": src || "뉴스", "분류": tag, "회사": "",
            "제목": title, "링크": link, "미국관련": (lang === "en" || US_RE.test(title)) ? "Y" : "", "키": "news:" + keyOf(title) });
        }
      }
      await save(found);
      state.news = { lastRun: new Date().toISOString(), error: null, found: state.news.found + found.length };
    } catch (e) { state.news = { ...state.news, lastRun: new Date().toISOString(), error: e.message }; }
  }

  // GET /api/issues?hours=24&tag=계약&us=1&since=ISO
  app.get("/api/issues", async (req, res) => {
    try {
      await load();
      const hours = Math.min(Number(req.query.hours) || 24, 24 * 14);
      const since = req.query.since ? Date.parse(req.query.since) : Date.now() - hours * 3600e3;
      let list = rows.filter((x) => Date.parse(x["수집시각"]) >= since);
      if (req.query.tag) list = list.filter((x) => x["분류"] === req.query.tag);
      if (req.query.us) list = list.filter((x) => x["미국관련"] === "Y");
      list.sort((a, b) => (b["출처"] === "DART") - (a["출처"] === "DART") || Date.parse(b["발표시각"]) - Date.parse(a["발표시각"]));
      res.json({ ok: true, state, count: list.length, items: list.slice(0, 300) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  setTimeout(() => { runDart().catch(() => {}); runNews().catch(() => {}); }, 45 * 1000);
  setInterval(() => runDart().catch(() => {}), 10 * 60 * 1000);
  setInterval(() => runNews().catch(() => {}), 15 * 60 * 1000);
};
