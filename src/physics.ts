// Motor de física de barras y nodos (XPBD). Sin dependencias: corre igual en el navegador y en Node.
//
// Idea didáctica: el edificio es un esqueleto de nodos unidos por barras.
//  - Columnas, vigas y losas son barras rígidas.
//  - "uniones" (joint): diagonales invisibles y blandas que representan la poca rigidez que
//    aporta una unión sin triángulos. Son débiles y se rompen fácil.
//  - "arriostres" (brace): diagonales rígidas y fuertes. Solo las tiene el Edificio 1.
// El mismo temblor mueve el suelo de los dos edificios. Lo que pasa después sale de las barras.

export type Kind = 'column' | 'beam' | 'diaphragm' | 'brace' | 'joint';

export interface Node {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  w: number; // masa inversa (0 = fijo al suelo)
  fixed: boolean;
  bx: number; by: number; bz: number; // posición de reposo
  level: number;
}

export interface Link {
  a: number; b: number;
  rest: number;
  compliance: number;
  cap: number; // fuerza máxima antes de romperse
  kind: Kind;
  alive: boolean;
  lambda: number;
  maxForce: number;
  load: number; // 0..1+ (fuerza / capacidad), suavizado, para colorear
  over: number;
  story: number;
  face: number;
  bay: number;
}

export interface Building {
  braced: boolean;
  cx: number; cz: number;
  nodes: Node[];
  links: Link[];
  topCenter: number;
  maxDrift: number;
  weakTotal: number;
  time: number; // tiempo del temblor (s)
  quakeOn: boolean;
}

export const STORIES = 5;
export const BAYS = 2;
export const BAY = 3; // m
export const STORY_H = 3.2; // m
export const HEIGHT = STORIES * STORY_H;
export const WIDTH = BAYS * BAY;
export const QUAKE_SECONDS = 9;

export const TUNE = {
  gravity: 9.8,
  jointCompliance: 4e-3,
  jointCap: 120,
  braceCompliance: 1.5e-5,
  braceCap: 2000,
  rigid: 1e-9,
  damping: 0.25,
  friction: 0.6,
  ampBase: 0.1,
  ampGrowth: 1.62,
};

const G = BAYS + 1;
const idx = (level: number, i: number, j: number) => level * G * G + j * G + i;

export function createBuilding(braced: boolean, cx: number, cz: number, tune = TUNE): Building {
  const nodes: Node[] = [];
  const links: Link[] = [];
  const half = WIDTH / 2;

  for (let l = 0; l <= STORIES; l++) {
    for (let j = 0; j <= BAYS; j++) {
      for (let i = 0; i <= BAYS; i++) {
        const x = cx + i * BAY - half;
        const y = l * STORY_H;
        const z = cz + j * BAY - half;
        const fixed = l === 0;
        nodes.push({
          x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0,
          w: fixed ? 0 : 1, fixed, bx: x, by: y, bz: z, level: l,
        });
      }
    }
  }

  const isRing = (i: number, j: number) => i === 0 || i === BAYS || j === 0 || j === BAYS;

  const add = (a: number, b: number, kind: Kind, story: number, face = -1, bay = -1) => {
    const na = nodes[a]!;
    const nb = nodes[b]!;
    const rest = Math.hypot(na.bx - nb.bx, na.by - nb.by, na.bz - nb.bz);
    let compliance = tune.rigid;
    let cap = Infinity;
    if (kind === 'joint') { compliance = tune.jointCompliance; cap = tune.jointCap; }
    if (kind === 'brace') { compliance = tune.braceCompliance; cap = tune.braceCap; }
    links.push({
      a, b, rest, compliance, cap, kind, alive: true, lambda: 0, maxForce: 0,
      load: 0, over: 0, story, face, bay,
    });
  };

  // Columnas (solo el anillo exterior)
  for (let l = 0; l < STORIES; l++) {
    for (let j = 0; j <= BAYS; j++) {
      for (let i = 0; i <= BAYS; i++) {
        if (isRing(i, j)) add(idx(l, i, j), idx(l + 1, i, j), 'column', l);
      }
    }
  }

  // Vigas del perímetro y losa rígida (rayos desde el centro) en cada piso
  for (let l = 1; l <= STORIES; l++) {
    for (let i = 0; i < BAYS; i++) {
      add(idx(l, i, 0), idx(l, i + 1, 0), 'beam', l - 1);
      add(idx(l, i, BAYS), idx(l, i + 1, BAYS), 'beam', l - 1);
    }
    for (let j = 0; j < BAYS; j++) {
      add(idx(l, 0, j), idx(l, 0, j + 1), 'beam', l - 1);
      add(idx(l, BAYS, j), idx(l, BAYS, j + 1), 'beam', l - 1);
    }
    const c = idx(l, BAYS / 2, BAYS / 2);
    for (let j = 0; j <= BAYS; j++) {
      for (let i = 0; i <= BAYS; i++) {
        if (isRing(i, j)) add(c, idx(l, i, j), 'diaphragm', l - 1);
      }
    }
  }

  // Caras: cada tramo (bahía) de cada piso es un rectángulo. Aquí viven las diagonales.
  const faces: Array<(k: number) => [number, number]> = [
    (k) => [k, 0],
    (k) => [BAYS, k],
    (k) => [BAYS - k, BAYS],
    (k) => [0, BAYS - k],
  ];
  for (let f = 0; f < 4; f++) {
    for (let k = 0; k < BAYS; k++) {
      const [i0, j0] = faces[f]!(k);
      const [i1, j1] = faces[f]!(k + 1);
      for (let s = 0; s < STORIES; s++) {
        const bl = idx(s, i0, j0);
        const br = idx(s, i1, j1);
        const tl = idx(s + 1, i0, j0);
        const tr = idx(s + 1, i1, j1);
        add(bl, tr, 'joint', s, f, k);
        add(br, tl, 'joint', s, f, k);
        if (braced) {
          add(bl, tr, 'brace', s, f, k);
          add(br, tl, 'brace', s, f, k);
        }
      }
    }
  }

  let weakTotal = 0;
  for (const l of links) if (l.kind === 'brace' || l.kind === 'joint') weakTotal++;

  return {
    braced, cx, cz, nodes, links,
    topCenter: idx(STORIES, BAYS / 2, BAYS / 2),
    maxDrift: 0, weakTotal, time: 0, quakeOn: false,
  };
}

export function quakeAmplitude(mag: number, tune = TUNE): number {
  return tune.ampBase * Math.pow(tune.ampGrowth, mag - 4);
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Desplazamiento del suelo (m) en el instante t del temblor. Igual para los dos edificios. */
export function groundOffset(t: number, mag: number, tune = TUNE): { x: number; z: number } {
  if (t < 0 || t > QUAKE_SECONDS) return { x: 0, z: 0 };
  const env = smooth(t / 1.5) * smooth((QUAKE_SECONDS - t) / 2.5);
  const A = quakeAmplitude(mag, tune);
  const tau = Math.PI * 2;
  const x = Math.sin(tau * 1.3 * t) + 0.55 * Math.sin(tau * 2.1 * t + 0.8) + 0.3 * Math.sin(tau * 3.4 * t + 2.1);
  const z = Math.sin(tau * 1.7 * t + 1.0) + 0.5 * Math.sin(tau * 2.6 * t);
  return { x: A * env * x, z: A * env * 0.45 * z };
}

export function startQuake(b: Building) {
  b.time = 0;
  b.quakeOn = true;
}

export function stepBuilding(
  b: Building, dt: number, mag: number, tune = TUNE, substeps = 20, iters = 2,
) {
  const h = dt / substeps;
  const ih2 = 1 / (h * h);
  const { nodes, links } = b;

  for (let s = 0; s < substeps; s++) {
    const tt = b.time + s * h;
    const g = b.quakeOn ? groundOffset(tt, mag, tune) : { x: 0, z: 0 };

    for (const n of nodes) {
      if (n.fixed) {
        n.px = n.x; n.py = n.y; n.pz = n.z;
        n.x = n.bx + g.x; n.z = n.bz + g.z;
        continue;
      }
      n.vy -= tune.gravity * h;
      n.px = n.x; n.py = n.y; n.pz = n.z;
      n.x += n.vx * h; n.y += n.vy * h; n.z += n.vz * h;
    }

    for (const l of links) l.lambda = 0;

    for (let it = 0; it < iters; it++) {
      for (const l of links) {
        if (!l.alive) continue;
        const a = nodes[l.a]!;
        const c = nodes[l.b]!;
        const wsum = a.w + c.w;
        if (wsum === 0) continue;
        const dx = a.x - c.x, dy = a.y - c.y, dz = a.z - c.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        const C = len - l.rest;
        const alpha = l.compliance * ih2;
        const dl = (-C - alpha * l.lambda) / (wsum + alpha);
        l.lambda += dl;
        const k = dl / len;
        a.x += a.w * k * dx; a.y += a.w * k * dy; a.z += a.w * k * dz;
        c.x -= c.w * k * dx; c.y -= c.w * k * dy; c.z -= c.w * k * dz;
      }
    }

    for (const l of links) {
      if (!l.alive) continue;
      const f = Math.abs(l.lambda) * ih2;
      if (f > l.maxForce) l.maxForce = f;
    }

    const damp = Math.max(0, 1 - tune.damping * h);
    for (const n of nodes) {
      if (n.fixed) continue;
      if (n.y < 0) {
        n.y = 0;
        n.x = n.px + (n.x - n.px) * (1 - tune.friction);
        n.z = n.pz + (n.z - n.pz) * (1 - tune.friction);
      }
      n.vx = ((n.x - n.px) / h) * damp;
      n.vy = ((n.y - n.py) / h) * damp;
      n.vz = ((n.z - n.pz) / h) * damp;
    }
  }

  // Fin del cuadro: ¿se rompió algo? ¿cómo colorear la tensión?
  for (const l of links) {
    if (!l.alive) continue;
    if (Number.isFinite(l.cap)) {
      const ratio = l.maxForce / l.cap;
      l.load += (ratio - l.load) * 0.35;
      if (ratio > 1) {
        l.over++;
        if (l.over >= 2) l.alive = false;
      } else {
        l.over = 0;
      }
    }
    l.maxForce = 0;
  }

  if (b.quakeOn) {
    b.time += dt;
    const g = groundOffset(b.time, mag, tune);
    const top = nodes[b.topCenter]!;
    const d = Math.hypot(top.x - (top.bx + g.x), top.z - (top.bz + g.z));
    if (d > b.maxDrift) b.maxDrift = d;
    if (b.time > QUAKE_SECONDS) b.quakeOn = false;
  }
}

export interface Metrics {
  status: 'ok' | 'damaged' | 'collapsed';
  intactPct: number;
  driftCm: number;
  topHeight: number;
}

export function metrics(b: Building): Metrics {
  let alive = 0;
  for (const l of b.links) if ((l.kind === 'brace' || l.kind === 'joint') && l.alive) alive++;
  const top = b.nodes[b.topCenter]!;
  const collapsed = top.y < HEIGHT * 0.6;
  const damaged = alive < b.weakTotal;
  return {
    status: collapsed ? 'collapsed' : damaged ? 'damaged' : 'ok',
    intactPct: Math.round((alive / b.weakTotal) * 100),
    driftCm: Math.round(b.maxDrift * 100),
    topHeight: top.y,
  };
}
