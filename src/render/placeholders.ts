import * as THREE from 'three';

/**
 * Simple stand-in geometry used until the original MDX models are available.
 * All shapes are built Z-up and face +X (Warcraft 3 convention), with the origin on the ground.
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function mat(color: number, opts: { emissive?: number; transparent?: boolean; opacity?: number; flat?: boolean } = {}) {
  const key = `${color}|${opts.emissive ?? 0}|${opts.opacity ?? 1}|${opts.flat ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive ?? 0,
      transparent: opts.transparent || (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      flatShading: opts.flat ?? false,
      depthWrite: (opts.opacity ?? 1) >= 1,
    });
    matCache.set(key, m);
  }
  return m;
}

const zUp = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2);

const cylinder = (rt: number, rb: number, h: number, seg = 10) => geo(`cyl${rt}|${rb}|${h}|${seg}`, () => zUp(new THREE.CylinderGeometry(rt, rb, h, seg)).translate(0, 0, h / 2));
const cone = (r: number, h: number, seg = 10) => geo(`cone${r}|${h}|${seg}`, () => zUp(new THREE.ConeGeometry(r, h, seg)).translate(0, 0, h / 2));
const box = (x: number, y: number, z: number) => geo(`box${x}|${y}|${z}`, () => new THREE.BoxGeometry(x, y, z).translate(0, 0, z / 2));
const sphere = (r: number, d = 1) => geo(`sph${r}|${d}`, () => new THREE.IcosahedronGeometry(r, d));
const dodeca = (r: number) => geo(`dod${r}`, () => new THREE.DodecahedronGeometry(r, 0));

function add(group: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

export const ATTACK_COLORS: Record<string, number> = {
  normal: 0xc8c8c8,
  pierce: 0x6fbf4a,
  siege: 0xd08a3c,
  magic: 0x5a8cff,
  chaos: 0xe04848,
  spells: 0xb060ff,
  hero: 0xffd040,
};

export function towerPlaceholder(attackType: string, roof: number, tier: number) {
  const g = new THREE.Group();
  const stone = mat(0x9b8f7a, { flat: true });
  add(g, box(110, 110, 24), mat(0x6f665a, { flat: true }));
  add(g, cylinder(34, 42, 130 + tier * 18, 8), stone, 0, 0, 24);
  add(g, cylinder(48, 40, 18, 8), stone, 0, 0, 154 + tier * 18);
  add(g, cone(46, 60, 8), mat(roof, { flat: true }), 0, 0, 172 + tier * 18);
  add(g, sphere(12, 0), mat(ATTACK_COLORS[attackType] ?? 0xffffff, { emissive: ATTACK_COLORS[attackType] ?? 0xffffff }), 0, 0, 238 + tier * 18);
  return g;
}

export function auraTowerPlaceholder() {
  const g = new THREE.Group();
  add(g, box(110, 110, 24), mat(0x6f665a, { flat: true }));
  add(g, cylinder(20, 36, 150, 6), mat(0xb8b0a0, { flat: true }), 0, 0, 24);
  add(g, sphere(26, 1), mat(0x60c0ff, { emissive: 0x2060a0 }), 0, 0, 200);
  return g;
}

export function creepPlaceholder(color: number, size: number, flying: boolean) {
  const g = new THREE.Group();
  const m = mat(color, { flat: true });
  if (flying) {
    add(g, sphere(size * 0.6, 0), m, 0, 0, 0);
    const wing = add(g, box(size * 0.5, size * 2.6, 4), mat(color, { flat: true }), 0, 0, -2);
    wing.rotation.x = 0.15;
  } else {
    add(g, cylinder(size * 0.45, size * 0.55, size * 1.1, 7), m);
    add(g, sphere(size * 0.38, 0), m, size * 0.15, 0, size * 1.35);
    add(g, box(size * 0.4, size * 0.12, size * 0.12), mat(0x222222), size * 0.5, 0, size * 1.3);
  }
  return g;
}

export function builderPlaceholder(color: number, flying: boolean) {
  const g = new THREE.Group();
  const m = mat(color, { flat: true });
  if (flying) {
    add(g, sphere(22, 0), m, 0, 0, 0);
    add(g, box(10, 90, 6), mat(0x8a6a3a), 0, 0, 10);
  } else {
    add(g, cylinder(12, 16, 40, 7), m);
    add(g, sphere(12, 0), mat(0xe0c090, { flat: true }), 0, 0, 50);
    add(g, box(40, 6, 6), mat(0x6a4a2a), 12, 10, 30).rotation.y = -0.6;
  }
  return g;
}

export function buildingPlaceholder(kind: 'spawning' | 'shop', color: number) {
  const g = new THREE.Group();
  if (kind === 'spawning') {
    add(g, cylinder(150, 170, 40, 10), mat(0x4a6a6a, { flat: true }));
    add(g, cylinder(60, 110, 140, 10), mat(0x3a8a8a, { flat: true }), 0, 0, 40);
    add(g, sphere(40, 1), mat(color, { emissive: color }), 0, 0, 200);
  } else {
    add(g, cylinder(110, 140, 60, 8), mat(0x6a7a8a, { flat: true }));
    add(g, cylinder(30, 60, 260, 8), mat(0x8aa0b0, { flat: true }), 0, 0, 60);
    add(g, sphere(34, 1), mat(0x80e0ff, { emissive: 0x2080a0 }), 0, 0, 340);
  }
  return g;
}

export type DoodadShape = 'none' | 'plant' | 'rock' | 'object' | 'structure' | 'wall' | 'portal' | 'gate' | 'portcullis' | 'spawn' | 'vine' | 'tree' | 'misc';

/** Heuristic category from the 4-char doodad id (tileset letter + category letter + name). */
export function doodadShape(id: string): DoodadShape {
  if (id.startsWith('YT')) return 'none'; // pathing blockers
  if (id === 'D004') return 'spawn';
  if (/^D00[0-3]$/.test(id)) return 'wall';
  if (id === 'OTsp') return 'portal';
  if (id === 'ZTsg') return 'gate';
  if (id === 'ZTg1') return 'portcullis';
  if (id === 'ZCv1' || id === 'ZCv2') return 'vine';
  switch (id[1]) {
    case 'P':
      return 'plant';
    case 'R':
      return 'rock';
    case 'O':
      return 'object';
    case 'S':
      return 'structure';
    case 'T':
      return 'tree';
    default:
      return 'misc';
  }
}

export function doodadPlaceholder(id: string, variation: number): THREE.Group {
  const g = new THREE.Group();
  const shape = doodadShape(id);
  const v = (variation * 37 + id.charCodeAt(2) * 13 + id.charCodeAt(3)) % 100;
  switch (shape) {
    case 'none':
      break;
    case 'plant': {
      const c = [0x4f7a2a, 0x5c8a34, 0x3e6a2a, 0x6a8a3a][v % 4];
      add(g, cone(14 + (v % 10), 30 + (v % 25), 5), mat(c, { flat: true }));
      add(g, cone(10, 22, 5), mat(c, { flat: true }), 10, 6, 0);
      break;
    }
    case 'rock':
      add(g, dodeca(18 + (v % 22)), mat(0x7d776c, { flat: true }), 0, 0, 8).scale.set(1.2, 1, 0.7);
      break;
    case 'object':
      if (v % 3 === 0) add(g, cylinder(14, 16, 70 + (v % 60), 8), mat(0xa89a80, { flat: true }));
      else add(g, box(40 + (v % 30), 30, 24 + (v % 30)), mat(0x988b74, { flat: true }));
      break;
    case 'structure':
      add(g, box(80, 80, 110), mat(0x8e836e, { flat: true }));
      add(g, box(96, 96, 16), mat(0x7a705e, { flat: true }), 0, 0, 110);
      break;
    case 'wall':
      add(g, box(128, 40, 130), mat(0x8d826c, { flat: true }));
      break;
    case 'vine':
      add(g, box(8, 60, 80), mat(0x3a6a2a, { opacity: 0.85 }));
      break;
    case 'tree':
      add(g, cylinder(10, 14, 90, 6), mat(0x5a4030, { flat: true }));
      add(g, cone(55, 140, 7), mat(0x2f5a2a, { flat: true }), 0, 0, 70);
      break;
    case 'portal': {
      const ring = add(g, geo('torus', () => new THREE.TorusGeometry(90, 14, 10, 32)), mat(0x9a50ff, { emissive: 0x5020a0 }), 0, 0, 110);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.y = Math.PI / 2;
      add(g, geo('portaldisc', () => new THREE.CircleGeometry(80, 32)), mat(0x6a2aff, { emissive: 0x3a10a0, opacity: 0.55 }), 0, 0, 110).rotation.y = Math.PI / 2;
      break;
    }
    case 'gate':
      add(g, box(40, 300, 220), mat(0x6a5a44, { flat: true }));
      add(g, box(50, 40, 260), mat(0x8d826c, { flat: true }), 0, 170, 0);
      add(g, box(50, 40, 260), mat(0x8d826c, { flat: true }), 0, -170, 0);
      break;
    case 'portcullis':
      add(g, box(20, 220, 180), mat(0x4a4a50, { flat: true }));
      break;
    case 'spawn':
      add(g, geo('spawnring', () => new THREE.TorusGeometry(120, 10, 8, 32)), mat(0x40c0ff, { emissive: 0x2070a0 }), 0, 0, 6);
      break;
    default:
      add(g, box(40, 40, 40), mat(0xa0a0a0, { flat: true }));
  }
  return g;
}

export function missilePlaceholder(color: number) {
  const g = new THREE.Group();
  add(g, sphere(9, 0), mat(color, { emissive: color }));
  return g;
}

export function ringMesh(radius: number, color: number, opacity = 0.9, width = 6) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(radius - width, radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = 5;
  return m;
}

export function hashColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const c = new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.55, 0.5);
  return c.getHex();
}
