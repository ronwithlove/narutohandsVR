import { distance } from './features.js';

export const SEALS = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

export const DEFAULT_SENSITIVITY = 1;
/** Base accept distance (in hand-size units, RMS over all joint coordinates). Scaled by sensitivity. */
export const BASE_THRESHOLD = 0.22;
/** The best seal must beat the runner-up seal by this ratio, otherwise the match is ambiguous. */
export const AMBIGUITY_RATIO = 0.8;

/**
 * library: { seal: [sample, ...] }, sample = { key, v }.
 * Returns { seal, dist, threshold, reason } where seal is null when nothing is accepted.
 * `dist` / `nearest` are always filled in when there is something comparable, for the debug line.
 */
export function bestMatch(sample, library, { sensitivity = DEFAULT_SENSITIVITY, only = null } = {}) {
  const threshold = BASE_THRESHOLD * sensitivity;
  if (!sample) return { seal: null, dist: Infinity, threshold, reason: 'nohand' };
  const per = [];
  for (const [seal, examples] of Object.entries(library)) {
    if (only && seal !== only) continue;
    let d = Infinity;
    for (const e of examples) { const x = distance(sample, e); if (x < d) d = x; }
    if (d < Infinity) per.push([seal, d]);
  }
  if (!per.length) return { seal: null, dist: Infinity, threshold, reason: 'nosamples' };
  per.sort((a, b) => a[1] - b[1]);
  const [seal, dist] = per[0];
  if (dist > threshold) return { seal: null, dist, nearest: seal, threshold, reason: 'far' };
  if (per.length > 1 && dist > AMBIGUITY_RATIO * per[1][1]) return { seal: null, dist, nearest: seal, threshold, reason: 'ambiguous' };
  return { seal, dist, nearest: seal, threshold, reason: 'ok' };
}

/** A candidate must hold for `holdMs` before it counts. */
export class StableMatch {
  constructor(holdMs = 150) { this.holdMs = holdMs; this.candidate = null; this.since = 0; }
  update(match, now) {
    if (!match) { this.reset(); return null; }
    if (this.candidate !== match) { this.candidate = match; this.since = now; }
    return now - this.since >= this.holdMs ? match : null;
  }
  reset() { this.candidate = null; this.since = 0; }
}

// ---- Jutsu sequences: ported unchanged from the original project's sequence.ts ----

export function validTechniques(value) {
  return Array.isArray(value) && value.length <= 200 && value.every((t) => t && typeof t.name === 'string' && t.name.trim().length > 0 && t.name.length <= 40 && Array.isArray(t.seals) && t.seals.length > 0 && t.seals.length <= 50 && t.seals.every((s) => typeof s === 'string' && SEALS.includes(s)));
}

// A repeated seal is accepted after two seconds; a deliberate release after completion may rearm it sooner.
export class SealEvents {
  constructor() { this.reset(); }
  update(confirmed, now) {
    if (!confirmed) {
      if (this.afterCompletion) {
        if (this.releaseSince === null) this.releaseSince = now;
        if (now - this.releaseSince >= 300) { this.last = null; this.afterCompletion = false; this.releaseSince = null; }
      }
      return null;
    }
    this.releaseSince = null;
    if (confirmed === this.last && now - this.lastAt < 2000) return null;
    this.last = confirmed; this.lastAt = now; this.afterCompletion = false;
    return confirmed;
  }
  completed() { this.afterCompletion = true; this.releaseSince = null; }
  reset() { this.last = null; this.lastAt = 0; this.afterCompletion = false; this.releaseSince = null; }
}

export function completedTechnique(history, techniques) {
  return techniques.filter((t) => t.seals.length <= history.length && t.seals.every((seal, i) => seal === history[history.length - t.seals.length + i])).sort((a, b) => b.seals.length - a.seals.length)[0] ?? null;
}

// Times correspond to accepted gestures; a match may start after unrelated earlier gestures.
export function techniqueDuration(times, length) {
  if (length < 1 || length > times.length) throw new Error('Invalid sequence length');
  return Math.max(0, times[times.length - 1] - times[times.length - length]);
}

export const DEFAULT_TECHNIQUES = [
  { name: '火遁·豪火球', seals: ['巳', '未', '申', '亥', '午', '寅'] },
  { name: '火遁・龍火', seals: ['巳', '辰', '卯', '寅'] },
  { name: '水遁・雨刺鲛', seals: ['未', '戌', '子', '戌', '未'] },
];

export function mergeTechniques(existing, incoming) {
  const merged = [...existing], names = new Set(existing.map((t) => t.name)), added = [], skipped = [];
  for (const technique of incoming) {
    if (names.has(technique.name)) { skipped.push(technique.name); continue; }
    names.add(technique.name); merged.push(technique); added.push(technique.name);
  }
  if (merged.length > 200) throw new Error('忍术数量超过上限');
  return { merged, added, skipped };
}
