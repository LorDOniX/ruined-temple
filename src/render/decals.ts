import * as THREE from 'three';
import type { SplatDef, UberSplatDef } from '../data/types';

/**
 * Ground decals – textures laid onto the terrain like the game's splats:
 *   - splats / footprints (Splats\SplatData.slk, event objects SPL / FPT): animated texture cell and colour
 *     over "Lifespan", then "Decay" (blood stays on the ground for two minutes),
 *   - ubersplats (UberSplatData.slk): craters (UBR events), scorch marks of destroyed buildings and the
 *     tiles under buildings (unit field "uubs"): fade in over BirthTime, stay PauseTime, fade out over Decay,
 *   - unit shadows (ReplaceableTextures\Shadows, fields ushu / ushx / ushy / ushw / ushh) and
 *     selection circles (ReplaceableTextures\Selection, UI\MiscData.txt [SelectionCircle]).
 * Each decal is a small grid that follows the terrain height; decals sharing texture + blend mode + layer are
 * drawn as one dynamic mesh. Texture orientation follows mdx-m3-viewer's splat shader.
 */

export interface Decal {
  texture: THREE.Texture | null;
  /** Emitter blend mode: 0 blend, 1 additive, 2 modulate, 3 modulate 2x, 4 alpha key. */
  blend: number;
  /** Draw layer: 0 ubersplats, 1 splats, 2 shadows, 3 selection circles. */
  layer: number;
  x: number;
  y: number;
  /** Half extents along the decal's local axes. */
  halfW: number;
  halfH: number;
  angle: number;
  /** Linear RGB + alpha, 0–1. */
  color: [number, number, number, number];
  /** Texture rectangle u0, v0, u1, v1. */
  uv: [number, number, number, number];
  visible: boolean;
  /** "splat" orientation: u runs along −local Y, v along −local X (game splats); "image": u along +X, v along −Y. */
  orientation: 'splat' | 'image';
  /** Cached terrain-following vertices (recomputed when the position changes). */
  cache?: { key: string; pos: Float32Array };
}

interface TimedDecal {
  decal: Decal;
  age: number;
  /** Returns false once expired. */
  step(d: Decal, age: number): boolean;
}

interface Batch {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  capacity: number;
}

const GRID = 4; // quads per side
const VERTS = (GRID + 1) * (GRID + 1);
const toLinear = (c: number) => Math.pow(Math.max(0, Math.min(1, c)), 2.2);
/** Cap of transient splats (footprints of whole waves add up quickly). */
const MAX_TIMED = 600;

export class DecalLayer {
  private decals = new Set<Decal>();
  private timed: TimedDecal[] = [];
  private batches = new Map<string, Batch>();
  private loading = new Map<string, Promise<THREE.Texture | null>>();
  private textures = new Map<string, THREE.Texture | null>();

  constructor(
    private readonly world: THREE.Object3D,
    private readonly heightAt: (x: number, y: number) => number,
    private readonly loadTexture: (path: string) => Promise<THREE.Texture | null>,
  ) {}

  /** Texture by game path; null until loaded (decals created earlier pick it up via `withTexture`). */
  texture(path: string) {
    const key = path.toLowerCase();
    if (!this.loading.has(key)) {
      const p = this.loadTexture(`${path}.blp`).then((t) => {
        if (t) {
          // Decals must not repeat at their edges (shadows / circles touch the border of the image).
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          t.needsUpdate = true;
        }
        this.textures.set(key, t);
        return t;
      });
      this.loading.set(key, p);
    }
    return this.textures.get(key) ?? null;
  }

  private withTexture(d: Decal, path: string) {
    d.texture = this.texture(path);
    if (!d.texture) void this.loading.get(path.toLowerCase())?.then((t) => (d.texture = t));
  }

  add(init: Partial<Decal> & { x: number; y: number; halfW: number; halfH: number }, texturePath?: string): Decal {
    const d: Decal = { texture: null, blend: 0, layer: 1, angle: 0, color: [1, 1, 1, 1], uv: [0, 0, 1, 1], visible: true, orientation: 'image', ...init };
    if (texturePath) this.withTexture(d, texturePath);
    this.decals.add(d);
    return d;
  }

  remove(d: Decal) {
    this.decals.delete(d);
    this.timed = this.timed.filter((t) => t.decal !== d);
  }

  /** A splat (SPL / FPT event): cell animation + colour over lifespan, then decay. */
  splat(def: SplatDef, x: number, y: number, angle: number) {
    if (this.timed.length >= MAX_TIMED) this.remove(this.timed[0].decal);
    const d = this.add({ x, y, halfW: def.scale, halfH: def.scale, angle, blend: def.blendMode, layer: 1, orientation: 'splat' }, def.texture);
    const cells = def.columns * def.rows;
    const cellAt = (iv: number[], factor: number) => {
      const count = iv[1] - iv[0];
      return count > 0 ? Math.min(iv[0] + (Math.floor(count * iv[2] * factor) % count), cells - 1) : iv[0];
    };
    this.timed.push({
      decal: d,
      age: 0,
      step: (dd, age) => {
        const total = def.lifespan + def.decay;
        if (age >= total) return false;
        const phase = age < def.lifespan ? 0 : 1;
        const factor = phase === 0 ? age / Math.max(1e-3, def.lifespan) : (age - def.lifespan) / Math.max(1e-3, def.decay);
        const cell = cellAt(phase === 0 ? def.uvLifespan : def.uvDecay, factor);
        const left = (cell % def.columns) / def.columns;
        const top = Math.floor(cell / def.columns) / def.rows;
        dd.uv = [left, top, left + 1 / def.columns, top + 1 / def.rows];
        dd.color = mixColor(def.colors[phase], def.colors[phase + 1], factor);
        return true;
      },
    });
    return d;
  }

  /**
   * An ubersplat. With `hold` the decal stays at full colour after its birth until `release()` is called
   * (tiles under buildings), then fades out over the decay time.
   */
  uberSplat(def: UberSplatDef, x: number, y: number, hold = false) {
    const d = this.add({ x, y, halfW: def.scale, halfH: def.scale, blend: def.blendMode, layer: 0, orientation: 'splat' }, def.texture);
    let releasedAt = hold ? Infinity : def.birthTime + def.pauseTime;
    const entry: TimedDecal = {
      decal: d,
      age: 0,
      step: (dd, age) => {
        if (age < def.birthTime) dd.color = mixColor(def.colors[0], def.colors[1], age / Math.max(1e-3, def.birthTime));
        else if (age < releasedAt) dd.color = mixColor(def.colors[1], def.colors[1], 0);
        else if (age < releasedAt + def.decay) dd.color = mixColor(def.colors[1], def.colors[2], (age - releasedAt) / Math.max(1e-3, def.decay));
        else return false;
        return true;
      },
    };
    this.timed.push(entry);
    return { decal: d, release: () => (releasedAt = Math.max(entry.age, def.birthTime)) };
  }

  update(dt: number) {
    if (dt > 0 || this.timed.some((t) => t.age === 0)) {
      this.timed = this.timed.filter((t) => {
        const alive = t.step(t.decal, t.age);
        t.age += dt;
        if (!alive) this.decals.delete(t.decal);
        return alive;
      });
    }
    this.draw();
  }

  private batch(d: Decal): Batch {
    const key = `${d.texture!.uuid}|${d.blend}|${d.layer}`;
    let b = this.batches.get(key);
    if (b) return b;
    const mat = new THREE.MeshBasicMaterial({ map: d.texture, vertexColors: true, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 - d.layer });
    switch (d.blend) {
      case 1:
        mat.blending = THREE.CustomBlending;
        mat.blendSrc = THREE.SrcAlphaFactor;
        mat.blendDst = THREE.OneFactor;
        break;
      case 2:
        mat.blending = THREE.CustomBlending;
        mat.blendSrc = THREE.ZeroFactor;
        mat.blendDst = THREE.SrcColorFactor;
        break;
      case 3:
        mat.blending = THREE.CustomBlending;
        mat.blendSrc = THREE.DstColorFactor;
        mat.blendDst = THREE.SrcColorFactor;
        break;
      case 4:
        mat.alphaTest = 0.5;
        break;
    }
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Before every other transparent object: decals lie on the ground under units and effects.
    mesh.renderOrder = -10 + d.layer;
    this.world.add(mesh);
    b = { mesh, geo, capacity: 0 };
    this.batches.set(key, b);
    return b;
  }

  private ensure(b: Batch, n: number) {
    if (n <= b.capacity) return;
    const cap = Math.max(32, 2 ** Math.ceil(Math.log2(n)));
    b.geo.dispose();
    b.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    b.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cap * VERTS * 2), 2).setUsage(THREE.DynamicDrawUsage));
    b.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * VERTS * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(cap * GRID * GRID * 6);
    let o = 0;
    for (let q = 0; q < cap; q++) {
      const base = q * VERTS;
      for (let j = 0; j < GRID; j++)
        for (let i = 0; i < GRID; i++) {
          const a = base + j * (GRID + 1) + i;
          idx.set([a, a + 1, a + GRID + 2, a, a + GRID + 2, a + GRID + 1], o);
          o += 6;
        }
    }
    b.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    b.capacity = cap;
  }

  private positions(d: Decal) {
    const key = `${d.x}|${d.y}|${d.halfW}|${d.halfH}|${d.angle}`;
    if (d.cache?.key === key) return d.cache.pos;
    const pos = d.cache?.pos ?? new Float32Array(VERTS * 3);
    const c = Math.cos(d.angle);
    const s = Math.sin(d.angle);
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++) {
        const lx = (i / GRID) * 2 - 1;
        const ly = (j / GRID) * 2 - 1;
        const x = d.x + (lx * d.halfW * c - ly * d.halfH * s);
        const y = d.y + (lx * d.halfW * s + ly * d.halfH * c);
        const o = (j * (GRID + 1) + i) * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = this.heightAt(x, y) + 1;
      }
    d.cache = { key, pos };
    return pos;
  }

  /** Ground area in view (with a margin); decals outside are not rebuilt or drawn. Null = everything. */
  viewRect: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  private draw() {
    const groups = new Map<Batch, Decal[]>();
    const r = this.viewRect;
    for (const d of this.decals) {
      if (!d.visible || !d.texture || d.color[3] <= 0.001) continue;
      if (r) {
        const ext = Math.max(d.halfW, d.halfH) * 1.5;
        if (d.x + ext < r.minX || d.x - ext > r.maxX || d.y + ext < r.minY || d.y - ext > r.maxY) continue;
      }
      const b = this.batch(d);
      let list = groups.get(b);
      if (!list) groups.set(b, (list = []));
      list.push(d);
    }
    for (const b of this.batches.values()) {
      const list = groups.get(b) ?? [];
      b.mesh.visible = list.length > 0;
      if (!list.length) continue;
      this.ensure(b, list.length);
      const P = (b.geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const U = (b.geo.getAttribute('uv') as THREE.BufferAttribute).array as Float32Array;
      const C = (b.geo.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      list.forEach((d, n) => {
        P.set(this.positions(d), n * VERTS * 3);
        const [u0, v0, u1, v1] = d.uv;
        for (let j = 0; j <= GRID; j++)
          for (let i = 0; i <= GRID; i++) {
            const fx = i / GRID; // local x: 0 → 1
            const fy = j / GRID; // local y: 0 → 1
            const o = (n * VERTS + j * (GRID + 1) + i) * 2;
            if (d.orientation === 'splat') {
              U[o] = u0 + (u1 - u0) * (1 - fy);
              U[o + 1] = v0 + (v1 - v0) * (1 - fx);
            } else {
              U[o] = u0 + (u1 - u0) * fx;
              U[o + 1] = v0 + (v1 - v0) * (1 - fy);
            }
          }
        for (let k = 0; k < VERTS; k++) C.set(d.color, (n * VERTS + k) * 4);
      });
      for (const name of ['position', 'uv', 'color']) b.geo.getAttribute(name).needsUpdate = true;
      b.geo.setDrawRange(0, list.length * GRID * GRID * 6);
    }
  }
}

/** Mix of two 0–255 RGBA colours → linear RGB + alpha 0–1. */
function mixColor(a: number[], b: number[], t: number): [number, number, number, number] {
  const f = Math.max(0, Math.min(1, t));
  const m = (i: number) => (a[i] + (b[i] - a[i]) * f) / 255;
  return [toLinear(m(0)), toLinear(m(1)), toLinear(m(2)), m(3)];
}
