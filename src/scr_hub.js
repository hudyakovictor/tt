/* =====================================================================
   HUB — «Арена»: живой стол с розыгрышем ИИ vs ИИ, дорога лиги,
   огромная кнопка «В бой», слоты сундуков, боковые ярлыки.
   ===================================================================== */
const MODES = [
  { id: 'ranked', t: 'Рейтинговый', s: 'Очки лиги · соперник твоего уровня', i: 'crown', c: 'gold', diff: .62, tag: '±24' },
  { id: 'quick', t: 'Быстрый матч', s: 'Без риска для рейтинга · до 7', i: 'bolt', c: 'coral', diff: .5, tag: '~20 с' },
  { id: 'practice', t: 'Тренировка', s: 'Обучение с наставником · 6 шагов', i: 'target', c: 'violet', diff: .35, tag: '2 мин' }
];
let MODE = MODES[0];

/* Задания дня. Клейм сохраняем в состояние — иначе лист можно было
   переоткрывать и бесконечно фармить ту же награду. */
const QUESTS = [
  { id: 'q_win3', t: 'Выиграй 3 матча', p: 2, m: 3, r: 120, k: 'coins', done: false },
  { id: 'q_perf10', t: '10 идеальных ударов', p: 10, m: 10, r: 8, k: 'gems', done: true },
  { id: 'q_rally15', t: 'Розыгрыш из 15 ударов', p: 9, m: 15, r: 80, k: 'coins', done: false }
];
const questReady = () => { const d = S.questDone || {}; return QUESTS.filter((q) => q.done && !d[q.id]).length; };
const FREE_MS = 4 * 3600 * 1000;           // подарок раз в 4 часа
const UNLOCK_MS = { wood: 30 * 60 * 1000, silver: 3 * 3600 * 1000, gold: 8 * 3600 * 1000, epic: 12 * 3600 * 1000 };

Router.def('hub', {
  mood: 'arena',
  render() {
    const L = leagueOf(S.rating), N = nextLeague(S.rating);
    const p = N ? (S.rating - L.min) / (N.min - L.min) : 1;
    const qr = questReady();
    const freeLeft = (S.freeAt || 0) - Date.now();
    return `${UI.hud()}
    <div class="road rise" style="--d:0" data-act="ranks">
      <span class="rb">${Art.badge(L, 34)}</span>
      <div class="bar gold"><i style="--p:0" data-p="${p}"></i><span class="lbl num">${fmt(S.rating)} / ${N ? fmt(N.min) : '∞'}</span></div>
      <span class="rb next">${N ? Art.badge(N, 34) : ''}</span>
    </div>
    <div class="hero">
      <div class="arena-title rise" style="--d:1"><span class="cap">Твой зал · ${L.n}</span><b class="h-display">Арена «Топспин»</b></div>
      <canvas class="demo"></canvas>
      <div class="side l">
        <button class="fab pop" style="--d:2" data-act="quests" data-press>${Art.icon('quest', { c: '#9CFFD0' })}${qr ? `<span class="dot">${qr}</span>` : ''}<em>Задания</em></button>
        <button class="fab pop" style="--d:3" data-act="events" data-press>${Art.icon('cal', { c: '#FFD88A' })}<em>События</em></button>
      </div>
      <div class="side r">
        <button class="fab pop ${freeLeft <= 0 ? 'free' : ''}" style="--d:2" data-act="free" data-press><span class="fchest">${Art.chest('wood', 40)}</span><em class="num" id="freeT" data-gift="1">${freeLeft > 0 ? fmtLeft(freeLeft) : 'Подарок'}</em></button>
        <button class="fab pop" style="--d:3" data-act="friends" data-press>${Art.icon('users', { c: '#9BE8FF' })}<em>Друзья</em></button>
      </div>
    </div>
    <div class="playzone">
      <button class="mode-chip rise" style="--d:2" data-act="mode" data-press><span class="mi">${Art.icon(MODE.i, { c: '#FFE28A' })}</span><span><small>Режим</small><b>${MODE.t}</b></span><span class="chev">▾</span></button>
      <button class="b3 xl play rise" style="--d:3" data-act="play"><span class="shine"></span>${Art.icon('swords', { c: '#3A1A00', sw: 2.6 })}В бой</button>
    </div>
    <div class="slots">${S.chests.map((c, i) => this.slot(c, i)).join('')}</div>`;
  },
  slot(c, i) {
    if (!c) return `<div class="slot empty rise" style="--d:${4 + i}"><span>Пустой<br>слот</span></div>`;
    const C = Art.CHEST[c.kind];
    if (c.state === 'ready') return `<button class="slot ready rar ${C.rar} beam rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 58)}</span><b class="open">Открыть</b></button>`;
    if (c.state === 'unlocking') return `<button class="slot unl rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 50)}</span><b class="num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</b><span class="skip">${Art.gem(14)}18</span></button>`;
    return `<button class="slot lock rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 50)}</span><b>${C.n}</b><span class="skip">${Art.icon('clock', { c: '#9BE8FF', sw: 2.6 })}${fmtLeft(UNLOCK_MS[c.kind] || UNLOCK_MS.silver)}</span></button>`;
  },
  mount(el) {
    UI.bindHud(el);
    // живой стол: настоящий движок за интерфейсом (бот против бота, облёт камеры);
    // на «Эконом» — лёгкая 2D-заглушка
    this.lobby = S.quality !== 'low';
    if (this.lobby) {
      el.classList.add('lobby');
      GameHost.ensure(); GameHost.send('quiet', { on: true }); GameHost.send('lobby'); GameHost.show(true, 'lobby');
    }
    const cv = el.querySelector('canvas.demo');
    if (this.lobby) cv.style.display = 'none';
    else this.game = new TT.Game(cv, { mode: 'demo', cam: { y: -1.55, z: 1.15, pitch: 25, f: .92, cy: .5, swayAmp: 9 }, spd: .38, diff: .9 });
    const g = this.game;
    if (g) {
      g.on = (ev, d) => {
        if (ev === 'point') setTimeout(() => !g.dead && g.serve(Math.random() < .5 ? 'p' : 'o'), 700);
      };
      setTimeout(() => g.serve('o'), 600);
    }
    // дорога лиги
    setTimeout(() => { const i = el.querySelector('.road .bar i'); i && i.style.setProperty('--p', i.dataset.p); }, 400);
    // таймеры: слоты сундуков + кулдаун подарка — оба живые, без застывших подписей
    this.timer = setInterval(() => {
      $$('[data-ends]', el).forEach((b) => (b.textContent = fmtLeft(+b.dataset.ends - Date.now())));
      const gft = el.querySelector('#freeT');
      if (gft) {
        const left = (S.freeAt || 0) - Date.now();
        gft.textContent = left > 0 ? fmtLeft(left) : 'Подарок';
        const fab = gft.closest('.fab'); fab && fab.classList.toggle('free', left <= 0);
      }
    }, 1000);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act],[data-chest]'); if (!a) return;
      if (a.dataset.chest !== undefined) return this.chestTap(+a.dataset.chest, a);
      const k = a.dataset.act;
      if (k === 'play') {
        const p = FX.pt(a); FX.burst(p.x, p.y, { count: 30, speed: 11 }); haptic('heavy');
        TGX.fullscreen(true);          // иммерсивный режим запрашиваем из жеста — так требует клиент
        if (MODE.id === 'practice') Router.go('train', { data: { then: 'hub' } });
        else if (!S.tutorialDone) Router.go('train', { data: { then: 'mm' } });
        else Router.go('mm');
      }
      if (k === 'mode') this.modeSheet();
      if (k === 'ranks') Router.go('ranks');
      if (k === 'quests') this.questSheet();
      if (k === 'events') this.eventsSheet();
      if (k === 'friends') this.friendsSheet();
      if (k === 'free') {
        if (Date.now() < (S.freeAt || 0)) return;      // подарок ещё в кулдауне
        S.freeAt = Date.now() + FREE_MS; save();
        const p = FX.pt(a); Wallet.add('coins', 40, p); FX.twinkles(p.x, p.y, 30, 8); haptic('success');
        a.classList.remove('free');
        const gft = a.querySelector('#freeT'); if (gft) gft.textContent = fmtLeft(FREE_MS);
        toast('Ежедневный подарок: +40 монет', 'gift');
      }
    });
    // пасхалка: тап по столу = искры
    cv.addEventListener('pointerdown', (e) => { const p = FX.pt({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, width: 0, height: 0 }) }); FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff'], count: 12, speed: 6, size: .7 }); Sfx.paddle(1.2); });
  },
  leave() { this.game && this.game.destroy(); this.game = null; clearInterval(this.timer); if (this.lobby) { GameHost.show(false); GameHost.send('attract'); } },
  chestTap(i, btn) {
    const c = S.chests[i]; if (!c) return;
    if (c.state === 'ready') { Router.go('chest', { data: { kind: c.kind, slot: i } }); return; }
    if (c.state === 'unlocking') {
      Sheet.open(`<div class="chest-sheet"><div class="cs-art">${Art.chest(c.kind, 150)}</div><div class="h1">${Art.CHEST[c.kind].n} сундук</div>
        <p class="mut">Откроется через <b class="num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</b></p>
        <div class="cs-loot"><span>${Art.coin(28)}<b>240–320</b></span><span>${Art.gem(26)}<b>4–8</b></span><span>${Art.icon('paddle', { c: '#D9C6FF' })}<b>Редкая карта</b></span></div>
        <button class="b3 cyan block" data-act="skip"><span class="shine"></span>Открыть сейчас · ${Art.gem(22)} 18</button></div>`, {
        onOpen: (w) => w.querySelector('[data-act=skip]').addEventListener('click', (e) => { if (!Wallet.spend('gems', 18, FX.pt(e.currentTarget))) return; c.state = 'ready'; save(); Sheet.close(); setTimeout(() => Router.go('chest', { data: { kind: c.kind, slot: i } }), 350); })
      });
      return;
    }
    // 'locked': тап ЗАПУСКАЕТ открытие, если очередь свободна. Занята — честно объясняем.
    if (S.chests.some((x) => x && x.state === 'unlocking')) {
      toast('Сначала дождись открытия другого сундука', 'clock');
      btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      Sfx.error(); return;
    }
    const ms = UNLOCK_MS[c.kind] || UNLOCK_MS.silver;
    c.state = 'unlocking'; c.endsAt = Date.now() + ms; save();
    btn.outerHTML = this.slot(c, i);   // подменяем слот прямо на месте — он начинает считать
    toast(`${Art.CHEST[c.kind].n} сундук откроется через ${fmtLeft(ms)}`, 'clock');
    haptic('medium');
  },
  modeSheet() {
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Выбери режим</div><div class="modes">${MODES.map((m, i) => `
      <button class="mcard ${m.c} ${m.id === MODE.id ? 'on' : ''}" data-m="${m.id}" style="--d:${i}">
        <span class="mic">${Art.icon(m.i, { c: '#fff' })}</span><span class="mt"><b>${m.t}</b><small>${m.s}</small></span><span class="chip">${m.tag}</span>
      </button>`).join('')}</div>`, {
      onOpen: (w) => {
        $$('.mcard', w).forEach((c) => UI.tilt(c, 6));
        w.addEventListener('click', (e) => { const b = e.target.closest('.mcard'); if (!b) return; MODE = MODES.find((m) => m.id === b.dataset.m); haptic('medium');
          const p = FX.pt(b); FX.burst(p.x, p.y, { count: 14, speed: 7, size: .8 });
          Sheet.close(); const chip = $('.screen.current .mode-chip'); if (chip) { chip.querySelector('b').textContent = MODE.t; chip.querySelector('.mi').innerHTML = Art.icon(MODE.i, { c: '#FFE28A' }); bump(chip); } });
      }
    });
  },
  questSheet() {
    const done = S.questDone || (S.questDone = {});
    Sheet.open(`<div class="h1" style="margin:4px 4px 4px">Задания дня</div><p class="dim" style="margin:0 4px 14px;font-size:12px">Обновятся через 7ч 12м</p>
      ${QUESTS.map((q, i) => { const claimed = !!done[q.id]; return `<div class="quest pnl"><div class="qi">${q.k === 'gems' ? Art.gem(34) : Art.coin(34)}<b>+${q.r}</b></div>
        <div class="qb"><b>${q.t}</b><div class="bar ${q.done ? 'green' : ''}"><i style="--p:${q.p / q.m}"></i><span class="lbl">${q.p}/${q.m}</span></div></div>
        ${q.done
          ? (claimed ? `<span class="chip green">${Art.icon('check', { c: '#9CFFD0' })}</span>`
                     : `<button class="b3 green sm" data-q="${q.id}" data-k="${q.k}" data-r="${q.r}">Забрать</button>`)
          : `<span class="chip">${Math.round(q.p / q.m * 100)}%</span>`}</div>`; }).join('')}`, {
      onOpen: (w) => w.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        const q = QUESTS.find((x) => x.id === b.dataset.q); if (!q || done[q.id]) return;
        done[q.id] = Date.now(); save();
        const p = FX.pt(b); FX.burst(p.x, p.y, { count: 20 }); Wallet.add(b.dataset.k, +b.dataset.r, p);
        b.outerHTML = `<span class="chip green">${Art.icon('check', { c: '#9CFFD0' })}</span>`; haptic('success');
      })
    });
  },
  /* События: честные анонсы — без кнопок, которые ведут в никуда */
  eventsSheet() {
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">События</div>
      <div class="pnl ev-row"><span class="ev-ic">${Art.icon('trophy', { c: '#FFE28A' })}</span><span class="ev-tx"><b>Кубок сезона</b><small>Одиночный турнир на 16 соперников. Награда — эпический сундук и гемы.</small></span><span class="chip gold">скоро</span></div>
      <div class="pnl ev-row"><span class="ev-ic">${Art.icon('users', { c: '#9BE8FF' })}</span><span class="ev-tx"><b>Лига выходного дня</b><small>Серия коротких матчей с двойным рейтингом — суббота и воскресенье.</small></span><span class="chip">скоро</span></div>
      <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.55">О старте события пришлём уведомление.</p>`);
  },
  /* Друзья: реальные люди из клуба; матчи по ссылке сознательно отключены */
  friendsSheet() {
    const F = [[0, PEOPLE[0]], [5, PEOPLE[5]]];
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Друзья</div>
      <div class="pnl sgroup">${F.map(([i, p]) => `<div class="fr-row">${Art.avatar('p' + i, 42)}<span class="fr-n"><b>${p.s}</b><small>${p.club} · ${fmt(p.r)}</small></span><button class="b3 dark sm" disabled>Скоро</button></div>`).join('')}</div>
      <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.55">Матчи по ссылке в чате появятся в следующем обновлении. Пока тренируйся в рейтинговых матчах.</p>`);
  }
});

/* ---------------- Настройки (лист) ---------------- */
function openSettings() {
  const row = (k, t, i, d) => `<div class="srow"><span class="si">${Art.icon(i, { c: '#9BE8FF' })}</span><span class="st"><b>${t}</b><small>${d}</small></span><button class="tgl ${S[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`;
  Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Настройки</div>
    <div class="pnl sgroup">${row('sfx', 'Звуки', 'sound', 'Удары, монеты, интерфейс')}${row('vibro', 'Вибрация', 'vibe', 'Хаптика Telegram')}${row('hint', 'Подсказка удара', 'target', 'Кольцо в точке встречи с мячом')}${row('rm', 'Меньше движения', 'motion', 'Без тряски и вспышек')}</div>
    <div class="cap" style="margin:18px 4px 8px">Качество графики</div>
    <div class="seg" id="qseg"><span class="pill"></span>${['high', 'mid', 'low'].map((q) => `<button data-v="${q}" class="${S.quality === q ? 'on' : ''}">${{ high: 'Высокое', mid: 'Среднее', low: 'Эконом' }[q]}</button>`).join('')}</div>
    <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.5">TTU v2 · сборка 2.0.0 · Telegram Mini App</p>`, {
    onOpen: (w) => {
      w.addEventListener('click', (e) => { const row = e.target.closest('.srow'); const t = e.target.closest('.tgl') || (row && row.querySelector('.tgl')); if (!t) return; const k = t.dataset.k; S[k] = !S[k]; save(); t.classList.toggle('on', S[k]); haptic('select'); Sfx.soft(); if (k === 'rm') { document.body.classList.toggle('rm', S.rm); GameHost.ready && GameHost.send('rm', { on: S.rm }); } });
      UI.seg($('#qseg', w), (v) => setQuality(v));
    }
  });
}
