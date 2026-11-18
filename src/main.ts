import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {
  createBuilding, startQuake, stepBuilding, metrics, groundOffset,
  HEIGHT, QUAKE_SECONDS, type Building,
} from './physics.ts';
import { BuildingView, makeWindowTexture } from './view.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- escena ----------
const canvas = $<HTMLCanvasElement>('stage');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:600 1.1rem system-ui;background:#070a14;color:#e8ecff;z-index:99">Este dispositivo o navegador no permite gráficos 3D (WebGL). Prueba con Chrome, Edge, Safari o Firefox actualizados.</p>',
  );
  throw new Error('WebGL no disponible');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#070a14');
scene.fog = new THREE.Fog('#070a14', 70, 190);

const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 12;
controls.maxDistance = 120;
controls.enablePan = false;

scene.add(new THREE.HemisphereLight('#a5b4fc', '#0b1030', 1.3));
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(-20, 40, 30);
scene.add(sun);

// suelo con cuadrícula
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(160, 64),
  new THREE.MeshBasicMaterial({ color: '#0a0f22' }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.62;
scene.add(ground);
const grid = new THREE.GridHelper(240, 80, 0x3a4378, 0x1a2144);
grid.position.y = -0.6;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.55;
scene.add(grid);

// ---------- edificios ----------
const SPACING = 11.5;
const tex = makeWindowTexture();
let b1: Building, b2: Building, v1: BuildingView, v2: BuildingView;

function buildWorld() {
  if (v1) v1.dispose(scene);
  if (v2) v2.dispose(scene);
  b1 = createBuilding(true, -SPACING, 0);
  b2 = createBuilding(false, SPACING, 0);
  v1 = new BuildingView(b1, scene, tex);
  v2 = new BuildingView(b2, scene, tex);
}
buildWorld();

// ---------- cámara ----------
type View = 'both' | '1' | '2';
let view: View = 'both';
const goal = { target: new THREE.Vector3(0, 6.5, 0), dist: 60 };
const camDir = new THREE.Vector3(0.28, 0.34, 1).normalize();
const tmp = new THREE.Vector3();
let animCam = 0;

function frame(v: View, instant = false) {
  const w = innerWidth, h = innerHeight;
  const aspect = camera.aspect;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);

  // zona libre entre las tarjetas de arriba y el panel de abajo
  const cardsBottom = document.querySelector('.status')!.getBoundingClientRect().bottom;
  const dockRect = document.querySelector('.dock')!.getBoundingClientRect();
  const dockTop = dockRect.top;
  document.documentElement.style.setProperty('--dock-h', `${Math.round(dockRect.height)}px`);
  const topUI = Math.min(cardsBottom + 14, h * 0.4);
  const freeH = Math.max(h * 0.3, dockTop - 8 - topUI);
  const freeCenter = topUI + freeH / 2;
  camera.setViewOffset(w, h, 0, -(freeCenter - h / 2), w, h);

  const halfW = v === 'both' ? SPACING + 9.8 : 9.8;
  const halfH = HEIGHT / 2 + 1.5;
  const dW = halfW / Math.tan(hfov / 2);
  const dH = (halfH / Math.tan(vfov / 2)) * (h / freeH);
  goal.dist = Math.max(dW, dH) * 1.04;
  const cx = v === 'both' ? 0 : v === '1' ? -SPACING : SPACING;
  goal.target.set(cx, HEIGHT * 0.42, 0);
  if (instant) {
    // conserva hacia dónde mira el usuario (en celular la barra del navegador dispara "resize" al hacer scroll)
    tmp.copy(camera.position).sub(controls.target);
    if (tmp.lengthSq() > 1e-6) camDir.copy(tmp).normalize();
    controls.target.copy(goal.target);
    camera.position.copy(goal.target).addScaledVector(camDir, goal.dist);
  }
  animCam = instant ? 0 : 1.4;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  frame(view, true);
}
addEventListener('resize', resize);
resize();
camera.position.copy(controls.target).addScaledVector(camDir, goal.dist);

// ---------- HUD ----------
const stateText = { ok: 'Estable', damaged: 'Dañado', collapsed: 'Colapsó' } as const;
const els = {
  s1: $('state1'), s2: $('state2'), r1: $('rig1'), r2: $('rig2'), d1: $('drift1'), d2: $('drift2'),
  tag1: $('tag1'), tag2: $('tag2'), toast: $('toast'),
};
function paintCard(m: ReturnType<typeof metrics>, s: HTMLElement, r: HTMLElement, d: HTMLElement) {
  if (s.dataset.state !== m.status) {
    s.dataset.state = m.status;
    s.querySelector('strong')!.textContent = stateText[m.status];
  }
  r.textContent = `${m.intactPct}%`;
  d.textContent = `${m.driftCm} cm`;
}

let toastTimer = 0;
function toast(msg: string, ms = 4200) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), ms);
}

// ---------- controles ----------
const xray = $<HTMLInputElement>('xray');
const slow = $<HTMLInputElement>('slow');
const mag = $<HTMLInputElement>('mag');
const magOut = $<HTMLOutputElement>('magOut');
const btnQuake = $<HTMLButtonElement>('btnQuake');
const btnReset = $<HTMLButtonElement>('btnReset');
let running = false;
let announced = true;

mag.addEventListener('input', () => { magOut.textContent = Number(mag.value).toFixed(1); });

function reset() {
  buildWorld();
  running = false;
  announced = true;
  btnQuake.disabled = false;
  btnQuake.classList.remove('running');
  btnQuake.querySelector('span')!.textContent = 'Temblor';
  els.toast.classList.remove('show');
}

function quake() {
  if (running) return;
  const dirty = metrics(b1).status !== 'ok' || metrics(b2).status !== 'ok' || b1.maxDrift > 0;
  if (dirty) reset();
  startQuake(b1);
  startQuake(b2);
  running = true;
  announced = false;
  btnQuake.disabled = true;
  btnQuake.classList.add('running');
  btnQuake.querySelector('span')!.textContent = 'Temblando…';
  toast(`Temblor de magnitud ${Number(mag.value).toFixed(1)}`, 2400);
}

btnQuake.addEventListener('click', quake);
btnReset.addEventListener('click', reset);

document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    view = btn.dataset.view as View;
    document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((o) => o.setAttribute('aria-pressed', String(o === btn)));
    frame(view);
  });
});

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
  if (e.code === 'Space') { e.preventDefault(); quake(); }
  else if (e.key === 'x' || e.key === 'X') { xray.checked = !xray.checked; }
  else if (e.key === 'l' || e.key === 'L') { slow.checked = !slow.checked; }
  else if (e.key === 'r' || e.key === 'R') { reset(); }
  else if (e.key === 'Escape') { closeSheet(); }
});

// ---------- hoja informativa ----------
const sheet = $('sheet');
const btnInfo = $('btnInfo');
function openSheet() { sheet.hidden = false; $('sheetClose').focus(); }
function closeSheet() { if (!sheet.hidden) { sheet.hidden = true; btnInfo.focus(); } }
btnInfo.addEventListener('click', () => (sheet.hidden ? openSheet() : closeSheet()));
$('sheetClose').addEventListener('click', closeSheet);

const bIn = $<HTMLInputElement>('bIn');
const hIn = $<HTMLInputElement>('hIn');
function paintTriangle() {
  const b = Number(bIn.value), h = Number(hIn.value);
  $('bOut').textContent = b.toFixed(1);
  $('hOut').textContent = h.toFixed(1);
  $('aOut').textContent = ((b * h) / 2).toFixed(2);
  const w = (b / 6) * 150 + 20, ht = (h / 6) * 80 + 15;
  $('triShape').setAttribute('points', `20,98 ${20 + w},98 ${20 + w},${98 - ht}`);
}
bIn.addEventListener('input', paintTriangle);
hIn.addEventListener('input', paintTriangle);
paintTriangle();

// ---------- bucle ----------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let hudTimer = 0;
const shakeBase = new THREE.Vector3();

function project(el: HTMLElement, v: BuildingView) {
  v.topPoint(tmp);
  tmp.project(camera);
  const visible = tmp.z < 1;
  const x = (tmp.x * 0.5 + 0.5) * innerWidth;
  const y = (-tmp.y * 0.5 + 0.5) * innerHeight;
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  el.style.opacity = visible ? '1' : '0';
}

function loop(now: number) {
  requestAnimationFrame(loop);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  const scale = slow.checked ? 0.3 : 1;
  acc += real * scale;
  let guard = 0;
  while (acc >= STEP && guard++ < 4) {
    const m = Number(mag.value);
    stepBuilding(b1, STEP, m);
    stepBuilding(b2, STEP, m);
    acc -= STEP;
  }
  if (guard >= 4) acc = 0;

  const m = Number(mag.value);
  v1.update(real, xray.checked, m, 1);
  v2.update(real, xray.checked, m, 1);

  // cámara: aproximación suave hacia la vista elegida
  if (animCam > 0) {
    animCam -= real;
    const k = 1 - Math.pow(0.0005, real);
    controls.target.lerp(goal.target, k);
    tmp.copy(camera.position).sub(controls.target);
    const cur = tmp.length();
    tmp.setLength(cur + (goal.dist - cur) * k);
    camera.position.copy(controls.target).add(tmp);
  }
  controls.update();

  // vibración leve de cámara durante el temblor
  if (running && !reduceMotion) {
    const g = groundOffset(b1.time, m);
    shakeBase.copy(camera.position);
    camera.position.x += g.x * 0.25;
    camera.position.y += g.z * 0.12;
    renderer.render(scene, camera);
    camera.position.copy(shakeBase);
  } else {
    renderer.render(scene, camera);
  }

  project(els.tag1, v1);
  project(els.tag2, v2);

  hudTimer += real;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    const m1 = metrics(b1), m2 = metrics(b2);
    paintCard(m1, els.s1, els.r1, els.d1);
    paintCard(m2, els.s2, els.r2, els.d2);
  }

  if (running && !b1.quakeOn && !b2.quakeOn && b1.time > QUAKE_SECONDS) {
    running = false;
    btnQuake.disabled = false;
    btnQuake.classList.remove('running');
    btnQuake.querySelector('span')!.textContent = 'Temblor';
    if (!announced) {
      announced = true;
      const m1 = metrics(b1), m2 = metrics(b2);
      const t = (s: string) => (s === 'ok' ? 'resistió' : s === 'damaged' ? 'quedó dañado' : 'colapsó');
      toast(`Edificio 1 ${t(m1.status)} · Edificio 2 ${t(m2.status)}`, 6000);
    }
  }
}
requestAnimationFrame(loop);

// Para depurar y para las pruebas automáticas
(window as unknown as { __sismo: unknown }).__sismo = {
  get b1() { return b1; }, get b2() { return b2; }, quake, reset, metrics,
};
