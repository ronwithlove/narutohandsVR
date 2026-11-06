import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleFromHands, distance, palmFrame, KEY_LENGTH } from '../src/features.js';
import { localHand, place, POSES, twoHands, rng, jitter } from '../src/synthetic.js';

const hand = (pose, side = 1, t = {}) => place(localHand(POSES[pose], 0.12, side), t);

test('single-hand sample has the documented length and key', () => {
  const s = sampleFromHands(null, hand('open'));
  assert.equal(s.key, 'R'); assert.equal(s.v.length, KEY_LENGTH.R);
  const l = sampleFromHands(hand('open', -1), null);
  assert.equal(l.key, 'L');
});

test('two hands give an LR sample of the documented length', () => {
  const { left, right } = twoHands(POSES.open, POSES.open);
  const s = sampleFromHands(left, right);
  assert.equal(s.key, 'LR'); assert.equal(s.v.length, KEY_LENGTH.LR);
});

test('invariant to where the hand is, how it is rotated and how big it is', () => {
  const a = sampleFromHands(null, hand('fist'));
  const b = sampleFromHands(null, hand('fist', 1, { yaw: 1.1, pitch: -0.7, roll: 2.2, at: [3, 1.4, -2], scale: 1.15 }));
  assert.ok(distance(a, b) < 1e-6, `distance ${distance(a, b)}`);
});

test('two-hand sample is invariant to a rigid move of both hands together', () => {
  const { left, right } = twoHands(POSES.pinch, POSES.fist, { yaw: 2.6, at: [0.04, 0.03, -0.02] });
  const a = sampleFromHands(left, right);
  const mv = (h) => place(h, { yaw: 0.9, pitch: 0.4, roll: -1.3, at: [1, 2, 3] });
  const b = sampleFromHands(mv(left), mv(right));
  assert.ok(distance(a, b) < 1e-6);
});

test('different poses are far apart, the same pose with tracking noise is close', () => {
  const rand = rng(7);
  const poses = Object.keys(POSES);
  const ref = Object.fromEntries(poses.map((p) => [p, sampleFromHands(null, hand(p))]));
  for (const p of poses) {
    const noisy = sampleFromHands(null, jitter(hand(p), 0.003, rand)); // 3 mm jitter
    const own = distance(noisy, ref[p]);
    for (const q of poses) if (q !== p) {
      const other = distance(noisy, ref[q]);
      assert.ok(own < 0.15, `${p} own distance ${own}`);
      assert.ok(other > 2 * own, `${p} vs ${q}: ${other} should be > 2x ${own}`);
    }
  }
});

test('left and right keys are never comparable', () => {
  assert.equal(distance(sampleFromHands(null, hand('open')), sampleFromHands(hand('open', -1), null)), Infinity);
});

test('how the second hand sits relative to the first changes the two-hand sample', () => {
  const a = twoHands(POSES.open, POSES.open, { at: [0.04, 0.0, 0.0] });
  const b = twoHands(POSES.open, POSES.open, { at: [0.04, 0.05, -0.03] });
  const d = distance(sampleFromHands(a.left, a.right), sampleFromHands(b.left, b.right));
  assert.ok(d > 0.1, `d=${d}`);
});

test('glitchy or missing tracking is rejected, not turned into a sample', () => {
  const h = hand('open');
  assert.equal(palmFrame(h.slice(0, 24)), null);
  const nan = h.map((p) => [...p]); nan[5][0] = NaN;
  assert.equal(palmFrame(nan), null);
  const tiny = place(h, { scale: 0.1 });
  assert.equal(palmFrame(tiny), null);
  assert.equal(sampleFromHands(null, null), null);
});
