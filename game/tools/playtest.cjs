#!/usr/bin/env node
/* =====================================================================
 *  PLAYTEST — a silicon beginner plays real matches through the real
 *  pointer pipeline (pointerdown / pointermove / pointerup on the canvas)
 *  and reports how often the player side actually returns the ball.
 *
 *  Why: "я отбиваю 1 мяч из 5, а соперник достаёт любые" is a claim about
 *  the WHOLE control chain (press gate -> paddle follow -> capture), not
 *  about physics constants. Unit tests pin each link; this tool measures
 *  the chain end to end with a human-shaped input model:
 *
 *    · aim error          — a finger is not a mouse (--err px, 1 sigma)
 *    · press lead time    — nobody presses 6 ms before contact (--lead s)
 *    · press below the ball, flick up through it (a real stroke)
 *    · one honest attempt per incoming ball, no second chances
 *
 *  Usage:
 *    node tools/playtest.cjs --html /tmp/tt-audit.html --diff 0 --matches 3
 *    node tools/playtest.cjs --diff 0 --err 30 --lead .22 --verbose
 *  Exit code 1 when a requested target return rate is not reached
 *  (--min-return 0.7), so it can gate a balance change.
 * ===================================================================== */
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const HTML = path.resolve(String(opt('html', path.join(ROOT, '..', '..', 'index.html'))));
const DIFF = Number(opt('diff', 0));
const MATCHES = Number(opt('matches', 2));
const ERR = Number(opt('err', 22));          // px, 1 sigma of aim error
const LEAD = Number(opt('lead', 0.16));      // s before the meeting point the finger goes down
const REACT = Number(opt('react', 0.12));    // s of reaction delay after the opponent's hit
const BELOW = Number(opt('below', 46));      // px below the meeting point the press starts
const FLICK = Number(opt('flick', 112));     // px of the upward stroke through the ball
const FLICK_FRAMES = Number(opt('flick-frames', 5));
const TARGET = Number(opt('target', 11));
const MIN_RETURN = Number(opt('min-return', 0));
const VERBOSE = !!opt('verbose', false);
const SEED = Number(opt('seed', 1));
const VIEW = String(opt('view', '390x844'));
const AUTOAIM = opt('autoaim', null) === null ? null : Number(opt('autoaim', null));

async function main() {
  if (!fs.existsSync(HTML)) {
    console.error(`playtest: html not found: ${HTML}\n  build it:  cd game/tt && python3 build.py /tmp/tt-audit.html`);
    process.exit(2);
  }
  const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
  const chromium = require(path.join(ROOT, 'node_modules', '@sparticuz', 'chromium'));
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (!fs.existsSync(path.join(libs, 'lib'))) {
    const archive = path.join(path.dirname(require.resolve(path.join(ROOT, 'node_modules', '@sparticuz', 'chromium'))),
      '../../bin/al2023.tar.br');
    execFileSync('mkdir', ['-p', libs]);
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const launchEnv = { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(), args: chromium.args, headless: true, env: launchEnv,
  });
  const [vw, vh] = VIEW.split('x').map(Number);
  const page = await browser.newPage();
  await page.setViewport({ width: vw || 390, height: vh || 844, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0, { timeout: 30000 });

  const out = await page.evaluate(async (cfg) => {
    const g = window.__game;
    g.paused = true; g.settings.sound = false; g.settings.haptics = false;
    try { g.audio.setMuted(true); } catch (e) { /* no audio in headless */ }
    g.settings.adaptive = false;
    g.settings.targetScore = cfg.target;
    g.settings.difficulty = cfg.diff;
    g.settings.showPlayerPaddle = true;
    if (cfg.autoaim !== null) g.settings.autoAim = cfg.autoaim;
    document.querySelectorAll('.screen.on').forEach((el) => el.classList.remove('on'));
    const canvas = g.canvas;
    const rect = () => canvas.getBoundingClientRect();
    const send = (type, x, y, target) => {
      const r = rect();
      const e = new PointerEvent(type, {
        pointerId: 1, pointerType: cfg.pointerType, isPrimary: true,
        button: type === 'pointerup' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true, cancelable: true,
        clientX: r.left + x * r.width, clientY: r.top + y * r.height,
      });
      (target || canvas).dispatchEvent(e);
    };
    const clamp01 = (v) => Math.max(0.002, Math.min(0.998, v));
    const spawn = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

    /* one wrapping only, so per-match tallies are not multiplied by wrappers */
    const ptReasons = {};
    let livePlan = null;          // the plan of the ball currently in flight
    let classify = null;          // set by runMatch, called when a point ends
    const origAward = g.awardPoint.bind(g);
    g.awardPoint = (who, reason) => {
      const before = g.score[0] + g.score[1];
      if (classify && g.score[0] + g.score[1] === before) classify(who, reason);
      const r = origAward(who, reason);
      if (!g.training && g.score[0] + g.score[1] !== before) {
        const k = (who > 0 ? 'W ' : 'L ') + reason;
        ptReasons[k] = (ptReasons[k] || 0) + 1;
      }
      return r;
    };

    const runMatch = (matchIndex) => {
      const rnd = spawn(cfg.seed * 7919 + matchIndex * 104729);
      const r2 = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;      // ~N(0,1), bounded
      const m = { diff: cfg.diff, incoming: 0, returns: 0, points: [0, 0], serveTries: 0, serveHits: 0,
        noCp: 0, noPress: 0, pressRejected: 0, pressNoContact: 0, dists: [], states: {} };
      g.startMatch(cfg.diff);
      g.score = [0, 0];
      const dt = 1 / 60;
      let plan = null, flick = null, shotSeen = -1, serveWait = 0, servePlan = null, shotWasServed = false;
      const countMiss = (p) => {
        if (!p) return;
        m.chances = (m.chances || 0) + 1;
        if (!p.cpSeen) m.noCp++;
        else if (!p.pressed) m.noPress++;
        else if (p.admitted === false) m.pressRejected++;
        else { m.pressNoContact++; (m.miss || (m.miss = [])).push(p.best); }
        m.dists.push(+p.minDist.toFixed(3));
      };
      classify = (who, reason) => {
        if (who < 0 && reason === 'ВЫ НЕ ДОСТАЛИ МЯЧ' && plan) { countMiss(plan); plan = null; livePlan = null; flick = null; }
      };
      const proj = (p) => { const q = g.project(p, {}); return q && q.ok ? q : null; };
      let frames = 0;
      while (frames++ < 60 * 300) {
        const st = g.state;
        const b = g.ball, pad = g.player;
        /* ---------------- my serve ---------------- */
        if (st === GS.SERVE_READY && g.server === 1) {
          serveWait += dt;
          if (!servePlan && serveWait > 0.55) {
            const q = proj(b.p) || { x: 0.5, y: 0.6 };
            serveWait = 0;
            send('pointermove', q.x, q.y, window);
            send('pointerdown', q.x, q.y);
            servePlan = { phase: 'wait', x0: q.x, y0: q.y };
            m.serveTries++;
          }
        } else if (st === GS.SERVE_TOSS && g.server === 1 && servePlan) {
          if (servePlan.phase === 'wait' && b.v.y <= 0.12) {
            servePlan.phase = 'flick';
            servePlan.i = 0;
            servePlan.dy = -0.30;
          }
          if (servePlan.phase === 'flick') {
            const k = Math.min(1, (++servePlan.i) / 4);
            send('pointermove', servePlan.x0, servePlan.y0 + servePlan.dy * k);
            if (servePlan.i >= 4) { send('pointerup', servePlan.x0, servePlan.y0 + servePlan.dy); servePlan = null; }
          }
        } else if (servePlan) {
          servePlan = null;
        }
        if (g.state !== GS.RALLY) { g.update(dt); continue; }

        /* ---------------- rally ---------------- */
        const incoming = b.live && b.lastHitBy === -1;
        const cp = incoming ? g.contactPrediction() : null;
        if (incoming && g.shotId !== shotSeen) {
          shotSeen = g.shotId;
          m.incoming++;
          plan = { ex: r2() * cfg.err, ey: r2() * cfg.err, t0: g.time, pressed: false, shot: g.shotId,
            cpSeen: false, minDist: 9, admitted: null, best: null, offScreen: null, trace: cfg.trace ? [] : null };
        }
        if (plan && incoming) {
          const dist = Math.hypot(b.p.x - pad.pos.x, b.p.y - pad.pos.y, b.p.z - pad.pos.z);
          if (dist < plan.minDist) {
            plan.minDist = dist;
            plan.best = { t: +g.time.toFixed(3), cp: cp ? +cp.t.toFixed(3) : null, intent: !!g.playerStrokeIntent(false),
              admits: g.pressAdmitsBall(), pressed: !!plan.pressed, b: [+b.p.x.toFixed(2), +b.p.y.toFixed(2), +b.p.z.toFixed(2)],
              pad: [+pad.pos.x.toFixed(2), +pad.pos.y.toFixed(2), +pad.pos.z.toFixed(2)], sw: g.swipe.active };
          }
          if (plan.trace) plan.trace.push({ t: +g.time.toFixed(2), cp: cp ? +cp.t.toFixed(2) : null, d: +dist.toFixed(2),
            bz: +b.p.z.toFixed(2), by: +b.p.y.toFixed(2), pz: +pad.pos.z.toFixed(2), py: +pad.pos.y.toFixed(2), px: +pad.pos.x.toFixed(2) });
          if (cp) {
            plan.cpSeen = true;
            if (plan.offScreen === null && cp.t < 0.10) {
              const qq = proj(cp.p);
              plan.offScreen = !qq || qq.x < 0.04 || qq.x > 0.96 || qq.y < 0.30 || qq.y > 0.855;
              m.cpN = (m.cpN || 0) + 1;
              if (plan.offScreen) m.cpOff = (m.cpOff || 0) + 1;
            }
          }
          const age = g.time - plan.t0;
          /* No prediction is not a reason to give up: a human swings at the
           * ball they SEE. Fall back to the ball's projection and press when
           * it is close to the bat plane. */
          const q = cp ? proj(cp.p) : (b.p.z > pad.pos.z - 0.55 ? proj(b.p) : null);
          const eta = cp ? cp.t : (pad.pos.z - b.p.z) / Math.max(b.v.z, 0.5);
          if (q && age >= cfg.react) {
            const ax = clamp01(q.x + plan.ex / rect().width);
            const ay = clamp01(q.y + plan.ey / rect().height);
            if (!plan.pressed) {
              send('pointermove', ax, clamp01(ay + cfg.below / rect().height), window);   // hover
              if (eta <= cfg.lead) {
                plan.px = ax; plan.py = clamp01(ay + cfg.below / rect().height);
                plan.pressed = true;
                send('pointerdown', plan.px, plan.py);
                plan.admitted = g.swipe.pressZone ? g.swipe.pressZone.accepted : null;
              }
            } else {
              if (eta <= 0.055 && !flick) flick = { i: 0 };
              if (flick) {
                const k = (++flick.i) / cfg.flickFrames;
                if (flick.i <= cfg.flickFrames) {
                  send('pointermove', clamp01(plan.px - 0.02 * k), clamp01(plan.py - (cfg.flick / rect().height) * k));
                } else {
                  send('pointerup', clamp01(plan.px - 0.02), clamp01(plan.py - cfg.flick / rect().height));
                  flick = null;
                  plan.released = true;
                }
              }
            }
          }
        }
        g.update(dt);
        if (plan && b.lastHitBy === 1) {
          m.returns++; m.chances = (m.chances || 0) + 1; m.dists.push(+plan.minDist.toFixed(3));
          plan = null; flick = null;
        } else if (plan && (b.p.z > pad.pos.z + 0.20 || !b.live || g.state !== GS.RALLY)) {
          /* Count a miss only when the ball actually crossed the bat plane
           * inside the table: a wide ball that flies past is the opponent's
           * mistake, not the player's, and counting it made the tool report
           * a 20 % worse return rate than the player really had. */
          const crossed = b.p.z > pad.pos.z + 0.20 && Math.abs(b.p.x) <= 0.92 && b.p.y > PH.TABLE_Y - 0.05;
          if (crossed) countMiss(plan);
          plan = null; livePlan = null; flick = null;
        }
        if (g.matchWinner && g.state === GS.MATCH_END) break;
      }
      m.points = g.score.slice();
      return m;
    };

    const matches = [];
    for (let i = 0; i < cfg.matches; i++) {
      matches.push(runMatch(i));
      if (g.state !== GS.MATCH_END) { /* stop a wedged sim from eating the next match */ }
    }
    return { matches, reasons: ptReasons };
  }, { diff: DIFF, matches: MATCHES, target: TARGET, err: ERR, lead: LEAD, react: REACT, below: BELOW,
    flick: FLICK, flickFrames: FLICK_FRAMES, seed: SEED, pointerType: opt('touch', false) ? 'touch' : 'mouse', autoaim: AUTOAIM,
    trace: !!opt('trace', false) });

  let totalIncoming = 0, totalReturns = 0, noCp = 0, noPress = 0, pressRejected = 0, pressNoContact = 0;
  out.matches.forEach((m, i) => {
    totalIncoming += (m.chances || m.incoming); totalReturns += m.returns;
    noCp += m.noCp; noPress += m.noPress; pressRejected += m.pressRejected; pressNoContact += m.pressNoContact;
    const denom = m.chances || m.incoming;
    const rate = denom ? m.returns / denom : 0;
    console.log(`match ${i + 1}: ${m.points[0]}:${m.points[1]}  returns ${m.returns}/${denom} (${(rate * 100).toFixed(0)}%)  ` +
      `serves ${m.serveTries}`);
    if (VERBOSE && m.miss) console.log('    close misses: ' + JSON.stringify(m.miss.slice(0, 4)));
    if (VERBOSE) console.log(`    meeting point off the play rect: ${m.cpOff || 0}/${m.cpN || 0}`);
    if (VERBOSE) console.log(`    ball reached the bat plane ${m.chances || 0}× (returns ${m.returns})`);
    if (VERBOSE) console.log(`    missed: no prediction ${m.noCp} · never pressed ${m.noPress} · press rejected ${m.pressRejected} · pressed, no contact ${m.pressNoContact}`);
  });
  const rate = totalIncoming ? totalReturns / totalIncoming : 0;
  console.log(`\nTOTAL diff ${DIFF}: returns ${totalReturns}/${totalIncoming} = ${(rate * 100).toFixed(1)}% ` +
    `(err ${ERR}px, lead ${LEAD}s, react ${REACT}s, view ${VIEW}${AUTOAIM === null ? ', auto-aim by level' : `, auto-aim ${AUTOAIM}`})`);
  if (totalIncoming) console.log(`miss split: no prediction ${noCp} · never pressed ${noPress} · press rejected ${pressRejected} · pressed/no contact ${pressNoContact}`);
  if (VERBOSE) console.log('points: ' + Object.entries(out.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · '));
  if (errors.length) console.log('page errors: ' + errors.slice(0, 5).join(' | '));
  await browser.close();
  if (MIN_RETURN > 0 && rate < MIN_RETURN) {
    console.error(`BELOW TARGET: ${(rate * 100).toFixed(1)}% < ${(MIN_RETURN * 100).toFixed(0)}%`);
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
