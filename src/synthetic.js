// Synthetic 25-joint hands, for unit tests and the desktop preview (no headset needed).
// Not anatomically exact: only self-consistent and sensitive to finger curl / hand arrangement.

const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];

/**
 * Hand in its local frame: wrist at the origin, fingers along +y, palm faces -z.
 * curl: [thumb, index, middle, ring, pinky], 0 (straight) .. 1.6 (fully curled), radians-ish.
 */
export function localHand(curl = [0, 0, 0, 0, 0], spread = 0.12, side = 1) {
  const pts = [[0, 0, 0]];
  // thumb: 4 joints, base to the side of the palm
  {
    const base = [0.035 * side, 0.02, 0];
    const dirAngle = 0.7; // from +y toward +x (outward)
    const c = curl[0];
    let p = base; pts.push(p);
    for (const [len, k] of [[0.04, 0.5], [0.032, 1.0], [0.025, 0.8]]) {
      const a = dirAngle * (1 - 0.6 * c);
      const d = [Math.sin(a) * side, Math.cos(a), 0];
      const bent = rotX(d, -c * k * 1.1);
      p = [p[0] + bent[0] * len, p[1] + bent[1] * len, p[2] + bent[2] * len];
      pts.push(p);
    }
  }
  // four fingers: metacarpal, proximal, intermediate, distal, tip
  const xs = [0.025, 0.008, -0.01, -0.027];
  const lens = [[0.075, 0.095, 0.085, 0.065], [0.045, 0.045, 0.04, 0.03]];
  for (let f = 0; f < 4; f++) {
    const c = curl[f + 1];
    const x = xs[f] * side;
    const knuckleY = [0.083, 0.088, 0.083, 0.073][f];
    const segs = [0.045, 0.026, 0.02];
    const fan = (1.5 - f) * spread * side * 0.5; // finger spread angle about z
    pts.push([x, 0.02, 0]); // metacarpal near the wrist
    let p = [x, knuckleY, 0];
    pts.push(p);
    let angle = 0;
    for (let s = 0; s < 3; s++) {
      angle += c * [0.9, 0.9, 0.6][s];
      let d = [0, Math.cos(angle), -Math.sin(angle)];
      d = rotZ(d, -fan);
      p = [p[0] + d[0] * segs[s], p[1] + d[1] * segs[s], p[2] + d[2] * segs[s]];
      pts.push(p);
    }
  }
  void lens;
  return pts;
}

/** Apply a rigid transform (yaw, pitch, roll, then translate) to a hand. */
export function place(pts, { yaw = 0, pitch = 0, roll = 0, at = [0, 0, 0], scale = 1 } = {}) {
  return pts.map((p) => {
    let q = [p[0] * scale, p[1] * scale, p[2] * scale];
    q = rotZ(rotX(rotY(q, yaw), pitch), roll);
    return [q[0] + at[0], q[1] + at[1], q[2] + at[2]];
  });
}

export const POSES = {
  open: [0, 0, 0, 0, 0],
  fist: [1.1, 1.5, 1.5, 1.5, 1.5],
  point: [1.0, 0, 1.5, 1.5, 1.5],
  peace: [1.0, 0, 0, 1.5, 1.5],
  pinch: [0.5, 0.9, 0.2, 0.1, 0.1],
  thumbsup: [0, 1.5, 1.5, 1.5, 1.5],
  rock: [0, 0, 1.5, 1.5, 0],
};

/** A two-hand arrangement: right hand placed relative to the left in some interlocked way. */
export function twoHands(poseL, poseR, rel = {}) {
  const left = place(localHand(poseL, 0.12, -1), { at: [-0.05, 0, 0] });
  const right = place(localHand(poseR, 0.12, 1), { yaw: Math.PI, ...rel, at: rel.at ?? [0.05, 0.0, 0.0] });
  return { left, right };
}

/** Tiny deterministic PRNG so tests are repeatable. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function jitter(pts, sigma, rand) {
  const g = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return (u - 3) * 0.7071; };
  return pts.map((p) => [p[0] + g() * sigma, p[1] + g() * sigma, p[2] + g() * sigma]);
}
