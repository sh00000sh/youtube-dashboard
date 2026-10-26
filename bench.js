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

function computeBench(videoRows, snapRows, now = Date.now()) {
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
    return { ...v, form, series: seriesOf(v.title, form), hour: k.getUTCHours(), dow: k.getUTCDay(), bucket: hourBucket(k.getUTCHours()),
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
  const tS = f("제목 형태", (x) => x.ctx.startsWith("시황"));
  if (tS) tryNext.push({ what: `시황 숏폼 제목을 '${tS.hi}'으로 (날짜는 맨 끝 한 번만)`, why: `${tS.hi} ${tS.hiMed.toLocaleString()}회 vs ${tS.lo} ${tS.loMed.toLocaleString()}회 (중간값, ${tS.nHi}편·${tS.nLo}편)`, measure: "다음 시황 숏폼 5편 조회수 중간값 비교" });
  const tL = f("롱폼 종류");
  if (tL) tryNext.push({ what: `조회수를 노리는 롱폼은 '${tL.hi}'형으로`, why: `${tL.hi} ${tL.hiMed}회 vs ${tL.lo} ${tL.loMed}회 (다 자란 롱폼 중간값). ${tL.lo === "화면·주문 가이드" ? "화면 가이드는 조회수보다 알림톡·고객 안내용으로 쓰는 게 맞아요" : ""}`.trim(), measure: "다음 롱폼 2주 조회수가 롱폼 중간값을 넘는지" });
  const best = trends.filter((t) => t.series.startsWith("교육")).sort((a, b) => b.recentMed - a.recentMed)[0];
  if (best && best.change > 15) tryNext.push({ what: `요즘 잘 되는 '${best.series.replace("교육 숏폼 · ", "")}' 시리즈 한 편 더`, why: `최근 2주 24시간 조회수 중간값 ${best.recentMed}회, 그 전보다 ${best.change}% 높음`, measure: "같은 시리즈 다음 편이 상위 25%에 드는지" });

  return { at: new Date(now).toISOString(), videos: vids, groups: Object.values(groups), recent, findings, trends, tryNext: tryNext.slice(0, 3),
    coverage: { videos: vids.length, with24h: vids.filter((v) => v.v24 != null).length, mature: vids.filter(mature).length } };
}

module.exports = { computeBench, seriesOf, viewsAt };
