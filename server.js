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
const fs = require("fs");
const { google } = require("googleapis");

// 과거(6/1 이전) 영상 비교 데이터 — 변동성이 낮아 한 번 계산해 고정(하드코딩). 현재 영상만 라이브 계산.
const COMPARE_CUTOFF = "2026-06-01";
let PAST_COMPARE = [];
try { PAST_COMPARE = JSON.parse(fs.readFileSync(path.join(__dirname, "compare_past.json"), "utf8")); }
catch (_) { console.log("compare_past.json 없음 — 과거 비교 데이터 비어있음"); }

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
// 초기 반응 측정: ①수동 입력(영상초기반응 탭, 시간 단위 — 최우선) ②없으면 Analytics 첫 N일(소급)
const EARLY_DAYS = Number(process.env.EARLY_DAYS || 1);       // 자동 폴백: 게시 첫 N일
const EARLY_WINDOW_H = Number(process.env.EARLY_WINDOW_H || 6); // 수동 입력 기준 시간(6h)
const HOURFIX_TAB = process.env.HOURFIX_TAB || "영상초기반응";  // 영상별 1~6h 누적조회수 직접 입력

// ----- 관리자 모드 -----
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";   // Railway 환경변수로 설정
const CONFIG_TAB = process.env.CONFIG_TAB || "_설정";      // KPI·제목 등 설정 JSON 저장 탭
function checkPw(pw) { return !!ADMIN_PASSWORD && pw === ADMIN_PASSWORD; }

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
        publishedFull: it.snippet.publishedAt,           // 전체 게시시각(ISO, 시간 포함)
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
    // W열: 전체 게시시각(ISO) — 시간대 분석용 (보이지 않는 열)
    updates.push({
      range: `${VIDEO_TAB}!W${row}`,
      values: [[m.publishedFull || ""]],
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
    ranges: [`${DAILY_TAB}!B${DAILY_FIRST_ROW}:N`, `${VIDEO_TAB}!A${VIDEO_FIRST_ROW}:W`],
  });
  return {
    daily: res.data.valueRanges?.[0]?.values || [],
    videos: res.data.valueRanges?.[1]?.values || [],
  };
}

// ===================================================================
//  API
// ===================================================================

async function runSync() {
  let step = "초기화";
  try {
    const missing = [];
    if (!OAUTH_CLIENT_ID) missing.push("OAUTH_CLIENT_ID");
    if (!OAUTH_CLIENT_SECRET) missing.push("OAUTH_CLIENT_SECRET");
    if (!OAUTH_REFRESH_TOKEN) missing.push("OAUTH_REFRESH_TOKEN");
    if (!GOOGLE_SERVICE_ACCOUNT) missing.push("GOOGLE_SERVICE_ACCOUNT");
    if (!SHEET_ID) missing.push("SHEET_ID");
    if (missing.length) throw new Error("환경변수 누락: " + missing.join(", "));

    const auth = getOAuth();
    const sheets = getSheetsClient();

    step = "채널분석(Analytics)";
    const daily = await fetchChannelDaily(auth);

    step = "영상분석(Analytics)";
    const vids = await fetchVideoAnalytics(auth);
    step = "영상정보(Data API)";
    const meta = await fetchVideoMeta(vids.map((v) => v.video_id));
    const uploadsPerDay = await fetchUploadsPerDay(Object.values(meta));

    step = "시트쓰기(일별)";
    const dCount = await writeDaily(sheets, daily, uploadsPerDay);
    step = "시트쓰기(영상별)";
    const vCount = await writeVideos(sheets, vids, meta);

    return { dailyRows: dCount, videoRows: vCount };
  } catch (e) {
    throw new Error(`[${step}] ${e.message}`);
  }
}
app.post("/api/sync", async (req, res) => {
  try { res.json({ ok: true, ...(await runSync()) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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

// 실시간 — 현재 시점 채널/영상 누적 지표(지연 없음). OAuth로 예약(공개예정) 영상도 포함
app.get("/api/live", async (req, res) => {
  try {
    if (!CHANNEL_ID) return res.status(400).json({ ok: false, error: "CHANNEL_ID 누락" });
    const yt = google.youtube({ version: "v3", auth: getOAuth() }); // OAuth → 예약/비공개 영상도 조회 가능
    const ch = await yt.channels.list({ part: "statistics,contentDetails", id: CHANNEL_ID });
    const st = ch.data.items?.[0]?.statistics || {};
    const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    let videos = [];
    if (uploads) {
      const pl = await yt.playlistItems.list({ part: "contentDetails", maxResults: 15, playlistId: uploads });
      const ids = (pl.data.items || []).map((it) => it.contentDetails.videoId);
      if (ids.length) {
        const vs = await yt.videos.list({ part: "snippet,statistics,status,contentDetails", id: ids.join(",") });
        videos = (vs.data.items || [])
          // 공개 영상 OR 예약 영상(공개예정 시각 있음)만 — 그냥 비공개/일부공개는 제외
          .filter((it) => it.status?.privacyStatus === "public" || it.status?.publishAt)
          .map((it) => ({
            id: it.id, title: it.snippet.title, publishedAt: it.snippet.publishedAt,
            duration: isoDurToMMSS(it.contentDetails?.duration),   // 숏폼/롱폼 구분용
            views: Number(it.statistics?.viewCount || 0),
            likes: Number(it.statistics?.likeCount || 0),
            comments: Number(it.statistics?.commentCount || 0),
            scheduled: it.status?.privacyStatus !== "public" && !!it.status?.publishAt,
            publishAt: it.status?.publishAt || null,
          }));
      }
    }
    res.json({
      ok: true, at: new Date().toISOString(),
      channel: { subscribers: Number(st.subscriberCount || 0), totalViews: Number(st.viewCount || 0), videoCount: Number(st.videoCount || 0) },
      videos,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 초기 반응 속도: 게시 후 첫 EARLY_DAYS일 조회수 / (일×24) = 초기 시간당 조회수
//  - 유튜브는 시(hour) 단위 소급은 안 주지만 일(day) 단위는 과거 영상도 제공 → 기존 영상도 계산 가능
//  - 모든 영상 동일 기준(첫 N일). 결과는 변동성 낮으므로 20분 캐시
let earlyCache = { at: 0, data: {} };
app.get("/api/early", async (req, res) => {
  try {
    if (!CHANNEL_ID) return res.status(400).json({ ok: false, error: "CHANNEL_ID 누락" });

    // ① 자동 폴백(Analytics 첫 N일) — 비싸므로 20분 캐시
    let early;
    if (Date.now() - earlyCache.at < 20 * 60 * 1000 && Object.keys(earlyCache.data).length) {
      early = earlyCache.data;
    } else {
      early = {};
      const yt = google.youtube({ version: "v3", auth: getOAuth() });
      const ya = google.youtubeAnalytics({ version: "v2", auth: getOAuth() });
      const ch = await yt.channels.list({ part: "contentDetails", id: CHANNEL_ID });
      const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (uploads) {
        const pl = await yt.playlistItems.list({ part: "contentDetails,snippet", maxResults: 25, playlistId: uploads });
        const items = (pl.data.items || []).map((it) => ({ id: it.contentDetails.videoId, publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt }));
        const CH = 6;
        for (let i = 0; i < items.length; i += CH) {
          const chunk = items.slice(i, i + CH);
          await Promise.all(chunk.map(async (it) => {
            try {
              const pub = new Date(it.publishedAt);
              const start = ymd(pub);
              const end = ymd(new Date(pub.getTime() + (EARLY_DAYS - 1) * 86400000));
              const r = await ya.reports.query({
                ids: "channel==MINE", startDate: start, endDate: end,
                dimensions: "day", metrics: "views", filters: "video==" + it.id,
              });
              let sum = 0; (r.data.rows || []).forEach((row) => sum += Number(row[1] || 0));
              early[it.id] = { views: sum, perHour: Math.round(sum / (EARLY_DAYS * 24)), days: EARLY_DAYS };
            } catch (_) { /* 영상별 실패는 건너뜀 */ }
          }));
        }
      }
      earlyCache = { at: Date.now(), data: early };
    }

    // ② 수동 입력(영상초기반응 탭) 덮어쓰기 — 최우선, 매번 최신 반영(캐시 안 함)
    const merged = { ...early };
    try {
      const sheets = getSheetsClient();
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${HOURFIX_TAB}!A2:H` });
      (r.data.values || []).forEach((x) => {
        const id = String(x[0] || "").trim(); if (!id) return;
        // x[2..7] = 1h..6h 누적조회수. 윈도우 이하에서 채워진 가장 큰 시간 사용
        let best = null;
        for (let hh = 1; hh <= EARLY_WINDOW_H; hh++) {
          const cell = String(x[1 + hh] || "").trim();
          const val = Number(cell.replace(/[^0-9.-]/g, ""));
          if (cell !== "" && !isNaN(val)) best = { hour: hh, views: val };
        }
        if (best) merged[id] = { views: best.views, perHour: Math.round(best.views / best.hour), hours: best.hour, window: EARLY_WINDOW_H, source: "manual", complete: best.hour >= EARLY_WINDOW_H };
      });
    } catch (_) { /* 탭 없음 */ }

    res.json({ ok: true, days: EARLY_DAYS, window: EARLY_WINDOW_H, early: merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 영상초기반응 탭에 현재 공개 영상 목록을 채워줌(ID·제목) → 사용자는 1~6h 칸만 입력
app.post("/api/init-hourfix", async (req, res) => {
  try {
    if (!CHANNEL_ID) return res.status(400).json({ ok: false, error: "CHANNEL_ID 누락" });
    const sheets = getSheetsClient();
    await ensureTab(sheets, HOURFIX_TAB, ["영상ID", "제목", "1h", "2h", "3h", "4h", "5h", "6h"]);
    const exist = new Set();
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${HOURFIX_TAB}!A2:A` });
      (r.data.values || []).forEach((x) => x[0] && exist.add(String(x[0]).trim()));
    } catch (_) {}
    const yt = google.youtube({ version: "v3", auth: getOAuth() });
    const ch = await yt.channels.list({ part: "contentDetails", id: CHANNEL_ID });
    const up = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!up) return res.json({ ok: true, added: 0 });
    const pl = await yt.playlistItems.list({ part: "contentDetails", maxResults: 25, playlistId: up });
    const ids = (pl.data.items || []).map((it) => it.contentDetails.videoId);
    const vs = await yt.videos.list({ part: "snippet,status", id: ids.join(",") });
    const rows = (vs.data.items || [])
      .filter((it) => it.status?.privacyStatus === "public" && !exist.has(it.id))
      .map((it) => [it.id, it.snippet.title, "", "", "", "", "", ""]);
    if (rows.length) await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${HOURFIX_TAB}!A:H`,
      valueInputOption: "USER_ENTERED", requestBody: { values: rows },
    });
    res.json({ ok: true, added: rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 과거 vs 현재 비교 (광고 유입 자동 제외)
//  - 과거(6/1 이전) 영상: compare_past.json 하드코딩 데이터 사용(변동성 낮음 → 즉시)
//  - 현재(6/1 이후) 영상: 라이브 계산(개수 적어 트래픽소스 조회가 빠름)
app.get("/api/compare", async (req, res) => {
  try {
    const auth = getOAuth();
    const ya = google.youtubeAnalytics({ version: "v2", auth });
    const yt = google.youtube({ version: "v3", auth }); // youtube.readonly 필요(비공개 영상)
    const end = ymd(new Date());

    // 1) 6/1 이후 영상별 합계 (startDate를 컷오프로 좁혀 현재 활동만)
    const totalRes = await ya.reports.query({
      ids: "channel==MINE", startDate: COMPARE_CUTOFF, endDate: end,
      dimensions: "video", metrics: "views,averageViewPercentage,subscribersGained",
      sort: "-views", maxResults: 200,
    });
    const totals = {};
    (totalRes.data.rows || []).forEach((r) => totals[r[0]] = { views: +r[1] || 0, avp: +r[2] || 0, subs: +r[3] || 0 });

    // 2) 제목·게시일·길이·공개상태 → 6/1 이후 업로드 & "공개" 영상만 "현재"로 추림
    let ids = Object.keys(totals);
    const meta = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const v = await yt.videos.list({ part: "snippet,contentDetails,status", id: chunk.join(",") });
      (v.data.items || []).forEach((it) => meta[it.id] = {
        title: it.snippet.title, publishedAt: it.snippet.publishedAt,
        duration: isoDurToMMSS(it.contentDetails.duration),
        privacy: it.status?.privacyStatus,   // public / unlisted / private(예약 포함)
      });
    }
    // 공개(public)만 — 예약(미공개)·비공개·일부공개 제외
    ids = ids.filter((id) => (meta[id]?.publishedAt || "") >= COMPARE_CUTOFF && totals[id].views > 0 && meta[id]?.privacy === "public");

    // 3) 현재 영상만 광고(ADVERTISING) 유입 조회 (몇 개뿐이라 빠름)
    const ads = {};
    const CHUNK = 10;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (id) => {
        try {
          const tr = await ya.reports.query({
            ids: "channel==MINE", startDate: COMPARE_CUTOFF, endDate: end,
            dimensions: "insightTrafficSourceType", metrics: "views",
            filters: "video==" + id,
          });
          let adv = 0;
          (tr.data.rows || []).forEach((row) => { if (row[0] === "ADVERTISING") adv = +row[1] || 0; });
          ads[id] = adv;
        } catch (_) { ads[id] = 0; }
      }));
    }

    const ADSHARE = Number(req.query.threshold || 0.7);
    const current = ids.map((id) => {
      const t = totals[id], ad = ads[id] || 0;
      const organic = Math.max(0, t.views - ad);
      const adShare = t.views ? ad / t.views : 0;
      const m = meta[id] || {};
      return {
        id, title: m.title || id, publishedAt: m.publishedAt || "", duration: m.duration || "",
        views: t.views, ad, organic, adShare, avp: t.avp, subs: t.subs,
        isAd: adShare >= ADSHARE,
      };
    }).filter((v) => v.publishedAt);

    // 과거(하드코딩) + 현재(라이브) 합치기
    res.json({ ok: true, videos: [...PAST_COMPARE, ...current], pastCount: PAST_COMPARE.length, liveCount: current.length });
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
//  관리자 모드 (비밀번호 잠금 + 셀 수정 + 설정 저장)
// ===================================================================

// 탭 없으면 만들기 (헤더 없이 — A1에 데이터를 직접 쓰는 설정탭용)
async function ensureTabExists(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

// 비밀번호 확인
app.post("/api/admin/verify", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ ok: false, error: "서버에 ADMIN_PASSWORD가 설정되지 않았습니다." });
  }
  const pw = (req.body || {}).pw;
  res.json({ ok: checkPw(pw) });
});

// 셀 한 칸 쓰기 (노출수/CTR 수동 입력)
//   daily: 노출수=I열, CTR=J열 (B열 날짜로 행 찾기)
//   video: 노출수=F열, CTR=G열 (A열 영상ID로 행 찾기)
app.post("/api/cell", async (req, res) => {
  try {
    const { pw, type, key, field, value } = req.body || {};
    if (!checkPw(pw)) return res.status(401).json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
    if (!key) return res.status(400).json({ ok: false, error: "key(날짜/영상ID)가 없습니다." });
    if (field !== "impr" && field !== "ctr") return res.status(400).json({ ok: false, error: "field 오류" });

    const sheets = getSheetsClient();
    let tab, findCol, firstRow, col;
    if (type === "daily") {
      tab = DAILY_TAB; findCol = "B"; firstRow = DAILY_FIRST_ROW; col = field === "impr" ? "I" : "J";
    } else if (type === "video") {
      tab = VIDEO_TAB; findCol = "A"; firstRow = VIDEO_FIRST_ROW; col = field === "impr" ? "F" : "G";
    } else {
      return res.status(400).json({ ok: false, error: "type 오류" });
    }

    const { map } = await readColumn(sheets, tab, findCol, firstRow);
    const row = map[String(key).trim()];
    if (!row) return res.status(404).json({ ok: false, error: "해당 행을 시트에서 찾지 못했습니다: " + key });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab}!${col}${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value === "" || value == null ? "" : value]] },
    });
    res.json({ ok: true, row, col });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 설정 읽기 (KPI·제목 등) — _설정 탭 A1의 JSON
app.get("/api/config", async (req, res) => {
  try {
    if (!GOOGLE_SERVICE_ACCOUNT || !SHEET_ID) return res.json({ ok: true, config: null });
    const sheets = getSheetsClient();
    let config = null;
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${CONFIG_TAB}!A1` });
      const raw = r.data.values?.[0]?.[0];
      if (raw) config = JSON.parse(raw);
    } catch (_) { /* 탭 없거나 JSON 아님 → null */ }
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 설정 저장 (관리자) — _설정 탭 A1에 JSON 통째로
app.post("/api/config", async (req, res) => {
  try {
    const { pw, config } = req.body || {};
    if (!checkPw(pw)) return res.status(401).json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
    const sheets = getSheetsClient();
    await ensureTabExists(sheets, CONFIG_TAB);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[JSON.stringify(config)]] },
    });
    res.json({ ok: true });
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

// 한 번 스냅샷: 숏폼=업로드 후 24시간 / 롱폼(3분+)=업로드 후 7일 추적
const SNAP_LONG_HOURS = Number(process.env.SNAP_LONG_HOURS || 168); // 롱폼 추적 시간(기본 7일)
function isoDurToSec(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "");
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}
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
  // 1차: 롱폼 최대 추적시간 안의 후보를 모두 모은 뒤, 길이 확인 후 최종 필터
  const cand = (pl.items || []).map((it) => ({
    id: it.contentDetails.videoId,
    publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
    title: it.snippet.title,
  })).filter((v) => ((now - new Date(v.publishedAt).getTime()) / 3600000) <= SNAP_LONG_HOURS + 0.5);
  if (!cand.length) return 0;

  const ids = cand.map((v) => v.id);
  const stat = await (await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids.join(",")}&key=${YOUTUBE_API_KEY}`)).json();
  const sm = {}, dur = {};
  (stat.items || []).forEach((it) => { sm[it.id] = it.statistics; dur[it.id] = isoDurToSec(it.contentDetails?.duration); });
  // 2차: 숏폼(3분 미만)=24.5h까지 / 롱폼(3분+)=SNAP_LONG_HOURS까지
  const recent = cand.filter((v) => {
    const hrs = (now - new Date(v.publishedAt).getTime()) / 3600000;
    return (dur[v.id] >= 180) ? hrs <= SNAP_LONG_HOURS + 0.5 : hrs <= 24.5;
  });
  if (!recent.length) return 0;

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

// ===================================================================
//  채널 스냅샷 로봇 + 일일 실시간 (지연 없는 어제/오늘 조회수)
//   - 유튜브 Analytics는 최근 1~2일이 미확정이라 "어제 조회수"를 못 봄
//   - 채널 누적조회수(Data API)는 즉시 정확 → 1시간마다 기록 후 하루 경계 차감
// ===================================================================
const CHSNAP_TAB = process.env.CHSNAP_TAB || "채널스냅샷";
const DAILYFIX_TAB = process.env.DAILYFIX_TAB || "일일조회수보정"; // 사용자가 시트에 직접 입력하는 날짜별 조회수(최우선)

// ms/ISO → KST(UTC+9) 기준 "YYYY-MM-DD"
function kstDate(ts) {
  return new Date(new Date(ts).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
// 사용자 입력 날짜 정규화: "2026-06-16" / "26-06-16" 등 → "YYYY-MM-DD"
function normDate(s) {
  s = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}-\d{2}-\d{2}$/.test(s)) return "20" + s;
  const d = new Date(s);
  return isNaN(d) ? s : kstDate(d.getTime());
}

// 업로드 영상들의 현재 조회수 합 (채널 viewCount보다 빠르게 갱신 → 일일 실시간 기준값)
async function fetchUploadsViewSum() {
  if (!CHANNEL_ID || !YOUTUBE_API_KEY) return null;
  const ch = await (await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}&key=${YOUTUBE_API_KEY}`)).json();
  const up = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!up) return null;
  const pl = await (await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${up}&key=${YOUTUBE_API_KEY}`)).json();
  const ids = (pl.items || []).map((it) => it.contentDetails.videoId).filter(Boolean);
  let sum = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const vs = await (await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&key=${YOUTUBE_API_KEY}`)).json();
    (vs.items || []).forEach((it) => sum += Number(it.statistics?.viewCount || 0));
  }
  return sum;
}

// 채널 누적 지표 1줄 기록 (구독자·채널누적·영상합계)
async function channelSnapshotJob() {
  if (!CHANNEL_ID || !YOUTUBE_API_KEY || !GOOGLE_SERVICE_ACCOUNT || !SHEET_ID) return false;
  const sheets = getSheetsClient();
  const ch = await (await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${YOUTUBE_API_KEY}`)).json();
  const st = ch.items?.[0]?.statistics;
  if (!st) return false;
  let viewSum = null;
  try { viewSum = await fetchUploadsViewSum(); } catch (_) { /* 합계 실패시 빈칸 */ }
  await ensureTab(sheets, CHSNAP_TAB, ["타임스탬프", "구독자", "채널누적조회수", "영상합계조회수"]);
  // 사용자 수동 보정 탭도 같이 준비(없으면 생성) — A:날짜 B:조회수
  await ensureTab(sheets, DAILYFIX_TAB, ["날짜(2026-06-16 또는 26-06-16)", "조회수(스튜디오 고급분석 값)"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `${CHSNAP_TAB}!A:D`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[new Date().toISOString(), Number(st.subscriberCount || 0), Number(st.viewCount || 0), viewSum == null ? "" : viewSum]] },
  });
  return true;
}

// 일일 실시간: 현재 누적 + 날짜별 조회수(오늘/어제는 스냅샷, 과거는 Analytics 백필)
app.get("/api/daily-live", async (req, res) => {
  try {
    if (!CHANNEL_ID || !YOUTUBE_API_KEY) return res.status(400).json({ ok: false, error: "CHANNEL_ID/API_KEY 누락" });
    // 1) 현재 누적 (즉시)
    const ch = await (await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${YOUTUBE_API_KEY}`)).json();
    const st = ch.items?.[0]?.statistics || {};
    const nowSubs = Number(st.subscriberCount || 0);
    const displayTotal = Number(st.viewCount || 0);          // 표시용 채널 누적(유튜브가 느리게 갱신)
    let gainNow = null; try { gainNow = await fetchUploadsViewSum(); } catch (_) {}
    if (gainNow == null) gainNow = displayTotal;             // 합계 실패시 채널 누적으로 폴백
    const nowTs = Date.now();
    const todayK = kstDate(nowTs), ydayK = kstDate(nowTs - 24 * 3600000);

    // 2) 채널 스냅샷 → KST 날짜별 "그날 첫 스냅샷"(0시 기준점)
    //    영상합계(D열, 즉시 갱신) 기준만 사용 — 채널 viewCount(C열)는 굼떠서 일일이 0으로 멈춤
    const sheets = getSheetsClient();
    let snaps = [];
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${CHSNAP_TAB}!A2:D` });
      // 기준값 = 영상합계(D열) 우선, 없으면 채널누적(C열) 폴백 — 오늘 새벽 baseline 확보용
      snaps = (r.data.values || []).map((x) => ({ ts: new Date(x[0]).getTime(), subs: Number(x[1] || 0), views: Number(x[3] || x[2] || 0) }))
        .filter((s) => s.ts && s.views > 0).sort((a, b) => a.ts - b.ts);
    } catch (_) { /* 탭 없음 */ }
    const firstOfDay = {};
    for (const s of snaps) { const dk = kstDate(s.ts); if (!firstOfDay[dk]) firstOfDay[dk] = s; }

    // 스냅샷 기반 일별 조회수 = (다음날 첫 스냅샷 누적) - (그날 첫 스냅샷 누적), 오늘은 now까지
    const snapDaily = {};
    const dks = Object.keys(firstOfDay).sort();
    for (let i = 0; i < dks.length; i++) {
      const startV = firstOfDay[dks[i]].views;
      const nextV = (i + 1 < dks.length) ? firstOfDay[dks[i + 1]].views : gainNow;
      snapDaily[dks[i]] = Math.max(0, nextV - startV);
    }

    // 3) Analytics 확정 일별 (백필) — 최근 30일
    const anaDaily = {};
    try {
      const ya = google.youtubeAnalytics({ version: "v2", auth: getOAuth() });
      const ar = await ya.reports.query({
        ids: "channel==MINE", startDate: ymd(daysAgo(30)), endDate: ymd(new Date()),
        dimensions: "day", metrics: "views,subscribersGained,subscribersLost", sort: "day",
      });
      (ar.data.rows || []).forEach((r) => { anaDaily[r[0]] = { views: Number(r[1] || 0), subsNet: Number(r[2] || 0) - Number(r[3] || 0) }; });
    } catch (_) { /* Analytics 실패해도 스냅샷만으로 동작 */ }

    // 3.5) 사용자 수동 보정 (시트 직접 입력) — 최우선. Analytics가 아직 안 준 6/16·17 등을 채움
    const manualFix = {};
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${DAILYFIX_TAB}!A2:B` });
      (r.data.values || []).forEach((x) => {
        const d = normDate(x[0]); const v = Number(String(x[1] || "").replace(/[^0-9.-]/g, ""));
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(v) && String(x[1] || "").trim() !== "") manualFix[d] = v;
      });
    } catch (_) { /* 탭 없음 */ }

    // 4) 병합: 수동 보정 > (오늘/어제) 스냅샷 > Analytics 확정 > 스냅샷
    const dates = [...new Set([...Object.keys(anaDaily), ...Object.keys(snapDaily), ...Object.keys(manualFix)])].sort();
    const days = dates.map((d) => {
      const hasSnap = snapDaily[d] != null, hasAna = anaDaily[d] != null, hasFix = manualFix[d] != null;
      let views, source;
      // 오늘은 항상 라이브(스냅샷) — 수동입력에 묶이면 갱신이 멈춤
      if (d === todayK && hasSnap) { views = snapDaily[d]; source = "snapshot"; }
      else if (hasFix) { views = manualFix[d]; source = "manual"; }
      else if (d === ydayK && hasSnap) { views = snapDaily[d]; source = "snapshot"; }
      else if (hasAna) { views = anaDaily[d].views; source = "analytics"; }
      else if (hasSnap) { views = snapDaily[d]; source = "snapshot"; }
      else { views = 0; source = "none"; }
      return { date: d, views, source };
    });

    const todayStart = firstOfDay[todayK];
    // 오늘 = 라이브(영상합계 - 새벽 baseline). 수동값은 baseline 스냅샷이 아예 없을 때만 폴백
    const todayViews = todayStart ? Math.max(0, gainNow - todayStart.views) : (manualFix[todayK] != null ? manualFix[todayK] : null);
    const todaySubs = todayStart ? (nowSubs - todayStart.subs) : (anaDaily[todayK] ? anaDaily[todayK].subsNet : null);
    const yesterdayViews = (manualFix[ydayK] != null) ? manualFix[ydayK]
      : (snapDaily[ydayK] != null) ? snapDaily[ydayK]
      : (anaDaily[ydayK] ? anaDaily[ydayK].views : null);

    res.json({
      ok: true, at: new Date(nowTs).toISOString(),
      now: { subs: nowSubs, totalViews: displayTotal },
      today: { views: todayViews, subs: todaySubs },
      yesterday: { views: yesterdayViews },
      hasSnapshots: snaps.length > 0,
      days,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 콘텐츠별 일일 성과 빌더 (일일 그래프 툴팁 + 게시물 탭 공용)
//  - 일자별 "TOP 콘텐츠" 리포트(dimensions=video, 하루 범위) → 삭제/비공개 영상·게시물까지 잡힘. 10분 캐시.
let dbvCache = { at: 0, data: null };
async function buildDailyByVideo() {
  if (dbvCache.data && Date.now() - dbvCache.at < 10 * 60 * 1000) return dbvCache.data;
  const ya = google.youtubeAnalytics({ version: "v2", auth: getOAuth() });
  const byDay = {};
  const allIds = new Set();
  for (let i = 30; i >= 0; i--) {
    const day = ymd(daysAgo(i));
    let rows = null;
    try {
      const r = await ya.reports.query({
        ids: "channel==MINE", startDate: day, endDate: day,
        dimensions: "video", metrics: "views,likes,comments", sort: "-views", maxResults: 20,
      });
      rows = (r.data.rows || []).map((x) => ({ id: x[0], views: Number(x[1] || 0), likes: Number(x[2] || 0), comments: Number(x[3] || 0) }));
    } catch (_) {
      try { // 일부 조합 미지원 시 조회수만 폴백
        const r = await ya.reports.query({
          ids: "channel==MINE", startDate: day, endDate: day,
          dimensions: "video", metrics: "views", sort: "-views", maxResults: 20,
        });
        rows = (r.data.rows || []).map((x) => ({ id: x[0], views: Number(x[1] || 0), likes: 0, comments: 0 }));
      } catch (_) { /* 하루 실패는 스킵 */ }
    }
    if (rows) {
      const f = rows.filter((v) => v.views > 0);
      if (f.length) { byDay[day] = f; f.forEach((v) => allIds.add(v.id)); }
    }
  }
  // 제목 매핑 — OAuth 사용(본인 비공개 영상도 제목 조회됨).
  // videos.list에 안 잡히는 ID = 영상이 아닌 콘텐츠(커뮤니티 게시물 등) → isPost로 분리
  const yt = google.youtube({ version: "v3", auth: getOAuth() });
  const titles = {};
  const ids = [...allIds];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const vr = await yt.videos.list({ part: "snippet", id: chunk.join(",") });
      (vr.data.items || []).forEach((it) => { titles[it.id] = it.snippet.title; });
    } catch (_) {}
  }
  Object.keys(byDay).forEach((day) => {
    byDay[day].forEach((v) => {
      if (titles[v.id]) { v.title = titles[v.id]; v.isPost = false; }
      else { v.title = "게시물"; v.isPost = true; }
    });
  });
  const out = { ok: true, byDay };
  dbvCache = { at: Date.now(), data: out };
  return out;
}
app.get("/api/daily-by-video", async (req, res) => {
  try { res.json(await buildDailyByVideo()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 게시물 성과 (게시물 탭용) — 게시물별 조회수·좋아요·댓글 + 일자별 추이
app.get("/api/posts", async (req, res) => {
  try {
    const d = await buildDailyByVideo();
    const map = {};
    Object.keys(d.byDay).sort().forEach((day) => {
      d.byDay[day].filter((v) => v.isPost).forEach((v) => {
        if (!map[v.id]) map[v.id] = { id: v.id, views: 0, likes: 0, comments: 0, days: [] };
        map[v.id].views += v.views; map[v.id].likes += v.likes || 0; map[v.id].comments += v.comments || 0;
        map[v.id].days.push({ date: day, views: v.views, likes: v.likes || 0, comments: v.comments || 0 });
      });
    });
    const posts = Object.values(map)
      .map((p) => {
        const firstSeen = p.days[0]?.date || null, lastSeen = p.days[p.days.length - 1]?.date || null;
        // 채널 게시물 = 데일리 "Options Trend" 시황 → 첫 조회일 기준으로 제목 생성
        const title = firstSeen ? `${firstSeen.slice(2).replace(/-/g, ".")} Options Trend 시황` : "게시물";
        return { ...p, firstSeen, lastSeen, title };
      })
      .sort((a, b) => b.views - a.views);
    res.json({ ok: true, range: 30, posts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===================================================================
//  인사이트 (규칙 엔진 + Claude AI 리포트) & 자동 동기화 스케줄러
// ===================================================================
const AILOG_TAB = process.env.AILOG_TAB || "분석로그";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
let aiCache = { date: null, text: null };
let ruleCache = { at: 0, data: null };

// 인사이트용 데이터 수집 (byDay 재활용 + 업로드 목록 + 구독자)
async function gatherStats() {
  const dbv = await buildDailyByVideo();
  const days = Object.keys(dbv.byDay).sort();
  const daily = days.map((d) => {
    let vid = 0, post = 0;
    dbv.byDay[d].forEach((v) => { if (v.isPost) post += v.views; else vid += v.views; });
    return { date: d, video: vid, post };
  });
  // 업로드 목록 (OAuth — 예약·비공개 포함)
  const yt = google.youtube({ version: "v3", auth: getOAuth() });
  const ch = await yt.channels.list({ part: "statistics,contentDetails", id: CHANNEL_ID });
  const subs = Number(ch.data.items?.[0]?.statistics?.subscriberCount || 0);
  const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  let videos = [];
  if (uploads) {
    const pl = await yt.playlistItems.list({ part: "contentDetails,snippet", maxResults: 10, playlistId: uploads });
    const ids = (pl.data.items || []).map((it) => it.contentDetails.videoId);
    if (ids.length) {
      const vs = await yt.videos.list({ part: "snippet,statistics,status,contentDetails", id: ids.join(",") });
      videos = (vs.data.items || []).filter((it) => it.status?.privacyStatus === "public").map((it) => ({
        id: it.id, title: it.snippet.title, publishedAt: it.snippet.publishedAt,
        durSec: isoDurToSec(it.contentDetails?.duration),
        views: Number(it.statistics?.viewCount || 0),
        likes: Number(it.statistics?.likeCount || 0),
        comments: Number(it.statistics?.commentCount || 0),
      }));
    }
  }
  // 최근 미확정일 보강: 채널스냅샷 기반 잠정 일별(영상) 조회수 — Analytics 2~3일 지연 커버
  try {
    const sheets = getSheetsClient();
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${CHSNAP_TAB}!A2:D` });
    const snaps = (r.data.values || []).map((x) => ({ ts: new Date(x[0]).getTime(), views: Number(x[3] || x[2] || 0) }))
      .filter((x) => x.ts && x.views > 0).sort((a, b) => a.ts - b.ts);
    const firstOfDay = {}; snaps.forEach((sn) => { const dk = kstDate(sn.ts); if (firstOfDay[dk] == null) firstOfDay[dk] = sn.views; });
    const dks = Object.keys(firstOfDay).sort();
    const lastConfirmed = daily.length ? daily[daily.length - 1].date : null;
    const todayK0 = kstDate(Date.now());
    for (let i = 0; i < dks.length; i++) {
      const d = dks[i];
      if (lastConfirmed && d <= lastConfirmed) continue;
      if (d >= todayK0) continue; // 오늘(진행 중)은 제외
      const next = (i + 1 < dks.length) ? firstOfDay[dks[i + 1]] : null;
      if (next == null) continue;
      daily.push({ date: d, video: Math.max(0, next - firstOfDay[d]), post: null, 잠정: true });
    }
    daily.sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch (_) { /* 스냅샷 없으면 확정분만으로 진행 */ }

  // 트래픽 소스 (최근 14일 채널 전체 + 최신 롱폼 개별)
  const SRC = { YT_SEARCH: "유튜브 검색", RELATED_VIDEO: "추천 영상", SUBSCRIBER: "홈/구독 피드", YT_CHANNEL: "채널 페이지", EXT_URL: "외부 링크", NOTIFICATION: "알림", SHORTS: "쇼츠 피드", PLAYLIST: "재생목록", NO_LINK_OTHER: "직접/기타", END_SCREEN: "끝화면", YT_OTHER_PAGE: "기타 유튜브", ADVERTISING: "광고" };
  let traffic = [], lfTraffic = [], longform = null;
  try {
    const ya = google.youtubeAnalytics({ version: "v2", auth: getOAuth() });
    const tr = await ya.reports.query({
      ids: "channel==MINE", startDate: ymd(daysAgo(14)), endDate: ymd(new Date()),
      dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views",
    });
    traffic = (tr.data.rows || []).map((r) => ({ 소스: SRC[r[0]] || r[0], 조회: Number(r[1] || 0) }));
    longform = videos.filter((v) => v.durSec > 180).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0] || null;
    if (longform) {
      const tr2 = await ya.reports.query({
        ids: "channel==MINE", filters: "video==" + longform.id,
        startDate: longform.publishedAt.slice(0, 10), endDate: ymd(new Date()),
        dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views",
      });
      lfTraffic = (tr2.data.rows || []).map((r) => ({ 소스: SRC[r[0]] || r[0], 조회: Number(r[1] || 0) }));
    }
  } catch (_) { /* 트래픽 소스 실패해도 나머지 분석은 진행 */ }
  return { daily, videos, subs, byDay: dbv.byDay, traffic, lfTraffic, longform };
}

// 규칙 엔진 — 팩트 기반 발견사항
function buildRuleInsights(s) {
  const out = [];
  const ydayK = kstDate(Date.now() - 24 * 3600000);
  const conf = s.daily.filter((d) => d.date < ydayK); // 어제 이전(비교적 확정)
  const last = conf[conf.length - 1];
  const prev7 = conf.slice(-8, -1);
  if (last && prev7.length >= 3) {
    const avg = prev7.reduce((a, d) => a + d.video, 0) / prev7.length;
    if (avg > 5) {
      const diff = Math.round((last.video - avg) / avg * 100);
      const drivers = (s.byDay[last.date] || []).filter((x) => !x.isPost).slice(0, 2)
        .map((x) => `"${x.title.slice(0, 16)}…" ${x.views}회`).join(" · ");
      const drvTxt = drivers ? ` · 주요 기여: ${drivers}` : (last.잠정 ? " · 잠정치(영상별 내역 확정 전)" : "");
      if (diff >= 30) out.push({ level: "good", title: `영상 조회수 급증 (${last.date})`, detail: `영상 전체 합계 ${Math.round(avg)}→${last.video}회 (+${diff}%)${drvTxt}` });
      else if (diff <= -30) out.push({ level: "warn", title: `영상 조회수 하락 (${last.date})`, detail: `영상 전체 합계 ${Math.round(avg)}→${last.video}회 (${diff}%)${drvTxt}` });
    }
    const postDays = prev7.filter((d) => d.post != null);
    const pAvg = postDays.length ? postDays.reduce((a, d) => a + d.post, 0) / postDays.length : 0;
    if (last.post != null && pAvg > 5 && last.post < pAvg * 0.4) out.push({ level: "warn", title: "게시물 조회 급감", detail: `시황 게시물 조회가 평균 ${Math.round(pAvg)}회 → ${last.post}회. 게시 누락 여부 확인` });
  }
  // 업로드 공백
  if (s.videos.length) {
    const lastUp = Math.max(...s.videos.map((v) => new Date(v.publishedAt).getTime()));
    const gap = Math.floor((Date.now() - lastUp) / 86400000);
    if (gap >= 4) out.push({ level: "warn", title: `업로드 공백 ${gap}일째`, detail: "주 2~3회 리듬 유지가 알고리즘 신호에 유리해요" });
    else out.push({ level: "info", title: `마지막 업로드 ${gap}일 전`, detail: "업로드 리듬 정상 범위" });
  }
  // 최신 영상 첫 3일 성과 vs 채널 평균
  const first3 = (vid) => {
    const ds = Object.keys(s.byDay).sort();
    const mine = ds.map((d) => (s.byDay[d].find((x) => x.id === vid && !x.isPost) || {}).views || 0).filter((v) => v > 0);
    return mine.slice(0, 3).reduce((a, b) => a + b, 0);
  };
  const recent = s.videos.filter((v) => (Date.now() - new Date(v.publishedAt).getTime()) / 86400000 <= 14)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (recent.length) {
    const newest = recent[0];
    const mine3 = first3(newest.id);
    const others = s.videos.filter((v) => v.id !== newest.id).map((v) => first3(v.id)).filter((x) => x > 0);
    if (mine3 > 0 && others.length >= 2) {
      const avg3 = others.reduce((a, b) => a + b, 0) / others.length;
      const pct = Math.round((mine3 - avg3) / avg3 * 100);
      if (pct >= 20) out.push({ level: "good", title: `최신 영상 초반 성과 우수`, detail: `"${newest.title.slice(0, 25)}…" 첫 3일 ${mine3}회 — 채널 평균 대비 +${pct}%. 이 훅·주제 패턴 재사용 권장` });
      else if (pct <= -30) out.push({ level: "warn", title: `최신 영상 초반 부진`, detail: `"${newest.title.slice(0, 25)}…" 첫 3일 ${mine3}회 — 채널 평균 대비 ${pct}%. 썸네일·제목 점검 필요` });
    }
    // 참여율
    if (newest.views >= 50) {
      const lr = newest.likes / newest.views * 100;
      if (lr >= 8) out.push({ level: "info", title: "최신 영상 좋아요 비율 높음", detail: `${lr.toFixed(1)}% — 우호 관객(구독자·배포망) 비중이 높다는 신호. 콜드 유입 확대 필요` });
    }
  }
  if (!out.length) out.push({ level: "info", title: "특이사항 없음", detail: "최근 데이터에서 큰 변동이 감지되지 않았어요" });
  return out;
}

// Claude AI 리포트 (전날까지 데이터 기준, 하루 1회)
async function runAIReport(force) {
  if (!ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
  const todayK = kstDate(Date.now());
  if (!force && aiCache.date === todayK) return { ok: true, cached: true };
  const s = await gatherStats();
  const rules = buildRuleInsights(s);
  // 최근 7일(어제까지) 콘텐츠별 일별 추이
  const dates7 = s.daily.map((d) => d.date).filter((d) => d < todayK).slice(-7);
  const ct = {};
  dates7.forEach((d) => (s.byDay[d] || []).forEach((x) => {
    if (!ct[x.id]) ct[x.id] = { 제목: x.title.slice(0, 30), 형태: x.isPost ? "게시물" : "영상", 일별: {}, 합: 0 };
    ct[x.id].일별[d.slice(5)] = x.views; ct[x.id].합 += x.views;
  }));
  const topContents = Object.values(ct).sort((a, b) => b.합 - a.합).slice(0, 6);
  // 전일 대비 비교 (어제 vs 그제) — 서버에서 확정 계산
  const conf2 = s.daily.filter((d) => d.date < todayK);
  const yD = conf2[conf2.length - 1] || null, pD = conf2[conf2.length - 2] || null;
  const pct = (a, b) => (b > 0 ? Math.round((a - b) / b * 100) + "%" : "-");
  const 전일비교 = (yD && pD) ? {
    어제: { 날짜: yD.date, 영상조회: yD.video, 게시물조회: yD.post == null ? "확정 전" : yD.post, 상태: yD.잠정 ? "잠정치(스냅샷 기반)" : "확정" },
    그제: { 날짜: pD.date, 영상조회: pD.video, 게시물조회: pD.post == null ? "확정 전" : pD.post, 상태: pD.잠정 ? "잠정치(스냅샷 기반)" : "확정" },
    증감_영상: `${yD.video - pD.video >= 0 ? "+" : ""}${yD.video - pD.video}회 (${pct(yD.video, pD.video)})`,
  } : null;
  const summary = {
    기준일: todayK, 구독자: s.subs,
    전일비교,
    최근7일_일별합계: s.daily.filter((d) => d.date < todayK).slice(-7).map((d) => ({ 날짜: d.date.slice(5), 영상: d.video, 게시물: d.post == null ? "확정 전" : d.post, 상태: d.잠정 ? "잠정" : "확정" })),
    주요콘텐츠_최근7일_일별추이: topContents,
    최신롱폼: s.longform ? { 제목: s.longform.title, 게시일: s.longform.publishedAt.slice(0, 10), 누적조회: s.longform.views, 좋아요: s.longform.likes, 트래픽소스: s.lfTraffic } : null,
    채널_트래픽소스_14일: s.traffic,
    최근영상: s.videos.slice(0, 6).map((v) => ({ 제목: v.title.slice(0, 30), 게시: v.publishedAt.slice(0, 10), 형태: v.durSec > 180 ? "롱폼" : "숏폼", 누적조회: v.views, 좋아요: v.likes, 댓글: v.comments })),
    자동감지: rules.map((r) => `${r.title}: ${r.detail}`),
  };
  const body = {
    model: "claude-sonnet-5",
    max_tokens: 2500,
    thinking: { type: "disabled" },
    system: `너는 유진투자선물(금융사, 미국주식옵션 교육 채널)의 유튜브 데이터 분석가다. 어제까지의 데이터로 데일리 리포트를 작성한다.

형식 규칙:
1. 섹션은 정확히 [핵심 진단] [수치 분석] [전망] [실행 제안] 4개의 대괄호 헤더로 구분.
2. 각 섹션은 이렇게 쓴다: 첫 줄에 그 섹션의 한 줄 요약을 **별표 두 개로 감싸서**(예: **어제부터 조회수가 확 식었어요.**) 쓰고, 한 줄 띄운 뒤 자세한 설명을 문단으로 쓴다. 설명이 길면 내용이 바뀌는 지점마다 빈 줄로 문단을 나눠 가독성을 높인다.
3. 볼드 요약(**...**)과 실행제안 번호(1. 2. 3.) 외에는 마크다운 기호(#, - 등)와 이모지를 쓰지 마라.
4. 전체 1,100자 이내.
5. 말투: 유튜브 채널 운영자에게 옆에서 말해주듯 편하고 자연스러운 존댓말. "~했어요", "~네요", "~하면 좋아요" 처럼. '자연 감쇠', '기저 수준', '낙수 효과', '단발성 확산' 같은 딱딱한 전문·논문 용어를 절대 쓰지 마라. 대신 "반응이 식었어요", "원래대로 돌아왔어요", "타고 넘어온 조회수", "반짝 떴다가 내려왔어요" 처럼 쉬운 말로 풀어 써라.

내용 규칙:
4. [수치 분석]은 반드시 "전일비교" 데이터로 시작하라: 어제가 그제 대비 얼마나(증감량·증감률) 변했는지, 그리고 그 변화가 무엇을 의미하는지(예: 쇼츠 유입 파도 소진, 신규 업로드 효과, 자연 감쇠 등) 해석까지. 그다음 최근 3일(어제 포함)의 일별 수치를 각각 언급하라. 급증한 날만 다루고 나머지를 생략하지 마라. 데이터에 "잠정"으로 표시된 날은 실시간 스냅샷 기반 잠정치이므로 확정 시 수치가 달라질 수 있음을 언급하고, 게시물 조회가 "확정 전"인 날은 게시물 수치를 단정하지 마라.
5. 날짜, 값, 증감률을 구체적으로. 트래픽소스 데이터가 있으면 검색·추천·쇼츠피드 노출 상태를 해석하라.
6. 전망: 최근 일별 추이를 근거로 최신 롱폼과 채널 전체의 7일 후·30일 후 예상 누적 조회수를 범위로 제시하라. 반드시 "추정치이며 변동 가능"임을 명시.
7. "꾸준히 업로드하라", "콘텐츠를 다양화하라", "숏폼과 롱폼을 구분하라" 같은 일반론 금지. 이 채널 데이터에서만 나올 수 있는 구체적 제안만.
8. 준법: 이 채널은 수익률·배수 숫자를 마케팅 문구에 쓸 수 없다. 제안에 반영하라.
9. 데이터에 없는 것을 지어내지 마라.
10. 영상을 지칭할 때 "숏폼", "롱폼" 대신 실제 제목(앞 15자 정도)을 큰따옴표로 써라. 예: "한 달만에 저세상 가버린…" 영상.
11. [실행 제안]은 번호(1. 2. 3.)로 3개. 각 항목은 한 문장으로 끝내라. 한 문장은 "무엇을 하라" + 괄호 안에 "왜(짧은 근거)"만. 전문용어·긴 수식어·여러 절을 겹친 문장 금지. 중학생이 한 번에 이해할 수 있게 쉽고 짧게.`,
    messages: [{ role: "user", content: "채널 데이터:\n" + JSON.stringify(summary, null, 1) }],
  };
  const callClaude = async (b) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(b),
    });
    const j = await r.json();
    if (!r.ok) return { err: j.error?.message || ("HTTP " + r.status) };
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("\n").trim();
    if (!text) return { err: `빈 응답 (stop_reason: ${j.stop_reason}, blocks: ${(j.content || []).map((c) => c.type).join(",") || "없음"})` };
    return { text };
  };
  let out = await callClaude(body);
  if (out.err) { // 폴백: thinking 미지원/빈 응답 등 → haiku로 재시도
    const fb = { ...body, model: "claude-haiku-4-5-20251001", max_tokens: 1500 };
    delete fb.thinking;
    out = await callClaude(fb);
  }
  if (out.err) return { ok: false, error: out.err };
  const text = out.text;
  aiCache = { date: todayK, text };
  try {
    const sheets = getSheetsClient();
    await ensureTab(sheets, AILOG_TAB, ["날짜", "리포트"]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${AILOG_TAB}!A:B`,
      valueInputOption: "RAW", requestBody: { values: [[todayK, text]] },
    });
  } catch (_) { /* 로그 실패해도 리포트는 유지 */ }
  return { ok: true, text };
}

// 인사이트 조회 (규칙=10분 캐시, AI=오늘자 캐시/시트)
function insightVisuals(s) {
  const todayK = kstDate(Date.now());
  const trend = s.daily.filter((d) => d.date <= todayK).slice(-14)
    .map((d) => ({ date: d.date, video: d.video, post: d.post, prov: !!d.잠정 }));
  const content = [...s.videos].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 8)
    .map((v) => ({ id: v.id, title: v.title, form: v.durSec > 180 ? "롱폼" : "숏폼", views: v.views, likes: v.likes, comments: v.comments, published: v.publishedAt.slice(0, 10) }));
  return { trend, content };
}
app.get("/api/insights", async (req, res) => {
  try {
    if (!ruleCache.data || Date.now() - ruleCache.at > 10 * 60 * 1000) {
      const s = await gatherStats();
      ruleCache = { at: Date.now(), data: buildRuleInsights(s), vis: insightVisuals(s) };
    }
    if (!aiCache.text) { // 서버 재시작 후 시트에서 최신 리포트 복구
      try {
        const sheets = getSheetsClient();
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${AILOG_TAB}!A2:B` });
        const rows = r.data.values || [];
        if (rows.length) { const lastRow = rows[rows.length - 1]; aiCache = { date: lastRow[0], text: lastRow[1] }; }
      } catch (_) {}
    }
    res.json({ ok: true, rules: ruleCache.data, vis: ruleCache.vis || null, ai: aiCache.text ? { date: aiCache.date, text: aiCache.text } : null, aiEnabled: !!ANTHROPIC_API_KEY });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 수동 실행 (규칙 새로고침 / body.ai=true면 AI 강제 실행)
app.post("/api/insights/run", async (req, res) => {
  try {
    const s = await gatherStats();
    ruleCache = { at: Date.now(), data: buildRuleInsights(s), vis: insightVisuals(s) };
    let ai = null;
    if (req.body && req.body.ai) { const r = await runAIReport(true); ai = r.ok ? { date: aiCache.date, text: aiCache.text } : { error: r.error }; }
    res.json({ ok: true, rules: ruleCache.data, vis: ruleCache.vis, ai });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 스케줄러: 매일 KST 09:00 동기화+AI리포트, 18:00 동기화
const schedDone = {};
setInterval(async () => {
  const now = new Date(Date.now() + 9 * 3600000); // KST
  const hh = now.getUTCHours(), key = now.toISOString().slice(0, 10) + "-" + hh;
  if (hh === 9 && !schedDone["s" + key]) {
    schedDone["s" + key] = 1;
    try { await runSync(); console.log("⏰ 자동 동기화(09시) 완료"); } catch (e) { console.log("자동 동기화 실패:", e.message); }
    try { const r = await runAIReport(false); console.log("🤖 AI 리포트:", r.ok ? "완료" : r.error); } catch (e) { console.log("AI 리포트 실패:", e.message); }
    try { const s = await gatherStats(); ruleCache = { at: Date.now(), data: buildRuleInsights(s) }; } catch (_) {}
  }
  if (hh === 18 && !schedDone["s" + key]) {
    schedDone["s" + key] = 1;
    try { await runSync(); console.log("⏰ 자동 동기화(18시) 완료"); } catch (e) { console.log("자동 동기화 실패:", e.message); }
  }
}, 60 * 1000);

// 수동 채널 스냅샷 트리거
app.post("/api/channel-snapshot", async (req, res) => {
  try { const ok = await channelSnapshotJob(); res.json({ ok: true, recorded: ok }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 1시간마다 자동 스냅샷 (서버 항상 켜져 있으니 별도 Cron 불필요)
setInterval(() => snapshotJob().catch((e) => console.log("snapshot err:", e.message)), 60 * 60 * 1000);
setTimeout(() => snapshotJob().catch(() => {}), 15000); // 서버 켜지고 15초 뒤 1회
// 채널 스냅샷도 1시간마다 + 시작 직후 1회 (일일 실시간용)
setInterval(() => channelSnapshotJob().catch((e) => console.log("ch-snapshot err:", e.message)), 60 * 60 * 1000);
setTimeout(() => channelSnapshotJob().catch(() => {}), 20000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 대시보드 실행 중: http://localhost:${PORT}`));
