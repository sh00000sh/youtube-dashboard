// ===================================================================
// 📸 인스타 탭 — 미주옵 · 회사 계정을 나눠 보고 나란히 비교 (/api/ig)
//   기준은 유튜브와 같다: 그 계정·그 형식(캐러셀/릴스) 게시물들의 중간값
// ===================================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const f = (n, d = 0) => (n == null || isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d }));
  const p1 = (x) => (x == null || isNaN(x) ? "-" : (x * 100).toFixed(1) + "%");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x) => (x === "" || x == null ? null : Number(x));
  const med = (a) => { const s = a.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const rank = (arr, v) => { const s = arr.filter((x) => x != null); if (!s.length || v == null) return null; let lo = 0, eq = 0; s.forEach((x) => { if (x < v) lo++; else if (x === v) eq++; }); return Math.round((lo + eq / 2) / s.length * 100); };
  const grade = (p) => p == null ? "" : p >= 75 ? `<span class="bchip up">${p >= 90 ? "상위 10%" : "상위 25%"}</span>` : p >= 40 ? `<span class="bchip mid">보통</span>` : `<span class="bchip dn">${p < 25 ? "하위 25%" : "아래쪽"}</span>`;
  // 첫 줄(후킹 문장) 형태 — 유튜브와 같은 분류
  const hookOf = (t) => { const m = String(t || ""); return /\?|까$|까요|나요|을까|ㄹ까|일까|할까|될까/.test(m) ? "질문형" : /이유|왜\s/.test(m) ? "이유형" : /는데|지만|에도|인데|했더니|대신/.test(m) ? "반전형" : "요약·정보형"; };
  const ACC = ["미주옵", "회사"], FMT = ["캐러셀", "릴스"];
  let D = null, loading = false, acctFilter = "전체";

  function prep(p) {
    const reach = num(p["도달"]), likes = num(p["좋아요"]) || 0, com = num(p["댓글"]) || 0, sav = num(p["저장"]) || 0, sh = num(p["공유"]) || 0, fol = num(p["팔로우"]);
    const k = new Date(Date.parse(p["게시시각"]) + 9 * 3600e3);
    return { acc: p["계정"], id: p["미디어ID"], ts: p["게시시각"], kdate: k.toISOString().slice(0, 10), hour: k.getUTCHours(), dow: k.getUTCDay(), fmt: p["형식"] === "사진" ? "캐러셀" : p["형식"] === "영상" ? "릴스" : p["형식"],
      first: p["첫줄"], link: p["링크"], reach, views: num(p["조회"]), likes, com, sav, sh, fol, visits: num(p["프로필방문"]), watch: num(p["릴스평균시청초"]),
      eng: reach ? (likes + com + sav + sh) / reach : null, saveR: reach ? sav / reach : null, shareR: reach ? sh / reach : null, fol1k: reach && fol != null ? fol / reach * 1000 : null,
      hook: hookOf(p["첫줄"]), age: (Date.now() - Date.parse(p["게시시각"])) / 864e5 };
  }

  function setupGuide() {
    return `<div class="bpanel" style="line-height:1.7">
      <div class="bt" style="font-size:15px;margin-bottom:6px">인스타 계정 연결이 필요해요 (처음 한 번)</div>
      <div class="bw">두 계정 모두 프로페셔널 계정이라 페이스북 페이지 없이 <b>Instagram API(Instagram 로그인)</b>로 바로 받아올 수 있어요.</div>
      <ol style="margin:8px 0 0 18px;font-size:13.5px">
        <li><a href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</a> → <b>앱 만들기</b> → 사용 사례 <b>'Instagram에서 메시지 및 콘텐츠 관리'</b> → 앱 이름 아무거나</li>
        <li>앱 대시보드 → <b>Instagram → Instagram 로그인으로 API 설정</b> → <b>1. 액세스 토큰 생성</b>에서 <b>계정 추가</b> → 미주옵으로 로그인 (회사 계정도 똑같이)</li>
        <li>계정이 '테스터 초대'를 받으면 인스타 → 설정 → <b>웹사이트 권한 → 앱 및 웹사이트 → 테스터 초대</b>에서 수락</li>
        <li>각 계정 옆 <b>토큰 생성</b> → 나온 토큰을 Railway → 이 서비스 → <b>Variables</b>에 직접 붙여넣기: <code>IG_TOKEN_MIZUOP</code>, <code>IG_TOKEN_COMPANY</code></li>
      </ol>
      <div class="bw" style="margin-top:8px">저장하면 1분 안에 첫 수집을 하고, 그 뒤로 3시간마다 최근 게시물 50개의 도달·조회·좋아요·댓글·저장·공유·팔로우를 받아와요. 토큰은 비밀번호와 같으니 채팅에 붙여넣지 말고 Railway에만 넣어 주세요.</div>
    </div>`;
  }

  function renderCompare(box) {
    const P = D.posts.map(prep).filter((p) => p.reach != null);
    const accs = D.accounts;
    const cards = accs.map((a) => {
      const mine = P.filter((p) => p.acc === a.key), last30 = mine.filter((p) => p.age <= 30);
      const hist = D.history.filter((h) => h.account === a.key).sort((x, y) => x.at.localeCompare(y.at));
      const now = hist[hist.length - 1], wk = hist.filter((h) => Date.parse(h.at) <= Date.now() - 7 * 864e5).pop();
      const dF = now && wk ? now.followers - wk.followers : null;
      return `<div class="bcard" style="cursor:default">
        <div class="bk">@${esc(a.handle)} · ${a.configured ? (a.ok ? `마지막 수집 ${a.lastSync ? new Date(a.lastSync).toLocaleString("ko-KR") : "-"}` : `⚠️ ${esc(a.error || "아직 수집 전")}`) : "연결 안 됨"}</div>
        <div class="bt">${esc(a.key)} 계정</div>
        <div class="bn"><b>${f(a.followers ?? (now ? now.followers : null))}</b> <span class="bsub">팔로워${dF != null ? ` · 7일 ${dF >= 0 ? "+" : ""}${dF}` : ""}</span></div>
        <div class="bw">최근 30일 게시물 <b>${last30.length}</b> · 도달 중간값 <b>${f(med(last30.map((p) => p.reach)))}</b> · 참여율 <b>${p1(med(last30.map((p) => p.eng)))}</b></div>
        <div class="bw">저장률 <b>${p1(med(last30.map((p) => p.saveR)))}</b> · 공유율 <b>${p1(med(last30.map((p) => p.shareR)))}</b> · 도달 1천당 팔로우 <b>${f(med(last30.map((p) => p.fol1k)), 1)}</b></div>
      </div>`;
    }).join("");

    // 계정 × 형식 비교표 (최근 60일)
    const cols = []; ACC.forEach((a) => FMT.forEach((t) => cols.push([a, t])));
    const sub = (a, t) => P.filter((p) => p.acc === a && p.fmt === t && p.age <= 60);
    const ROWS = [["게시물 수", (x) => x.length, (v) => f(v)], ["도달 중간값", (x) => med(x.map((p) => p.reach)), (v) => f(v)], ["조회 중간값", (x) => med(x.map((p) => p.views)), (v) => f(v)],
      ["참여율", (x) => med(x.map((p) => p.eng)), p1], ["저장률", (x) => med(x.map((p) => p.saveR)), p1], ["공유율", (x) => med(x.map((p) => p.shareR)), p1],
      ["도달 1천당 팔로우", (x) => med(x.map((p) => p.fol1k)), (v) => f(v, 1)], ["릴스 평균 시청(초)", (x) => med(x.map((p) => p.watch)), (v) => f(v, 1)]];
    const tbl = `<table class="btable"><thead><tr><th style="text-align:left">최근 60일</th>${cols.map(([a, t]) => `<th>${a} ${t}</th>`).join("")}</tr></thead><tbody>
      ${ROWS.map(([n, fn, fm]) => { const vals = cols.map(([a, t]) => fn(sub(a, t))); const best = n === "게시물 수" ? null : Math.max(...vals.filter((v) => v != null && !isNaN(v)));
        return `<tr><td style="text-align:left">${n}</td>${vals.map((v) => `<td>${v != null && v === best && n !== "릴스 평균 시청(초)" ? `<b style="color:var(--g-tx)">${fm(v)}</b>` : fm(v)}</td>`).join("")}</tr>`; }).join("")}</tbody></table>`;

    // 첫 줄 형태 · 시간대 (계정별, 도달 중간값)
    const by = (a, keyFn, keys) => keys.map((k) => { const x = P.filter((p) => p.acc === a && keyFn(p) === k); return `<td>${x.length ? `<b>${f(med(x.map((p) => p.reach)))}</b><div class="bsub">${x.length}편 · 참여 ${p1(med(x.map((p) => p.eng)))}</div>` : "-"}</td>`; }).join("");
    const HOOKS = ["질문형", "이유형", "반전형", "요약·정보형"], SLOT = (p) => p.hour < 11 ? "아침(~11시)" : p.hour < 17 ? "낮(11~17시)" : p.hour < 20 ? "퇴근길(17~20시)" : "밤(20시~)", SLOTS = ["아침(~11시)", "낮(11~17시)", "퇴근길(17~20시)", "밤(20시~)"];
    const hookTbl = `<table class="btable"><thead><tr><th style="text-align:left">도달 중간값</th>${HOOKS.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${ACC.map((a) => `<tr><td style="text-align:left">${a}</td>${by(a, (p) => p.hook, HOOKS)}</tr>`).join("")}</tbody></table>`;
    const slotTbl = `<table class="btable"><thead><tr><th style="text-align:left">도달 중간값</th>${SLOTS.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${ACC.map((a) => `<tr><td style="text-align:left">${a}</td>${by(a, SLOT, SLOTS)}</tr>`).join("")}</tbody></table>`;

    // 잘 된 / 안 된 게시물 (계정·형식 안에서 위치)
    const ranked = P.filter((p) => p.age >= 2).map((p) => ({ ...p, r: rank(P.filter((q) => q.acc === p.acc && q.fmt === p.fmt && q.age >= 2).map((q) => q.reach), p.reach) }));
    const pick = (a, best) => ranked.filter((p) => p.acc === a).sort((x, y) => best ? y.reach - x.reach : x.reach - y.reach).slice(0, 3)
      .map((p) => `<div class="bv"><a href="${esc(p.link)}" target="_blank">${esc(p.first.slice(0, 40) || "(첫 줄 없음)")}</a><br><span class="bsub">${p.kdate.slice(5)} ${p.hour}시 · ${p.fmt} · ${p.hook}</span> · 도달 <b>${f(p.reach)}</b> ${grade(p.r)} · 저장 ${f(p.sav)} · 공유 ${f(p.sh)}</div>`).join("") || `<div class="bsub">아직 없어요</div>`;
    const bw = ACC.map((a) => `<div><b>${a}</b><div class="bsub" style="margin:4px 0">잘 된 3개</div>${pick(a, true)}<div class="bsub" style="margin:10px 0 4px">안 된 3개</div>${pick(a, false)}</div>`).join("");

    box.innerHTML = `
      <h3 class="bh">👥 두 계정 한눈에 <span class="bsub">최근 30일 · 중간값 기준</span></h3><div class="bgrid">${cards}</div>
      <h3 class="bh">⚖️ 계정 × 형식 비교 <span class="bsub">초록 = 네 칸 중 가장 좋은 값. 도달은 팔로워 수 차이를 그대로 반영하니 참여율·저장률을 같이 보세요</span></h3><div class="panel"><div class="table-wrap">${tbl}</div></div>
      <h3 class="bh">🪝 첫 줄 형태별 <span class="bsub">캡션 첫 줄(후킹 문장)을 질문·이유·반전·요약으로 자동 분류</span></h3><div class="panel"><div class="table-wrap">${hookTbl}</div></div>
      <h3 class="bh">🕘 올린 시간대별</h3><div class="panel"><div class="table-wrap">${slotTbl}</div></div>
      <h3 class="bh">🏆 잘 된 게시물 · 아쉬운 게시물 <span class="bsub">배지 = 같은 계정·같은 형식 안에서 위치</span></h3><div class="bpanel"><div class="bcols">${bw}</div></div>`;
  }

  function renderPosts(box) {
    const P = D.posts.map(prep).sort((a, b) => b.ts.localeCompare(a.ts));
    const list = P.filter((p) => acctFilter === "전체" || p.acc === acctFilter);
    const pool = (p) => P.filter((q) => q.acc === p.acc && q.fmt === p.fmt && q.reach != null && q.age >= 2).map((q) => q.reach);
    box.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">${["전체", ...ACC].map((a) => `<button class="igf ${a === acctFilter ? "on" : ""}" data-a="${a}">${a}</button>`).join("")}
      <button class="igf on" style="margin-left:auto" id="igAdd">+ 직접 입력</button></div>
      <div id="igForm"></div>
      <div class="panel"><div class="table-wrap"><table class="btable"><thead><tr><th>게시</th><th>계정</th><th style="text-align:left">첫 줄</th><th>형식</th><th>도달</th><th>조회</th><th>좋아요</th><th>댓글</th><th>저장</th><th>공유</th><th>팔로우</th><th>참여율</th></tr></thead><tbody>
      ${list.map((p) => `<tr ${String(p.id).startsWith("manual_") ? `class="igm" data-id="${esc(p.id)}" title="눌러서 고치기" style="cursor:pointer"` : ""}><td style="white-space:nowrap">${p.kdate.slice(5)} ${p.hour}시${String(p.id).startsWith("manual_") ? ' <span class="bsub">✍️</span>' : ""}</td><td>${esc(p.acc)}</td>
        <td style="text-align:left"><a href="${esc(p.link)}" target="_blank">${esc((p.first || "(첫 줄 없음)").slice(0, 36))}</a><div class="bsub">${p.hook}</div></td><td>${esc(p.fmt)}</td>
        <td>${f(p.reach)} ${p.age >= 2 ? grade(rank(pool(p), p.reach)) : `<span class="bsub">${Math.floor(p.age * 24)}시간째</span>`}</td><td>${f(p.views)}</td><td>${f(p.likes)}</td><td>${f(p.com)}</td><td>${f(p.sav)}</td><td>${f(p.sh)}</td><td>${f(p.fol)}</td><td>${p1(p.eng)}</td></tr>`).join("") || '<tr><td colspan="12" class="empty">아직 수집된 게시물이 없어요.</td></tr>'}
      </tbody></table></div></div>`;
    box.querySelectorAll(".igf[data-a]").forEach((b) => b.onclick = () => { acctFilter = b.dataset.a; renderPosts(box); });
    box.querySelector("#igAdd").onclick = () => openForm(box.querySelector("#igForm"), null);
    box.querySelectorAll("tr.igm").forEach((tr) => tr.onclick = (ev) => { if (ev.target.closest("a")) return; openForm(box.querySelector("#igForm"), D.posts.find((x) => x["미디어ID"] === tr.dataset.id)); box.querySelector("#igForm").scrollIntoView({ behavior: "smooth", block: "center" }); });
  }

  // ✍️ 직접 입력 폼 — 캘린더에 적어 둔 인스타 게시물을 골라 계정·형식·시각·제목을 채울 수 있다
  let CAL = null;
  async function calPosts() { if (CAL) return CAL; try { const r = await fetch("/api/calendar").then((r) => r.json()); CAL = (r.items || []).filter((x) => x.kind === "post" && ACC.includes(x.account)); } catch (_) { CAL = []; } return CAL; }
  const FIELDS = [["reach", "도달"], ["views", "조회"], ["likes", "좋아요"], ["comments", "댓글"], ["saved", "저장"], ["shares", "공유"], ["follows", "팔로우"], ["visits", "프로필 방문"], ["watch", "릴스 평균 시청(초)"]];
  const COLK = { reach: "도달", views: "조회", likes: "좋아요", comments: "댓글", saved: "저장", shares: "공유", follows: "팔로우", visits: "프로필방문", watch: "릴스평균시청초" };
  async function openForm(el, row) {
    const v = (k) => row ? row[COLK[k]] ?? "" : "";
    const ts = row ? new Date(Date.parse(row["게시시각"]) + 9 * 3600e3).toISOString().slice(0, 16) : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16);
    const cal = await calPosts();
    const done = new Set(D.posts.map((p) => p["첫줄"]));
    el.innerHTML = `<div class="bpanel igform"><div class="bt" style="margin-bottom:8px">${row ? "게시물 고치기" : "게시물 직접 입력"} <span class="bsub">인스타 앱 → 게시물 → 인사이트 보기의 숫자를 그대로 넣어 주세요</span></div>
      ${row ? "" : `<label class="igl">캘린더에서 불러오기 <select id="igCal"><option value="">— 고르면 아래가 채워져요 —</option>${cal.filter((c) => !done.has(c.title)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 40).map((c) => `<option value="${esc(c.id)}">${esc(c.date.slice(5))} ${esc(c.time || "")} · ${esc(c.account)} ${esc(c.format === "릴스" ? "릴스" : "게시물")} · ${esc((c.title || "").slice(0, 30))}</option>`).join("")}</select></label>`}
      <div class="iggrid">
        <label class="igl">계정 <select id="igAcc">${ACC.map((a) => `<option ${row && row["계정"] === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label class="igl">형식 <select id="igFmt">${FMT.map((a) => `<option ${row && row["형식"] === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label class="igl">올린 시각 <input type="datetime-local" id="igTs" value="${ts}"></label>
        <label class="igl" style="grid-column:span 2">첫 줄(후킹 문장) <input id="igFirst" value="${esc(row ? row["첫줄"] : "")}"></label>
        <label class="igl">링크 <input id="igLink" value="${esc(row ? row["링크"] : "")}" placeholder="https://www.instagram.com/p/…"></label>
        ${FIELDS.map(([k, l]) => `<label class="igl">${l} <input type="number" min="0" step="any" id="ig_${k}" value="${esc(v(k))}"></label>`).join("")}
      </div>
      <div id="igPwRow"></div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">${row ? `<button class="igf" id="igDel" style="color:#e15a72">삭제</button>` : ""}<span class="bsub" id="igMsg" style="margin-left:auto"></span>
        <button class="igf" id="igCancel">닫기</button><button class="igf on" id="igSave">저장</button></div></div>`;
    const q = (id) => el.querySelector("#" + id);
    if (q("igCal")) q("igCal").onchange = () => { const c = cal.find((x) => x.id === q("igCal").value); if (!c) return; q("igAcc").value = c.account; q("igFmt").value = c.format === "릴스" ? "릴스" : "캐러셀"; q("igTs").value = `${c.date}T${c.time || "09:00"}`; q("igFirst").value = c.title || ""; };
    q("igCancel").onclick = () => { el.innerHTML = ""; };
    const send = async (op) => {
      const item = { id: row ? row["미디어ID"] : null, acc: q("igAcc").value, fmt: q("igFmt").value, ts: q("igTs").value ? new Date(q("igTs").value + ":00+09:00").toISOString() : null, first: q("igFirst").value.trim(), link: q("igLink").value.trim() };
      FIELDS.forEach(([k]) => { item[k] = q("ig_" + k).value; });
      const pwEl = el.querySelector("#igPw");
      q("igMsg").textContent = "저장 중…";
      try {
        const r = await fetch("/api/ig/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, item, pw: (pwEl && pwEl.value) || (typeof ADMIN !== "undefined" && ADMIN ? ADMIN_PW : "") }) }).then((r) => r.json());
        if (r.needPw) { q("igPwRow").innerHTML = `<div class="bpanel" style="margin-top:8px;background:var(--chip)"><div class="bsub">${esc(r.error)} 한 번 맞히면 이 브라우저에선 30일 동안 바로 저장돼요.</div><input type="password" id="igPw" placeholder="대시보드 관리자 비밀번호" style="width:100%;margin-top:6px"></div>`; el.querySelector("#igPw").focus(); q("igMsg").textContent = ""; return; }
        if (!r.ok) { q("igMsg").textContent = "❌ " + (r.error || "실패"); return; }
        el.innerHTML = ""; await load();
      } catch (e) { q("igMsg").textContent = "❌ " + e.message; }
    };
    q("igSave").onclick = () => send("upsert");
    if (q("igDel")) q("igDel").onclick = () => { if (q("igDel").dataset.arm) send("delete"); else { q("igDel").dataset.arm = 1; q("igDel").textContent = "한 번 더 누르면 삭제"; } };
  }

  function render(mode) {
    const box = $(mode === "posts" ? "igPostsBody" : "igBody"); if (!box) return;
    if (!D) { box.innerHTML = `<div class="empty">${loading ? "불러오는 중…" : "인스타 데이터를 불러오지 못했어요."}</div>`; return; }
    const api = D.accounts.some((a) => a.configured);
    const banner = api ? "" : `<div class="bpanel" style="margin-bottom:12px"><b>지금은 직접 입력한 숫자로 분석해요.</b> <span class="bsub">인스타 API 연결(메타 개발자 등록)이 페이스북 보안 제한으로 막혀 있어요. 풀리면 자동 수집으로 바뀌고, 입력한 숫자는 그대로 남아요.</span>
      <details style="margin-top:6px"><summary style="cursor:pointer;color:var(--blue);font-size:12.5px">자동 연결 방법 보기</summary>${setupGuide()}</details></div>`;
    if (!D.posts.length && mode !== "posts") { box.innerHTML = banner + `<div class="bpanel">아직 입력된 게시물이 없어요. <a onclick="showSub('sec-igposts')" style="cursor:pointer;color:var(--blue)">게시물 성과 → + 직접 입력</a>에서 인스타 인사이트 숫자를 넣으면 여기서 두 계정을 비교해 줘요.</div>`; return; }
    const inner = document.createElement("div");
    mode === "posts" ? renderPosts(inner) : renderCompare(inner);
    box.innerHTML = banner; box.appendChild(inner);
  }
  let lastMode = "compare";
  async function load() { loading = true; render(lastMode); try { const r = await fetch("/api/ig").then((r) => r.json()); D = r.ok ? r : null; } catch (_) { D = null; } loading = false; render(lastMode); }
  window.igDraw = (mode) => { lastMode = mode; if (!D && !loading) load(); else render(mode); };
})();
