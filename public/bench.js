// ===================================================================
// 📏 우리 채널 기준 화면 (서버 /api/benchmarks 결과를 그린다)
//  - 유명 채널이 아니라 '우리 영상들의 중간값'이 기준
//  - 지금 올라가는 영상: n시간째 조회수 vs 같은 시점 우리 중간값
//  - 최근 2주 성적표(24시간·지금까지 백분위), 시리즈별 기준값, 데이터가 말하는 차이, 이번 주 해볼 것
// ===================================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const f = (n) => (n == null ? "-" : Number(n).toLocaleString("ko-KR"));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let B = null, loading = false;

  const chip = (g) => {
    if (!g) return "";
    const cls = g === "상위 10%" || g === "상위 25%" ? "up" : g === "보통" ? "mid" : "dn";
    return `<span class="bchip ${cls}">${g}</span>`;
  };
  const short = (t, n = 34) => { const s = String(t || "").split("#")[0].trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  const openV = (v) => `openVideo('${v.id}',\`${String(v.title || "").replace(/[`\\]/g, "")}\`,'${v.pub.slice(0, 10)}')`;
  const when = (v) => `${v.kdate.slice(5).replace("-", "/")} ${String(v.hour).padStart(2, "0")}시`;
  const seriesShort = (s) => s.replace("교육 숏폼 · ", "교육·").replace("롱폼 · ", "롱폼·");

  function render() {
    const box = $("benchBody"); if (!box) return;
    if (!B) { box.innerHTML = `<div class="empty">${loading ? "불러오는 중…" : "기준값을 불러오지 못했어요."}</div>`; return; }

    // ① 지금 올라가는 중 (24시간 안 숏폼 / 7일 안 롱폼)
    const live = B.videos.filter((v) => v.pace).sort((a, b) => b.pub.localeCompare(a.pub));
    const liveHtml = live.length ? live.map((v) => {
      const diff = v.pace.med ? Math.round((v.pace.v / v.pace.med - 1) * 100) : null;
      return `<div class="bcard" onclick="${openV(v)}">
        <div class="bk">${v.form === "S" ? "숏폼" : "롱폼"} · ${esc(seriesShort(v.series))} · ${when(v)} 업로드</div>
        <div class="bt">${esc(short(v.title, 40))}</div>
        <div class="bn"><b>${f(v.pace.v)}회</b> <span class="bsub">${v.pace.h}시간째</span> ${chip(v.pace.grade)}</div>
        <div class="bw">같은 시점 우리 ${esc(v.pace.basis)} 중간값 <b>${f(v.pace.med)}회</b></div>
        ${diff == null ? "" : `<div class="bw">평소보다 <b class="${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "+" : ""}${diff}%</b> <span class="bsub">(${v.pace.n}편과 비교)</span></div>`}
      </div>`;
    }).join("") : `<div class="empty">지금 막 올라간 영상이 없어요. 업로드하면 시간마다 여기서 우리 채널 평소 속도와 비교해 보여줘요.</div>`;

    // ② 최근 2주 성적표
    const rows = B.recent.map((v) => `<tr>
      <td style="white-space:nowrap">${when(v)}</td>
      <td style="text-align:left"><span class="vtitle" onclick="${openV(v)}">${esc(short(v.title))}</span><div class="bsub">${esc(seriesShort(v.series))}</div></td>
      <td>${v.v24 == null ? (v.pace ? `<span class="bsub">${v.pace.h}h ${f(v.pace.v)}</span>` : "-") : `${f(v.v24)} ${chip(v.grade24)}`}</td>
      <td>${f(v.views)} ${v.mature ? chip(v.gradeViews) : `<span class="bsub">${Math.floor(v.age)}일째</span>`}</td>
      <td>${v.avp ? v.avp.toFixed(0) + "%" : "-"}</td>
    </tr>`).join("");

    // ③ 기준값 표
    const order = (g) => (g.name.endsWith("전체") ? 0 : 1);
    const grows = [...B.groups].sort((a, b) => order(a) - order(b) || (a.name.startsWith("롱폼") - b.name.startsWith("롱폼")) || (b.views?.med || 0) - (a.views?.med || 0)).map((g) => `<tr class="${g.name.endsWith("전체") ? "tot" : ""}">
      <td style="text-align:left">${esc(g.name)}</td><td>${g.n}</td>
      <td>${g.v24 ? `<b>${f(g.v24.med)}</b><div class="bsub">${f(g.v24.p25)}~${f(g.v24.p75)}</div>` : "-"}</td>
      <td>${g.views ? `<b>${f(g.views.med)}</b><div class="bsub">${f(g.views.p25)}~${f(g.views.p75)}</div>` : "-"}</td>
      <td>${g.avp ? g.avp.med + "%" : "-"}</td>
      <td>${g.per1k ? g.per1k.med : "-"}</td></tr>`).join("");

    // ④ 차이 · ⑤ 해볼 것 · ⑥ 흐름
    const fx = B.findings.length ? B.findings.map((x) => `<li><b>${esc(x.hi)}</b>이 <b>${esc(x.lo)}</b>보다 <b>${x.ratio}배</b> <span class="bsub">(${esc(x.ctx)}: ${f(x.hiMed)} vs ${f(x.loMed)} · ${x.nHi}편·${x.nLo}편)</span></li>`).join("")
      : `<li class="bsub">아직 뚜렷한 차이가 보이지 않아요(그룹마다 4편 이상, 1.3배 이상 차이만 보여줘요).</li>`;
    const tn = B.tryNext.length ? B.tryNext.map((t, i) => `<div class="btry"><div class="bi">${i + 1}</div><div>
      <div class="bt">${esc(t.what)}</div><div class="bw">근거 · ${esc(t.why)}</div><div class="bw">판단 · ${esc(t.measure)}</div></div></div>`).join("")
      : `<div class="empty">데이터에서 바로 나오는 실험이 아직 없어요.</div>`;
    const tr = (B.trends || []).length ? B.trends.map((t) => `<li>${esc(t.series)} · 최근 2주 24시간 조회수 중간값 <b>${f(t.recentMed)}회</b> <span class="${t.change >= 0 ? "pos" : "neg"}">(${t.change >= 0 ? "+" : ""}${t.change}%)</span> <span class="bsub">그 전 4주 ${f(t.prevMed)}회 · ${t.nRecent}편 vs ${t.nPrev}편</span></li>`).join("") : `<li class="bsub">비교할 만큼 편수가 쌓인 시리즈가 아직 없어요.</li>`;

    // ⓪ 흐름 경보 (잘 나오다 꺾임 / 연속 부진 / 상승)
    const al = (B.alerts || []).map((a) => `<div class="balert ${a.level}">
      <div class="bt">${a.level === "bad" ? "📉" : a.level === "warn" ? "⚠️" : "📈"} ${esc(a.title)}</div>
      <div class="bw">${esc(a.detail)}</div>
      ${(a.diffs || []).map((d) => `<div class="bw">· ${esc(d)}</div>`).join("")}
      ${(a.actions || []).length ? `<div class="bw">· 이 사이 조치이력: ${a.actions.map((x) => esc(`${x.date.slice(5)} ${x.kind} ${x.note}`)).join(" / ")}</div>` : ""}
      ${a.peak ? `<details><summary>영상 보기</summary><div class="bcols"><div><b>잘 된 편</b>${a.peak.영상.map((v) => `<div class="bv">${v.date.slice(5)} ${v.hour}시 · <b>${f(v.v24)}</b> · <span class="bsub">${esc(v.hook)}</span><br>${esc(v.title)}</div>`).join("")}</div>
        <div><b>최근</b>${a.recent.영상.map((v) => `<div class="bv">${v.date.slice(5)} ${v.hour}시 · <b>${f(v.v24)}</b> · <span class="bsub">${esc(v.hook)}</span><br>${esc(v.title)}</div>`).join("")}</div></div></details>` : ""}
    </div>`).join("");
    const fx2 = (B.actionEffects || []).map((e) => `<div class="balert">
      <div class="bt">🔧 ${esc(e.date.slice(5).replace("-", "/"))} ${esc(e.kind)} — ${esc(e.target)}</div>
      <div class="bw">${esc(e.note)}</div>
      <div class="bw">24시간 조회수 중간값: 바꾸기 전 ${e.preN}편 <b>${f(e.preMed)}회</b> → 바꾼 뒤 ${e.postN}편 <b>${f(e.postMed)}회</b> <span class="${e.change >= 0 ? "pos" : "neg"}">(${e.change >= 0 ? "+" : ""}${e.change}%)</span></div>
      <div class="bw">바꾼 직후 3편 <b>${f(e.first3Med)}회</b> → 최근 ${e.lastN}편 <b>${f(e.lastMed)}회</b> · 바꾼 뒤 제목 형태: ${esc(e.postHooks)}</div>
    </div>`).join("");
    const serList = B.groups.filter((g) => !g.name.endsWith("전체") && g.v24 && g.v24.n >= 5).map((g) => g.name);
    if (!serList.includes(curSeries)) curSeries = serList.includes("시황 숏폼") ? "시황 숏폼" : serList[0];

    box.innerHTML = `
      ${fx2 ? `<h3 class="bh">🔧 바꾼 것의 효과 <span class="bsub">조치이력(포맷·TTS·제목 방식 등) 전후 비교</span></h3><div class="bstack">${fx2}</div>` : ""}
      ${al ? `<h3 class="bh">🚨 흐름 경보 <span class="bsub">시리즈마다 최근 편들이 평소·잘 나오던 때와 비교해 어떤지</span></h3><div class="bstack">${al}</div>` : ""}
      <h3 class="bh">📉 시리즈별 흐름 <span class="bsub">점 = 영상 1편의 업로드 24시간 조회수 · 주황 = 질문·이유·반전형 제목 · 회색 = 뉴스 요약형 · 세로선 = 조치이력</span>
        <select id="benchSeries" style="margin-left:auto">${serList.map((x) => `<option ${x === curSeries ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></h3>
      <div class="panel"><div style="position:relative;height:280px"><canvas id="benchSerChart"></canvas></div><div class="bsub" id="benchSerNote" style="margin-top:6px"></div></div>
      <h3 class="bh">🚀 지금 올라가는 중 <span class="bsub">업로드 후 숏폼 24시간·롱폼 7일까지, 같은 시점의 우리 영상들과 비교</span></h3>
      <div class="bgrid">${liveHtml}</div>
      <h3 class="bh">🧪 이번 주 해볼 것 <span class="bsub">아래 '차이'에서 바로 나온 실험이에요. 해 보고 '판단' 기준으로 확인해요</span></h3>
      <div class="bpanel">${tn}</div>
      <h3 class="bh">🔍 데이터가 말하는 차이 <span class="bsub">다 자란 영상(숏폼 1주·롱폼 2주 지난 것)끼리 비교</span></h3>
      <div class="bpanel"><ul class="blist">${fx}</ul></div>
      <h3 class="bh">📋 최근 2주 영상 성적표 <span class="bsub">배지 = 같은 형태 우리 영상 중 위치 (상위 25%면 우리 채널에서 잘 된 편)</span></h3>
      <div class="panel"><div class="table-wrap"><table class="btable"><thead><tr><th>업로드</th><th style="text-align:left">영상</th><th>24시간 조회수</th><th>지금까지 조회수</th><th>평균조회율</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">최근 2주 영상이 없어요.</td></tr>'}</tbody></table></div></div>
      <h3 class="bh">📏 우리 채널 기준값 <span class="bsub">굵은 숫자 = 중간값, 아래 = 보통 범위(하위 25%~상위 25%)</span></h3>
      <div class="panel"><div class="table-wrap"><table class="btable"><thead><tr><th style="text-align:left">구분</th><th>편수</th><th>24시간 조회수</th><th>다 자란 조회수</th><th>평균조회율</th><th>1,000회당 구독</th></tr></thead><tbody>${grows}</tbody></table></div></div>
      <h3 class="bh">📈 시리즈 흐름</h3>
      <div class="bpanel"><ul class="blist">${tr}</ul></div>
      <div class="bsub" style="margin-top:10px">제목 형태는 자동 분류예요: '?·~까'는 질문형, '왜·이유'는 이유형, '~는데·~지만·~에도'는 반전형, 나머지는 뉴스 요약형. 영상 ${B.coverage.videos}편 중 24시간 조회수가 기록된 영상 ${B.coverage.with24h}편 · 기준 시각 ${new Date(B.at).toLocaleString("ko-KR")}</div>`;
    const sel = $("benchSeries"); if (sel) sel.onchange = () => { curSeries = sel.value; drawSeries(); };
    drawSeries();
  }

  let curSeries = null, serChart = null;
  function drawSeries() {
    const cv = $("benchSerChart"); if (!cv || !B) return;
    if (serChart) { serChart.destroy(); serChart = null; }
    const arr = B.videos.filter((v) => v.series === curSeries && v.v24 != null).sort((a, b) => a.pub.localeCompare(b.pub)).slice(-40);
    const g = B.groups.find((x) => x.name === curSeries);
    const labels = arr.map((v) => v.kdate.slice(5).replace("-", "/"));
    const roll = arr.map((_, i) => { const w = arr.slice(Math.max(0, i - 4), i + 1).map((v) => v.v24).sort((a, b) => a - b); return w[w.length >> 1]; });
    const acts = (B.actions || []).filter((a) => a.date >= (arr[0] || {}).kdate);
    const actPlugin = { id: "benchActs", afterDraw(c) {
      const xa = c.scales.x, ya = c.scales.y, ctx = c.ctx;
      acts.forEach((a) => { let i = arr.findIndex((v) => v.kdate >= a.date); if (i < 0) return; const x = xa.getPixelForValue(i) - (i > 0 ? (xa.getPixelForValue(i) - xa.getPixelForValue(i - 1)) / 2 : 0);
        ctx.save(); ctx.strokeStyle = "rgba(225,29,72,.55)"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, ya.top); ctx.lineTo(x, ya.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = "rgba(225,29,72,.9)"; ctx.font = "11px system-ui"; ctx.fillText("🔧 " + (a.kind || "").slice(0, 8), x + 3, ya.top + 12); ctx.restore(); }); } };
    serChart = new Chart(cv, { data: { labels, datasets: [
      { type: "line", label: "최근 5편 중간값", data: roll, borderColor: "#3182f6", borderWidth: 2, pointRadius: 0, tension: .3 },
      { type: "line", label: "24시간 조회수", data: arr.map((v) => v.v24), showLine: false, pointRadius: 6, pointHoverRadius: 8,
        pointBackgroundColor: arr.map((v) => v.hook === "뉴스 요약형" ? "#adb5bd" : "#f0a020"), pointBorderColor: "transparent" },
      ...(g && g.v24 ? [{ type: "line", label: "시리즈 중간값", data: arr.map(() => g.v24.med), borderColor: "rgba(139,149,161,.6)", borderDash: [5, 5], borderWidth: 1, pointRadius: 0 }] : []),
    ] }, plugins: [actPlugin], options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: true },
      plugins: { legend: { labels: { boxWidth: 10, color: "#8b95a1" } }, tooltip: { callbacks: { title: (it) => { const v = arr[it[0].dataIndex]; return `${v.kdate} ${v.hour}시 · ${v.hook}`; }, label: (c) => c.datasetIndex === 1 ? `${arr[c.dataIndex].title.split("#")[0].slice(0, 40)} — ${f(c.parsed.y)}회` : `${c.dataset.label} ${f(c.parsed.y)}회` } } },
      onClick: (ev, els) => { const e = els.find((x) => x.datasetIndex === 1); if (e) { const v = arr[e.index]; openVideo(v.id, v.title, v.pub.slice(0, 10)); } },
      scales: { x: { ticks: { color: "#8b95a1", maxRotation: 0, autoSkip: true }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: "#8b95a1" }, grid: { color: typeof gridCol === "function" ? gridCol() : "#eee" } } } } });
    const cur = arr.filter((v) => v.hook !== "뉴스 요약형").map((v) => v.v24).sort((a, b) => a - b), nw = arr.filter((v) => v.hook === "뉴스 요약형").map((v) => v.v24).sort((a, b) => a - b);
    const md = (a) => a.length ? a[a.length >> 1] : null;
    $("benchSerNote").innerHTML = cur.length && nw.length ? `이 시리즈 최근 ${arr.length}편: 질문·이유·반전형 ${cur.length}편 중간값 <b>${f(md(cur))}회</b> · 뉴스 요약형 ${nw.length}편 <b>${f(md(nw))}회</b>. 포맷·TTS처럼 바꾼 날은 관리자 → 조치이력에 남기면 세로선으로 표시돼요.` : "포맷·TTS처럼 바꾼 날은 관리자 → 조치이력에 남기면 세로선으로 표시돼요.";
  }
  async function load(force) {
    loading = true; render();
    try { const r = await fetch("/api/benchmarks" + (force ? "?fresh=1" : "")).then((r) => r.json()); B = r.ok ? r : null; } catch (_) { B = null; }
    loading = false; render();
  }
  window.benchDraw = function () { if (!B && !loading) load(); else render(); };
  window.benchReload = () => load(true);
  // 화면이 열려 있으면 10분마다 다시 불러온다 (지금 올라가는 영상 페이스 갱신)
  setInterval(() => { const sec = $("sec-bench"); if (!document.hidden && sec && sec.style.display !== "none") load(false); }, 10 * 60 * 1000);
  window.benchData = () => B;
})();
