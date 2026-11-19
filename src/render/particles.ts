import * as THREE from 'three';
import { evalTrackAt, type Emitter2Def } from './mdx';

/**
 * MDX particle emitters (type 2) – explosions, fire, sparks, missile trails. Behaviour follows the game /
 * mdx-m3-viewer: particles spawn around the emitter node (width × length area), fly along the node's Z axis
 * spread by `latitude`, fall with gravity and interpolate colour / alpha / scale / texture cell over three
 * segments (start → timeMiddle → end). Head particles are camera-facing quads (XY quads for "XYQuad"),
 * tail particles are streaks along the velocity. Everything is simulated on the CPU in WC3 coordinates and
 * drawn as one dynamic mesh per texture + blend mode.
 */

/** Animation state of an emitting model instance: active sequence interval and current frame (ms). */
export type FrameSource = () => { interval: [number, number]; frame: number } | null;

interface Source {
  defs: Emitter2Def[];
  bones: (THREE.Object3D | null)[];
  emission: number[];
  lastKey: number[];
  frame: FrameSource;
  root: THREE.Object3D;
  alive: boolean;
  globals: number[];
}

interface Particle {
  def: Emitter2Def;
  health: number;
  tail: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  gravity: number;
  nodeScale: number;
  facing: number;
}

interface Batch {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  capacity: number;
  count: number;
}

export interface ParticleHandle {
  /** Stops emitting; living particles finish their life. */
  stop(): void;
}

const rnd = (a: number) => (Math.random() * 2 - 1) * a;
const toLinear = (c: number) => Math.pow(Math.max(0, c), 2.2);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const MAX_PARTICLES = 6000;

export class ParticleSystem {
  private sources: Source[] = [];
  private particles: Particle[] = [];
  private batches = new Map<string, Batch>();
  private clockMs = 0;
  private invWorld = new THREE.Matrix4();

  constructor(private readonly world: THREE.Object3D) {}

  /** Starts the emitters of a cloned model instance (`template.userData.emitters2`). */
  attach(root: THREE.Object3D, template: THREE.Object3D, frame: FrameSource, globals: number[] = []): ParticleHandle | null {
    const defs = (template.userData.emitters2 as Emitter2Def[] | undefined) ?? [];
    if (!defs.length) return null;
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o);
    });
    const src: Source = { globals, defs, bones: defs.map((d) => byName.get(d.node) ?? null), emission: defs.map(() => 0), lastKey: defs.map(() => -1), frame, root, alive: true };
    this.sources.push(src);
    return { stop: () => (src.alive = false) };
  }

  update(dt: number, camera: THREE.Camera) {
    this.clockMs += dt * 1000;
    this.world.updateMatrixWorld();
    this.invWorld.copy(this.world.matrixWorld).invert();
    this.sources = this.sources.filter((s) => s.alive && this.attached(s.root));
    if (dt > 0) {
      for (const s of this.sources) this.emit(s, dt);
      for (const p of this.particles) {
        p.health -= dt;
        p.v.z -= p.gravity * dt;
        p.p.addScaledVector(p.v, dt);
      }
      this.particles = this.particles.filter((p) => p.health > 0);
    }
    this.draw(camera);
  }

  private attached(o: THREE.Object3D) {
    for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (cur === this.world) return true;
    return false;
  }

  private emit(s: Source, dt: number) {
    const f = s.frame();
    if (!f) return;
    s.defs.forEach((d, i) => {
      const bone = s.bones[i];
      if (!bone) return;
      const vis = evalTrackAt(d.raw, 'KP2V', 1, f.interval, f.frame, s.globals, this.clockMs).value;
      const rate = evalTrackAt(d.raw, 'KP2E', d.raw.emissionRate, f.interval, f.frame, s.globals, this.clockMs);
      if (d.squirt) {
        if (rate.key !== s.lastKey[i] && rate.key >= 0) s.emission[i] += rate.value;
        s.lastKey[i] = rate.key;
      } else s.emission[i] += rate.value * dt;
      if (vis <= 0) {
        s.emission[i] = Math.min(s.emission[i], 1);
        return;
      }
      if (s.emission[i] < 1) return;
      const at = (n: string, fb: number) => evalTrackAt(d.raw, n, fb, f.interval, f.frame, s.globals, this.clockMs).value;
      const width = at('KP2N', d.raw.width) * 0.5;
      const length = at('KP2W', d.raw.length) * 0.5;
      const latitude = THREE.MathUtils.degToRad(at('KP2L', d.raw.latitude));
      const variation = at('KP2R', d.raw.variation);
      const speed = at('KP2S', d.raw.speed);
      const gravity = at('KP2G', d.raw.gravity);
      // Node transform in WC3 world coordinates (bones are positioned at their pivot).
      tmpM.multiplyMatrices(this.invWorld, bone.matrixWorld);
      tmpM.decompose(tmpP, tmpQ, tmpS);
      while (s.emission[i] >= 1 && this.particles.length < MAX_PARTICLES) {
        s.emission[i] -= 1;
        const p = new THREE.Vector3(rnd(width), rnd(length), 0).applyMatrix4(tmpM);
        tmpQ2.setFromAxisAngle(AXIS_Z, Math.PI / 2);
        tmpQ2.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, rnd(latitude)));
        if (!d.lineEmitter) tmpQ2.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, rnd(latitude)));
        tmpQ2.premultiply(tmpQ);
        const v = AXIS_Z.clone().applyQuaternion(tmpQ2).multiplyScalar(speed * (1 + rnd(variation))).multiply(tmpS);
        const facing = d.xyQuad ? Math.atan2(v.y, v.x) - Math.PI + Math.PI / 8 : 0;
        const base = { def: d, health: d.lifeSpan, gravity: gravity * tmpS.z, nodeScale: tmpS.x, facing };
        if (d.head) this.particles.push({ ...base, tail: false, p, v });
        if (d.tail) this.particles.push({ ...base, tail: true, p: p.clone(), v: v.clone() });
      }
      s.emission[i] = Math.min(s.emission[i], 4);
    });
  }

  private batch(d: Emitter2Def): Batch {
    const key = `${d.texture?.uuid ?? 'none'}|${d.filterMode}|${d.priorityPlane}`;
    let b = this.batches.get(key);
    if (b) return b;
    const mat = new THREE.MeshBasicMaterial({ map: d.texture, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    switch (d.filterMode) {
      case 1: // additive
        mat.blending = THREE.AdditiveBlending;
        break;
      case 2: // modulate
        mat.blending = THREE.CustomBlending;
        mat.blendSrc = THREE.ZeroFactor;
        mat.blendDst = THREE.SrcColorFactor;
        break;
      case 3: // modulate 2x
        mat.blending = THREE.CustomBlending;
        mat.blendSrc = THREE.DstColorFactor;
        mat.blendDst = THREE.SrcColorFactor;
        break;
      case 4: // alpha key
        mat.alphaTest = 0.5;
        break;
    }
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20 + d.priorityPlane;
    this.world.add(mesh);
    b = { mesh, geo, capacity: 0, count: 0 };
    this.batches.set(key, b);
    return b;
  }

  private ensure(b: Batch, n: number) {
    if (n <= b.capacity) return;
    const cap = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
    const pos = new THREE.BufferAttribute(new Float32Array(cap * 12), 3).setUsage(THREE.DynamicDrawUsage);
    const uv = new THREE.BufferAttribute(new Float32Array(cap * 8), 2).setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.BufferAttribute(new Float32Array(cap * 16), 4).setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    b.geo.dispose();
    b.geo.setAttribute('position', pos);
    b.geo.setAttribute('uv', uv);
    b.geo.setAttribute('color', col);
    b.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    b.capacity = cap;
  }

  private draw(camera: THREE.Camera) {
    // Camera axes in WC3 coordinates (billboards).
    camera.updateMatrixWorld();
    const rot = new THREE.Matrix3().setFromMatrix4(this.invWorld).multiply(new THREE.Matrix3().setFromMatrix4(camera.matrixWorld));
    const right = new THREE.Vector3(1, 0, 0).applyMatrix3(rot).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyMatrix3(rot).normalize();
    const camZ = new THREE.Vector3(0, 0, 1).applyMatrix3(rot).normalize();
    const groups = new Map<Batch, Particle[]>();
    for (const p of this.particles) {
      const b = this.batch(p.def);
      let list = groups.get(b);
      if (!list) groups.set(b, (list = []));
      list.push(p);
    }
    for (const b of this.batches.values()) {
      const list = groups.get(b) ?? [];
      b.count = list.length;
      b.mesh.visible = list.length > 0;
      if (!list.length) continue;
      this.ensure(b, list.length);
      const pos = b.geo.getAttribute('position') as THREE.BufferAttribute;
      const uv = b.geo.getAttribute('uv') as THREE.BufferAttribute;
      const col = b.geo.getAttribute('color') as THREE.BufferAttribute;
      const P = pos.array as Float32Array;
      const U = uv.array as Float32Array;
      const C = col.array as Float32Array;
      list.forEach((p, n) => {
        const d = p.def;
        let factor = (d.lifeSpan - p.health) / d.lifeSpan;
        let seg = 0;
        if (factor < d.timeMiddle) factor /= d.timeMiddle;
        else {
          factor = (factor - d.timeMiddle) / (1 - d.timeMiddle);
          seg = 1;
        }
        factor = Math.min(1, Math.max(0, factor));
        const scale = d.scaling[seg] + (d.scaling[seg + 1] - d.scaling[seg]) * factor;
        const c0 = d.colors[seg];
        const c1 = d.colors[seg + 1];
        const r = toLinear(c0[0] + (c1[0] - c0[0]) * factor);
        const g = toLinear(c0[1] + (c1[1] - c0[1]) * factor);
        const bl = toLinear(c0[2] + (c1[2] - c0[2]) * factor);
        const a = c0[3] + (c1[3] - c0[3]) * factor;
        const iv = d.intervals[(p.tail ? 2 : 0) + seg];
        const sprites = iv[1] - iv[0];
        const cell = sprites > 0 ? Math.min(iv[0] + (Math.floor(sprites * iv[2] * factor) % sprites), d.columns * d.rows - 1) : iv[0];
        const left = (cell % d.columns) / d.columns;
        const top = Math.floor(cell / d.columns) / d.rows;
        const rr = left + 1 / d.columns;
        const bb = top + 1 / d.rows;
        U.set([rr, top, left, top, left, bb, rr, bb], n * 8);
        for (let k = 0; k < 4; k++) C.set([r, g, bl, a], n * 16 + k * 4);
        const o = n * 12;
        if (!p.tail) {
          // Corners (-1,-1), (-1,1), (1,1), (1,-1) like the game's billboard vectors.
          let rx = right;
          let ux = up;
          if (d.xyQuad) {
            rx = tmpA.set(Math.cos(p.facing), Math.sin(p.facing), 0);
            ux = tmpB.set(-Math.sin(p.facing), Math.cos(p.facing), 0);
          }
          const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
          corners.forEach(([cx, cy], k) => {
            P[o + k * 3] = p.p.x + (rx.x * cx + ux.x * cy) * scale;
            P[o + k * 3 + 1] = p.p.y + (rx.y * cx + ux.y * cy) * scale;
            P[o + k * 3 + 2] = p.p.z + (rx.z * cx + ux.z * cy) * scale;
          });
        } else {
          const start = tmpA.copy(p.p).addScaledVector(p.v, -d.tailLength);
          const end = p.p;
          const dir = tmpN.subVectors(end, start);
          if (dir.lengthSq() < 1e-6) dir.copy(up);
          const normal = tmpB.crossVectors(camZ, dir.normalize()).multiplyScalar(scale * p.nodeScale);
          P.set([start.x - normal.x, start.y - normal.y, start.z - normal.z, end.x - normal.x, end.y - normal.y, end.z - normal.z, end.x + normal.x, end.y + normal.y, end.z + normal.z, start.x + normal.x, start.y + normal.y, start.z + normal.z], o);
        }
      });
      pos.needsUpdate = uv.needsUpdate = col.needsUpdate = true;
      b.geo.setDrawRange(0, list.length * 6);
    }
  }
}
