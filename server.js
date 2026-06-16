// ===================================================================
//  유튜브 인게이지먼트 대시보드 - 일꾼(백엔드) + 화면(프론트) 한 몸
//  - 동기화 버튼을 누르면 유튜브에서:
//      (1) 채널 통계: 구독자 수 / 총 조회수 / 총 영상 수
//      (2) 영상별 인게이지먼트: 조회수 / 좋아요 / 댓글
//    를 가져와 저장하고 화면에 보여줌
// ===================================================================

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ----- 환경변수(열쇠·설정) 읽기 -----
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;          // 유튜브 출입 열쇠
const CHANNEL_ID = (process.env.CHANNEL_ID || "").trim();     // 채널 ID (UC...로 시작)
const VIDEO_IDS = (process.env.VIDEO_IDS || "")               // 추적할 영상 ID들 (쉼표로 구분)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DATABASE_URL = process.env.DATABASE_URL;                // Railway가 자동으로 넣어주는 냉장고 주소

// ----- 창고(데이터베이스) 준비 -----
// DATABASE_URL이 있으면 진짜 DB(Postgres)를 쓰고,
// 없으면(=내 컴퓨터에서 테스트할 때) 임시로 메모리에 저장한다.
let db = null;
const memory = { channel: null, videos: new Map() };

async function initDb() {
  if (!DATABASE_URL) {
    console.log("⚠️  DATABASE_URL 없음 → 임시 메모리 모드로 실행 (테스트용)");
    return;
  }
  const { Pool } = require("pg");
  db = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.query(`
    CREATE TABLE IF NOT EXISTS videos (
      video_id   TEXT PRIMARY KEY,
      title      TEXT,
      views      BIGINT,
      likes      BIGINT,
      comments   BIGINT,
      updated_at TIMESTAMPTZ
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS channel (
      channel_id   TEXT PRIMARY KEY,
      title        TEXT,
      subscribers  BIGINT,
      total_views  BIGINT,
      video_count  BIGINT,
      updated_at   TIMESTAMPTZ
    )
  `);
  console.log("✅ 데이터베이스 연결 완료");
}

// ---------- 저장 ----------
async function saveVideo(v) {
  if (db) {
    await db.query(
      `INSERT INTO videos (video_id, title, views, likes, comments, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (video_id)
       DO UPDATE SET title=$2, views=$3, likes=$4, comments=$5, updated_at=NOW()`,
      [v.video_id, v.title, v.views, v.likes, v.comments]
    );
  } else {
    memory.videos.set(v.video_id, { ...v, updated_at: new Date().toISOString() });
  }
}

async function saveChannel(c) {
  if (db) {
    await db.query(
      `INSERT INTO channel (channel_id, title, subscribers, total_views, video_count, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (channel_id)
       DO UPDATE SET title=$2, subscribers=$3, total_views=$4, video_count=$5, updated_at=NOW()`,
      [c.channel_id, c.title, c.subscribers, c.total_views, c.video_count]
    );
  } else {
    memory.channel = { ...c, updated_at: new Date().toISOString() };
  }
}

// ---------- 읽기 ----------
async function getVideos() {
  if (db) {
    const r = await db.query("SELECT * FROM videos ORDER BY views DESC");
    return r.rows;
  }
  return [...memory.videos.values()].sort((a, b) => b.views - a.views);
}

async function getChannel() {
  if (db) {
    const r = await db.query("SELECT * FROM channel LIMIT 1");
    return r.rows[0] || null;
  }
  return memory.channel;
}

// ---------- 유튜브에서 가져오기 ----------
async function fetchVideos(ids) {
  if (ids.length === 0) return [];
  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    "?part=snippet,statistics&id=" + ids.join(",") +
    "&key=" + YOUTUBE_API_KEY;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.items || []).map((item) => ({
    video_id: item.id,
    title: item.snippet.title,
    views: Number(item.statistics.viewCount || 0),
    likes: Number(item.statistics.likeCount || 0),
    comments: Number(item.statistics.commentCount || 0),
  }));
}

async function fetchChannel(id) {
  if (!id) return null;
  const url =
    "https://www.googleapis.com/youtube/v3/channels" +
    "?part=snippet,statistics&id=" + id +
    "&key=" + YOUTUBE_API_KEY;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const item = (data.items || [])[0];
  if (!item) return null;
  return {
    channel_id: item.id,
    title: item.snippet.title,
    subscribers: Number(item.statistics.subscriberCount || 0),
    total_views: Number(item.statistics.viewCount || 0),
    video_count: Number(item.statistics.videoCount || 0),
  };
}

// ===================================================================
//  API (화면이 일꾼에게 보내는 신호들)
// ===================================================================

// 저장된 데이터 보여줘 (채널 + 영상)
app.get("/api/data", async (req, res) => {
  try {
    res.json({ ok: true, channel: await getChannel(), videos: await getVideos() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔄 동기화! 유튜브 다녀와서 저장
app.post("/api/sync", async (req, res) => {
  try {
    if (!YOUTUBE_API_KEY) {
      return res.status(400).json({ ok: false, error: "YOUTUBE_API_KEY가 설정되지 않았습니다." });
    }
    if (!CHANNEL_ID && VIDEO_IDS.length === 0) {
      return res.status(400).json({ ok: false, error: "CHANNEL_ID 또는 VIDEO_IDS 중 하나는 넣어주세요." });
    }

    const channel = await fetchChannel(CHANNEL_ID);
    if (channel) await saveChannel(channel);

    const fresh = await fetchVideos(VIDEO_IDS);
    for (const v of fresh) await saveVideo(v);

    res.json({
      ok: true,
      videoCount: fresh.length,
      channel: await getChannel(),
      videos: await getVideos(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ----- 서버 켜기 -----
const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log(`🚀 대시보드 실행 중: http://localhost:${PORT}`));
});
