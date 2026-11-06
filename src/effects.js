// Particle effects and the floating text that appears when a seal / jutsu is recognised.
import * as THREE from 'three';

const ELEMENTS = {
  fire: { colors: ['#ffef9a', '#ffb03a', '#ff6a1f', '#e03a10'], speed: 0.9, gravity: 0.9, size: 0.05 },
  water: { colors: ['#e0f7ff', '#7fd0ff', '#2f8fff', '#1b5fd6'], speed: 1.0, gravity: -1.6, size: 0.04 },
  lightning: { colors: ['#ffffff', '#cfe9ff', '#8fd0ff', '#c7a6ff'], speed: 2.2, gravity: 0, size: 0.03 },
  wind: { colors: ['#f2fff8', '#bdf5d8', '#7fe0b4'], speed: 0.8, gravity: 0, size: 0.04, swirl: true },
  earth: { colors: ['#e6c590', '#b98a52', '#8a5f35', '#5d3f22'], speed: 0.9, gravity: -2.4, size: 0.05 },
  gold: { colors: ['#fff3b0', '#ffd36b', '#ffb347'], speed: 0.9, gravity: 0, size: 0.045 },
};
const SEAL_ELEMENT = { 子: 'water', 丑: 'earth', 寅: 'wind', 卯: 'wind', 辰: 'earth', 巳: 'fire', 午: 'fire', 未: 'earth', 申: 'lightning', 酉: 'lightning', 戌: 'earth', 亥: 'water' };

export function jutsuElement(name) {
  if (/火/.test(name)) return 'fire';
  if (/水/.test(name)) return 'water';
  if (/雷/.test(name)) return 'lightning';
  if (/风|風/.test(name)) return 'wind';
  if (/土/.test(name)) return 'earth';
  return 'gold';
}

function spriteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Particles {
  constructor(scene, max = 5000) {
    this.max = max; this.next = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max).fill(1);
    this.base = new Float32Array(max * 3); this.grav = new Float32Array(max); this.swirl = new Float32Array(max);
    this.pos.fill(-1000);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.05, map: spriteTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.emitters = [];
    this.tmp = new THREE.Color();
  }

  emit(origin, dir, n, el, { spread = 1, life = 1.0, speed = 1, size } = {}) {
    const e = ELEMENTS[el] ?? ELEMENTS.gold;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), r = Math.random();
      // direction: mostly along `dir`, scattered by `spread`
      const sx = Math.sin(b) * Math.cos(a), sy = Math.sin(b) * Math.sin(a), sz = Math.cos(b);
      const sp = e.speed * speed * (0.4 + r);
      this.vel[i * 3] = (dir.x + sx * spread) * sp; this.vel[i * 3 + 1] = (dir.y + sy * spread) * sp; this.vel[i * 3 + 2] = (dir.z + sz * spread) * sp;
      this.pos[i * 3] = origin.x + sx * 0.03; this.pos[i * 3 + 1] = origin.y + sy * 0.03; this.pos[i * 3 + 2] = origin.z + sz * 0.03;
      this.tmp.set(e.colors[(Math.random() * e.colors.length) | 0]);
      this.base[i * 3] = this.tmp.r; this.base[i * 3 + 1] = this.tmp.g; this.base[i * 3 + 2] = this.tmp.b;
      this.age[i] = 0; this.life[i] = life * (0.6 + Math.random() * 0.8);
      this.grav[i] = e.gravity; this.swirl[i] = e.swirl ? 1 : 0;
    }
    if (size) this.points.material.size = Math.max(this.points.material.size, size);
  }

  /** A small burst for a single recognised seal. */
  seal(origin, dir, seal) { this.emit(origin, dir, 160, SEAL_ELEMENT[seal] ?? 'gold', { spread: 1.0, life: 0.9, speed: 0.8 }); }

  /** A long, travelling blast for a completed jutsu. */
  jutsu(origin, dir, name) {
    const el = jutsuElement(name);
    this.emit(origin, dir, 500, el, { spread: 1.2, life: 1.3, speed: 1.2 });
    this.emitters.push({ origin: origin.clone(), dir: dir.clone(), el, t: 0, dur: 1.8 });
  }

  update(dt) {
    for (const em of this.emitters) {
      em.t += dt;
      const pos = em.origin.clone().addScaledVector(em.dir, em.t * 1.6);
      this.emit(pos, em.dir, Math.ceil(260 * dt), em.el, { spread: 0.45, life: 0.9, speed: 1.4 });
    }
    this.emitters = this.emitters.filter((e) => e.t < e.dur);
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.age[i] += dt;
      const f = Math.max(0, 1 - this.age[i] / this.life[i]);
      this.vel[i * 3 + 1] += this.grav[i] * dt * (this.grav[i] > 0 ? 0.6 : 0.6);
      if (this.swirl[i]) { const vx = this.vel[i * 3], vz = this.vel[i * 3 + 2]; this.vel[i * 3] = vx + vz * 2.5 * dt; this.vel[i * 3 + 2] = vz - vx * 2.5 * dt; }
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = f * f;
      this.col[i * 3] = this.base[i * 3] * k; this.col[i * 3 + 1] = this.base[i * 3 + 1] * k; this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
    }
    if (!this.emitters.length) this.points.material.size = Math.max(0.05, this.points.material.size * 0.98);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/** Big text floating in front of the player, fading out. */
export class FloatingText {
  constructor(scene) {
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 512;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.scale.set(0.9, 0.45, 1); this.sprite.renderOrder = 10; this.sprite.visible = false;
    scene.add(this.sprite);
    this.until = 0; this.start = 0; this.base = new THREE.Vector3();
  }
  show({ title, subtitle = '', color = '#ffdb8a', glow = '#f0a63c' }, position, now, ms) {
    const g = this.canvas.getContext('2d'); g.clearRect(0, 0, 1024, 512);
    const font = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = title.length > 4 ? 120 : title.length > 2 ? 170 : 300;
    g.font = `900 ${size}px ${font}`;
    while (size > 40 && g.measureText(title).width > 940) { size -= 6; g.font = `900 ${size}px ${font}`; }
    g.shadowColor = glow; g.shadowBlur = 40; g.fillStyle = color; g.fillText(title, 512, subtitle ? 215 : 256);
    g.shadowBlur = 0; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(title, 512, subtitle ? 215 : 256); g.fillText(title, 512, subtitle ? 215 : 256);
    if (subtitle) { g.font = `700 64px ${font}`; g.fillStyle = '#ffffff'; g.shadowColor = '#000'; g.shadowBlur = 12; g.fillText(subtitle, 512, 430); }
    this.tex.needsUpdate = true;
    this.base.copy(position); this.sprite.position.copy(position); this.sprite.visible = true;
    this.start = now; this.until = now + ms;
  }
  update(now) {
    if (!this.sprite.visible) return;
    if (now >= this.until) { this.sprite.visible = false; return; }
    const t = (now - this.start) / (this.until - this.start);
    this.sprite.material.opacity = t < 0.1 ? t / 0.1 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
    this.sprite.position.set(this.base.x, this.base.y + t * 0.08, this.base.z);
  }
  hide() { this.sprite.visible = false; }
}
