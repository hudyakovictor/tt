/* Balance and readability — the promises that decide whether the FIRST
 * match is winnable.
 *
 * The complaint these tests exist for: "я отбиваю 1 мяч из 5, а он любые
 * достаёт" — the opponent never missed and the player could not convert.
 * Each assertion below pins one of the four things that were measurably
 * wrong (see docs/gameplay-audit-150.ru.md):
 *
 *   1. the rookie bot's authored execution error was never applied, so it
 *      returned like a wall at every level;
 *   2. the adaptive director's window (0.86 … 1.03) was too narrow to
 *      rescue a blow-out;
 *   3. the blade got no help reading a predicted meeting point the player
 *      cannot see, so the misses were one capture radius short;
 *   4. the racket was drawn over the ball and the difficulty was declared
 *      instead of earned.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./helpers.cjs');

const AI_FILES = ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '55_ai.js'];

function aiLib() {
  return load(AI_FILES, ['OpponentAI', 'V3', 'PH', 'AI_LEVELS', 'AUTO_AIM_BY_LEVEL', 'AUTO_AIM_HORIZON']);
}

function gameStub(lib, t) {
  const V3 = lib.V3, PH = lib.PH;
  return {
    time: t,
    ball: { p: V3.new(.2, PH.TABLE_Y + .35, -1.5), v: V3.new(-3, 1, -6), w: V3.new(0, -90, 0) },
    equip: { forSide: () => ({ e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 }) },
    player: { pos: V3.new(0, PH.TABLE_Y + .3, 1.7) },
    settings: { hand: 'right', grip: 'shakehand' },
  };
}

function swingOnce(lib, ai, t) {
  ai.commit = { archId: 'DRIVE', speed: 5, aim: { x: .3, z: -1.2 } };
  ai.swingAt = 0;
  ai.phase = 'SWING';
  const r = ai.swing(gameStub(lib, t));
  ai.phase = 'IDLE'; ai.commit = null;
  return r;
}

test('every level gets an execution error, and it shrinks with the level', () => {
  const lib = aiLib();
  const base = lib.AI_LEVELS.map((L) => L.errBase);
  for (let i = 1; i < base.length; i++)
    assert.ok(base[i] < base[i - 1], `level ${i} is not more accurate than level ${i - 1}`);
  // The rookie has to miss often enough to lose a point without being handed one.
  assert.ok(base[0] >= .30, `level 0 errBase ${base[0]} is too clean`);
  assert.ok(base[4] <= .06, `level 4 errBase ${base[4]} is too sloppy`);
});

test('a rookie return really goes wrong, and the miss is physical, not cosmetic', () => {
  const lib = aiLib();
  const ai = new lib.OpponentAI(0);
  let miss = 0, short = 0, long = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const r = swingOnce(lib, ai, i * .01);
    assert.ok(r, 'the solver must still return a racket');
    if (i === 0) assert.ok(ai._missP >= .3, `level 0 miss probability ${ai._missP}`);
    if (r.miss) {
      miss++;
      if (r.miss === 'short') short++; else long++;
      // A "short" miss is a slower swing, never a hidden teleport.
      if (r.miss === 'short') assert.ok(lib.V3.len(r.vR) < 5 * 0.8, 'short miss did not slow the swing');
      if (r.miss === 'long') assert.ok(r.vR.y > 0, 'long miss did not lift the swing');
    }
    assert.ok(Number.isFinite(ai._missP));
  }
  assert.ok(miss / N > .2, `rookie missed only ${miss}/${N}`);
  assert.ok(short > 0 && long > 0, 'both miss kinds must occur, not one dominant one');
});

test('the legend almost never errs, and the handicap is a real dial', () => {
  const lib = aiLib();
  const legend = new lib.OpponentAI(4);
  swingOnce(lib, legend, 0);
  assert.ok(legend._missP <= .08, `level 4 miss probability ${legend._missP}`);
  const rookie = new lib.OpponentAI(0);
  swingOnce(lib, rookie, 0);
  rookie.setHandicap(.62);
  swingOnce(lib, rookie, .01);
  assert.ok(rookie._missP > .45, `a losing player faces ${rookie._missP} — the dial does nothing`);
  // and it cannot leave its documented range
  rookie.setHandicap(.01); assert.equal(rookie.handicap, .55);
  rookie.setHandicap(9); assert.equal(rookie.handicap, 1.10);
});

test('the director rescues a blow-out instead of decorating it', () => {
  const { MatchDirector } = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '58_coach.js'],
    ['MatchDirector']);
  const d = new MatchDirector();
  let h = 1;
  for (let i = 0; i < 8; i++) h = d.onPoint(-1, 0);
  assert.ok(h <= .68, `eight lost points in a row leave the handicap at ${h}`);
  assert.ok(d.streak <= -8);
  // a player who is dominating is answered, but never punished
  const w = new MatchDirector();
  let h2 = 1;
  for (let i = 0; i < 8; i++) h2 = w.onPoint(1, 0);
  assert.ok(h2 >= 1.0 && h2 <= 1.10, `eight won points in a row give ${h2}`);
  // above the authored ceiling the bot is left alone
  const top = new MatchDirector();
  for (let i = 0; i < 8; i++) top.onPoint(-1, 4);
  assert.equal(top.handicap, 1);
});

test('auto-aim helps a beginner and fades to nothing at the top', () => {
  const Game = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js', '70_game.js'], ['Game']).Game;
  const mk = (settings) => Object.assign(Object.create(Game.prototype), { settings });
  const lv = [0, 1, 2, 3, 4].map((d) => mk({ difficulty: d, autoAim: -1 }).autoAimStrength());
  assert.ok(lv[0] >= .7, `a beginner gets ${lv[0]} of help`);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i] < lv[i - 1], 'the help must fade with the level');
  assert.ok(lv[4] <= .15);
  // an explicit setting wins over the table, including "off"
  assert.equal(mk({ difficulty: 0, autoAim: 0 }).autoAimStrength(), 0);
  assert.equal(mk({ difficulty: 4, autoAim: 1 }).autoAimStrength(), 1);
  assert.equal(mk({ difficulty: 2, autoAim: NaN }).autoAimStrength(), lv[2]);
  // out-of-range values are clamped, never trusted
  assert.equal(mk({ difficulty: 0, autoAim: 7 }).autoAimStrength(), 1);
  assert.equal(mk({ difficulty: 0, autoAim: -5 }).autoAimStrength(), lv[0]);
});

test('the racket is hidden by default; the ball is the only thing to look at', () => {
  const src = fs.readFileSync(path.join(root, 'tt/src/70_game.js'), 'utf8');
  assert.match(src, /showPlayerPaddle:\s*false/, 'the blade still paints over the ball by default');
  // hiding it must stay a RENDER decision: the physical capture is untouched
  assert.match(src, /if \(this\.settings\.showPlayerPaddle !== false\) \{/);
  const rules = fs.readFileSync(path.join(root, 'tt/src/12_match_rules.js'), 'utf8');
  assert.match(rules, /captureRadius:\s*\.22/);
});

test('a hidden racket never leaves a desktop player without a pointer', async () => {
  const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
    '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js', '70_game.js', '80_ui.js'], ['UI', 'GS']);
  const canvas = { style: {} };
  const mk = (showPlayerPaddle) => {
    const ui = Object.create(lib.UI.prototype);
    ui.game = { canvas, state: lib.GS.RALLY, paused: false, replayer: { on: false },
      settings: { showPlayerPaddle } };
    ui.captureDebug = false;
    return ui;
  };
  // blade hidden -> the mouse IS the reference, so it must stay visible
  mk(false).syncNativeCursor();
  assert.equal(canvas.style.cursor, 'default');
  // blade drawn -> the OS cursor would double the blade, so it hides
  mk(true).syncNativeCursor();
  assert.equal(canvas.style.cursor, 'none');
});

test('a hidden racket gets a reticle, a drawn one does not', () => {
  const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
    '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js', '70_game.js', '80_ui.js'], ['UI', 'GS', 'TAU']);
  const calls = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, arc() {}, stroke() {}, fill() {},
    setLineDash() {}, moveTo() {}, lineTo() {}, closePath() {},
    set strokeStyle(v) { calls.push(['stroke', v]); }, get strokeStyle() { return ''; },
    set fillStyle(v) { calls.push(['fill', v]); }, get fillStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 0; }, set lineCap(v) {}, get lineCap() { return ''; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; } };
  const mk = (showPlayerPaddle) => {
    const ui = Object.create(lib.UI.prototype);
    ui.game = {
      paused: false, replayer: { on: false }, state: lib.GS.RALLY,
      settings: { showPlayerPaddle }, player: { pos: { x: 0, y: 1, z: 1.78 } },
      project: () => ({ ok: true, x: .5, y: .6 }),
    };
    ui._pv = {};
    return ui;
  };
  assert.equal(mk(false).drawBladeReticle(ctx, 780, 1688, 2), true, 'no reticle over a hidden racket');
  assert.equal(mk(true).drawBladeReticle(ctx, 780, 1688, 2), false, 'the blade itself is the reticle');
  // it must be hollow: strokes only, never a filled disc over the ball
  const fills = calls.filter((c) => c[0] === 'fill');
  assert.ok(fills.length === 1, 'only the tiny centre dot may be filled');
});

test('the camera keeps the strike zone off the reading band on a phone', () => {
  const NAMES = ['cameraRigFor', 'rigViewProj', 'projectPoint', 'tabletopBounds', 'CAMERA_PRESETS',
    'CAMERA_ORDER', 'PLAY_RECT', 'PLAY_BAND_Y', 'PH'];
  const lib = load(['10_math.js', '30_physics.js', '57_camera.js'], NAMES);
  const a = 390 / 844;
  for (const mode of lib.CAMERA_ORDER) {
    const vp = lib.rigViewProj(lib.cameraRigFor(mode, null, a), a);
    const table = lib.tabletopBounds(vp);
    const TY = lib.PH.TABLE_Y;
    for (const dy of [.15, .35, .55]) {
      const q = lib.projectPoint(vp, { x: 0, y: TY + dy, z: 1.78 });
      assert.ok(q.ok, `${mode}: the bat plane at ${dy} m is not on screen`);
      assert.ok(q.y > lib.PLAY_RECT.top && q.y < lib.PLAY_RECT.bottom,
        `${mode}: a ball at ${dy} m meets the bat at ${q.y.toFixed(3)}, outside the play rect`);
      assert.ok(q.y < lib.PLAY_BAND_Y - .10,
        `${mode}: the meeting point ${q.y.toFixed(3)} crowds the reading band`);
    }
    // the player's own half — where the ball bounces and must be judged — is on screen
    assert.ok(table.bottom > .5 && table.bottom < .8, `${mode}: near edge ${table.bottom.toFixed(3)}`);
  }
});
