import * as THREE from 'three';
import {
  type Building, type Link, BAYS, STORIES, WIDTH, groundOffset,
} from './physics.ts';

const COLORS = {
  column: new THREE.Color('#cbd5e1'),
  beam: new THREE.Color('#94a3b8'),
  diaphragm: new THREE.Color('#475569'),
  brace: new THREE.Color('#22d3ee'),
  warm: new THREE.Color('#fb923c'),
  hot: new THREE.Color('#ef4444'),
};

const THICK: Record<string, number> = { column: 0.26, beam: 0.16, diaphragm: 0.07, brace: 0.15 };

export function makeWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0f1a38';
  g.fillRect(0, 0, 256, 256);
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, 'rgba(129,140,248,0.22)');
  grad.addColorStop(1, 'rgba(34,211,238,0.06)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // dos ventanas por tramo
  const win = (x: number) => {
    g.fillStyle = '#fde68a';
    g.globalAlpha = 0.85;
    g.fillRect(x, 70, 74, 116);
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(15,26,56,0.9)';
    g.lineWidth = 4;
    g.strokeRect(x, 70, 74, 116);
    g.beginPath(); g.moveTo(x + 37, 70); g.lineTo(x + 37, 186); g.stroke();
  };
  win(32); win(150);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 6;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Quad { nodes: [number, number, number, number]; joints: number[]; }

export class BuildingView {
  group = new THREE.Group();
  readonly b: Building;
  private beamLinks: number[] = [];
  private beams: THREE.InstancedMesh;
  private facadeGeom: THREE.BufferGeometry;
  private facadeMat: THREE.MeshBasicMaterial;
  private facade: THREE.Mesh;
  private slabGeom: THREE.BufferGeometry;
  private slabMat: THREE.MeshBasicMaterial;
  private slabs: THREE.Mesh;
  private quads: Quad[] = [];
  private platform: THREE.Mesh;
  private tmp = new THREE.Object3D();
  private up = new THREE.Vector3(0, 1, 0);
  private dir = new THREE.Vector3();
  private col = new THREE.Color();
  private xray = 0; // 0..1 suavizado
  private slabRing: number[] = [];

  constructor(b: Building, scene: THREE.Scene, tex: THREE.Texture) {
    this.b = b;

    // --- vigas, columnas y arriostres (instanciadas) ---
    b.links.forEach((l, i) => { if (l.kind !== 'joint') this.beamLinks.push(i); });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.beams = new THREE.InstancedMesh(geo, mat, this.beamLinks.length);
    this.beams.frustumCulled = false;
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.beamLinks.length * 3), 3);
    this.beams.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.beams);

    // --- fachada (vidrio con ventanas): un cuadrilátero por tramo y piso ---
    const jointsByCell = new Map<string, number[]>();
    b.links.forEach((l, i) => {
      if (l.kind !== 'joint') return;
      const key = `${l.face}-${l.bay}-${l.story}`;
      (jointsByCell.get(key) ?? jointsByCell.set(key, []).get(key)!).push(i);
    });
    const G = BAYS + 1;
    const idx = (level: number, i: number, j: number) => level * G * G + j * G + i;
    const faces: Array<(k: number) => [number, number]> = [
      (k) => [k, 0], (k) => [BAYS, k], (k) => [BAYS - k, BAYS], (k) => [0, BAYS - k],
    ];
    for (let f = 0; f < 4; f++) {
      for (let k = 0; k < BAYS; k++) {
        const [i0, j0] = faces[f]!(k);
        const [i1, j1] = faces[f]!(k + 1);
        for (let s = 0; s < STORIES; s++) {
          this.quads.push({
            nodes: [idx(s, i0, j0), idx(s, i1, j1), idx(s + 1, i1, j1), idx(s + 1, i0, j0)],
            joints: jointsByCell.get(`${f}-${k}-${s}`) ?? [],
          });
        }
      }
    }
    const fpos = new Float32Array(this.quads.length * 4 * 3);
    const fuv = new Float32Array(this.quads.length * 4 * 2);
    const find: number[] = [];
    this.quads.forEach((_, q) => {
      const o = q * 4 * 2;
      fuv.set([0, 0, 1, 0, 1, 1, 0, 1], o);
      find.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    });
    this.facadeGeom = new THREE.BufferGeometry();
    this.facadeGeom.setAttribute('position', new THREE.BufferAttribute(fpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.facadeGeom.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
    this.facadeGeom.setIndex(find);
    this.facadeMat = new THREE.MeshBasicMaterial({
      // los cuadriláteros miran hacia adentro; BackSide dibuja solo las paredes cercanas a la cámara
      map: tex, transparent: true, opacity: 0.94, side: THREE.BackSide, depthWrite: false,
      color: new THREE.Color('#c9d3ff'),
    });
    this.facade = new THREE.Mesh(this.facadeGeom, this.facadeMat);
    this.facade.frustumCulled = false;
    this.facade.renderOrder = 2;
    this.group.add(this.facade);

    // --- losas: abanico de triángulos desde el centro del piso ---
    const ring: number[] = [];
    const rr: Array<[number, number]> = [];
    for (let i = 0; i < BAYS; i++) rr.push([i, 0]);
    for (let j = 0; j < BAYS; j++) rr.push([BAYS, j]);
    for (let i = BAYS; i > 0; i--) rr.push([i, BAYS]);
    for (let j = BAYS; j > 0; j--) rr.push([0, j]);
    rr.forEach(([i, j]) => ring.push(i + j * G));
    this.slabRing = ring;
    const slabTris = STORIES * ring.length;
    const spos = new Float32Array(slabTris * 3 * 3);
    this.slabGeom = new THREE.BufferGeometry();
    this.slabGeom.setAttribute('position', new THREE.BufferAttribute(spos, 3).setUsage(THREE.DynamicDrawUsage));
    this.slabMat = new THREE.MeshBasicMaterial({
      color: '#818cf8', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    });
    this.slabs = new THREE.Mesh(this.slabGeom, this.slabMat);
    this.slabs.frustumCulled = false;
    this.slabs.renderOrder = 1;
    this.group.add(this.slabs);

    // --- plataforma del suelo (se mueve con el temblor) ---
    const pg = new THREE.BoxGeometry(WIDTH + 5, 0.6, WIDTH + 5);
    const pm = new THREE.MeshStandardMaterial({ color: '#1b2347', roughness: 0.6, metalness: 0.2 });
    this.platform = new THREE.Mesh(pg, pm);
    this.platform.position.set(b.cx, -0.3 - 0.01, b.cz);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(pg),
      new THREE.LineBasicMaterial({ color: b.braced ? '#22d3ee' : '#f87171', transparent: true, opacity: 0.55 }),
    );
    this.platform.add(edge);
    this.group.add(this.platform);

    scene.add(this.group);
    this.update(0, false, 6.5, 1);
  }

  private linkColor(l: Link, out: THREE.Color) {
    out.copy(COLORS[l.kind as keyof typeof COLORS] ?? COLORS.beam);
    // el arriostre y la unión pierden "frescura" según su carga
    const t = l.load;
    if (t > 0.08) {
      const k = Math.min(1, t);
      if (k < 0.55) out.lerp(COLORS.warm, k / 0.55);
      else { out.copy(COLORS.warm); out.lerp(COLORS.hot, (k - 0.55) / 0.45); }
    }
  }

  /** Dibuja el estado actual. `xrayOn` anima la transparencia de la fachada. */
  update(dt: number, xrayOn: boolean, mag: number, bright: number) {
    const b = this.b;
    this.xray += ((xrayOn ? 1 : 0) - this.xray) * Math.min(1, dt * 7);
    this.facadeMat.opacity = 0.94 - 0.89 * this.xray;
    this.facadeMat.color.setScalar(bright);
    this.slabMat.opacity = 0.1 + 0.2 * this.xray;

    // plataforma
    const g = b.quakeOn ? groundOffset(b.time, mag) : { x: 0, z: 0 };
    this.platform.position.x = b.cx + g.x;
    this.platform.position.z = b.cz + g.z;

    const nodes = b.nodes;
    for (let n = 0; n < this.beamLinks.length; n++) {
      const l = b.links[this.beamLinks[n]!]!;
      const t = this.tmp;
      if (!l.alive) {
        t.scale.set(0, 0, 0);
        t.position.set(0, -50, 0);
        t.updateMatrix();
        this.beams.setMatrixAt(n, t.matrix);
        continue;
      }
      const A = nodes[l.a]!;
      const B = nodes[l.b]!;
      this.dir.set(B.x - A.x, B.y - A.y, B.z - A.z);
      const len = this.dir.length() || 1e-6;
      this.dir.multiplyScalar(1 / len);
      t.position.set((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
      t.quaternion.setFromUnitVectors(this.up, this.dir);
      const th = THICK[l.kind] ?? 0.15;
      t.scale.set(th, len, th);
      t.updateMatrix();
      this.beams.setMatrixAt(n, t.matrix);
      this.linkColor(l, this.col);
      this.beams.setColorAt(n, this.col);
    }
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;

    // fachada
    const fp = this.facadeGeom.getAttribute('position') as THREE.BufferAttribute;
    // la fachada va 0,22 m hacia afuera para tapar las vigas cuando los rayos X están apagados
    const OUT = 0.22;
    this.quads.forEach((q, qi) => {
      const broken = q.joints.some((j) => !b.links[j]!.alive);
      for (let v = 0; v < 4; v++) {
        const nd = nodes[q.nodes[v]!]!;
        if (broken) { fp.setXYZ(qi * 4 + v, 0, -50, 0); continue; }
        const rx = nd.bx - b.cx, rz = nd.bz - b.cz;
        const ox = Math.abs(rx) > 0.1 ? Math.sign(rx) * OUT : 0;
        const oz = Math.abs(rz) > 0.1 ? Math.sign(rz) * OUT : 0;
        fp.setXYZ(qi * 4 + v, nd.x + ox, nd.y, nd.z + oz);
      }
    });
    fp.needsUpdate = true;

    // losas
    const sp = this.slabGeom.getAttribute('position') as THREE.BufferAttribute;
    const G = BAYS + 1;
    let k = 0;
    for (let l = 1; l <= STORIES; l++) {
      const c = nodes[l * G * G + (BAYS / 2) * G + BAYS / 2]!;
      for (let r = 0; r < this.slabRing.length; r++) {
        const a = nodes[l * G * G + this.slabRing[r]!]!;
        const d = nodes[l * G * G + this.slabRing[(r + 1) % this.slabRing.length]!]!;
        sp.setXYZ(k++, c.x, c.y, c.z);
        sp.setXYZ(k++, a.x, a.y, a.z);
        sp.setXYZ(k++, d.x, d.y, d.z);
      }
    }
    sp.needsUpdate = true;
  }

  /** Punto 3D sobre el techo para anclar la etiqueta. */
  topPoint(out: THREE.Vector3) {
    const n = this.b.nodes[this.b.topCenter]!;
    out.set(n.x, Math.max(n.y, 4) + 1.8, n.z);
  }

  /** Quita el edificio de la escena y libera la memoria de la GPU (la textura de ventanas es compartida y no se toca). */
  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.beams.dispose();
  }
}
