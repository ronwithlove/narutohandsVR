import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLibrary, mergeMissing, packSample, validSamples, exportPayload, FORMAT } from '../src/store.js';
import { sampleFromHands } from '../src/features.js';
import { localHand, place, POSES } from '../src/synthetic.js';

const sample = () => packSample(sampleFromHands(null, place(localHand(POSES.fist))));

test('export then parse round-trips', () => {
  const lib = { 巳: [sample(), sample()] };
  const back = parseLibrary(JSON.parse(JSON.stringify(exportPayload(lib, []))));
  assert.deepEqual(Object.keys(back), ['巳']); assert.equal(back.巳.length, 2);
});

test('rejects wrong format, unknown seals and malformed samples', () => {
  assert.throws(() => parseLibrary({ format: 'x', version: 1, seals: {} }));
  assert.throws(() => parseLibrary({ format: FORMAT, version: 1, seals: { 猫: [sample()] } }));
  assert.throws(() => parseLibrary({ format: FORMAT, version: 1, seals: { 子: [{ key: 'L', v: [1, 2, 3] }] } }));
  assert.ok(!validSamples([{ key: 'L', v: Array(72).fill(Infinity) }]));
  assert.ok(!validSamples([]));
});

test('mergeMissing never overwrites existing seals', () => {
  const a = [sample()], b = [sample(), sample()];
  const r = mergeMissing({ 子: a }, { 子: b, 丑: b });
  assert.equal(r.merged.子, a); assert.deepEqual(r.added, ['丑']); assert.deepEqual(r.skipped, ['子']);
});

test('stored samples are compact (3 decimals)', () => {
  assert.ok(sample().v.every((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6));
});
