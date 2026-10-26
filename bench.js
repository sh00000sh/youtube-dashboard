// ===================================================================
// 📏 우리 채널 기준 (benchmarks)
//   10/26 사용자: "우리 채널 기준에 맞는 조회수로 분석하고 더 나은 방향을 알려줘야 하는데 그런 게 없다"
//   - 유명 채널 기준이 아니라 '우리 영상들의 중간값'으로 좋고 나쁨을 판정한다
//   - 형태(숏폼/롱폼) → 시리즈(시황 숏폼, #제로데이옵션 …)별 기준값
//   - 최근 영상마다 백분위 배지 (업로드 24시간 조회수, 지금까지 조회수)
//   - 잘 된 영상 vs 안 된 영상의 차이를 데이터로 뽑아 '이번 주 해볼 것'을 만든다
//   순수 함수만 둔다(시트·API 호출 없음) → server.js 의 /api/benchmarks 와 AI 리포트가 같이 쓴다
// ===================================================================

const N = (x) => { const n = Number(String(x ?? "").replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; };
const durSec = (s) => String(s || "").split(":").reduce((t, x) => (/^\d+$/.test(x) ? t * 60 + Number(x) : t), 0);
const pctNum = (x) => { if (x == null || x === "") return null; const n = N(x); return String(x).includes("%") ? n : n * 100; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quant = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
// v 가 arr 안에서 아래에서 몇 % 위치인지 (0~100). 같은 값은 절반만 센다
const pctRank = (arr, v) => { if (!arr.length || v == null) return null; let lo = 0, eq = 0; arr.forEach((x) => { if (x < v) lo++; else if (x === v) eq++; }); return Math.round((lo + eq / 2) / arr.length * 100); };
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3);
const HOUR_BUCKETS = [["아침", 5, 11], ["낮", 11, 17], ["저녁", 17, 20], ["밤", 20, 24]];
const hourBucket = (h) => (HOUR_BUCKETS.find(([, a, b]) => h >= a && h < b) || ["새벽"])[0];

// 시리즈: 시황 숏폼은 제목 패턴, 교육 숏폼은 대표 해시태그, 롱폼은 화면 가이드/개념으로 나눈다
const GENERIC_TAGS = new Set(["미국주식옵션", "옵션", "주식", "경제", "미국주식", "옵션매매", "옵션투자", "유진투자선물", "미국주식투자", "주식투자", "단타", "curb", "0dte",
  "콜옵션", "풋옵션", "삼성전자", "하이닉스", "행사가", "기초자산", "마이크론", "애플", "엔비디아"]);
const MKT_RE = /Options\s*Trend|옵션\s*시황/i;
function seriesOf(title, form) {
  const t = title || "";
  if (form === "L") return /주문|화면|보는 법|읽는 법|설정하는 법|수수료|증거금/.test(t) ? "롱폼 · 화면·주문 가이드" : "롱폼 · 개념 설명";
  if (MKT_RE.test(t)) return "시황 숏폼";
  const tags = (t.match(/#[^\s#|]+/g) || []).map((x) => x.slice(1));
  if (tags.includes("1분옵션")) return "교육 숏폼 · 1분옵션";        // 6~8월 시리즈 이름
  const key = tags.find((x) => !GENERIC_TAGS.has(x.toLowerCase()));
  if (key) return "교육 숏폼 · " + (key.toLowerCase() === "0dte" ? "제로데이옵션" : key);
  return "교육 숏폼 · 단편";
}
const isEdu = (s) => s.startsWith("교육 숏폼");
// 제목 형태 (해시태그·'| 10/26 옵션 시황' 같은 꼬리는 떼고 본다)
//   질문형: ~까? ~나요?  이유형: 왜·이유  반전형: ~는데/~지만/~에도  나머지 = 뉴스 요약형(사실을 그대로 요약)
const mainTitle = (t) => String(t || "").split("#")[0].replace(/\|\s*\d{1,2}[./]\s?\d{1,2}.*$/, "").replace(/\|\s*26\.\s?\d{2}.*$/, "").trim();
function hookOf(t) {
  const m = mainTitle(t);
  if (/\?|까$|까요|나요|을까|ㄹ까|일까|할까|될까/.test(m)) return "질문형";
  if (/이유|왜\s/.test(m)) return "이유형";
  if (/는데|지만|에도|인데|했더니|대신/.test(m)) return "반전형";
  return "뉴스 요약형";
}

// 시간별 스냅샷 → 업로드 24시간 시점 조회수 (앞뒤 스냅샷을 이어 24h 값을 추정)
function viewsAt(snaps, hours) {
  if (!snaps || !snaps.length) return null;
  const s = [...snaps].sort((a, b) => a.h - b.h);
  const before = s.filter((x) => x.h <= hours).pop(), after = s.find((x) => x.h >= hours);
  if (before && after) {
    if (after.h === before.h) return before.v;
    return Math.round(before.v + (after.v - before.v) * (hours - before.h) / (after.h - before.h));
  }
  if (before && hours - before.h <= 2) return before.v;       // 24h 직전까지만 있으면 근사
  return null;
}

// 운영자가 알려준 큰 변화 (시트 조치이력과 같이 쓴다)
const KNOWN_EVENTS = [
  { date: "2026-10-15", kind: "포맷 변경", series: "시황 숏폼", note: "시황 숏폼 'Options Trend' → '옵션 시황' 포맷, TTS 추가 (10/26 사용자)" },
];
function computeBench(videoRows, snapRows, now = Date.now(), actionRows = []) {
  // 1) 영상 정리 — 2026-05 이후, 제목 있는 공개 영상, 같은 ID는 조회수 큰 행 하나만
  const byId = {};
  videoRows.forEach((r) => {
    const id = r[0], title = r[3], pub = r[22];
    if (!id || !title || title === id || !pub || pub < "2026-05") return;
    const v = { id, title, pub, views: N(r[8]), avp: pctNum(r[7]), subs: N(r[12]), likes: N(r[9]), comments: N(r[10]), dur: durSec(r[4]),
      impr: N(r[5]) || null, ctr: r[6] ? N(r[6]) : null };
    if (!byId[id] || v.views > byId[id].views) byId[id] = v;
  });
  const snapBy = {};
  (snapRows || []).forEach((x) => { const id = String(x[1] || "").trim(), h = Number(x[3]), v = N(x[4]); if (id && !isNaN(h)) (snapBy[id] = snapBy[id] || []).push({ h, v }); });
  let vids = Object.values(byId).map((v) => {
    const form = v.dur > 180 ? "L" : "S";
    const k = kst(v.pub), age = (now - Date.parse(v.pub)) / 86400000;
    return { ...v, form, series: seriesOf(v.title, form), hook: hookOf(v.title), hasNum: /\d/.test(mainTitle(v.title)), tlen: mainTitle(v.title).length, hour: k.getUTCHours(), dow: k.getUTCDay(), bucket: hourBucket(k.getUTCHours()),
      kdate: k.toISOString().slice(0, 10), age: Math.round(age * 10) / 10, v24: viewsAt(snapBy[v.id], 24),
      per1k: v.views ? Math.round(v.subs / v.views * 1000 * 10) / 10 : null };
  });
  // 3편 미만 시리즈는 '단편'으로 합친다 (한두 편으로는 기준값이 안 선다)
  const cnt = {}; vids.forEach((v) => { cnt[v.series] = (cnt[v.series] || 0) + 1; });
  vids = vids.map((v) => (v.series.startsWith("교육 숏폼") && cnt[v.series] < 3) ? { ...v, series: "교육 숏폼 · 단편" } : v);
  // 숏폼은 1주, 롱폼은 2주가 지나면 조회수가 거의 다 찼다고 보고 '다 자란 영상'으로 기준값을 잡는다
  const mature = (v) => v.age >= (v.form === "S" ? 7 : 14);

  // 2) 그룹별 기준값
  // 구독 전환은 동기화가 영상 일부만 받아오던 때(10/26 이전) 0으로 비어 있던 값이 많다 → 절반 이상 채워졌을 때만 쓴다
  const subsOk = vids.filter((v) => v.subs > 0).length >= vids.length * 0.5;
  const stat = (arr, key) => { const xs = arr.map((v) => v[key]).filter((x) => x != null); return xs.length ? { n: xs.length, med: Math.round(median(xs)), p25: Math.round(quant(xs, .25)), p75: Math.round(quant(xs, .75)) } : null; };
  const groups = {};
  const addGroup = (name, arr) => { if (!arr.length) return; const p1 = stat(arr.filter(mature).filter((v) => v.subs > 0 || v.views < 300), "per1k");
    groups[name] = { name, n: arr.length, views: stat(arr.filter(mature), "views"), v24: stat(arr, "v24"), avp: stat(arr.filter(mature).filter((v) => v.avp > 0), "avp"), per1k: subsOk && p1 && p1.med > 0 ? p1 : null }; };
  addGroup("숏폼 전체", vids.filter((v) => v.form === "S"));
  addGroup("롱폼 전체", vids.filter((v) => v.form === "L"));
  [...new Set(vids.map((v) => v.series))].forEach((s) => addGroup(s, vids.filter((v) => v.series === s)));

  // 3) 최근 영상 배지 (같은 형태 안에서 위치)
  const poolViews = { S: vids.filter((v) => v.form === "S" && mature(v)).map((v) => v.views), L: vids.filter((v) => v.form === "L" && mature(v)).map((v) => v.views) };
  const pool24 = { S: vids.filter((v) => v.form === "S" && v.v24 != null).map((v) => v.v24), L: vids.filter((v) => v.form === "L" && v.v24 != null).map((v) => v.v24) };
  const seriesPool24 = {}; vids.forEach((v) => { if (v.v24 != null) (seriesPool24[v.series] = seriesPool24[v.series] || []).push(v.v24); });
  const grade = (p) => p == null ? null : p >= 90 ? "상위 10%" : p >= 75 ? "상위 25%" : p >= 40 ? "보통" : p >= 25 ? "아래쪽" : "하위 25%";
  vids.forEach((v) => {
    v.rank24 = pctRank(pool24[v.form], v.v24);
    v.rank24Series = (seriesPool24[v.series] || []).length >= 4 ? pctRank(seriesPool24[v.series], v.v24) : null;
    v.rankViews = mature(v) ? pctRank(poolViews[v.form], v.views) : null;
    v.grade24 = grade(v.rank24); v.gradeViews = grade(v.rankViews); v.mature = mature(v);
  });
  // 아직 24시간이 안 된 영상(롱폼은 7일): '지금 n시간째 조회수'를 다른 영상들의 같은 시점 조회수와 비교 (실시간 페이스)
  vids.forEach((v) => {
    const sn = snapBy[v.id]; if (!sn || !sn.length) return;
    const last = [...sn].sort((a, b) => b.h - a.h)[0];
    // 지금 추적 중인 영상만: 숏폼 업로드 24시간 안, 롱폼 7일 안 (그 뒤엔 스냅샷이 멈춰 '현재'가 아님)
    if (v.age > (v.form === "S" ? 1 : 7)) return;
    const h = last.h;
    const same = vids.filter((o) => o.id !== v.id && o.form === v.form && o.series === v.series).map((o) => viewsAt(snapBy[o.id], h)).filter((x) => x != null);
    const sameForm = vids.filter((o) => o.id !== v.id && o.form === v.form).map((o) => viewsAt(snapBy[o.id], h)).filter((x) => x != null);
    const pool = same.length >= 4 ? same : sameForm;
    if (pool.length < 4) return;
    v.pace = { h: Math.round(h * 10) / 10, v: last.v, med: Math.round(median(pool)), rank: pctRank(pool, last.v), basis: same.length >= 4 ? v.series : (v.form === "S" ? "숏폼 전체" : "롱폼 전체"), n: pool.length };
    v.pace.grade = grade(v.pace.rank);
  });
  const recent = vids.filter((v) => v.age <= 14).sort((a, b) => b.pub.localeCompare(a.pub));

  // 4) 잘 된 영상 vs 안 된 영상 — 차이가 뚜렷하고 표본이 충분한 것만 (각 그룹 4편 이상, 1.3배 이상)
  const findings = [];
  const cmp = (label, a, b, key, ctx, fmtA, fmtB) => {
    const xa = a.map((v) => v[key]).filter((x) => x != null), xb = b.map((v) => v[key]).filter((x) => x != null);
    if (xa.length < 4 || xb.length < 4) return;
    const ma = median(xa), mb = median(xb); if (!ma || !mb) return;
    const ratio = ma / mb;
    if (ratio < 1.3 && ratio > 1 / 1.3) return;
    const [hi, lo, mh, ml, nh, nl] = ratio >= 1 ? [fmtA, fmtB, ma, mb, xa.length, xb.length] : [fmtB, fmtA, mb, ma, xb.length, xa.length];
    findings.push({ topic: label, ctx, hi, lo, hiMed: Math.round(mh), loMed: Math.round(ml), nHi: nh, nLo: nl, ratio: Math.round(Math.max(ratio, 1 / ratio) * 10) / 10 });
  };
  const S = vids.filter((v) => v.form === "S" && mature(v)), L = vids.filter((v) => v.form === "L" && mature(v));
  const eduS = S.filter((v) => isEdu(v.series)), mktS = S.filter((v) => v.series === "시황 숏폼");
  cmp("숏폼 종류", eduS, mktS, "views", "다 자란 숏폼, 조회수 중간값", "교육 숏폼", "시황 숏폼");
  // 교육 숏폼 안에서만 비교해야 시황(아침 9시 고정)과 섞이지 않는다
  cmp("올리는 시간", eduS.filter((v) => v.hour >= 17), eduS.filter((v) => v.hour < 17), "views", "교육 숏폼만, 조회수 중간값", "오후 5시 이후", "오후 5시 전");
  cmp("올리는 시간", mktS.filter((v) => v.hour >= 12), mktS.filter((v) => v.hour < 12), "views", "시황 숏폼만, 조회수 중간값", "낮·저녁(12시 이후)", "아침(12시 전)");
  cmp("제목 형태", eduS.filter((v) => /\?/.test(v.title)), eduS.filter((v) => !/\?/.test(v.title)), "views", "교육 숏폼만, 조회수 중간값", "물음표 있는 제목", "물음표 없는 제목");
  cmp("제목 형태", eduS.filter((v) => v.title.split("#")[0].trim().length <= 22), eduS.filter((v) => v.title.split("#")[0].trim().length > 22), "views", "교육 숏폼만, 해시태그 뺀 제목 길이", "짧은 제목(22자 이하)", "긴 제목");
  cmp("제목 형태", mktS.filter((v) => !/\|/.test(v.title.replace(/\|\s*\d{2}[./]\d{2}.*$/, ""))), mktS.filter((v) => /\|/.test(v.title.replace(/\|\s*\d{2}[./]\d{2}.*$/, ""))), "views", "시황 숏폼만", "한 문장 제목", "| 로 이어 붙인 제목");
  cmp("롱폼 종류", L.filter((v) => v.series.includes("개념")), L.filter((v) => v.series.includes("화면")), "views", "다 자란 롱폼, 조회수 중간값", "개념 설명", "화면·주문 가이드");
  if (subsOk) cmp("구독 전환", eduS, L, "per1k", "조회 1,000회당 구독", "교육 숏폼", "롱폼");
  Object.keys(groups).filter((g) => !g.endsWith("전체")).forEach((g) => {
    const arr = vids.filter((v) => v.series === g && v.v24 != null && v.age <= 60);
    const a = arr.filter((v) => v.hook !== "뉴스 요약형").map((v) => v.v24), b = arr.filter((v) => v.hook === "뉴스 요약형").map((v) => v.v24);
    if (a.length < 3 || b.length < 3) return;
    const ma = median(a), mb = median(b), r = ma / mb;
    if (r >= 1.5) findings.push({ topic: "제목 형태", ctx: `${g}만, 최근 60일 24시간 조회수`, hi: "질문·이유·반전형 제목", lo: "뉴스 요약형 제목", hiMed: Math.round(ma), loMed: Math.round(mb), nHi: a.length, nLo: b.length, ratio: Math.round(r * 10) / 10 });
  });
  findings.sort((a, b) => b.ratio - a.ratio);

  // 5) 시리즈별 최근 흐름: 최근 14일 vs 그 전 28일 (24시간 조회수 기준 — 나이 차이에 안 흔들림)
  const trends = [];
  Object.keys(groups).filter((g) => !g.endsWith("전체")).forEach((g) => {
    const arr = vids.filter((v) => v.series === g && v.v24 != null);
    const a = arr.filter((v) => v.age <= 14).map((v) => v.v24), b = arr.filter((v) => v.age > 14 && v.age <= 42).map((v) => v.v24);
    if (a.length >= 3 && b.length >= 3) trends.push({ series: g, recentMed: Math.round(median(a)), prevMed: Math.round(median(b)), nRecent: a.length, nPrev: b.length, change: Math.round((median(a) / median(b) - 1) * 100) });
  });

  // 6) 이번 주 해볼 것 — 위 차이에서 바로 나오는 실험만. 각 항목에 '무엇을 재서 판단할지'를 붙인다
  const tryNext = [];
  const f = (topic, pred) => findings.find((x) => x.topic === topic && (!pred || pred(x)));
  const tH = f("올리는 시간", (x) => x.ctx.startsWith("교육"));
  if (tH) tryNext.push({ what: `교육 숏폼은 ${tH.hi}에 올리기`, why: `${tH.hi} ${tH.hiMed.toLocaleString()}회 vs ${tH.lo} ${tH.loMed.toLocaleString()}회 (중간값, ${tH.nHi}편·${tH.nLo}편)`, measure: `이번 주 교육 숏폼이 우리 숏폼 중간값(${(groups["숏폼 전체"]?.views?.med || 0).toLocaleString()}회)을 넘는지` });
  const tK = f("숏폼 종류");
  if (tK && tK.lo === "시황 숏폼") {
    const tM = f("올리는 시간", (x) => x.ctx.startsWith("시황"));
    tryNext.push({ what: tM ? `시황 숏폼을 ${tM.hi}에 올려 보기` : "시황 숏폼 한 편은 교육 숏폼처럼 '질문 하나'로 제목·첫 문장 열기",
      why: `시황 숏폼 중간값 ${tK.loMed.toLocaleString()}회로 교육 숏폼(${tK.hiMed.toLocaleString()}회)의 ${Math.round(tK.loMed / tK.hiMed * 100)}% 수준` + (tM ? ` · 시황끼리도 ${tM.hi} ${tM.hiMed}회 vs ${tM.lo} ${tM.loMed}회` : ""),
      measure: groups["시황 숏폼"]?.v24 ? `시황 숏폼 24시간 조회수가 시황 중간값(${groups["시황 숏폼"].v24.med.toLocaleString()}회)보다 높은지 3편 이상 비교` : `시황 숏폼 1주 조회수가 시황 중간값(${tK.loMed.toLocaleString()}회)보다 높은지 3편 이상 비교` });
  }
  const tT = f("제목 형태", (x) => x.ctx.startsWith("교육"));
  if (tT) tryNext.push({ what: `교육 숏폼 제목을 '${tT.hi}'으로`, why: `${tT.hi} ${tT.hiMed.toLocaleString()}회 vs ${tT.lo} ${tT.loMed.toLocaleString()}회 (중간값)`, measure: "다음 5편 24시간 조회수 중간값 비교" });
  const tS = f("제목 형태", (x) => x.ctx === "시황 숏폼만");
  if (tS) tryNext.push({ what: `시황 숏폼 제목을 '${tS.hi}'으로 (날짜는 맨 끝 한 번만)`, why: `${tS.hi} ${tS.hiMed.toLocaleString()}회 vs ${tS.lo} ${tS.loMed.toLocaleString()}회 (중간값, ${tS.nHi}편·${tS.nLo}편)`, measure: "다음 시황 숏폼 5편 조회수 중간값 비교" });
  const tL = f("롱폼 종류");
  if (tL) tryNext.push({ what: `조회수를 노리는 롱폼은 '${tL.hi}'형으로`, why: `${tL.hi} ${tL.hiMed}회 vs ${tL.lo} ${tL.loMed}회 (다 자란 롱폼 중간값). ${tL.lo === "화면·주문 가이드" ? "화면 가이드는 조회수보다 알림톡·고객 안내용으로 쓰는 게 맞아요" : ""}`.trim(), measure: "다음 롱폼 2주 조회수가 롱폼 중간값을 넘는지" });
  const best = trends.filter((t) => t.series.startsWith("교육")).sort((a, b) => b.recentMed - a.recentMed)[0];
  if (best && best.change > 15) tryNext.push({ what: `요즘 잘 되는 '${best.series.replace("교육 숏폼 · ", "")}' 시리즈 한 편 더`, why: `최근 2주 24시간 조회수 중간값 ${best.recentMed}회, 그 전보다 ${best.change}% 높음`, measure: "같은 시리즈 다음 편이 상위 25%에 드는지" });

  // 7) 흐름 경보 — 10/26 사용자: "시황 숏폼이 포맷 바꾸고 TTS 넣은 직후엔 잘 나오다가 다시 100회도 안 나오는데 이런 걸 못 집는다"
  //    시리즈마다 업로드 순서대로 24시간 조회수를 보고, '잘 나오던 구간 → 최근 구간'이 꺾였는지 / 계속 바닥인지 / 올라왔는지 본다
  //    잘 된 구간과 최근 구간의 차이(제목 형태·업로드 시간·제목 길이·조치이력)를 같이 낸다
  const actions = [...KNOWN_EVENTS, ...(actionRows || []).filter((a) => a[0]).map((a) => { const d = String(a[0]).trim(); return { date: d.length === 8 ? "20" + d : d, vid: (a[1] || "").trim(), kind: (a[2] || "").trim(), note: (a[3] || "").trim() }; })]
    .sort((a, b) => a.date.localeCompare(b.date));
  const alerts = [];
  const cntBy = (arr, f) => { const c = {}; arr.forEach((v) => { const k = f(v); c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "); };
  const describe = (arr) => ({ 편수: arr.length, 중간값: Math.round(median(arr.map((v) => v.v24))), 제목형태: cntBy(arr, (v) => v.hook), 업로드시각: arr.map((v) => v.hour + "시").join("·"),
    제목길이_평균: Math.round(arr.reduce((a, v) => a + v.tlen, 0) / arr.length), 영상: arr.map((v) => ({ id: v.id, date: v.kdate, title: mainTitle(v.title).slice(0, 40), v24: v.v24, hook: v.hook, hour: v.hour })) });
  Object.keys(groups).filter((g) => !g.endsWith("전체")).forEach((g) => {
    const arr = vids.filter((v) => v.series === g && v.v24 != null && v.age <= 60).sort((a, b) => a.pub.localeCompare(b.pub));
    const gm = groups[g].v24 ? groups[g].v24.med : null;
    if (arr.length < 6 || !gm) return;
    const K = Math.min(5, Math.max(3, Math.floor(arr.length / 3)));
    const recentA = arr.slice(-K), before = arr.slice(0, -K);
    const rMed = median(recentA.map((v) => v.v24));
    // 잘 된 구간 = 최근 구간 직전 30일 안에서 24시간 조회수 상위 3편 (날짜순으로 다시 정렬)
    const pool = before.filter((v) => v.age <= 30 + K * 2);
    const top3 = [...pool].sort((a, b) => b.v24 - a.v24).slice(0, 3).sort((a, b) => a.pub.localeCompare(b.pub));
    const peak = top3.length === 3 ? { m: median(top3.map((v) => v.v24)), w: top3 } : null;
    const inRange = (a, b) => actions.filter((x) => x.date >= a && x.date <= b);
    if (peak && peak.m >= gm * 1.8 && rMed <= peak.m * 0.5) {
      const P = describe(peak.w), R = describe(recentA);
      const diffs = [];
      const cur = (a) => a.filter((v) => v.hook !== "뉴스 요약형").length;
      const pc = cur(peak.w), rc = cur(recentA);
      if (pc / peak.w.length - rc / recentA.length >= 0.34) diffs.push(`제목 형태: 잘 된 ${peak.w.length}편 중 ${pc}편이 질문·이유·반전형 → 최근 ${recentA.length}편은 ${rc}편뿐(나머지는 뉴스 요약형)`);
      else if (P.제목형태 !== R.제목형태) diffs.push(`제목 형태: 잘 된 구간 ${P.제목형태} → 최근 ${R.제목형태}`);
      const ph = peak.w.map((v) => v.hour), rh = recentA.map((v) => v.hour);
      if (Math.abs(median(ph) - median(rh)) >= 3) diffs.push(`업로드 시각: 잘 된 구간 ${P.업로드시각} → 최근 ${R.업로드시각}`);
      if (Math.abs(P.제목길이_평균 - R.제목길이_평균) >= 6) diffs.push(`제목 길이: 잘 된 구간 평균 ${P.제목길이_평균}자 → 최근 ${R.제목길이_평균}자`);
      const acts = inRange(peak.w[0].kdate, recentA[recentA.length - 1].kdate);
      alerts.push({ type: "꺾임", series: g, level: "bad", curiousPeak: pc, curiousRecent: rc,
        title: `${g}: ${peak.w.map((v) => v.kdate.slice(5).replace("-", "/")).join("·")}엔 잘 나왔는데 최근 ${K}편은 다시 떨어졌어요`,
        detail: `잘 된 3편 24시간 중간값 ${Math.round(peak.m)}회 → 최근 ${K}편 ${Math.round(rMed)}회 (시리즈 평소 ${gm}회)`,
        peak: P, recent: R, diffs, actions: acts });
    } else if (recentA.length >= 4 && recentA.slice(-4).every((v) => v.v24 < (groups[g].v24.p25 || 0))) {
      alerts.push({ type: "부진", series: g, level: "warn", title: `${g}: 최근 4편 연속 시리즈 하위 25%(${groups[g].v24.p25}회 미만)`,
        detail: `최근 ${K}편 24시간 중간값 ${Math.round(rMed)}회 (평소 ${gm}회)`, recent: describe(recentA), diffs: [], actions: inRange(recentA[0].kdate, recentA[recentA.length - 1].kdate) });
    } else if (rMed >= gm * 1.6) {
      alerts.push({ type: "상승", series: g, level: "good", title: `${g}: 최근 ${K}편이 평소보다 잘 나오고 있어요`,
        detail: `최근 ${K}편 24시간 중간값 ${Math.round(rMed)}회 (평소 ${gm}회)`, recent: describe(recentA), diffs: [], actions: inRange(recentA[0].kdate, recentA[recentA.length - 1].kdate) });
    }
  });
  // 조치 전후: 시리즈가 지정된 조치는 그 시리즈, 아니면 같은 형태 전체에서 조치 전 최대 10편 vs 조치 후 편들 (24시간 조회수)
  const actionEffects = actions.filter((a) => a.date >= "2026-05").map((a) => {
    const target = a.series ? vids.filter((v) => v.series === a.series) : a.vid ? [] : vids.filter((v) => v.form === "S");
    const arr = target.filter((v) => v.v24 != null).sort((x, y) => x.pub.localeCompare(y.pub));
    const pre = arr.filter((v) => v.kdate < a.date).slice(-10), post = arr.filter((v) => v.kdate >= a.date);
    if (pre.length < 3 || post.length < 2) return null;
    const m1 = median(pre.map((v) => v.v24)), m2 = median(post.map((v) => v.v24));
    const post3 = post.slice(0, 3), postLast = post.slice(-Math.min(5, post.length));
    return { ...a, target: a.series || "숏폼 전체", preN: pre.length, preMed: Math.round(m1), postN: post.length, postMed: Math.round(m2),
      first3Med: Math.round(median(post3.map((v) => v.v24))), lastMed: Math.round(median(postLast.map((v) => v.v24))), lastN: postLast.length,
      change: Math.round((m2 / m1 - 1) * 100),
      postHooks: cntBy(post, (v) => v.hook) };
  }).filter(Boolean);
  alerts.sort((a, b) => ({ bad: 0, warn: 1, good: 2 }[a.level] - { bad: 0, warn: 1, good: 2 }[b.level]));
  // 꺾임 경보는 '이번 주 해볼 것' 맨 앞에: 잘 된 구간의 공통점으로 되돌리기
  alerts.filter((a) => a.type === "꺾임" && a.curiousPeak > a.curiousRecent).reverse().forEach((a) => {
    const how = a.curiousPeak > a.curiousRecent ? "질문·이유·반전형 제목(예: '~했을까?', '~늘어난 이유', '~올랐는데 ~')" : "잘 된 편들과 같은 형식";
    tryNext.unshift({ what: `${a.series}: 잘 나왔던 편들처럼 ${how}으로 3편 연속 올려 보기`,
      why: `${a.detail}. ${a.diffs[0] || "잘 된 구간과 최근 구간의 차이를 아래 경보에서 확인하세요"}`, measure: `3편의 24시간 조회수 중간값이 시리즈 평소(${groups[a.series].v24.med}회)를 넘는지` });
  });

  return { at: new Date(now).toISOString(), videos: vids, groups: Object.values(groups), recent, findings, trends, tryNext: tryNext.slice(0, 3), alerts, actions, actionEffects,
    coverage: { videos: vids.length, with24h: vids.filter((v) => v.v24 != null).length, mature: vids.filter(mature).length } };
}

module.exports = { computeBench, seriesOf, viewsAt };
