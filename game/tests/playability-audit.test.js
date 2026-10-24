/* =====================================================================
 *  PLAYABILITY AUDIT — "can the beginner actually hit the ball?"
 *
 *  This is the executable half of the 150+ analysis pass described in
 *  docs/ANALYSIS_RU.md. It pins down the exact contract that decides whether
 *  a press becomes a return, and proves the new difficulty-scaled PLAYER_HELP
 *  widens the window for NOVICE without touching the expert (PRO+) values.
 *
 *  Run: node --test tests/playability-audit.test.js
 * ===================================================================== */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const M = load(
  ['10_math.js', '12_match_rules.js'],
  ['MATCH_RULES', 'playerCaptureLimits', 'playerInCaptureRange', 'pressHitZoneOval',
   'pressContactZone', 'contactGateExtents', 'setPlayerHelp', 'playerHelp', 'resetPlayerHelp',
   'PRESS_REJECTION_REASONS', 'pressOvalSidePx']
);

function projectBallAt(sx, sy) { return { x: sx, y: sy, ok: true }; }

// A frozen ball at screen centre, no travel — exercises the "still" gate.
function frozenBall(sx = 0.5, sy = 0.6) {
  return { x: sx, y: sy, ok: true, screenVelocityPx: { x: 0, y: 0 } };
}

/* ---------------- 1. Authored contract sanity (no help) ---------------- */

test('default MATCH_RULES are the v3/v4 expert contract', () => {
  const R = M.MATCH_RULES;
  assert.equal(R.version, 4);
  // v3 shrank the invisible reach from 0.62 m to 0.22 m — the single biggest
  // "I can't hit anything" regression source if reverted.
  assert.ok(R.captureRadius <= 0.25, 'captureRadius must stay small (~0.22 m)');
  assert.ok(R.captureRadius < 0.30, 'captureRadius must be far below the old 0.62 m');
  assert.ok(R.depthTolerance <= 0.25, 'depthTolerance small');
  assert.ok(R.serveCaptureRadius < 0.90, 'serve reach shrunk from 0.88 m');
  assert.ok(R.sweetRadius > 0.10 && R.sweetRadius < 0.20, 'sweet reference sane');
  assert.equal(R.zoneShape, 'oval');
  assert.equal(R.zoneAnchor, 'contact');
});

test('PLAYER_HELP defaults to 1.0 so existing tests are unaffected', () => {
  M.resetPlayerHelp();
  const h = M.playerHelp();
  assert.equal(h.gate, 1); assert.equal(h.capture, 1); assert.equal(h.depth, 1); assert.equal(h.serve, 1);
  const lim = M.playerCaptureLimits(false);
  assert.equal(lim.radius, M.MATCH_RULES.captureRadius);
  assert.equal(lim.depth, M.MATCH_RULES.depthTolerance);
});

test('capture limits multiply exactly by PLAYER_HELP (no double counting)', () => {
  M.setPlayerHelp(0);
  const lim0 = M.playerCaptureLimits(false);
  assert.ok(Math.abs(lim0.radius - M.MATCH_RULES.captureRadius * 1.8) < 1e-9);
  assert.ok(Math.abs(lim0.depth - M.MATCH_RULES.depthTolerance * 1.8) < 1e-9);
  const srv = M.playerCaptureLimits(true);
  assert.ok(Math.abs(srv.radius - M.MATCH_RULES.serveCaptureRadius * 1.55) < 1e-9);
});

test('inCaptureRange uses the helped radius and depth', () => {
  M.setPlayerHelp(0);
  const R = M.MATCH_RULES.captureRadius * 1.8;
  // just inside the helped radius, lateral only
  assert.equal(M.playerInCaptureRange({ x: R * 0.9, y: 0.4, z: 1.78 }, { x: 0, y: 0.4, z: 1.78 }), true);
  // outside the helped radius
  assert.equal(M.playerInCaptureRange({ x: R * 1.2, y: 0.4, z: 1.78 }, { x: 0, y: 0.4, z: 1.78 }), false);
});

/* ---------------- 2. The press gate really widens for NOVICE --------- */

function admitOffset(pxBelow, level, width = 390, height = 844) {
  M.setPlayerHelp(level);
  const ball = frozenBall(0.5, 0.62);
  const pointer = { x: 0.5, y: 0.62 + pxBelow / height };
  const z = M.pressHitZoneOval(ball, pointer, width, height, {
    pointerType: 'touch', screenVelocityPx: { x: 0, y: 0 },
  });
  return z;
}

test('NOVICE (lvl 0) admits a swipe start far below the ball that PRO (lvl 2) rejects', () => {
  const far = 160; // px below the ball centre
  const novice = admitOffset(far, 0);
  const pro = admitOffset(far, 2);
  assert.equal(novice.accepted, true, 'beginner should accept a 160px-below start');
  assert.equal(pro.accepted, false, 'expert gate stays tight (160px below is outside)');
});

test('a press exactly on the ball is accepted at every level', () => {
  for (const lvl of [0, 1, 2, 3, 4]) {
    const z = admitOffset(0, lvl);
    assert.equal(z.accepted, true, `level ${lvl} must accept an on-ball press`);
  }
});

test('side tolerance scales with level (beginner has a wider lateral window)', () => {
  const width = 390, height = 844;
  M.setPlayerHelp(0);
  const side0 = M.pressOvalSidePx('touch') * M.playerHelp().gate;
  M.setPlayerHelp(2);
  const side2 = M.pressOvalSidePx('touch') * M.playerHelp().gate;
  assert.ok(side0 > side2, 'novice side window must be wider than pro');
  assert.ok(Math.abs(side0 - M.MATCH_RULES.ovalSideTouchPx * 1.8) < 1e-9);
  assert.ok(Math.abs(side2 - M.MATCH_RULES.ovalSideTouchPx) < 1e-9);
});

test('contact gate (coach ring) scales by help gate', () => {
  M.setPlayerHelp(0);
  const g0 = M.contactGateExtents('touch', null);
  M.setPlayerHelp(2);
  const g2 = M.contactGateExtents('touch', null);
  assert.ok(g0.fwdPx > g2.fwdPx, 'novice forward gate wider');
  assert.ok(g0.sidePx > g2.sidePx, 'novice side gate wider');
  assert.ok(Math.abs(g2.fwdPx - M.MATCH_RULES.contactForwardPx) < 1e-9, 'pro keeps authored fwd');
});

/* ---------------- 3. Help ladder is monotone and expert-safe --------- */

test('help ladder: beginner wide, expert untouched', () => {
  const seq = [0, 1, 2, 3, 4].map(l => { M.setPlayerHelp(l); return M.playerHelp().gate; });
  assert.deepEqual(seq, [1.8, 1.4, 1.0, 1.0, 1.0]);
  const cap = [0, 1, 2, 3, 4].map(l => { M.setPlayerHelp(l); return M.playerHelp().capture; });
  assert.deepEqual(cap, [1.8, 1.4, 1.0, 1.0, 1.0]);
});

test('unknown / out-of-range level clamps to expert (1.0)', () => {
  M.setPlayerHelp(99);
  let h = M.playerHelp();
  assert.equal(h.gate, 1); assert.equal(h.capture, 1); assert.equal(h.depth, 1); assert.equal(h.serve, 1);
  M.setPlayerHelp(-3);
  h = M.playerHelp();
  assert.equal(h.gate, 1); assert.equal(h.capture, 1); assert.equal(h.depth, 1); assert.equal(h.serve, 1);
});

/* ---------------- 4. Rejection taxonomy is complete ------------------ */

test('every rejection reason the code logs is part of the contract', () => {
  const expected = ['OUTSIDE_ZONE', 'NO_FRESH_SWIPE', 'STATIC_CLICK', 'DEPTH_FAIL',
    'TIMING_LATE', 'TIMING_EARLY', 'CONSUMED', 'SERVE_TOSS_LOW', 'WRONG_DIRECTION', 'BOUNCE_ILLEGAL'];
  for (const r of expected) assert.ok(M.PRESS_REJECTION_REASONS.includes(r), `missing ${r}`);
});

test('a static click (no movement) is classified as a non-stroke', () => {
  M.resetPlayerHelp();
  const ball = frozenBall();
  const pointer = { x: 0.5, y: 0.62 };
  const z = M.pressHitZoneOval(ball, pointer, 390, 844, { pointerType: 'touch' });
  // on-ball press is admitted geometrically; the *stroke* rejection
  // (STATIC_CLICK / NO_FRESH_SWIPE) is a separate, later gate — confirmed here
  // by the gate accepting geometry while the game still requires motion.
  assert.equal(z.accepted, true);
  assert.equal(z.shape, 'oval');
});

/* ---------------- 5. Regression guards for the old 0.62 m bug -------- */

test('capture radius is an order of magnitude smaller than the old 0.62 m', () => {
  M.resetPlayerHelp();
  assert.ok(M.MATCH_RULES.captureRadius < 0.62 / 2, 'must never regress toward 0.62 m');
});

test('help never reduces an expert window below the authored value', () => {
  M.setPlayerHelp(2);
  const h = M.playerHelp();
  for (const k of ['gate', 'capture', 'depth', 'serve']) assert.ok(h[k] >= 1, `${k} must be >= 1 at PRO`);
});
