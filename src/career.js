/* ---------- Карьера: настоящая статистика из сыгранных матчей ----------
   Профиль раньше рисовал «Стиль игры» и достижения из заглушек. Теперь
   всё считается из матчей: удары, идеальные, смеши, вращение, приём,
   подачи и точность контакта (ZoneStats). Пока матчей мало, радар
   смешивается с нейтральными значениями, чтобы не скакать от одного матча. */
const ICON_FILL = new Set(['star', 'bolt', 'fire']);   // у контурных иконок (мишень, часы) заливка превращает их в кляксу
const SPIN_STROKES = new Set(['LOOP', 'COUNTER', 'FLICK', 'PUSH', 'CHOP', 'HOOK', 'FADE', 'LOB']);
const ACH = [
  { id: 'first_win', t: 'Первая победа', i: 'trophy', d: 'Выиграй матч' },
  { id: 'streak3', t: 'Серия 3', i: 'fire', d: 'Выиграй 3 матча подряд' },
  { id: 'sniper', t: 'Снайпер', i: 'target', d: 'Контакт 80%+ за матч (от 10 попыток)' },
  { id: 'marathon', t: 'Марафонец', i: 'clock', d: 'Розыгрыш из 15+ ударов' },
  { id: 'jeweler', t: 'Ювелир', i: 'star', d: '5 идеальных ударов за матч' },
  { id: 'spinner', t: 'Мастер вращения', i: 'bolt', d: '10 ударов с вращением за матч' }
];
const Career = {
  zero: () => ({ m: 0, w: 0, streak: 0, best: 0, hits: 0, perf: 0, smash: 0, spin: 0, oppHits: 0, rallyHits: 0, servePts: 0, serveWon: 0, att: 0, con: 0, maxRally: 0 }),
  get c() { if (!S.car) S.car = this.zero(); return S.car; },
  get got() { if (!S.ach) S.ach = {}; return S.ach; },
  /** st — счётчики экрана матча, coach — разбор матча. Возвращает новые достижения. */
  record(st, win, coach) {
    const c = this.c;
    c.m++; if (win) { c.w++; c.streak++; c.best = Math.max(c.best, c.streak); } else c.streak = 0;
    c.hits += st.hits; c.perf += st.perfect; c.smash += st.smash; c.spin += st.spin || 0;
    c.oppHits += st.oppHits || 0; c.rallyHits += st.rallyHits || 0;
    c.servePts += st.servePts || 0; c.serveWon += st.serveWon || 0;
    if (coach) { c.att += coach.n; c.con += coach.hit; }
    c.maxRally = Math.max(c.maxRally, st.maxRally || 0);
    const cond = {
      first_win: c.w >= 1, streak3: c.best >= 3,
      sniper: !!coach && coach.n >= 10 && coach.pct >= 80,
      marathon: (st.maxRally || 0) >= 15, jeweler: st.perfect >= 5, spinner: (st.spin || 0) >= 10
    };
    const fresh = ACH.filter((a) => cond[a.id] && !this.got[a.id]);
    fresh.forEach((a) => { this.got[a.id] = Date.now(); });
    save();
    return fresh;
  },
  radar() {
    const c = this.c, k = 2, n = c.m, mix = (prior, v) => clamp((prior * k + (v === null ? prior : v) * n) / (k + n), 0.15, 0.98);
    const r = (a, b, s = 1) => (b > 0 ? Math.min(1, a / b * s) : null);
    return [
      ['Подача', mix(0.55, r(c.serveWon, c.servePts))],
      ['Атака', mix(0.6, r(c.perf + c.smash, c.hits, 1.6))],
      ['Защита', mix(0.55, r(c.rallyHits, c.oppHits))],
      ['Вращение', mix(0.5, r(c.spin, c.hits, 2))],
      ['Реакция', mix(0.6, r(c.con, c.att))]
    ];
  }
};

/* Достижение открыто: золотая плашка с ударом, по очереди для каждого */
async function achievementPops(list, alive = () => true) {
  for (const a of list) {
    if (!alive()) return;
    const el = document.createElement('div'); el.className = 'ach-pop';
    el.innerHTML = `<div class="ap-card"><span class="ap-ic">${Art.icon(a.i, { c: '#3A1A00', sw: 2.4, fill: ICON_FILL.has(a.i) ? '#3A1A00' : 'transparent' })}</span><div><span class="cap">Достижение открыто</span><b>${a.t}</b><small>${a.d}</small></div></div>`;
    document.body.appendChild(el);
    await sleep(60); el.classList.add('on');
    const p = FX.pt(el.querySelector('.ap-ic'));
    setTimeout(() => { FX.burst(p.x, p.y, { c: ['#FFC93A', '#FFF6C8', '#FF8A00'], count: 30, speed: 10, size: 1 }); FX.twinkles && FX.twinkles(p.x, p.y, 40, 6); Sfx.impact(); haptic('heavy'); }, 260);
    await Promise.race([sleep(2300), new Promise((res) => el.addEventListener('click', res, { once: true }))]);
    el.classList.remove('on'); el.classList.add('off'); setTimeout(() => el.remove(), 450);
    await sleep(250);
  }
}
