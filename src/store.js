import { KEY_LENGTH } from './features.js';
import { SEALS, validTechniques, mergeTechniques, DEFAULT_TECHNIQUES } from './matcher.js';

export const FORMAT = 'naruto-vr-seals';
const SEAL_KEY = 'naruto-vr-seals-v1';
const TECH_KEY = 'naruto-vr-techniques-v1';
const SENS_KEY = 'naruto-vr-sensitivity-v1';

const round = (n) => Math.round(n * 1000) / 1000;

export function validSamples(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 400 && value.every((s) => s && typeof s === 'object' && KEY_LENGTH[s.key] === (s.v && s.v.length) && s.v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20));
}

/** Compact a sample for storage (3 decimals is far below tracking noise). */
export function packSample(s) { return { key: s.key, v: s.v.map(round) }; }

export function parseLibrary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件格式无效');
  if (value.format !== FORMAT || value.version !== 1 || !value.seals || typeof value.seals !== 'object' || Array.isArray(value.seals)) throw new Error('文件格式或版本不受支持');
  const result = {};
  for (const [name, samples] of Object.entries(value.seals)) {
    if (!SEALS.includes(name) || !validSamples(samples)) throw new Error('文件中包含无效的结印数据');
    result[name] = samples;
  }
  return result;
}

export function mergeMissing(current, imported) {
  const merged = { ...current }, added = [], skipped = [];
  for (const [name, samples] of Object.entries(imported)) {
    if (merged[name]) skipped.push(name); else { merged[name] = samples; added.push(name); }
  }
  return { merged, added, skipped };
}

export function exportPayload(library, techniques) { return { format: FORMAT, version: 1, seals: library, techniques }; }

// ---- localStorage wrappers (every access can throw in private windows / blocked storage) ----
const get = (k) => { try { return JSON.parse(globalThis.localStorage.getItem(k) || 'null'); } catch { return null; } };
const set = (k, v) => { try { globalThis.localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export function loadLibrary() {
  const saved = get(SEAL_KEY), library = {};
  if (saved && typeof saved === 'object') for (const s of SEALS) if (validSamples(saved[s])) library[s] = saved[s];
  return library;
}
export const saveLibrary = (library) => set(SEAL_KEY, library);

export function loadTechniques() {
  const saved = get(TECH_KEY);
  const base = validTechniques(saved) ? saved : [];
  return mergeTechniques(base, DEFAULT_TECHNIQUES).merged;
}
export const saveTechniques = (techniques) => set(TECH_KEY, techniques);

export const loadSensitivity = () => { const v = Number(get(SENS_KEY)); return v >= 0.4 && v <= 2.5 ? v : 1; };
export const saveSensitivity = (v) => set(SENS_KEY, v);
