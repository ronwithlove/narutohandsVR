import * as THREE from 'three';
import { JOINT_NAMES, JOINT_COUNT, sampleFromHands } from './features.js';
import { bestMatch, StableMatch, SealEvents, completedTechnique, techniqueDuration, mergeTechniques, validTechniques } from './matcher.js';
import * as store from './store.js';
import { getLanguage, setLanguage, translate, compactSeal, jutsuLabel } from './i18n.js';
import { createPanel, PANEL_W, PANEL_H } from './panel.js';
import { Particles, FloatingText } from './effects.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- app state (mirrors the original seal page)
let page = 'practice';                    // 'practice' | 'record' | 'compose'
let mode = 'idle';                        // 'idle' | 'countdown' | 'recording' | 'practice' | 'sequence-practice'
let practiceScope = 'current';
let selected = '子';
let library = store.loadLibrary();
let techniques = store.loadTechniques();
let sensitivity = store.loadSensitivity();
let draft = [], history = [], historyTimes = [], captured = [];
let phaseStart = 0, lastCapture = 0, lastDebugAt = 0;
let xrActive = false, testInput = false;  // testInput: lets tests / desktop preview act as if hands were available
let instruction = '', result = '', success = false, saved = '', seqStatus = '等待开始', message = '', speed = '', count = '', debug = '';
let lastSeal = null, lastSealUntil = 0, shownSeal = null;
let shownHistory = [], shownMatched = 0;       // what the panel shows; internal `history` is cleared when a jutsu completes
let panelDirty = true, lastPanelDraw = 0, hoverId = null;
let curHands = { left: null, right: null };
const recognizer = new StableMatch(150);
const events = new SealEvents();

const canStart = () => xrActive || testInput;
const busy = () => mode === 'countdown' || mode === 'recording';

// ---------------------------------------------------------------- three.js scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
const scene = new THREE.Scene();
const BG = new THREE.Color('#10151d');
scene.background = BG;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 50);
const DESKTOP_CAM = new THREE.Vector3(0, 1.4, -0.55);
camera.position.copy(DESKTOP_CAM);
camera.lookAt(0, 1.4, -2);
scene.add(new THREE.GridHelper(8, 16, 0x2a3646, 0x1b2430));

const sheet = new Image();
sheet.src = 'assets/seals-mirrored.png';
const panel = createPanel(sheet);
const panelTex = new THREE.CanvasTexture(panel.canvas);
panelTex.colorSpace = THREE.SRGBColorSpace; panelTex.anisotropy = 8;
const PANEL_M = 1.5; // metres wide
const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_M, PANEL_M * PANEL_H / PANEL_W), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }));
panelMesh.position.set(0, 1.4, -1.5);
scene.add(panelMesh);

const particles = new Particles(scene);
const floatText = new FloatingText(scene);

// hands: 25 joint dots + bones per hand
const HAND_COLOR = { left: 0x81d0ff, right: 0xff9db0 };
const CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8, 9], [0, 10, 11, 12, 13, 14], [0, 15, 16, 17, 18, 19], [0, 20, 21, 22, 23, 24]];
function makeHandVisual(color) {
  const group = new THREE.Group();
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0085, 8, 6), new THREE.MeshBasicMaterial({ color }), JOINT_COUNT);
  dots.frustumCulled = false;
  const segs = CHAINS.flatMap((c) => c.slice(1).map((j, i) => [c[i], j]));
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs.length * 6), 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color }));
  lines.frustumCulled = false;
  group.add(dots, lines); group.visible = false; scene.add(group);
  return { group, dots, lines, segs };
}
const handVisual = { left: makeHandVisual(HAND_COLOR.left), right: makeHandVisual(HAND_COLOR.right) };
const tmpM = new THREE.Matrix4();
function showHand(side, pts) {
  const v = handVisual[side];
  v.group.visible = !!pts;
  if (!pts) return;
  pts.forEach((p, i) => { tmpM.makeTranslation(p[0], p[1], p[2]); v.dots.setMatrixAt(i, tmpM); });
  v.dots.instanceMatrix.needsUpdate = true;
  const arr = v.lines.geometry.attributes.position.array;
  v.segs.forEach(([a, b], i) => { arr.set(pts[a], i * 6); arr.set(pts[b], i * 6 + 3); });
  v.lines.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- viewer pose / placement
const viewer = { pos: new THREE.Vector3().copy(DESKTOP_CAM), fwd: new THREE.Vector3(0, 0, -1) };
let needPlace = false;
function placePanelInFront() {
  const f = viewer.fwd.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  panelMesh.position.set(viewer.pos.x + f.x * 1.5, viewer.pos.y - 0.08, viewer.pos.z + f.z * 1.5);
  panelMesh.rotation.set(0, Math.atan2(viewer.pos.x - panelMesh.position.x, viewer.pos.z - panelMesh.position.z), 0);
}
function resetDesktopView() { panelMesh.position.set(0, 1.4, -1.5); panelMesh.rotation.set(0, 0, 0); viewer.pos.copy(DESKTOP_CAM); viewer.fwd.set(0, 0, -1); }

// ---------------------------------------------------------------- messages (source strings are Chinese; translate() at draw time)
function clearRecognition() { recognizer.reset(); shownSeal = null; floatText.hide(); }
function selectSeal(seal) {
  selected = seal; mode = 'idle'; clearRecognition();
  instruction = canStart() ? `准备好后录制「${seal}」。` : '请先进入 VR，戴上头显后即可录制。';
  result = library[seal] ? '已录制，可以练习' : '等待录制'; success = false;
  saved = library[seal] ? `已加载「${seal}」的录制` : '';
  dirty();
}
selectSeal(selected);

function startRecord(now) {
  if (!canStart() || busy()) return;
  captured = []; clearRecognition(); mode = 'countdown'; phaseStart = now; lastCapture = 0;
  result = '准备录制'; success = false; instruction = '准备：倒数结束后开始录制。'; saved = '';
}
function tick(now) {
  const elapsed = now - phaseStart;
  if (mode === 'countdown') {
    count = String(Math.max(1, 3 - Math.floor(elapsed / 1000)));
    if (elapsed >= 3000) { mode = 'recording'; phaseStart = now; instruction = '正在录制：保持结印，缓慢调整角度。'; }
  } else if (mode === 'recording') {
    count = `录制 ${Math.max(1, 5 - Math.floor(elapsed / 1000))}`;
    if (elapsed >= 5000) finishRecording();
  }
  dirty();
}
function finishRecording() {
  mode = 'idle'; count = '';
  if (!captured.length) { instruction = '没有识别到手，未保存录制。请调整角度后重试。'; result = '录制未完成'; return; }
  library[selected] = captured;
  saved = store.saveLibrary(library) ? `已保存「${selected}」` : '浏览器无法保存，本次关闭页面后录制会丢失。';
  instruction = captured.length < 10 ? `录制完成，但只识别到 ${captured.length} 帧，建议重新录制。` : '录制完成！选择一种练习方式，再摆出结印。';
  result = '录制完成'; success = false;
}
function startPractice(scope) {
  if (!canStart()) { instruction = '请先进入 VR（需要手部追踪）。'; return; }
  practiceScope = scope; mode = 'practice'; clearRecognition();
  result = '请摆出结印'; success = false;
  instruction = scope === 'current' ? `正在验证「${selected}」，保持片刻。` : '正在识别全部已录结印，摆出任意一个并保持片刻。';
}

// ---- sequence practice (ported from the original) ----
function startSequencePractice() {
  if (!canStart()) { seqStatus = '请先进入 VR（需要手部追踪）。'; return; }
  if (!Object.keys(library).length) { seqStatus = '请先在手势录制中录入单个手势。'; return; }
  if (!techniques.length) { seqStatus = '请先在忍术录入中保存一个顺序。'; return; }
  history = []; historyTimes = []; shownHistory = []; shownMatched = 0; speed = ''; mode = 'sequence-practice'; clearRecognition(); events.reset(); seqStatus = '正在识别，请按顺序结印。';
}
function endSequencePractice() { mode = 'idle'; recognizer.reset(); events.reset(); history = []; historyTimes = []; shownHistory = []; shownMatched = 0; speed = ''; floatText.hide(); seqStatus = '练习已结束'; }

function effectAnchor() {
  const f = viewer.fwd.clone(); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  const textPos = viewer.pos.clone().addScaledVector(f, 0.9); textPos.y += 0.14;
  const wrists = ['left', 'right'].map((s) => curHands[s]?.[0]).filter(Boolean);
  const origin = wrists.length
    ? new THREE.Vector3(...wrists.reduce((a, w) => [a[0] + w[0] / wrists.length, a[1] + w[1] / wrists.length, a[2] + w[2] / wrists.length], [0, 0, 0]))
    : viewer.pos.clone().addScaledVector(f, 0.6).add(new THREE.Vector3(0, -0.2, 0));
  const dir = f.clone(); dir.y = 0.15; dir.normalize();
  return { textPos, origin, dir };
}
function announceSeal(seal, now) {
  const { textPos, origin, dir } = effectAnchor();
  const en = getLanguage() === 'en';
  floatText.show({ title: compactSeal(seal), subtitle: en ? seal : '' }, textPos, now, 1000);
  particles.seal(origin, dir, seal);
  lastSeal = seal; lastSealUntil = now + 1000;
}
function announceJutsu(tech, seconds, now) {
  const { textPos, origin, dir } = effectAnchor();
  floatText.show({ title: jutsuLabel(tech.name), subtitle: translate(`手速 ${seconds} 秒`), color: '#ffe9a8', glow: '#ff7a1a' }, textPos, now, 2500);
  particles.jutsu(origin, dir, tech.name);
}

/** Returns true when something the panel shows has changed. */
function processSequence(sample, now) {
  let changed = false;
  const r = sample ? bestMatch(sample, library, { sensitivity }) : null;
  const confirmed = recognizer.update(r?.seal ?? null, now);
  const event = events.update(confirmed, now);
  if (event) {
    changed = true;
    history.push(event); history = history.slice(-50); historyTimes.push(now); historyTimes = historyTimes.slice(-50);
    const found = completedTechnique(history, techniques);
    shownHistory = [...history]; shownMatched = found?.seals.length ?? 0;
    if (found) {
      const secs = (techniqueDuration(historyTimes, found.seals.length) / 1000).toFixed(2);
      seqStatus = `✓ ${found.name}`; speed = `手速 ${secs} 秒`;
      events.completed(); announceJutsu(found, secs, now);
      history = []; historyTimes = [];
    } else {
      seqStatus = `识别到「${event}」`; announceSeal(event, now);
    }
  }
  if (lastSealUntil && now >= lastSealUntil) { lastSeal = null; lastSealUntil = 0; changed = true; }
  return changed;
}

// ---------------------------------------------------------------- per-frame hand handling
function handleHands(left, right, now) {
  curHands = { left, right };
  showHand('left', left); showHand('right', right);
  const sample = sampleFromHands(left, right);
  if (busy()) tick(now);
  if (mode === 'recording' && sample && now - lastCapture >= 80 && captured.length < 400) { captured.push(store.packSample(sample)); lastCapture = now; }
  if (mode === 'practice') {
    const r = sample ? bestMatch(sample, library, { sensitivity, only: practiceScope === 'current' ? selected : null }) : null;
    const confirmed = recognizer.update(r?.seal ?? null, now);
    if (confirmed && confirmed !== shownSeal) announceSeal(confirmed, now);
    shownSeal = confirmed;
    success = Boolean(confirmed);
    result = confirmed ? `✓ ${confirmed}` : !sample ? '请让双手出现在画面中' : r?.seal ? '保持住…' : '调整一下姿势';
    if (lastSealUntil && now >= lastSealUntil) { lastSeal = null; lastSealUntil = 0; }
    dirty();
  }
  if (mode === 'sequence-practice' && processSequence(sample, now)) dirty();
  // live debug line: what is the nearest seal and how far is it (helps tune sensitivity on a real headset)
  if (page !== 'compose' && now - lastDebugAt > 200) {
    lastDebugAt = now;
    const r = sample && Object.keys(library).length ? bestMatch(sample, library, { sensitivity }) : null;
    const next = r ? `${r.nearest ?? '-'}  d=${Number.isFinite(r.dist) ? r.dist.toFixed(3) : '-'}  thr=${r.threshold.toFixed(3)}  ${r.reason}` : sample ? `${sample.key}` : '';
    if (next !== debug) { debug = next; dirty(); }
  }
}

// ---------------------------------------------------------------- reading the headset's hands
const poseBuf = new Float32Array(JOINT_COUNT * 16);
function readXRHands(frame, refSpace, session) {
  const out = { left: null, right: null };
  for (const src of session.inputSources) {
    if (!src.hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
    const spaces = JOINT_NAMES.map((n) => src.hand.get(n));
    if (spaces.some((s) => !s)) continue;
    let pts = null;
    if (frame.fillPoses && frame.fillPoses(spaces, refSpace, poseBuf)) {
      pts = Array.from({ length: JOINT_COUNT }, (_, i) => [poseBuf[i * 16 + 12], poseBuf[i * 16 + 13], poseBuf[i * 16 + 14]]);
    } else {
      pts = [];
      for (const s of spaces) { const p = frame.getJointPose(s, refSpace); if (!p) { pts = null; break; } pts.push([p.transform.position.x, p.transform.position.y, p.transform.position.z]); }
    }
    if (pts) out[src.handedness] = pts;
  }
  return out;
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Both hands close together: the player is forming a seal, so hand-pinch "clicks" must be ignored. */
const sealing = () => curHands.left && curHands.right && dist3(curHands.left[0], curHands.right[0]) < 0.45;

// ---------------------------------------------------------------- UI actions
function switchPage(next) {
  page = next; mode = 'idle'; clearRecognition(); events.reset(); history = []; historyTimes = []; shownHistory = []; shownMatched = 0; speed = ''; count = ''; lastSeal = null; message = '';
  if (page === 'record') selectSeal(selected);
  seqStatus = '等待开始';
  if (page === 'practice' && canStart()) startSequencePractice();
}
function autoName() { let n = techniques.length + 1; while (techniques.some((t) => t.name === `忍术 ${n}`)) n++; return `忍术 ${n}`; }
function saveTechnique() {
  const input = $('technique-name'); const name = (input.value.trim() || autoName());
  if (!draft.length) { message = '请先录入结印顺序。'; return; }
  if (techniques.length >= 200) { message = '已达到保存数量上限。'; return; }
  if (techniques.some((t) => t.name === name)) { message = '这个名称已存在，请换一个名称。'; return; }
  if (techniques.some((t) => t.seals.length === draft.length && t.seals.every((s, i) => s === draft[i]))) { message = '这个结印顺序已存在，请调整顺序。'; return; }
  const next = [...techniques, { name, seals: [...draft] }];
  if (!store.saveTechniques(next)) { message = '保存失败，请检查浏览器存储空间。'; return; }
  techniques = next; draft = []; input.value = ''; message = `已保存「${name}」。`;
}
function press(id, now = performance.now()) {
  if (id.startsWith('tab:')) switchPage(id.slice(4));
  else if (id === 'lang:zh' || id === 'lang:en') { setLanguage(id.slice(5)); applyDomLanguage(); }
  else if (id === 'recenter') placePanelInFront();
  else if (id.startsWith('seal:')) selectSeal(id.slice(5));
  else if (id.startsWith('add:')) { if (draft.length >= 50) message = '每个顺序最多添加 50 个结印。'; else { draft.push(id.slice(4)); message = ''; } }
  else if (id === 'record') startRecord(now);
  else if (id === 'practice') startPractice('current');
  else if (id === 'practice-all') startPractice('all');
  else if (id === 'clear-selected') { delete library[selected]; store.saveLibrary(library); selectSeal(selected); saved = '已清除'; }
  else if (id === 'sens-' || id === 'sens+') { sensitivity = Math.min(2.5, Math.max(0.4, Math.round((sensitivity + (id === 'sens+' ? 0.1 : -0.1)) * 10) / 10)); store.saveSensitivity(sensitivity); }
  else if (id === 'draft-undo') draft.pop();
  else if (id === 'draft-clear') draft = [];
  else if (id === 'technique-save') saveTechnique();
  else if (id === 'sequence-practice') { if (mode !== 'sequence-practice') startSequencePractice(); else endSequencePractice(); }
  dirty();
}

// ---------------------------------------------------------------- panel drawing
function dirty() { panelDirty = true; }
function panelState() {
  const rec = new Set(Object.keys(library));
  return {
    page, lang: getLanguage(), hover: hoverId, selected, recorded: rec, busy: busy(),
    selectedLine: `当前：${selected}`, instruction, result, success, saved, count, sensitivity, debug,
    canRecord: canStart() && !busy() && mode !== 'sequence-practice', canPracticeCurrent: canStart() && !busy() && rec.has(selected), canPracticeAll: canStart() && !busy() && rec.size > 0,
    draft, techniques, history: shownHistory, matchedCount: shownMatched, seqStatus, seqActive: mode === 'sequence-practice', speed, message, lastSeal,
  };
}
function redrawPanel(force = false, now = performance.now()) {
  if (!force && (!panelDirty || now - lastPanelDraw < 90)) return;
  panel.draw(panelState()); panelTex.needsUpdate = true; panelDirty = false; lastPanelDraw = now;
}
sheet.onload = dirty;

// ---------------------------------------------------------------- pointing: VR controllers / hand rays, and the mouse on desktop
const raycaster = new THREE.Raycaster();
const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe3a8 }));
cursor.visible = false; scene.add(cursor);
function pick(ray) {
  raycaster.ray.copy(ray);
  const hit = raycaster.intersectObject(panelMesh, false)[0];
  if (!hit || !hit.uv) return null;
  const px = hit.uv.x * PANEL_W, py = (1 - hit.uv.y) * PANEL_H;
  return { id: panel.hit(px, py), point: hit.point, distance: hit.distance };
}
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xf5bb5a }));
  line.visible = false; c.add(line); c.userData.line = line; scene.add(c);
  c.addEventListener('connected', (e) => { c.userData.src = e.data; });
  c.addEventListener('disconnected', () => { c.userData.src = null; line.visible = false; });
  c.addEventListener('selectstart', () => {
    if (c.userData.src?.hand && sealing()) return; // pinching while making a seal is not a click
    const ray = controllerRay(c); const h = pick(ray);
    if (h?.id) press(h.id);
  });
  return c;
});
const _m = new THREE.Matrix4();
function controllerRay(c) {
  _m.identity().extractRotation(c.matrixWorld);
  return new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(_m));
}
function updatePointers() {
  let hover = null, cur = null;
  if (xrActive) {
    for (const c of controllers) {
      const src = c.userData.src;
      if (!src || (src.hand && sealing())) { c.userData.line.visible = false; continue; }
      const h = pick(controllerRay(c));
      c.userData.line.visible = true; c.userData.line.scale.z = h ? h.distance : 1.2;
      if (h && !cur) { cur = h.point; hover = h.id; }
    }
  } else if (mouse.inside) {
    raycaster.setFromCamera(mouse.ndc, camera);
    const h = pick(raycaster.ray);
    if (h) { cur = h.point; hover = h.id; }
  }
  cursor.visible = !!cur; if (cur) cursor.position.copy(cur);
  if (hover !== hoverId) { hoverId = hover; dirty(); }
}
const mouse = { ndc: new THREE.Vector2(), inside: false };
function mouseToNdc(e) { const r = canvas.getBoundingClientRect(); mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); }
canvas.addEventListener('pointermove', (e) => { mouse.inside = true; mouseToNdc(e); });
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('click', (e) => {
  if (xrActive) return;
  mouseToNdc(e); raycaster.setFromCamera(mouse.ndc, camera);
  const h = pick(raycaster.ray); if (h?.id) press(h.id);
});

// ---------------------------------------------------------------- entering VR / AR
async function enterXR(kind) {
  const status = $('xr-status');
  try {
    renderer.xr.setReferenceSpaceType('local-floor');
    const session = await navigator.xr.requestSession(kind, { optionalFeatures: ['hand-tracking', 'local-floor'] });
    scene.background = kind === 'immersive-ar' ? null : BG;
    renderer.setClearAlpha(kind === 'immersive-ar' ? 0 : 1);
    session.addEventListener('end', () => { xrActive = false; scene.background = BG; renderer.setClearAlpha(1); resetDesktopView(); showHand('left', null); showHand('right', null); mode = 'idle'; selectSeal(selected); seqStatus = '等待开始'; dirty(); status.textContent = ''; });
    await renderer.xr.setSession(session);
    xrActive = true; needPlace = true;
    if (page === 'practice') startSequencePractice(); else selectSeal(selected);
    dirty();
  } catch (e) { status.textContent = `${e.name}: ${e.message}`; }
}
async function setupXRButtons() {
  const vr = $('enter-vr'), ar = $('enter-ar'), status = $('xr-status');
  const supported = async (m) => { try { return await navigator.xr.isSessionSupported(m); } catch { return false; } };
  if (!navigator.xr) { status.textContent = translate('当前设备不支持 WebXR，可在桌面预览界面，用鼠标点击操作。'); return; }
  vr.disabled = !(await supported('immersive-vr')); ar.disabled = !(await supported('immersive-ar'));
  if (vr.disabled && ar.disabled) status.textContent = translate('当前设备不支持 WebXR，可在桌面预览界面，用鼠标点击操作。');
  vr.onclick = () => enterXR('immersive-vr'); ar.onclick = () => enterXR('immersive-ar');
}

// ---------------------------------------------------------------- render loop
let lastTime = 0;
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(0.1, (time - lastTime) / 1000 || 0.016); lastTime = time;
  if (frame && xrActive) {
    const session = renderer.xr.getSession(), ref = renderer.xr.getReferenceSpace();
    const vp = frame.getViewerPose(ref);
    if (vp) {
      const t = vp.transform;
      viewer.pos.set(t.position.x, t.position.y, t.position.z);
      viewer.fwd.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w));
      if (needPlace) { placePanelInFront(); needPlace = false; }
    }
    const h = readXRHands(frame, ref, session);
    handleHands(h.left, h.right, time);
  }
  updatePointers();
  particles.update(dt); floatText.update(time);
  redrawPanel(false, time);
  renderer.render(scene, camera);
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  if (renderer.xr.isPresenting) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- 2D page: language, import / export
function applyDomLanguage() {
  document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.dataset.src ??= el.textContent.trim(); el.textContent = translate(el.dataset.src); });
  const input = $('technique-name'); input.placeholder = getLanguage() === 'en' ? 'e.g. Fire Style: Flame Dragon' : '例如：火遁·炎龙之术';
  document.title = translate('忍术练习 VR'); dirty();
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const toolStatus = (s) => { $('tools-status').textContent = translate(s); };
$('export-seals').onclick = () => { download('naruto-vr-seals.json', store.exportPayload(library, techniques)); toolStatus(`已导出 ${Object.keys(library).length} 个结印。`); };
$('export-jutsu').onclick = () => { download('naruto-vr-jutsu.json', { format: 'naruto-vr-seals', version: 1, seals: {}, techniques }); toolStatus(`已导出 ${techniques.length} 个忍术。`); };
const fileInput = $('import-file');
$('import').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  try {
    if (file.size > 30_000_000) throw new Error('文件太大');
    const payload = JSON.parse(await file.text());
    const imported = store.parseLibrary(payload);
    const incoming = payload.techniques ?? [];
    if (!validTechniques(incoming)) throw new Error('连招数据无效');
    const tm = mergeTechniques(techniques, incoming), sm = store.mergeMissing(library, imported);
    if (!store.saveLibrary(sm.merged)) throw new Error('保存失败，请检查浏览器存储空间。');
    library = sm.merged; if (tm.added.length) { techniques = tm.merged; store.saveTechniques(techniques); }
    selectSeal(selected);
    toolStatus(`${sm.added.length ? `已导入：${sm.added.join('、')}。` : '没有新增结印。'}${sm.skipped.length ? `已保留本机已有的：${sm.skipped.join('、')}。` : ''}${tm.added.length ? `已导入 ${tm.added.length} 个连招。` : ''}`);
  } catch (e) { toolStatus(`导入失败：${e instanceof Error ? e.message : '文件无效'}`); }
  finally { fileInput.value = ''; }
};

// Defaults shipped with the site (data/seals.json): public reference samples; personal recordings win.
(async () => {
  try {
    const res = await fetch(new URL('data/seals.json', document.baseURI)); if (!res.ok) return;
    const defaults = store.parseLibrary(await res.json());
    const { merged, added } = store.mergeMissing(library, defaults);
    if (added.length) { store.saveLibrary(merged); library = merged; selectSeal(selected); }
  } catch { /* the user can still record or import their own seals */ }
})();

applyDomLanguage(); setupXRButtons(); redrawPanel(true);

// Test / desktop-preview hooks (same code path as the headset: handleHands is what the XR loop calls).
window.__vr = {
  enableTest: () => { testInput = true; selectSeal(selected); if (page === 'practice') startSequencePractice(); dirty(); },
  feed: (left, right, t) => { handleHands(left, right, t); },
  press: (id, t = performance.now()) => press(id, t),
  state: () => ({ page, mode, selected, library: Object.fromEntries(Object.entries(library).map(([k, v]) => [k, v.length])), techniques, history, seqStatus, result, instruction, count, saved, debug, lastSeal, sensitivity }),
  redraw: () => redrawPanel(true),
  particlesAlive: () => particles.age.reduce((n, a, i) => n + (a < particles.life[i] ? 1 : 0), 0),
  floatTextVisible: () => floatText.sprite.visible,
  hitIds: () => panel.hits.map((h) => h.id),
};
