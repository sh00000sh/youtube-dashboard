// ===================================================================
// 📸 인스타그램 성과 수집 (Instagram API with Instagram Login · graph.instagram.com)
//   10/26 사용자: 인스타는 유튜브와 따로 탭. 미주옵·회사 계정을 나눠 보고 두 계정을 비교
//   - 두 계정 모두 프로페셔널 계정(미주옵: 카테고리 '블로거')이라 페이스북 페이지 연결 없이 API 사용 가능
//   - Railway 변수: IG_TOKEN_MIZUOP, IG_TOKEN_COMPANY (메타 개발자 앱에서 만든 장기 토큰, 60일)
//   - 3시간마다 최근 게시물 50개와 각 게시물 인사이트를 받아 '인스타_게시물' 탭에 갱신, 팔로워 수는 '인스타_계정' 탭에 기록
// ===================================================================
const IG_VER = process.env.IG_API_VERSION || "v23.0";
const IG_POST_TAB = process.env.IG_POST_TAB || "인스타_게시물";
const IG_ACC_TAB = process.env.IG_ACC_TAB || "인스타_계정";
const IG_COLS = ["계정", "미디어ID", "게시시각", "형식", "첫줄", "링크", "도달", "조회", "좋아요", "댓글", "저장", "공유", "팔로우", "프로필방문", "릴스평균시청초", "갱신시각"];
const ACCOUNTS = [
  { key: "미주옵", env: "IG_TOKEN_MIZUOP", handle: "mizuop_kr" },
  { key: "회사", env: "IG_TOKEN_COMPANY", handle: "eugeneoptions" },
];

module.exports = function setupIg({ app, getSheetsClient, ensureTab, SHEET_ID }) {
  const tokens = {};   // 메모리 안에서 갱신한 토큰 (서버가 켜져 있는 동안 60일 만료를 계속 미룬다)
  const state = {};    // 계정별 상태
  ACCOUNTS.forEach((a) => { tokens[a.key] = process.env[a.env] || ""; state[a.key] = { key: a.key, handle: a.handle, configured: !!tokens[a.key], ok: false, error: null, followers: null, mediaCount: null, lastSync: null, tokenExpiresAt: null }; });

  const g = async (path, params, key) => {
    const q = new URLSearchParams({ ...params, access_token: tokens[key] });
    const r = await fetch(`https://graph.instagram.com/${IG_VER}/${path}?${q}`);
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message || "API 오류"); e.code = j.error.code; throw e; }
    return j;
  };
  const fmtType = (m) => (m.media_product_type === "REELS" ? "릴스" : m.media_type === "CAROUSEL_ALBUM" ? "캐러셀" : m.media_type === "VIDEO" ? "영상" : "사진");
  // 형식마다 지원하는 지표가 달라서, 안 되면 작은 묶음으로 다시 요청
  const METRICS = {
    REELS: [["reach", "views", "likes", "comments", "saved", "shares", "ig_reels_avg_watch_time"], ["reach", "likes", "comments", "saved", "shares"]],
    FEED: [["reach", "views", "likes", "comments", "saved", "shares", "follows", "profile_visits"], ["reach", "likes", "comments", "saved", "shares"], ["reach"]],
  };
  async function insightsOf(m, key) {
    const sets = METRICS[m.media_product_type === "REELS" ? "REELS" : "FEED"];
    for (const set of sets) {
      try {
        const j = await g(`${m.id}/insights`, { metric: set.join(",") }, key);
        const o = {}; (j.data || []).forEach((d) => { o[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null; });
        return o;
      } catch (_) { /* 다음 묶음 */ }
    }
    return {};
  }

  async function syncAccount(acc, sheets, idRow) {
    const st = state[acc.key];
    if (!tokens[acc.key]) { st.configured = false; return []; }
    try {
      const me = await g("me", { fields: "user_id,username,followers_count,media_count" }, acc.key);
      st.followers = me.followers_count ?? null; st.mediaCount = me.media_count ?? null; st.handle = me.username || acc.handle;
      const media = await g("me/media", { fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count", limit: 50 }, acc.key);
      const rows = [];
      for (const m of media.data || []) {
        const ins = await insightsOf(m, acc.key);
        const first = String(m.caption || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
        rows.push([acc.key, m.id, m.timestamp, fmtType(m), first.slice(0, 120), m.permalink || "",
          ins.reach ?? "", ins.views ?? "", ins.likes ?? m.like_count ?? "", ins.comments ?? m.comments_count ?? "", ins.saved ?? "", ins.shares ?? "",
          ins.follows ?? "", ins.profile_visits ?? "", ins.ig_reels_avg_watch_time != null ? Math.round(ins.ig_reels_avg_watch_time / 100) / 10 : "", new Date().toISOString()]);
      }
      // 시트에 갱신(있으면 그 줄, 없으면 아래에 추가)
      const upd = [], app = [];
      rows.forEach((r) => { const at = idRow[r[1]]; if (at) upd.push({ range: `${IG_POST_TAB}!A${at}:P${at}`, values: [r] }); else app.push(r); });
      for (let i = 0; i < upd.length; i += 200) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: "RAW", data: upd.slice(i, i + 200) } });
      if (app.length) await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${IG_POST_TAB}!A:P`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: app } });
      await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${IG_ACC_TAB}!A:D`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
        requestBody: { values: [[new Date().toISOString(), acc.key, st.followers ?? "", st.mediaCount ?? ""]] } });
      st.ok = true; st.error = null; st.lastSync = new Date().toISOString();
      return rows;
    } catch (e) {
      st.ok = false;
      st.error = e.code === 190 ? "토큰이 만료됐거나 잘못됐어요. 메타 개발자 앱에서 새 토큰을 만들어 Railway 변수에 넣어 주세요." : e.message;
      return [];
    }
  }
  async function refreshTokens() {
    for (const a of ACCOUNTS) {
      if (!tokens[a.key]) continue;
      try {
        const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tokens[a.key])}`);
        const j = await r.json();
        if (j.access_token) { tokens[a.key] = j.access_token; state[a.key].tokenExpiresAt = new Date(Date.now() + (j.expires_in || 0) * 1000).toISOString(); }
      } catch (_) {}
    }
  }
  let syncing = false;
  async function igSync() {
    if (syncing || !SHEET_ID || !ACCOUNTS.some((a) => tokens[a.key])) return;
    syncing = true;
    try {
      const sheets = getSheetsClient();
      await ensureTab(sheets, IG_POST_TAB, IG_COLS);
      await ensureTab(sheets, IG_ACC_TAB, ["시각", "계정", "팔로워", "게시물수"]);
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${IG_POST_TAB}!B2:B` });
      const idRow = {}; (r.data.values || []).forEach((x, i) => { if (x[0]) idRow[x[0]] = i + 2; });
      for (const a of ACCOUNTS) await syncAccount(a, sheets, idRow);
    } finally { syncing = false; }
  }

  app.get("/api/ig", async (req, res) => {
    try {
      let posts = [], history = [];
      try {
        const sheets = getSheetsClient();
        const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: [`${IG_POST_TAB}!A2:P`, `${IG_ACC_TAB}!A2:D`] });
        posts = (r.data.valueRanges?.[0]?.values || []).filter((x) => x[1]).map((x) => Object.fromEntries(IG_COLS.map((k, i) => [k, x[i] ?? ""])));
        history = (r.data.valueRanges?.[1]?.values || []).map((x) => ({ at: x[0], account: x[1], followers: Number(x[2] || 0), media: Number(x[3] || 0) }));
      } catch (_) { /* 탭 없음 */ }
      res.json({ ok: true, accounts: Object.values(state), posts, history });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  setInterval(() => igSync().catch(() => {}), 3 * 60 * 60 * 1000);
  setTimeout(() => igSync().catch(() => {}), 60 * 1000);
  setInterval(() => refreshTokens().catch(() => {}), 24 * 60 * 60 * 1000);
  setTimeout(() => refreshTokens().catch(() => {}), 90 * 1000);
};
