// 📡 이슈 레이더 — /api/issues (DART 공시 + 뉴스 RSS) 를 보여 주고, 고른 이슈를 캘린더 아이디어로 보낸다
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TAGS = ["전체", "계약", "합병·인수", "속보", "실적", "자금조달"];
  const COLOR = { "계약": "#e5484d", "합병·인수": "#8e4ec6", "속보": "#f76b15", "실적": "#0090ff", "자금조달": "#12a594", "기타": "#8b8d98" };
  let D = null, tag = "전체", usOnly = false, hours = 24, loading = false;
  const kst = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600e3); return isNaN(d) ? "" : `${d.toISOString().slice(5, 10).replace("-", "/")} ${d.toISOString().slice(11, 16)}`; };
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };

  async function load() {
    loading = true; render();
    try { const r = await fetch(`/api/issues?hours=${hours}`).then((r) => r.json()); D = r.ok ? r : null; } catch (_) { D = null; }
    loading = false; render();
  }
  function render() {
    const el = document.getElementById("radarBody"); if (!el) return;
    if (loading && !D) { el.innerHTML = `<div class="bsub">불러오는 중…</div>`; return; }
    if (!D) { el.innerHTML = `<div class="bsub">불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</div>`; return; }
    const st = D.state || {};
    const dartLine = st.dart && st.dart.configured
      ? `DART 공시: ${st.dart.lastRun ? ago(st.dart.lastRun) + " 확인" : "첫 확인 전"}${st.dart.error ? ` · <span style="color:#e5484d">${esc(st.dart.error)}</span>` : ""}`
      : `<span style="color:#e5484d">DART 키가 아직 없어요</span> — opendart.fss.or.kr에서 무료 인증키를 받아 Railway 변수 <code>DART_API_KEY</code>에 넣으면 공시도 10분마다 들어와요`;
    const newsLine = `뉴스: ${st.news && st.news.lastRun ? ago(st.news.lastRun) + " 확인" : "첫 확인 전"}${st.news && st.news.error ? ` · <span style="color:#e5484d">${esc(st.news.error)}</span>` : ""}`;
    let items = (D.items || []).filter((x) => (tag === "전체" || x["분류"] === tag) && (!usOnly || x["미국관련"] === "Y"));
    const chips = TAGS.map((t) => { const n = (D.items || []).filter((x) => (t === "전체" || x["분류"] === t) && (!usOnly || x["미국관련"] === "Y")).length;
      return `<button data-tag="${t}" class="rd-chip" style="border:1px solid var(--line);background:${t === tag ? "var(--text)" : "var(--chip)"};color:${t === tag ? "var(--bg)" : "var(--text)"};padding:6px 12px;border-radius:999px;font-size:12.5px;cursor:pointer">${t} ${n}</button>`; }).join(" ");
    const rows = items.slice(0, 200).map((x, i) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--line)">
        <span style="flex:none;font-size:11px;font-weight:700;color:#fff;background:${COLOR[x["분류"]] || "#8b8d98"};border-radius:6px;padding:3px 7px;margin-top:2px">${esc(x["분류"])}</span>
        <div style="flex:1;min-width:0">
          <a href="${esc(x["링크"])}" target="_blank" rel="noopener" style="font-size:14px;font-weight:600;color:var(--text);text-decoration:none;line-height:1.45">${esc(x["제목"])}</a>
          <div class="bsub">${x["출처"] === "DART" ? "📑 DART 공시" : esc(x["출처"])} · ${kst(x["발표시각"])}${x["미국관련"] === "Y" ? ' · <b style="color:#0090ff">🇺🇸 미국 관련</b>' : ""}</div>
        </div>
        <button data-i="${i}" class="rd-idea" style="flex:none;background:var(--chip);color:var(--text);border:1px solid var(--line);padding:5px 10px;border-radius:8px;font-size:11.5px;cursor:pointer">캘린더에 아이디어로</button>
      </div>`).join("") || `<div class="bsub" style="padding:14px 4px">조건에 맞는 이슈가 아직 없어요.</div>`;
    el.innerHTML = `<div class="bsub" style="margin-bottom:8px">${dartLine}<br>${newsLine}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">${chips}
        <label style="margin-left:8px;font-size:12.5px;cursor:pointer"><input type="checkbox" id="rdUs" ${usOnly ? "checked" : ""}> 미국 관련만</label>
        <select id="rdHours" style="margin-left:6px;font-size:12.5px;padding:4px 6px;border-radius:7px;border:1px solid var(--line);background:var(--chip);color:var(--text)">
          ${[[6, "최근 6시간"], [24, "최근 24시간"], [72, "최근 3일"], [168, "최근 7일"]].map(([h, l]) => `<option value="${h}" ${h === hours ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button id="rdReload" style="margin-left:auto;background:var(--chip);color:var(--text);border:1px solid var(--line);padding:5px 10px;border-radius:8px;font-size:12px;cursor:pointer">새로고침</button></div>
      <div class="panel" style="padding:4px 12px">${rows}</div>`;
    el.querySelectorAll(".rd-chip").forEach((b) => b.onclick = () => { tag = b.dataset.tag; render(); });
    el.querySelector("#rdUs").onchange = (e) => { usOnly = e.target.checked; render(); };
    el.querySelector("#rdHours").onchange = (e) => { hours = Number(e.target.value); load(); };
    el.querySelector("#rdReload").onclick = load;
    el.querySelectorAll(".rd-idea").forEach((b) => b.onclick = () => toCalendar(items[Number(b.dataset.i)], b));
  }
  async function toCalendar(x, btn) {
    if (!x) return;
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const id = "idea_" + (x["키"] || "").replace(/[^\w]/g, "").slice(-24) + Date.now().toString(36).slice(-4);
    const item = { id, kind: "post", account: "미주옵", format: "캐러셀", date: today, time: "", title: x["제목"].slice(0, 80), status: "아이디어", topic: x["분류"], memo: x["링크"], color: "", title_type: "" };
    const send = (pw) => fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "upsert", item, pw }) }).then((r) => r.json());
    let r = await send("");
    if (r.needPw) { const pw = prompt("이 브라우저에서 처음 한 번만 대시보드 비밀번호가 필요해요."); if (!pw) return; r = await send(pw); }
    btn.textContent = r.ok ? "넣었어요 ✓" : "실패: " + (r.error || ""); btn.disabled = !!r.ok;
  }
  window.radarDraw = () => { if (!D) load(); else render(); };
  setInterval(() => { if (document.getElementById("sec-radar")?.style.display !== "none") load(); }, 5 * 60 * 1000);
})();
