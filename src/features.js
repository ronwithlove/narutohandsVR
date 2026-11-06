// Hand features computed from the 25 WebXR hand joints.
//
// Design goal: a pose should look the same no matter where the hands are, how they are
// rotated, or how big they are. So every hand is re-expressed in its own palm frame and
// divided by its own size. Two-hand seals (most of them) additionally store where hand R is
// in hand L's frame, which is what actually distinguishes interlocked fingers.

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
export const J = { WRIST: 0, INDEX_KNUCKLE: 6, INDEX_TIP: 9, MIDDLE_KNUCKLE: 11, PINKY_KNUCKLE: 21 };
export const JOINT_COUNT = 25;
// Vector lengths per sample key.
export const KEY_LENGTH = { L: 72, R: 72, LR: 72 + 72 + 75 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : null; };

/** Palm frame of a hand: origin at the wrist, `up` toward the middle knuckle, `normal` out of the palm plane. */
export function palmFrame(p) {
  if (!p || p.length !== JOINT_COUNT) return null;
  for (const q of p) if (!q || !q.every(Number.isFinite)) return null;
  const origin = p[J.WRIST];
  const along = sub(p[J.MIDDLE_KNUCKLE], origin);
  const size = norm(along);
  if (size < 0.03 || size > 0.3) return null; // not a plausible hand: tracking glitch
  const up = unit(along);
  const across = sub(p[J.INDEX_KNUCKLE], p[J.PINKY_KNUCKLE]);
  const normal = unit(cross(up, across));
  if (!normal) return null;
  const side = cross(normal, up);
  return { origin, up, side, normal, size };
}

function toFrame(frame, point) {
  const d = sub(point, frame.origin);
  return [dot(d, frame.up) / frame.size, dot(d, frame.side) / frame.size, dot(d, frame.normal) / frame.size];
}

/** 24 non-wrist joints in the hand's own frame, in units of hand size. */
function localBlock(frame, p) {
  const out = [];
  for (let i = 1; i < JOINT_COUNT; i++) out.push(...toFrame(frame, p[i]));
  return out;
}

/**
 * Build a sample from the two hands (each: 25 [x,y,z] points in any shared space, or null).
 * Returns { key: 'L' | 'R' | 'LR', v: number[] } or null if nothing usable.
 */
export function sampleFromHands(left, right) {
  const fl = left ? palmFrame(left) : null;
  const fr = right ? palmFrame(right) : null;
  if (fl && fr) {
    const v = [...localBlock(fl, left), ...localBlock(fr, right)];
    for (let i = 0; i < JOINT_COUNT; i++) v.push(...toFrame(fl, right[i]));
    return { key: 'LR', v };
  }
  if (fl) return { key: 'L', v: localBlock(fl, left) };
  if (fr) return { key: 'R', v: localBlock(fr, right) };
  return null;
}

/** Root-mean-square difference; Infinity when the samples are not comparable. */
export function distance(a, b) {
  if (!a || !b || a.key !== b.key || a.v.length !== b.v.length || !a.v.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.v.length; i++) { const d = a.v[i] - b.v[i]; sum += d * d; }
  return Math.sqrt(sum / a.v.length);
}
