import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestMatch, StableMatch, SealEvents, completedTechnique, techniqueDuration, validTechniques, mergeTechniques, DEFAULT_TECHNIQUES, BASE_THRESHOLD } from '../src/matcher.js';
import { sampleFromHands } from '../src/features.js';
import { localHand, place, POSES, rng, jitter } from '../src/synthetic.js';

const h = (pose, side = 1, t = {}) => place(localHand(POSES[pose], 0.12, side), t);
const rec = (pose, rand, n = 20) => Array.from({ length: n }, () => sampleFromHands(null, jitter(h(pose), 0.002, rand)));

function library(rand) { return { 子: rec('open', rand), 丑: rec('fist', rand), 寅: rec('point', rand), 卯: rec('peace', rand) }; }

test('recognises each recorded seal under noise, in any position and rotation', () => {
  const rand = rng(3), lib = library(rand);
  const names = { open: '子', fist: '丑', point: '寅', peace: '卯' };
  let ok = 0, total = 0;
  for (const [pose, seal] of Object.entries(names)) for (let i = 0; i < 15; i++) {
    const s = sampleFromHands(null, jitter(h(pose, 1, { yaw: rand() * 6, pitch: rand() * 3, roll: rand() * 6, at: [rand(), rand(), rand()] }), 0.003, rand));
    total++; if (bestMatch(s, lib).seal === seal) ok++;
  }
  assert.equal(ok, total);
});

test('something that is not a recorded seal is rejected', () => {
  const rand = rng(5), lib = library(rand);
  const s = sampleFromHands(null, h('rock'));
  const r = bestMatch(s, lib);
  assert.equal(r.seal, null);
  assert.ok(r.dist > BASE_THRESHOLD, `dist ${r.dist}`);
});

test('no hand / empty library are reported, not thrown', () => {
  assert.equal(bestMatch(null, {}).reason, 'nohand');
  assert.equal(bestMatch(sampleFromHands(null, h('open')), {}).reason, 'nosamples');
});

test('sensitivity widens or narrows the accepted distance', () => {
  const rand = rng(9), lib = library(rand);
  const sloppy = sampleFromHands(null, jitter(h('fist'), 0.012, rand)); // ~1.2 cm of jitter
  const strict = bestMatch(sloppy, lib, { sensitivity: 0.3 });
  const loose = bestMatch(sloppy, lib, { sensitivity: 2 });
  assert.equal(strict.seal, null);
  assert.equal(loose.seal, '丑');
});

test('ambiguous matches (two seals about equally close) are refused', () => {
  const rand = rng(11);
  const same = rec('open', rand);
  const lib = { 子: same, 丑: same }; // two seals recorded identically
  const r = bestMatch(sampleFromHands(null, h('open')), lib);
  assert.equal(r.seal, null); assert.equal(r.reason, 'ambiguous');
});

test('StableMatch needs the candidate to hold, and resets on change', () => {
  const m = new StableMatch(100);
  assert.equal(m.update('巳', 0), null);
  assert.equal(m.update('巳', 99), null);
  assert.equal(m.update('巳', 100), '巳');
  assert.equal(m.update('午', 150), null);
  assert.equal(m.update(null, 160), null);
  assert.equal(m.update('午', 170), null);
});

test('SealEvents: same seal repeats only after 2 s, or after release following a completion', () => {
  const e = new SealEvents();
  assert.equal(e.update('子', 0), '子');
  assert.equal(e.update('子', 1000), null);
  assert.equal(e.update('子', 2100), '子');
  e.completed();
  assert.equal(e.update(null, 2200), null);
  assert.equal(e.update(null, 2600), null); // release held 300ms re-arms
  assert.equal(e.update('子', 2650), '子');
});

test('completedTechnique picks the longest suffix match; default jutsu are valid', () => {
  assert.ok(validTechniques(DEFAULT_TECHNIQUES));
  const hist = ['子', '巳', '辰', '卯', '寅'];
  assert.equal(completedTechnique(hist, DEFAULT_TECHNIQUES)?.name, '火遁・龍火');
  assert.equal(completedTechnique(['巳', '辰'], DEFAULT_TECHNIQUES), null);
  const long = ['巳', '未', '申', '亥', '午', '寅'];
  assert.equal(completedTechnique(long, DEFAULT_TECHNIQUES)?.name, '火遁·豪火球');
});

test('techniqueDuration measures only the matched suffix', () => {
  assert.equal(techniqueDuration([0, 500, 900, 1500, 2300], 3), 1400); // 2300 - 900
  assert.throws(() => techniqueDuration([1, 2], 3));
});

test('mergeTechniques keeps existing names', () => {
  const r = mergeTechniques([{ name: 'a', seals: ['子'] }], [{ name: 'a', seals: ['丑'] }, { name: 'b', seals: ['丑'] }]);
  assert.deepEqual(r.added, ['b']); assert.deepEqual(r.skipped, ['a']);
});
