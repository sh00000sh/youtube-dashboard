// ===================================================================
//  유튜브 인게이지먼트 자동 수집 대시보드  (v2)
//
//  하는 일:
//   1) YouTube Analytics API(OAuth)로 채널/영상 숫자를 가져옴
//      - 조회수, 좋아요, 댓글, 공유, 구독자증감, 구독전환,
//        평균조회율, 시청지속률, 평균시청시간
//      - (노출수·CTR은 구글이 API로 안 열어줘서 제외 = 스튜디오 전용)
//   2) YouTube Data API로 영상 제목/길이/업로드일 보충
//   3) 구글 시트(일별 / 영상별 탭)에 자동으로 기록
//   4) 대시보드 화면이 그 시트를 읽어 예쁘게 보여줌
// ===================================================================

const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ----- 환경변수(열쇠들) -----
const {
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_REFRESH_TOKEN,
  GOOGLE_SERVICE_ACCOUNT, // 서비스계정 JSON 통째로
  SHEET_ID,               // 구글 시트 ID
  CHANNEL_ID,             // UCkitMbZJ1j6P2RLf_tbklQQ
  YOUTUBE_API_KEY,
} = process.env;

const DAYS = Number(process.env.SYNC_DAYS || 30);     // 며칠치 가져올지 (기본 30일)
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS || 50);

// 시트 탭 이름 / 데이터 시작 행
const DAILY_TAB = process.env.DAILY_TAB || "일별";
const VIDEO_TAB = process.env.VIDEO_TAB || "영상별";
const DAILY_FIRST_ROW = Number(process.env.DAILY_FIRST_ROW || 7);  // 일별 데이터 시작 행
const VIDEO_FIRST_ROW = Number(process.env.VIDEO_FIRST_ROW || 3);  // 영상별 데이터 시작 행

// ----- 구글 인증 준비 -----
// (1) 채널 분석용: OAuth (내가 채널 주인이다)
function getOAuth() {
  const o = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
  o.setCredentials({ refresh_token: OAUTH_REFRESH_TOKEN });
  return o;
}
// 서비스계정 JSON 파싱: 그냥 JSON이든 Base64로 인코딩된 거든 둘 다 처리
function parseServiceAccount(raw) {
  let s = (raw || "").trim();
  if (!s.startsWith("{")) {
    // { 로 시작 안 하면 Base64로 보고 디코딩
    s = Buffer.from(s, "base64").toString("utf8").trim();
  }
  return JSON.parse(s);
}

// (2) 시트 쓰기용: 서비스계정(로봇)
function getSheetsClient() {
  const creds = parseServiceAccount(GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ----- 날짜 도우미 -----
function ymd(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
// 시트 날짜(26-06-02) → API용(2026-06-02) 정규화
function fullDate(s) {
  s = String(s || "").trim();
  if (/^\d{2}-\d{2}-\d{2}$/.test(s)) return "20" + s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return "2020-01-01";
}
// 초 -> "m:ss"
function secToMMSS(sec) {
  sec = Math.round(Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
// ISO8601 길이(PT1M30S) -> "1:30"
function isoDurToMMSS(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return "";
  const h = Number(m[1] || 0), mi = Number(m[2] || 0), s = Number(m[3] || 0);
  const total = h * 3600 + mi * 60 + s;
  return secToMMSS(total);
}

// ===================================================================
//  유튜브에서 숫자 가져오기
// ===================================================================

// 채널 "일별" 분석 (날짜별 한 줄)
async function fetchChannelDaily(auth) {
  const ya = google.youtubeAnalytics({ version: "v2", auth });
  const res = await ya.reports.query({
    ids: "channel==MINE",
    startDate: ymd(daysAgo(DAYS)),
    endDate: ymd(new Date()),
    dimensions: "day",
    metrics:
      "views,likes,comments,shares,subscribersGained,subscribersLost,averageViewPercentage,averageViewDuration",
    sort: "day",
  });
  const rows = res.data.rows || [];
  // 컬럼 순서 = metrics 순서
  return rows.map((r) => ({
    date: r[0],
    views: Number(r[1] || 0),
    likes: Number(r[2] || 0),
    comments: Number(r[3] || 0),
    shares: Number(r[4] || 0),
    subsGained: Number(r[5] || 0),
    subsLost: Number(r[6] || 0),
    subsNet: Number(r[5] || 0) - Number(r[6] || 0), // 구독자 증감(순)
    avgViewPct: Number(r[7] || 0),                   // 평균조회율(%) = 시청지속률
    avgViewDurSec: Number(r[8] || 0),                // 평균시청시간(초)
  }));
}

// 영상별 분석 (영상 한 줄)
async function fetchVideoAnalytics(auth) {
  const ya = google.youtubeAnalytics({ version: "v2", auth });
  const res = await ya.reports.query({
    ids: "channel==MINE",
    startDate: ymd(daysAgo(DAYS)),
    endDate: ymd(new Date()),
    dimensions: "video",
    metrics:
      "views,likes,comments,shares,subscribersGained,averageViewPercentage,averageViewDuration",
    sort: "-views",
    maxResults: MAX_VIDEOS,
  });
  const rows = res.data.rows || [];
  return rows.map((r) => ({
    video_id: r[0],
    views: Number(r[1] || 0),
    likes: Number(r[2] || 0),
    comments: Number(r[3] || 0),
    shares: Number(r[4] || 0),
    subsGained: Number(r[5] || 0), // 구독전환
    avgViewPct: Number(r[6] || 0),
    avgViewDurSec: Number(r[7] || 0),
  }));
}

// 채널 정보 (배너/이름/구독자/누적조회수) — Data API, 공개 정보
async function fetchChannelInfo() {
  if (!CHANNEL_ID || !YOUTUBE_API_KEY) return null;
  const url =
    "https://www.googleapis.com/youtube/v3/channels" +
    "?part=snippet,statistics,brandingSettings&id=" + CHANNEL_ID +
    "&key=" + YOUTUBE_API_KEY;
  const data = await (await fetch(url)).json();
  if (data.error) throw new Error(data.error.message);
  const it = (data.items || [])[0];
  if (!it) return null;
  return {
    title: it.snippet.title,
    avatar: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
    banner: it.brandingSettings?.image?.bannerExternalUrl || "",
    subscribers: Number(it.statistics.subscriberCount || 0),
    totalViews: Number(it.statistics.viewCount || 0),
    url: "https://www.youtube.com/channel/" + it.id,
  };
}

// 영상 제목/길이/업로드일 보충 (Data API)
async function fetchVideoMeta(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      "https://www.googleapis.com/youtube/v3/videos" +
      "?part=snippet,contentDetails&id=" + chunk.join(",") +
      "&key=" + YOUTUBE_API_KEY;
    const data = await (await fetch(url)).json();
    if (data.error) throw new Error(data.error.message);
    for (const it of data.items || []) {
      out[it.id] = {
        title: it.snippet.title,
        publishedAt: it.snippet.publishedAt.slice(0, 10),
        duration: isoDurToMMSS(it.contentDetails.duration),
      };
    }
  }
  return out;
}

// 그날 업로드된 영상 수 세기 (날짜 -> 개수)
async function fetchUploadsPerDay(metaList) {
  const counter = {};
  for (const m of metaList) {
    if (!m.publishedAt) continue;
    counter[m.publishedAt] = (counter[m.publishedAt] || 0) + 1;
  }
  return counter;
}

// ===================================================================
//  구글 시트에 쓰기
// ===================================================================

// 특정 탭의 한 열(예: 날짜 열)을 읽어서 "값 -> 행번호" 지도 만들기
async function readColumn(sheets, tab, colLetter, firstRow) {
  const range = `${tab}!${colLetter}${firstRow}:${colLetter}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  const vals = res.data.values || [];
  const map = {};
  vals.forEach((row, i) => {
    const v = (row[0] || "").toString().trim();
    if (v) map[v] = firstRow + i;
  });
  return { map, nextEmptyRow: firstRow + vals.length };
}

// 일별 탭 기록
// 컬럼: B날짜 C구독자 D추가된영상 E좋아요 F댓글 G공유 H조회수
//       I노출수(건드림X) J노출CTR(X) K평균조회율 L시청지속률 M평균시청시간
async function writeDaily(sheets, daily, uploadsPerDay) {
  // 날짜는 B열. 날짜 형식을 시트와 맞춤: 시트가 "26-06-14" 형태였음 → YY-MM-DD
  const toSheetDate = (iso) => iso.slice(2); // 2026-06-14 -> 26-06-14
  const { map, nextEmptyRow } = await readColumn(sheets, DAILY_TAB, "B", DAILY_FIRST_ROW);

  const updates = [];
  let appendRow = nextEmptyRow;

  for (const d of daily) {
    const sd = toSheetDate(d.date);
    let row = map[sd];
    if (!row) { row = appendRow++; }

    // 같은 줄에 B~H, K~M 만 채움 (I,J 노출수/CTR 과 N 특이사항은 안 건드림)
    // 두 묶음으로 나눠서 기록 (I,J 건너뛰기 위해)
    updates.push({
      range: `${DAILY_TAB}!B${row}:H${row}`,
      values: [[
        sd,
        d.subsNet,
        uploadsPerDay[d.date] || 0,
        d.likes,
        d.comments,
        d.shares,
        d.views,
      ]],
    });
    updates.push({
      range: `${DAILY_TAB}!K${row}:M${row}`,
      values: [[
        d.avgViewPct / 100,        // 평균조회율 (%표시 셀이면 0.65 형태)
        d.avgViewPct / 100,        // 시청지속률 (동일 값 사용)
        secToMMSS(d.avgViewDurSec),// 평균시청시간
      ]],
    });
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    });
  }
  return daily.length;
}

// 영상별 탭 기록
// 컬럼: B업로드일 C형태(X) D타이틀 E영상길이 F노출수(X) G CTR(X)
//       H평균조회율 I조회수 J좋아요 K댓글 L공유 M구독전환
async function writeVideos(sheets, videos, meta) {
  const { map, nextEmptyRow } = await readColumn(sheets, VIDEO_TAB, "D", VIDEO_FIRST_ROW); // 타이틀 기준
  const updates = [];
  let appendRow = nextEmptyRow;

  for (const v of videos) {
    const m = meta[v.video_id] || {};
    const title = m.title || v.video_id;
    let row = map[title];
    if (!row) { row = appendRow++; }

    // A: 영상ID (재생용, 보통 숨겨두는 열), B: 업로드일
    updates.push({
      range: `${VIDEO_TAB}!A${row}`,
      values: [[v.video_id]],
    });
    updates.push({
      range: `${VIDEO_TAB}!B${row}`,
      values: [[m.publishedAt || ""]],
    });
    updates.push({
      range: `${VIDEO_TAB}!D${row}:E${row}`,
      values: [[title, m.duration || ""]],
    });
    // H~M 채움 (F노출수 G CTR 은 안 건드림)
    updates.push({
      range: `${VIDEO_TAB}!H${row}:M${row}`,
      values: [[
        v.avgViewPct / 100, // 평균조회율
        v.views,
        v.likes,
        v.comments,
        v.shares,
        v.subsGained,       // 구독전환
      ]],
    });
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    });
  }
  return videos.length;
}

// 대시보드 화면이 읽을 데이터 (시트 그대로 읽어서 반환)
async function readForDashboard(sheets) {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: [`${DAILY_TAB}!B${DAILY_FIRST_ROW}:N`, `${VIDEO_TAB}!A${VIDEO_FIRST_ROW}:V`],
  });
  return {
    daily: res.data.valueRanges?.[0]?.values || [],
    videos: res.data.valueRanges?.[1]?.values || [],
  };
}

// ===================================================================
//  API
// ===================================================================

app.post("/api/sync", async (req, res) => {
  let step = "초기화";
  try {
    const missing = [];
    if (!OAUTH_CLIENT_ID) missing.push("OAUTH_CLIENT_ID");
    if (!OAUTH_CLIENT_SECRET) missing.push("OAUTH_CLIENT_SECRET");
    if (!OAUTH_REFRESH_TOKEN) missing.push("OAUTH_REFRESH_TOKEN");
    if (!GOOGLE_SERVICE_ACCOUNT) missing.push("GOOGLE_SERVICE_ACCOUNT");
    if (!SHEET_ID) missing.push("SHEET_ID");
    if (missing.length) {
      return res.status(400).json({ ok: false, error: "환경변수 누락: " + missing.join(", ") });
    }

    const auth = getOAuth();
    const sheets = getSheetsClient();

    // 1) 채널 일별
    step = "채널분석(Analytics)";
    const daily = await fetchChannelDaily(auth);

    // 2) 영상별
    step = "영상분석(Analytics)";
    const vids = await fetchVideoAnalytics(auth);
    step = "영상정보(Data API)";
    const meta = await fetchVideoMeta(vids.map((v) => v.video_id));
    const uploadsPerDay = await fetchUploadsPerDay(Object.values(meta));

    // 3) 시트에 쓰기
    step = "시트쓰기(일별)";
    const dCount = await writeDaily(sheets, daily, uploadsPerDay);
    step = "시트쓰기(영상별)";
    const vCount = await writeVideos(sheets, vids, meta);

    res.json({ ok: true, dailyRows: dCount, videoRows: vCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: `[${step}] ${e.message}` });
  }
});

// 영상 하나의 "게시 후 일자별" 추이 (조회/좋아요/댓글/공유/구독/평균조회율)
app.post("/api/video", async (req, res) => {
  try {
    const id = (req.body && req.body.id) || req.query.id;
    const start = fullDate((req.body && req.body.start) || req.query.start);
    if (!id) return res.status(400).json({ ok: false, error: "영상 id 없음" });
    const auth = getOAuth();
    const ya = google.youtubeAnalytics({ version: "v2", auth });
    const r = await ya.reports.query({
      ids: "channel==MINE",
      filters: "video==" + id,
      startDate: start,
      endDate: ymd(new Date()),
      dimensions: "day",
      metrics: "views,likes,comments,shares,subscribersGained,averageViewPercentage",
      sort: "day",
    });
    const rows = (r.data.rows || []).map((x) => ({
      date: x[0], views: Number(x[1]||0), likes: Number(x[2]||0),
      comments: Number(x[3]||0), shares: Number(x[4]||0),
      subs: Number(x[5]||0), avp: Number(x[6]||0),
    }));
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    if (!GOOGLE_SERVICE_ACCOUNT || !SHEET_ID) {
      return res.json({ ok: true, daily: [], videos: [] });
    }
    const sheets = getSheetsClient();
    const data = await readForDashboard(sheets);
    let channel = null;
    try { channel = await fetchChannelInfo(); } catch (_) {}
    res.json({ ok: true, channel, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===================================================================
//  시간별 스냅샷 로봇 (업로드 후 24시간, 1시간 간격 자동 기록)
// ===================================================================
const SNAP_TAB = process.env.SNAP_TAB || "시간별스냅샷";

// 탭 없으면 만들고 헤더 깔기
async function ensureTab(sheets, title, header) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${title}!A1`,
      valueInputOption: "RAW", requestBody: { values: [header] },
    });
  }
}

// 한 번 스냅샷: 최근 24시간 내 게시된 영상의 현재 조회수를 기록
async function snapshotJob() {
  if (!CHANNEL_ID || !YOUTUBE_API_KEY || !GOOGLE_SERVICE_ACCOUNT || !SHEET_ID) return 0;
  const sheets = getSheetsClient();
  // 업로드 재생목록
  const ch = await (await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}&key=${YOUTUBE_API_KEY}`)).json();
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return 0;
  const pl = await (await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&maxResults=15&playlistId=${uploads}&key=${YOUTUBE_API_KEY}`)).json();
  const now = Date.now();
  const recent = (pl.items || []).map((it) => ({
    id: it.contentDetails.videoId,
    publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
    title: it.snippet.title,
  })).filter((v) => ((now - new Date(v.publishedAt).getTime()) / 3600000) <= 24.5);
  if (!recent.length) return 0;

  const ids = recent.map((v) => v.id);
  const stat = await (await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}&key=${YOUTUBE_API_KEY}`)).json();
  const sm = {}; (stat.items || []).forEach((it) => sm[it.id] = it.statistics);

  await ensureTab(sheets, SNAP_TAB, ["타임스탬프", "영상ID", "제목", "게시후시간(H)", "조회수", "좋아요", "댓글"]);
  const rows = recent.map((v) => {
    const s = sm[v.id] || {};
    const hrs = (now - new Date(v.publishedAt).getTime()) / 3600000;
    return [new Date().toISOString(), v.id, v.title, Number(hrs.toFixed(2)),
      Number(s.viewCount || 0), Number(s.likeCount || 0), Number(s.commentCount || 0)];
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${SNAP_TAB}!A:G`,
    valueInputOption: "USER_ENTERED", requestBody: { values: rows },
  });
  console.log(`📸 스냅샷 기록: ${rows.length}개 영상`);
  return rows.length;
}

// 수동 트리거
app.post("/api/snapshot", async (req, res) => {
  try { const n = await snapshotJob(); res.json({ ok: true, count: n }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 특정 영상의 시간별 스냅샷 읽기 (24시간 그래프용)
app.get("/api/video-hourly", async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ ok: false, error: "id 없음" });
    const sheets = getSheetsClient();
    let rows = [];
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SNAP_TAB}!A2:G` });
      rows = (r.data.values || []).filter((x) => x[1] === id).map((x) => ({
        hours: Number(x[3] || 0), views: Number(x[4] || 0),
        likes: Number(x[5] || 0), comments: Number(x[6] || 0),
      })).sort((a, b) => a.hours - b.hours);
    } catch (_) {}
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 1시간마다 자동 스냅샷 (서버 항상 켜져 있으니 별도 Cron 불필요)
setInterval(() => snapshotJob().catch((e) => console.log("snapshot err:", e.message)), 60 * 60 * 1000);
setTimeout(() => snapshotJob().catch(() => {}), 15000); // 서버 켜지고 15초 뒤 1회

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 대시보드 실행 중: http://localhost:${PORT}`));
