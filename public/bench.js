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

    box.innerHTML = `
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
      <div class="bsub" style="margin-top:10px">영상 ${B.coverage.videos}편 중 24시간 조회수가 기록된 영상 ${B.coverage.with24h}편 · 기준 시각 ${new Date(B.at).toLocaleString("ko-KR")}</div>`;
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
