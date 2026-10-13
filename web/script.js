(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $ = (sel) => document.querySelector(sel);
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- data
  const MOODS = [
    { key: 'all', label: '🎲 아무거나' },
    { key: '국물', label: '🥣 국물' },
    { key: '매운', label: '🌶️ 매운' },
    { key: '가벼운', label: '🥗 가볍게' },
    { key: '든든', label: '💪 든든하게' },
  ];
  const TAG_EMOJI = { '국물': '🍲', '매운': '🌶️', '가벼운': '🥗', '든든': '🍚', '': '🍽️' };
  const DEFAULT_MENUS = [
    { name: '김치찌개', emoji: '🍲', tags: ['국물', '매운', '든든'] },
    { name: '돈까스', emoji: '🍱', tags: ['든든'] },
    { name: '쌀국수', emoji: '🍜', tags: ['국물', '가벼운'] },
    { name: '샐러드', emoji: '🥗', tags: ['가벼운'] },
    { name: '햄버거', emoji: '🍔', tags: ['든든'] },
    { name: '마라탕', emoji: '🌶️', tags: ['국물', '매운'] },
    { name: '초밥', emoji: '🍣', tags: ['가벼운'] },
    { name: '제육볶음', emoji: '🥘', tags: ['매운', '든든'] },
  ];
  const COLORS = ['#FFB5A7', '#FFE29A', '#B8E0D2', '#CDB4DB', '#FFC8DD', '#A2D2FF', '#FFD6A5', '#CAFFBF'];
  const COMMENTS = [
    '운명이 골라준 메뉴, 거부권은 없습니다 😎',
    '고민 시간 0초! 오늘 점심은 이걸로 끝 ⏱️',
    '탁월한 선택이에요. 룰렛이 했지만요 🤭',
    '이거 먹으면 오후 업무 효율 200% 💪',
    '배고픈 팀원들이 박수 치는 중 👏',
    '오늘의 점심 운세: 대길(大吉) 🍀',
  ];
  const REROLL_COMMENTS = [
    '',
    '한 번 더? 이번엔 진짜 운명이에요 🙏',
    '두 번째 다시… 룰렛이 살짝 서운해해요 🥲',
    '세 번째! 사실 먹고 싶은 메뉴 정해져 있죠? 🤨',
    '운명을 거스르는 자… 다음은 없습니다 (사실 있어요) 😤',
  ];

  // ---------------------------------------------------------------- storage
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };
  const todayKST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const cleanText = (s) => (s || '').trim().replace(/\s+/g, ' ').slice(0, 20);

  // ---------------------------------------------------------------- state
  let team = cleanText(new URLSearchParams(location.search).get('team')) || '전체';
  let menus = store.get('menus:v1', null) || DEFAULT_MENUS.map((m) => ({ ...m }));
  let mood = 'all';
  let weather = { boostTag: null, text: '' };
  let slices = [];
  let rotation = 0;
  let spinning = false;
  let current = null;
  let spinsSinceVote = 0;
  let soundOn = store.get('sound', true);
  let expired = false;

  const sb = CFG.supabaseUrl && CFG.supabaseKey && window.supabase
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;

  // ---------------------------------------------------------------- ui helpers
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  const emojiFor = (name) => (menus.find((m) => m.name === name) || DEFAULT_MENUS.find((m) => m.name === name) || {}).emoji || '🍽️';

  // ---------------------------------------------------------------- sound
  let audioCtx = null;
  function ensureAudio() {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
  }
  function beep(freq, dur, type = 'triangle', vol = 0.06) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
  const tick = () => beep(880, 0.04);
  const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'sine', 0.09), i * 110));
  function renderSound() { $('#sound').textContent = soundOn ? '🔊' : '🔇'; }

  // ---------------------------------------------------------------- wheel
  const canvas = $('#wheel');
  const ctx = canvas.getContext('2d');

  function activeMenus() {
    if (mood === 'all') return menus;
    const filtered = menus.filter((m) => m.tags.includes(mood));
    return filtered.length >= 2 ? filtered : menus;
  }

  function colorFor(i, n) {
    // 마지막 칸이 첫 칸과 같은 색이 되지 않도록
    if (n > 1 && i === n - 1 && i % COLORS.length === 0) return COLORS[2];
    return COLORS[i % COLORS.length];
  }

  function buildSlices() {
    const list = activeMenus();
    const weights = list.map((m) => (weather.boostTag && m.tags.includes(weather.boostTag) ? 2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    slices = list.map((menu, i) => {
      const size = (weights[i] / total) * TAU;
      const s = { menu, size, start: acc, boosted: weights[i] > 1, color: colorFor(i, list.length) };
      acc += size;
      return s;
    });

    let hint = `${list.length}개 메뉴 중 하나!`;
    if (mood !== 'all' && list === menus) hint = `'${mood}' 메뉴가 2개 미만이라 전체 메뉴로 돌려요`;
    if (weather.boostTag && slices.some((s) => s.boosted)) hint += ` · ⭐ 표시는 날씨 보너스 확률 2배`;
    $('#hint').textContent = hint;
    draw();
  }

  function resizeCanvas() {
    const css = canvas.clientWidth || 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(css * dpr);
    draw();
  }

  function draw() {
    const W = canvas.width;
    const r = W / 2;
    const font = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(rotation);

    for (const s of slices) {
      const a0 = s.start - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r - 2, a0, a0 + s.size);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = W * 0.008;
      ctx.stroke();

      ctx.save();
      const mid = a0 + s.size / 2;
      // 화면 왼쪽 절반에 온 글자는 뒤집어서 항상 바로 읽히게
      const flip = Math.cos(mid + rotation) < 0;
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3d2c29';
      const label = `${s.boosted ? '⭐' : ''}${s.menu.name} ${s.menu.emoji}`;
      let fs = Math.min(W * 0.055, s.size * r * 0.42);
      ctx.font = `700 ${fs}px ${font}`;
      while (ctx.measureText(label).width > r * 0.66 && fs > W * 0.025) {
        fs -= 1;
        ctx.font = `700 ${fs}px ${font}`;
      }
      ctx.fillText(label, flip ? -(r - W * 0.05) : r - W * 0.05, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function pointerIndex(rot) {
    const p = (((-rot) % TAU) + TAU) % TAU;
    const i = slices.findIndex((s) => p >= s.start && p < s.start + s.size);
    return i === -1 ? slices.length - 1 : i;
  }

  function pickWeighted() {
    let x = Math.random() * TAU;
    for (const s of slices) {
      x -= s.size;
      if (x <= 0) return s;
    }
    return slices[slices.length - 1];
  }

  function spin() {
    if (spinning || expired) return;
    if (slices.length < 2) { toast('메뉴를 2개 이상 넣어주세요'); return; }
    ensureAudio();
    spinning = true;
    spinsSinceVote += current ? 1 : 0;
    $('#spin').disabled = true;
    $('#respin').disabled = true;
    $('#result').hidden = true;

    const target = pickWeighted();
    const point = target.start + target.size * (0.15 + 0.7 * Math.random());
    const desired = (((TAU - point) % TAU) + TAU) % TAU;
    const now = ((rotation % TAU) + TAU) % TAU;
    const from = rotation;
    const to = rotation + TAU * (5 + Math.floor(Math.random() * 2)) + (((desired - now) % TAU) + TAU) % TAU;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 600 : 4200;
    const t0 = performance.now();
    let lastIdx = pointerIndex(from);

    const frame = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      rotation = from + (to - from) * (1 - Math.pow(1 - p, 4));
      draw();
      const idx = pointerIndex(rotation);
      if (idx !== lastIdx) { lastIdx = idx; tick(); }
      if (p < 1) { requestAnimationFrame(frame); return; }
      rotation = to % TAU;
      spinning = false;
      $('#spin').disabled = expired;
      $('#respin').disabled = expired;
      showResult(target.menu);
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- result & vote
  function showResult(menu) {
    current = menu;
    $('#result-emoji').textContent = menu.emoji;
    $('#result-name').textContent = menu.name;
    const reroll = REROLL_COMMENTS[Math.min(spinsSinceVote, REROLL_COMMENTS.length - 1)];
    $('#result-comment').textContent = reroll || COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    $('#result').hidden = false;
    renderVoteButton();
    fanfare();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    if (window.confetti) {
      window.confetti({ particleCount: 140, spread: 90, origin: { y: 0.55 }, colors: COLORS });
    }
    addHistory(menu);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const voteKey = () => `voted:${team}:${todayKST()}`;

  function renderVoteButton() {
    const voted = store.get(voteKey(), null);
    const btn = $('#vote');
    btn.disabled = !!voted || expired;
    btn.textContent = voted ? '투표 완료 ✅' : '이걸로 결정! 🗳️';
    btn.title = voted ? `오늘은 '${voted}'에 투표했어요` : '';
  }

  async function vote() {
    if (!current || expired || store.get(voteKey(), null)) return;
    const btn = $('#vote');
    btn.disabled = true; // 연타 방지
    const menu = current.name;
    try {
      if (sb) {
        const { error } = await sb.from('votes').insert({ menu, team });
        if (error) throw error;
      } else {
        const local = store.get('localVotes', []);
        local.push({ menu, team, day: todayKST() });
        store.set('localVotes', local);
      }
      store.set(voteKey(), menu);
      spinsSinceVote = 0;
      toast(`'${menu}' 에 한 표! 🗳️`);
      if (window.confetti) window.confetti({ particleCount: 60, spread: 120, startVelocity: 25, origin: { y: 0.7 } });
      await refreshRanking();
    } catch (e) {
      const closed = /row-level security|policy/i.test(String(e && e.message));
      toast(closed ? '투표 시간이 끝나 투표가 닫혔어요 🔒' : '투표 저장에 실패했어요. 잠시 후 다시 시도해 주세요');
      console.error(e);
    }
    renderVoteButton();
  }

  // ---------------------------------------------------------------- ranking
  async function refreshRanking() {
    let rows = [];
    try {
      if (sb) {
        const { data, error } = await sb.rpc('top_menus', { p_team: team });
        if (error) throw error;
        rows = data || [];
      } else {
        const counts = {};
        for (const v of store.get('localVotes', [])) {
          if (v.team === team && v.day === todayKST()) counts[v.menu] = (counts[v.menu] || 0) + 1;
        }
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([menu, votes]) => ({ menu, votes, total }));
      }
    } catch (e) {
      console.error(e);
      $('#rank-note').textContent = '순위를 불러오지 못했어요. 잠시 후 자동으로 다시 시도해요.';
      return;
    }

    const list = $('#ranking');
    list.replaceChildren();
    const mine = store.get(voteKey(), null);
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '아직 투표가 없어요. 첫 표의 주인공이 되어 보세요! 🙌';
      list.append(li);
    }
    const max = Math.max(1, ...rows.map((r) => Number(r.votes)));
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'rank-row' + (row.menu === mine ? ' mine' : '');
      const medal = document.createElement('span');
      medal.className = 'rank-medal';
      medal.textContent = medals[i];
      const body = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'rank-name';
      name.textContent = `${emojiFor(row.menu)} ${row.menu}`;
      const bar = document.createElement('div');
      bar.className = 'rank-bar';
      const fill = document.createElement('span');
      fill.style.width = `${(Number(row.votes) / max) * 100}%`;
      bar.append(fill);
      body.append(name, bar);
      const count = document.createElement('span');
      count.className = 'rank-count';
      count.textContent = `${row.votes}표`;
      li.append(medal, body, count);
      list.append(li);
    });
    const total = rows.length ? Number(rows[0].total) : 0;
    $('#total').textContent = total ? `오늘 총 ${total}표` : '';
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#rank-note').textContent = `${team === '전체' ? '전체' : `'${team}' 팀`} 기준 · ${time} 업데이트 · 30초마다 자동 갱신`;
  }

  // ---------------------------------------------------------------- weather (Open-Meteo, 무료·키 불필요)
  function describeWeather(temp, code) {
    const t = Math.round(temp);
    const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
    const snowy = (code >= 71 && code <= 77) || code === 85 || code === 86;
    const storm = code >= 95;
    if (storm) return { boostTag: '국물', text: `⛈️ ${t}°C · 천둥 치는 날엔 국물 메뉴 확률 2배!` };
    if (rainy) return { boostTag: '국물', text: `🌧️ ${t}°C · 비 오는 날엔 국물 메뉴 확률 2배!` };
    if (snowy) return { boostTag: '국물', text: `❄️ ${t}°C · 눈 오는 날엔 국물 메뉴 확률 2배!` };
    if (t <= 5) return { boostTag: '국물', text: `🥶 ${t}°C · 추운 날엔 국물 메뉴 확률 2배!` };
    if (t >= 28) return { boostTag: '가벼운', text: `🥵 ${t}°C · 더운 날엔 가벼운 메뉴 확률 2배!` };
    const icon = code === 0 ? '☀️' : code <= 3 ? '⛅' : '🌫️';
    return { boostTag: null, text: `${icon} ${t}°C · 점심 먹기 딱 좋은 날씨!` };
  }

  async function loadWeather(lat = 37.5665, lon = 126.978, label = '서울') {
    const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
    let cur = null;
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (cached && Date.now() - cached.at < 30 * 60 * 1000) cur = cached.cur;
    } catch { /* ignore */ }
    try {
      if (!cur) {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FSeoul`);
        if (!res.ok) throw new Error(res.status);
        cur = (await res.json()).current;
        try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), cur })); } catch { /* ignore */ }
      }
      weather = describeWeather(cur.temperature_2m, cur.weather_code);
      $('#weather').textContent = `${label} ${weather.text}`;
    } catch {
      weather = { boostTag: null, text: '' };
      $('#weather').textContent = '🌤️ 날씨 정보를 불러오지 못했어요';
    }
    buildSlices();
  }

  function locate() {
    if (!navigator.geolocation) { toast('이 브라우저는 위치를 지원하지 않아요'); return; }
    $('#weather').textContent = '📍 위치 확인 중…';
    navigator.geolocation.getCurrentPosition(
      (pos) => loadWeather(pos.coords.latitude, pos.coords.longitude, '내 위치'),
      () => { toast('위치 권한이 없어 서울 날씨로 보여드려요'); loadWeather(); },
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  }

  // ---------------------------------------------------------------- moods
  function renderMoods() {
    const wrap = $('#moods');
    wrap.replaceChildren(...MOODS.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mood' + (m.key === mood ? ' on' : '');
      b.textContent = m.label;
      b.setAttribute('aria-pressed', String(m.key === mood));
      b.addEventListener('click', () => {
        if (spinning) return;
        mood = m.key;
        renderMoods();
        buildSlices();
      });
      return b;
    }));
  }

  // ---------------------------------------------------------------- menu editor
  function saveMenus() { store.set('menus:v1', menus); renderMenus(); buildSlices(); }

  function renderMenus() {
    $('#menu-count').textContent = `(${menus.length}개)`;
    $('#menu-list').replaceChildren(...menus.map((m, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${m.emoji} ${m.name}`;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = m.tags.length ? `#${m.tags.join(' #')}` : '';
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', `${m.name} 삭제`);
      del.addEventListener('click', () => {
        if (spinning) return;
        if (menus.length <= 2) { toast('메뉴는 최소 2개가 필요해요'); return; }
        menus.splice(i, 1);
        saveMenus();
      });
      li.append(label, tag, del);
      return li;
    }));
  }

  function addMenu(e) {
    e.preventDefault();
    if (spinning) return;
    const name = cleanText($('#add-name').value);
    const tagValue = $('#add-tag').value;
    if (!name) return;
    if (menus.some((m) => m.name === name)) { toast('이미 있는 메뉴예요'); return; }
    if (menus.length >= 16) { toast('메뉴는 최대 16개까지 넣을 수 있어요'); return; }
    menus.push({ name, emoji: TAG_EMOJI[tagValue], tags: tagValue ? [tagValue] : [] });
    $('#add-name').value = '';
    saveMenus();
    toast(`'${name}' 추가 완료!`);
  }

  // ---------------------------------------------------------------- history
  function addHistory(menu) {
    const h = store.get('history', []);
    h.unshift({ name: menu.name, emoji: menu.emoji, at: Date.now() });
    store.set('history', h.slice(0, 8));
    renderHistory();
  }

  function renderHistory() {
    const h = store.get('history', []);
    const list = $('#history');
    if (!h.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '아직 기록이 없어요. 룰렛을 돌려보세요!';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...h.map((x) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${x.emoji} ${x.name}`;
      const time = document.createElement('time');
      time.textContent = new Date(x.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      li.append(name, time);
      return li;
    }));
  }

  // ---------------------------------------------------------------- team & share
  function shareUrl() {
    const url = new URL(location.pathname, location.origin);
    if (team !== '전체') url.searchParams.set('team', team);
    return url.toString();
  }

  function renderTeam() {
    $('#team-name').textContent = team;
    const qrEl = $('#qr');
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(shareUrl());
      qr.make();
      qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } else {
      qrEl.textContent = 'QR을 불러오지 못했어요';
    }
  }

  function changeTeam() {
    const input = window.prompt('팀 이름을 입력하세요 (예: 마케팅). 비우면 전체 집계로 돌아가요.', team === '전체' ? '' : team);
    if (input === null) return;
    team = cleanText(input) || '전체';
    history.replaceState(null, '', shareUrl());
    renderTeam();
    renderVoteButton();
    refreshRanking();
    toast(`'${team}' 투표방으로 이동했어요`);
  }

  async function copyLink() {
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('링크를 복사했어요! 단톡방에 붙여넣기 📋');
  }

  // ---------------------------------------------------------------- auto close
  function startExpiryClock() {
    if (!CFG.expiresAt) return;
    const end = new Date(CFG.expiresAt).getTime();
    if (Number.isNaN(end)) return;
    const banner = $('#expiry-banner');
    const endText = new Date(end).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    banner.hidden = false;
    const update = () => {
      const left = end - Date.now();
      if (left <= 0) {
        expired = true;
        $('#closed').hidden = false;
        $('#spin').disabled = true;
        $('#respin').disabled = true;
        $('#vote').disabled = true;
        banner.textContent = '🔒 서비스가 종료되었어요';
        clearInterval(timer);
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      banner.classList.toggle('warn', left < 5 * 60 * 1000);
      banner.textContent = `⏳ 실습용 서비스 · ${endText}에 자동 종료 (남은 시간 ${m}:${String(s).padStart(2, '0')})`;
    };
    const timer = setInterval(update, 1000);
    update();
  }

  // ---------------------------------------------------------------- init
  function init() {
    renderSound();
    renderMoods();
    renderMenus();
    renderHistory();
    renderTeam();
    startExpiryClock();
    resizeCanvas();
    buildSlices();
    loadWeather();
    refreshRanking();

    $('#mode-note').textContent = sb ? '☁️ 투표는 클라우드(Supabase)에 저장돼요' : '💾 로컬 모드: 투표가 이 브라우저에만 저장돼요';
    $('#spin').addEventListener('click', spin);
    $('#respin').addEventListener('click', spin);
    $('#vote').addEventListener('click', vote);
    $('#add-form').addEventListener('submit', addMenu);
    $('#reset-menus').addEventListener('click', () => {
      if (spinning) return;
      menus = DEFAULT_MENUS.map((m) => ({ ...m }));
      saveMenus();
      toast('기본 메뉴로 되돌렸어요');
    });
    $('#team-change').addEventListener('click', changeTeam);
    $('#locate').addEventListener('click', locate);
    $('#copy').addEventListener('click', copyLink);
    $('#sound').addEventListener('click', () => {
      soundOn = !soundOn;
      store.set('sound', soundOn);
      renderSound();
      if (soundOn) { ensureAudio(); beep(660, 0.1); }
    });
    if (navigator.share) {
      const btn = $('#native-share');
      btn.hidden = false;
      btn.addEventListener('click', () => navigator.share({ title: '오늘 뭐 먹지?', text: '점심 메뉴 같이 투표해요!', url: shareUrl() }).catch(() => {}));
    }
    window.addEventListener('resize', resizeCanvas);

    // 비용 최소화: 화면이 보일 때만 30초 간격으로 갱신
    setInterval(() => {
      if (document.visibilityState === 'visible' && !expired) refreshRanking();
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !expired) refreshRanking();
    });
  }

  init();
})();
