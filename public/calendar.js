// ===================================================================
// 📅 콘텐츠 캘린더 — 미주옵·회사 인스타 + 유튜브를 한 달력에서
//  - 유튜브 영상은 VIDEOS(/api/data)에서 자동으로 그린다: 업로드 시각(KST)·쇼츠/영상·시황 여부
//  - 인스타 게시물·릴스, 일정, 유튜브 메모(시황 표시 등)는 /api/calendar (시트 '콘텐츠캘린더' 탭)
//  - 보기는 누구나, 저장·삭제는 관리자 로그인 후
//  - 왼쪽 달력 + 오른쪽 그날 시간표, 항목을 누르면 수정 창 (예전 클로드 캘린더를 옮겨 옴)
// ===================================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = ['업로드 예정', '올림', '보류'];
  const ACCTS = [['미주옵', '미주옵 · 인스타 @mizuop_kr'], ['회사', '회사 · 인스타 @eugeneoptions'], ['유튜브', '유튜브 · @eugenefutures']];
  const ACCT_FMT = { '미주옵': ['캐러셀', '릴스'], '회사': ['캐러셀', '릴스'], '유튜브': ['영상', '쇼츠'] };
  const FMT_L = { '캐러셀': '게시물' };
  const DEF_C = { '미주옵|캐러셀': 'blue', '미주옵|릴스': 'coral', '회사|캐러셀': 'mint', '회사|릴스': 'pink', '유튜브|영상': 'purple', '유튜브|쇼츠': 'yellow', '유튜브|시황': 'orange' };
  const SLOTS = [['09:30', '아침'], ['11:00', '오전'], ['15:00', '오후'], ['18:00', '퇴근길 릴스'], ['21:00', '밤']];
  const SLOT_T = { am1: '09:30', am2: '11:00', pm1: '13:30', pm2: '15:00', pm3: '16:30', reel: '18:00', eve: '21:00' };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const COLORS = ['coral', 'orange', 'yellow', 'green', 'mint', 'blue', 'purple', 'pink', 'gray'];
  const KINDS = ['회의', '마감', '촬영', '휴무', '기타'];
  const KIND_C = { '회의': 'green', '마감': 'gray', '촬영': 'purple', '휴무': 'coral', '기타': 'gray' };
  // ── 휴장일·공휴일 (10/26 사용자: 미장 휴장, 한국 명절·공휴일, 휴무일을 캘린더에) ──
  // kr = 한국 공휴일(국내 증시도 휴장), krx = 국내 증시만 휴장, us = 미국 증시 휴장, half = 미국 조기 폐장, info = 참고(서머타임)
  // 출처: NYSE 2026~2028 휴장 공지(2025.12.23), 2026·2027 한국 공휴일(대체·임시공휴일 포함). 해마다 연말에 다음 해를 추가한다
  const HOL_RAW = {
    kr: ['2026-01-01 신정', '2026-02-16 설날 연휴', '2026-02-17 설날', '2026-02-18 설날 연휴', '2026-03-01 삼일절', '2026-03-02 대체공휴일(삼일절)',
      '2026-05-01 노동절', '2026-05-05 어린이날', '2026-05-24 부처님오신날', '2026-05-25 대체공휴일(부처님오신날)', '2026-06-03 지방선거', '2026-06-06 현충일',
      '2026-07-17 제헌절', '2026-08-15 광복절', '2026-08-17 대체공휴일(광복절)', '2026-09-24 추석 연휴', '2026-09-25 추석', '2026-09-26 추석 연휴',
      '2026-10-03 개천절', '2026-10-05 대체공휴일(개천절)', '2026-10-09 한글날', '2026-12-25 성탄절',
      '2027-01-01 신정', '2027-02-06 설날 연휴', '2027-02-07 설날', '2027-02-08 설날 연휴', '2027-02-09 대체공휴일(설날)', '2027-03-01 삼일절',
      '2027-05-01 노동절', '2027-05-03 대체공휴일(노동절)', '2027-05-05 어린이날', '2027-05-13 부처님오신날', '2027-06-06 현충일',
      '2027-07-17 제헌절', '2027-07-19 대체공휴일(제헌절)', '2027-08-15 광복절', '2027-08-16 대체공휴일(광복절)',
      '2027-09-14 추석 연휴', '2027-09-15 추석', '2027-09-16 추석 연휴', '2027-10-03 개천절', '2027-10-04 대체공휴일(개천절)',
      '2027-10-09 한글날', '2027-10-11 대체공휴일(한글날)', '2027-12-25 성탄절', '2027-12-27 대체공휴일(성탄절)'],
    krx: ['2026-12-31 국내 증시 연말 휴장', '2027-12-31 국내 증시 연말 휴장'],
    us: ['2026-01-01 신정', '2026-01-19 마틴 루서 킹 데이', '2026-02-16 대통령의 날', '2026-04-03 성금요일', '2026-05-25 메모리얼 데이',
      '2026-06-19 준틴스', '2026-07-03 독립기념일(대체)', '2026-09-07 노동절', '2026-11-26 추수감사절', '2026-12-25 성탄절',
      '2027-01-01 신정', '2027-01-18 마틴 루서 킹 데이', '2027-02-15 대통령의 날', '2027-03-26 성금요일', '2027-05-31 메모리얼 데이',
      '2027-06-18 준틴스(대체)', '2027-07-05 독립기념일(대체)', '2027-09-06 노동절', '2027-11-25 추수감사절', '2027-12-24 성탄절(대체)'],
    half: ['2026-11-27 추수감사절 다음 날', '2026-12-24 성탄 전날', '2027-11-26 추수감사절 다음 날'],
    info: ['2026-03-08 미국 서머타임 시작', '2026-11-01 미국 서머타임 종료', '2027-03-14 미국 서머타임 시작', '2027-11-07 미국 서머타임 종료'],
  };
  const HOL = {};
  Object.entries(HOL_RAW).forEach(([t, arr]) => arr.forEach((x) => { const d = x.slice(0, 10); (HOL[d] = HOL[d] || []).push({ t, n: x.slice(11) }); }));
  const holText = (h) => h.t === 'us' ? `🇺🇸 미장 휴장 · ${h.n}` : h.t === 'half' ? `🇺🇸 미장 조기 폐장(현지 13시) · ${h.n}` : h.t === 'info' ? `🕐 ${h.n}` : h.t === 'krx' ? `🇰🇷 ${h.n}` : `🇰🇷 ${h.n}`;
  const holShort = (h) => h.t === 'us' ? `🇺🇸 휴장` : h.t === 'half' ? `🇺🇸 조기폐장` : h.t === 'info' ? `🕐 ${h.n.replace('미국 ', '')}` : h.t === 'krx' ? '🇰🇷 증시 휴장' : `🇰🇷 ${h.n.replace(/대체공휴일\(.+\)/, '대체공휴일')}`;
  const TYPES = ['반전형', '이득·손해형', '인용형', '인물 스토리형', '질문형', '숫자 강조형', '비교형', '미분류'];
  const YT_FROM = '2026-05-01';   // 이전 영상은 이 채널 운영 전 것이라 캘린더에 넣지 않는다

  const SHORT = { '미주옵_게시물': '미 게시물', '미주옵_릴스': '미 릴스', '회사_게시물': '회 게시물', '회사_릴스': '회 릴스', '유튜브_영상': 'YT 영상', '유튜브_쇼츠': 'YT 쇼츠', '유튜브_시황쇼츠': 'YT 시황' };
  const isMkt = (p) => p.account === '유튜브' && p.format === '쇼츠' && (p.topic || '').trim() === '시황';
  const acctOf = (p) => p.account || '미주옵';
  const fmtOf = (p) => p.format || ACCT_FMT[acctOf(p)][0];
  const labelOf = (p) => isMkt(p) ? '유튜브_시황쇼츠' : `${acctOf(p)}_${FMT_L[fmtOf(p)] || fmtOf(p)}`;
  const pColor = (p) => p.color || (isMkt(p) ? DEF_C['유튜브|시황'] : DEF_C[`${acctOf(p)}|${fmtOf(p)}`]) || 'gray';
  const pTime = (p) => p.time || SLOT_T[p.slot] || '';
  const eColor = (e) => e.color || KIND_C[e.format || '회의'] || 'gray';
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());

  let raw = [], loaded = false, inited = false;
  let cur = new Date(); cur.setDate(1);
  let sel = today();

  // ---------- 데이터 ----------
  const metaOf = () => { const m = {}; raw.filter((x) => x.kind === 'ytmeta').forEach((x) => { m[x.id] = x; }); return m; };
  const kst = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600e3); return [d.toISOString().slice(0, 10), d.toISOString().slice(11, 16)]; };
  const MKT_RE = /시황|Options Trend|\|\s*\d{2}\.\s?\d{2}\.\s?\d{2}/;
  function ytItems() {
    const meta = metaOf();
    return (typeof VIDEOS !== 'undefined' ? VIDEOS : []).filter((v) => v[22]).map((v) => {
      const [date, time] = kst(v[22]);
      const short = isShort(v), m = meta['yt:' + v[0]];
      return { id: 'yt:' + v[0], vid: v[0], auto: true, account: '유튜브', format: short ? '쇼츠' : '영상', date, time,
        title: v[3] || '', status: '올림', views: v[8], upload: v[1],
        topic: m ? m.topic : (short && MKT_RE.test(v[3] || '') ? '시황' : ''), memo: m ? m.memo : '', color: m ? m.color : '' };
    }).filter((x) => x.date >= YT_FROM);
  }
  let posts = [], events = [];
  function rebuild() {
    posts = [...raw.filter((x) => x.kind === 'post'), ...ytItems()];
    events = raw.filter((x) => x.kind === 'event');
  }
  async function loadCal() {
    try { const r = await fetch('/api/calendar').then((r) => r.json()); raw = r.ok ? (r.items || []) : []; }
    catch (_) { raw = []; }
    loaded = true; rebuild(); renderCal();
  }
  function msg(t) { const el = $('ccMsg'); if (!el) return; el.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => { el.textContent = ''; }, 3000); }
  // 저장: 이 브라우저가 한 번 비밀번호를 맞혔으면(30일 쿠키) 그냥 저장되고,
  // 아니면 수정 창 안에 비밀번호 칸이 한 번 뜬다. 대시보드 관리자 로그인 상태면 그 비밀번호를 그대로 쓴다.
  async function save(op, item) {
    const pwEl = $('ccPw'), pw = (pwEl && pwEl.value) || (typeof ADMIN !== 'undefined' && ADMIN ? ADMIN_PW : '');
    try {
      const r = await fetch('/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, item, pw }) }).then((r) => r.json());
      if (r.needPw) { askPw(r.error); return false; }
      if (!r.ok) { msg('저장하지 못했어요: ' + (r.error || '')); return false; }
      const i = raw.findIndex((x) => x.id === item.id);
      if (op === 'delete') { if (i >= 0) raw.splice(i, 1); } else if (i >= 0) raw[i] = { ...raw[i], ...item }; else raw.push(item);
      rebuild(); msg(op === 'delete' ? '지웠어요' : '저장했어요'); return true;
    } catch (e) { msg('저장하지 못했어요: ' + e.message); return false; }
  }

  // ---------- 달력 ----------
  function dayItems(day) {
    const ps = posts.filter((p) => p.date === day).sort((a, b) => (pTime(a) || '99').localeCompare(pTime(b) || '99'));
    const es = events.filter((e) => e.date === day).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
    return { ps, es };
  }
  const tspan = (t) => { const s = document.createElement('span'); s.className = 'bt'; s.textContent = t; return s; };
  function flashRows(ids) { ids.forEach((id) => { const r = document.querySelector(`#sec-cal .tli[data-id="${CSS.escape(id)}"]`); if (r) { r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); } }); }
  function grpBlk(g, day) {
    const b = document.createElement('button'); b.type = 'button'; const p0 = g[0];
    const allDone = g.every((p) => p.status === '올림'), allHold = g.every((p) => p.status === '보류');
    b.className = 'blk g' + (allHold ? ' hold' : ''); b.style.background = `var(--c-${pColor(p0)})`;
    // 달력 칸은 좁아서 짧은 이름을 쓴다 (넓은 화면: 유튜브_시황 / 휴대폰: 미 게시물·YT 쇼츠처럼)
    const L = labelOf(p0), lt = document.createElement('span'); lt.className = 'lt';
    lt.innerHTML = `<span class="ck">${allDone ? '✓ ' : ''}</span><span class="lf"></span><span class="ls"></span>`;
    lt.querySelector('.lf').textContent = L.replace('시황쇼츠', '시황'); lt.querySelector('.ls').textContent = SHORT[L] || L;
    b.appendChild(lt);
    if (g.length > 1) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = g.length; b.appendChild(c); }
    b.title = g.map((p) => `${pTime(p) || '시간 미정'} ${p.title || ''}`).join('\n');
    b.addEventListener('click', (ev) => { ev.stopPropagation(); const same = sel === day; sel = day; if (!same) renderCal(); if (g.length === 1) openPost(p0); else flashRows(g.map((p) => p.id)); });
    return b;
  }
  function evBlk(x) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'blk line';
    b.style.setProperty('--dot', `var(--c-${eColor(x)})`); b.append(tspan(x.time ? x.time + ' ' : ''), x.title);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openEvent(x); });
    return b;
  }
  function renderCal() {
    if (!$('ccCal') || $('ccSheet').open) return;
    $('ccTitle').textContent = `${cur.getFullYear()}년 ${cur.getMonth() + 1}월`;
    const cal = $('ccCal'); cal.textContent = '';
    DOW.forEach((d) => { const h = document.createElement('div'); h.className = 'dow'; h.textContent = d; cal.appendChild(h); });
    const start = new Date(cur); start.setDate(1 - cur.getDay());
    const td = today();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== cur.getMonth()) break;
      const key = ymd(d), { ps, es } = dayItems(key);
      const c = document.createElement('div'); c.tabIndex = 0; c.setAttribute('role', 'button');
      c.className = 'day' + (d.getMonth() !== cur.getMonth() ? ' out' : '') + (key === td ? ' today' : '') + (key === sel ? ' sel' : '') + (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '');
      c.setAttribute('aria-label', `${d.getMonth() + 1}월 ${d.getDate()}일, 콘텐츠 ${ps.length}개, 일정 ${es.length}개`);
      const hs = HOL[key] || [];
      if (hs.some((h) => h.t === 'kr')) c.classList.add('sun');   // 한국 공휴일은 날짜를 빨갛게
      const dn = document.createElement('span'); dn.className = 'dn'; dn.textContent = d.getDate(); c.appendChild(dn);
      hs.forEach((h) => { const t = document.createElement('span'); t.className = 'hol h-' + h.t; t.textContent = holShort(h); t.title = holText(h); c.appendChild(t); });
      const groups = new Map(); ps.forEach((p) => { const l = labelOf(p); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(p); });
      const items = [...[...groups.values()].map((g) => ['grp', g]), ...es.map((e) => ['ev', e])];
      items.slice(0, 4).forEach(([k, x]) => c.appendChild(k === 'grp' ? grpBlk(x, key) : evBlk(x)));
      if (items.length > 4) { const m = document.createElement('span'); m.className = 'more'; m.textContent = `+${items.length - 4}`; c.appendChild(m); }
      const pick = () => { if (sel === key) openEvent({ date: key }); else { sel = key; renderCal(); } };
      c.addEventListener('click', pick);
      c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      cal.appendChild(c);
    }
    renderMonthSum();
    renderDay();
  }
  function renderMonthSum() {
    const ym = ymd(cur).slice(0, 7);
    const mp = posts.filter((p) => (p.date || '').startsWith(ym) && p.status !== '보류');
    const cnt = {}; mp.forEach((p) => { const l = labelOf(p); cnt[l] = (cnt[l] || 0) + 1; });
    const order = ['미주옵_게시물', '미주옵_릴스', '회사_게시물', '회사_릴스', '유튜브_영상', '유튜브_쇼츠', '유튜브_시황쇼츠'];
    const parts = order.filter((l) => cnt[l]).map((l) => `${l.replace('_', ' ')} <b>${cnt[l]}</b>`);
    $('ccSum').innerHTML = !loaded ? '불러오는 중…' : parts.length ? `${cur.getMonth() + 1}월 합계 · ${parts.join(' · ')}` : `${cur.getMonth() + 1}월에는 아직 기록이 없어요.`;
  }
  function renderDay() {
    const d = new Date(sel + 'T00:00:00');
    $('ccDayTitle').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
    const { ps, es } = dayItems(sel);
    const rows = [...ps.map((p) => ({ t: pTime(p), k: 'post', x: p })), ...es.map((e) => ({ t: e.time || '', k: 'ev', x: e }))]
      .sort((a, b) => (a.t || '99').localeCompare(b.t || '99'));
    const box = $('ccTl'); box.textContent = '';
    (HOL[sel] || []).forEach((h) => { const t = document.createElement('div'); t.className = 'holrow h-' + h.t; t.textContent = holText(h); box.appendChild(t); });
    if (!rows.length) { const e0 = document.createElement('p'); e0.className = 'empty'; e0.textContent = '이 날 기록이 없어요. 아래 + 콘텐츠로 시간과 함께 넣어 주세요.'; box.appendChild(e0); return; }
    const part = (t) => !t ? '시간 미정' : t < '12:00' ? '오전' : t < '18:00' ? '오후' : '저녁';
    let last = null;
    rows.forEach((r) => {
      const pt = part(r.t);
      if (pt !== last) { const h = document.createElement('h3'); h.textContent = pt; box.appendChild(h); last = pt; }
      const row = document.createElement('button'); row.type = 'button';
      const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = r.t || '—';
      const bar = document.createElement('span'); bar.className = 'bar4';
      const body = document.createElement('span'); const lb = document.createElement('span'); lb.className = 'lb'; body.appendChild(lb);
      const sm = document.createElement('small'); body.appendChild(sm);
      if (r.k === 'post') {
        const p = r.x; row.className = 'tli' + (p.status === '보류' ? ' hold' : ''); row.dataset.id = p.id;
        bar.style.background = `var(--c-${pColor(p)})`;
        lb.textContent = labelOf(p); const st = document.createElement('s');
        st.textContent = p.auto ? `✓ 조회 ${Number(p.views || 0).toLocaleString('ko-KR')}` : (p.status === '올림' ? '✓ ' : '') + (p.status || ''); lb.appendChild(st);
        sm.textContent = p.title || '';
        row.addEventListener('click', () => openPost(p));
      } else {
        const e = r.x; row.className = 'tli ev'; bar.style.background = `var(--c-${eColor(e)})`;
        lb.textContent = e.format || '일정'; sm.textContent = e.title + (e.memo ? ' · ' + e.memo : '');
        row.addEventListener('click', () => openEvent(e));
      }
      row.append(tm, bar, body); box.appendChild(row);
    });
  }

  // ---------- 수정 창 ----------
  function field(label, el) { const r = document.createElement('label'); r.className = 'row'; const s = document.createElement('span'); s.textContent = label; r.append(s, el); return r; }
  function mk(tag, attrs) { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'value') e.value = v ?? ''; else e.setAttribute(k, v); }); return e; }
  function sel_(opts, value) { const s = document.createElement('select'); opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === (value ?? '')) o.selected = true; s.appendChild(o); }); return s; }
  function palette(value) {
    const w = document.createElement('div'); w.className = 'palette'; w.setAttribute('role', 'radiogroup'); w.setAttribute('aria-label', '색');
    COLORS.forEach((c) => { const l = document.createElement('label'); const i = mk('input', { type: 'radio', name: 'cccolor', value: c, 'aria-label': c }); if (c === value) i.checked = true; const sp = document.createElement('span'); sp.style.background = `var(--c-${c})`; l.append(i, sp); w.appendChild(l); });
    return w;
  }
  const pickedColor = (f) => (f.querySelector('input[name=cccolor]:checked') || {}).value || '';
  function openSheet(build) {
    const f = $('ccForm'); f.textContent = ''; build(f);
    const dlg = $('ccSheet'); if (!dlg.open) dlg.showModal();
    const t = f.querySelector('.sh-title:not([readonly])'); if (t) t.focus();
  }
  function closeSheet() { $('ccSheet').close(); }
  function askPw(why) {
    const f = $('ccForm'); let row = $('ccPwRow');
    if (!row) {
      row = document.createElement('div'); row.id = 'ccPwRow'; row.className = 'pwrow';
      const t = document.createElement('div'); t.className = 'kind'; t.id = 'ccPwWhy'; row.appendChild(t);
      const i = mk('input', { type: 'password', id: 'ccPw', placeholder: '대시보드 관리자 비밀번호', autocomplete: 'current-password', 'aria-label': '비밀번호' }); row.appendChild(i);
      f.insertBefore(row, f.querySelector('.acts'));
    }
    $('ccPwWhy').textContent = (why || '') + ' 한 번 맞히면 이 브라우저에선 30일 동안 바로 저장돼요.';
    $('ccPw').focus();
  }
  function acts(f, onSave, onDel) {
    const a = document.createElement('div'); a.className = 'acts';
    if (onDel) { const d = mk('button', { type: 'button', class: 'ccbtn del' }); d.textContent = '삭제'; d.addEventListener('click', () => { if (d.dataset.arm) onDel(); else { d.dataset.arm = 1; d.textContent = '한 번 더 누르면 삭제'; } }); a.appendChild(d); }
    const sp = document.createElement('span'); sp.className = 'sp'; a.appendChild(sp);
    const c = mk('button', { type: 'button', class: 'ccbtn' }); c.textContent = '닫기'; c.addEventListener('click', closeSheet);
    const s = mk('button', { type: 'submit', class: 'ccbtn pri' }); s.textContent = '저장';
    a.append(c, s); f.appendChild(a);
    f.onsubmit = async (ev) => { ev.preventDefault(); if (await onSave()) closeSheet(); };
  }
  // 유튜브 영상(자동) — 제목·시간은 유튜브 값 그대로, 시황 여부와 메모만 덧붙인다
  function openYt(p) {
    openSheet((f) => {
      const k = document.createElement('div'); k.className = 'kind'; k.textContent = `${labelOf(p)} · 유튜브에서 자동으로 가져온 영상`; f.appendChild(k);
      const title = document.createElement('div'); title.className = 'sh-title ro'; title.textContent = p.title; f.appendChild(title);
      const info = document.createElement('div'); info.className = 'yinfo';
      info.textContent = `${p.date} ${p.time} 업로드 · 조회 ${Number(p.views || 0).toLocaleString('ko-KR')}회`;
      const go = mk('button', { type: 'button', class: 'ccbtn' }); go.textContent = '게시 후 성과 보기 →';
      go.addEventListener('click', () => { closeSheet(); openVideo(p.vid, p.title, p.upload); goSub('explore', 'sec-vd'); });
      info.appendChild(go); f.appendChild(info);
      let mkt = isMkt(p);
      const chip = mk('button', { type: 'button', class: 'qt' + (mkt ? ' on' : '') });
      const syncChip = () => { chip.textContent = mkt ? '● 시황 쇼츠' : '○ 시황 쇼츠 아님'; chip.classList.toggle('on', mkt); };
      chip.addEventListener('click', () => { mkt = !mkt; syncChip(); }); syncChip();
      if (p.format === '쇼츠') f.appendChild(field('구분', chip));
      const tp = mk('input', { type: 'text', value: (p.topic || '') === '시황' ? '' : p.topic, placeholder: '예: 콜옵션, 제로데이옵션' }); f.appendChild(field('주제', tp));
      const pal = palette(p.color || ''); f.appendChild(field('색', pal));
      const note = document.createElement('div'); note.className = 'kind'; note.textContent = '색을 안 고르면 쇼츠는 노랑, 시황 쇼츠는 주황, 영상은 보라로 칠해요.'; f.appendChild(note);
      const memo = mk('textarea', { 'aria-label': '메모' }); memo.value = p.memo || ''; memo.placeholder = '메모 (예: 촬영 파일명, 시트 제목)'; f.appendChild(memo);
      acts(f, () => save('upsert', { id: p.id, kind: 'ytmeta', account: '유튜브', topic: mkt ? '시황' : tp.value.trim(), memo: memo.value.trim(), color: pickedColor(f) }), null);
    });
  }
  function openPost(p) {
    if (p.auto) return openYt(p);
    const isNew = !p.id;
    openSheet((f) => {
      const k = document.createElement('div'); k.className = 'kind'; k.textContent = isNew ? '새 콘텐츠' : labelOf(p); f.appendChild(k);
      const title = mk('input', { class: 'sh-title', value: p.title, placeholder: '콘텐츠 타이틀', 'aria-label': '타이틀', required: 'required' }); f.appendChild(title);
      const acct = sel_(ACCTS, acctOf(p)); f.appendChild(field('계정', acct));
      const fmt_ = document.createElement('select'); f.appendChild(field('형식', fmt_));
      const fillFmt = (keep) => { fmt_.textContent = ''; ACCT_FMT[acct.value].forEach((x) => { const o = document.createElement('option'); o.value = x; o.textContent = `${acct.value}_${FMT_L[x] || x}`; if (x === keep) o.selected = true; fmt_.appendChild(o); }); };
      fillFmt(fmtOf(p));
      const date = mk('input', { type: 'date', value: p.date || sel }); f.appendChild(field('업로드일', date));
      const time = mk('input', { type: 'time', value: pTime(p), 'aria-label': '업로드 시간' }); f.appendChild(field('업로드 시간', time));
      const quick = document.createElement('div'); quick.className = 'quick';
      SLOTS.forEach(([t, l]) => { const b = mk('button', { type: 'button', class: 'qt' }); b.textContent = `${t} ${l}`; b.addEventListener('click', () => { time.value = t; }); quick.appendChild(b); });
      f.appendChild(field('', quick));
      const st = sel_(STATUS.map((x) => [x, x]), p.status || '업로드 예정'); f.appendChild(field('상태', st));
      const ty = sel_(TYPES.map((x) => [x, x]), p.title_type || '미분류'); f.appendChild(field('제목 유형', ty));
      const tp = mk('input', { type: 'text', value: p.topic }); f.appendChild(field('주제', tp));
      const pal = palette(p.color || ''); f.appendChild(field('색', pal));
      const defC = () => { if (p.color) return; const c = DEF_C[`${acct.value}|${fmt_.value}`]; const r = pal.querySelector(`input[value=${c}]`); if (r) r.checked = true; };
      acct.addEventListener('change', () => { fillFmt(''); defC(); }); fmt_.addEventListener('change', defC); defC();
      const memo = mk('textarea', { 'aria-label': '메모' }); memo.value = p.memo || ''; memo.placeholder = '메모 (예: 고정댓글, 음악, 커버)'; f.appendChild(memo);
      acts(f, async () => {
        if (!title.value.trim()) return false;
        const c = pickedColor(f);
        const item = { id: p.id || 'c' + Date.now().toString(36), kind: 'post', title: title.value.trim(), account: acct.value, format: fmt_.value,
          date: date.value, time: time.value || '', status: st.value, title_type: ty.value, topic: tp.value.trim(),
          color: c && c !== DEF_C[`${acct.value}|${fmt_.value}`] ? c : '', memo: memo.value.trim() };
        const ok = await save('upsert', item); if (ok) sel = date.value || sel; return ok;
      }, isNew ? null : async () => { if (await save('delete', { id: p.id })) closeSheet(); });
    });
  }
  function openEvent(e) {
    const isNew = !e.id;
    openSheet((f) => {
      const k = document.createElement('div'); k.className = 'kind'; k.textContent = isNew ? '새 일정' : '일정'; f.appendChild(k);
      const title = mk('input', { class: 'sh-title', value: e.title, placeholder: '일정 이름', 'aria-label': '일정 이름', required: 'required' }); f.appendChild(title);
      const date = mk('input', { type: 'date', value: e.date || sel }); f.appendChild(field('날짜', date));
      const time = mk('input', { type: 'time', value: e.time }); f.appendChild(field('시간', time));
      const kind = sel_(KINDS.map((x) => [x, x]), e.format || '회의'); f.appendChild(field('종류', kind));
      const pal = palette(eColor(e)); f.appendChild(field('색', pal));
      kind.addEventListener('change', () => { const r = pal.querySelector(`input[value=${KIND_C[kind.value]}]`); if (r && !e.color) r.checked = true; });
      const memo = mk('textarea', { 'aria-label': '메모' }); memo.value = e.memo || ''; memo.placeholder = '메모 (선택)'; f.appendChild(memo);
      acts(f, async () => {
        if (!title.value.trim()) return false;
        const item = { id: e.id || 'e' + Date.now().toString(36), kind: 'event', title: title.value.trim(), date: date.value, time: time.value || '',
          format: kind.value, color: pickedColor(f), memo: memo.value.trim() };
        const ok = await save('upsert', item); if (ok) sel = date.value || sel; return ok;
      }, isNew ? null : async () => { if (await save('delete', { id: e.id })) closeSheet(); });
    });
  }

  // ---------- 시작 ----------
  function init() {
    if (inited) return; inited = true;
    $('ccPrev').addEventListener('click', () => { cur.setMonth(cur.getMonth() - 1); renderCal(); });
    $('ccNext').addEventListener('click', () => { cur.setMonth(cur.getMonth() + 1); renderCal(); });
    $('ccToday').addEventListener('click', () => { cur = new Date(); cur.setDate(1); sel = today(); renderCal(); });
    $('ccAddEv').addEventListener('click', () => openEvent({ date: sel }));
    $('ccAddPost').addEventListener('click', () => openPost({ date: sel }));
    $('ccSheet').addEventListener('close', () => renderCal());
    $('ccSheet').addEventListener('click', (ev) => { if (ev.target === $('ccSheet')) closeSheet(); });
    loadCal();
  }
  // 대시보드 탭에서 열 때마다 호출된다. VIDEOS가 늦게 들어와도 다시 그린다
  window.calDraw = function () { init(); if (loaded) { rebuild(); renderCal(); } };
})();
