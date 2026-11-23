import * as THREE from 'three';
import type { TerrainData } from '../data/types';
import { BLIGHT_STYLE, CLIFF_STYLES, LAYER_H, LAYER_W, TILE_STYLES, generateTileLayer, resample, type TileStyle } from './textures';

/** Terrain queries on the w3e corner grid. Heights follow mdx-m3-viewer: (groundHeight + layerHeight - 2) * 128. */
export class TerrainGrid {
  readonly cols: number; // tiles
  readonly rows: number;
  readonly ox: number;
  readonly oy: number;
  readonly cornerHeight: Float32Array;
  /** Tiles (y * cols + x) covered by a ramp model (HiveWE "romp"); filled by cliffInstances. */
  readonly romp = new Set<number>();

  constructor(readonly t: TerrainData) {
    this.cols = t.columns - 1;
    this.rows = t.rows - 1;
    [this.ox, this.oy] = t.centerOffset;
    this.cornerHeight = new Float32Array(t.columns * t.rows);
    for (let i = 0; i < this.cornerHeight.length; i++) this.cornerHeight[i] = (t.groundHeight[i] + t.layerHeight[i] - 2) * 128;
    // Ramp entrances: the lower corners of a tile inside a ramp are lifted by half a cliff layer (like HiveWE / the game).
    for (let y = 0; y < t.rows; y++)
      for (let x = 0; x < t.columns; x++)
        for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) continue;
          const base = Math.min(this.layer(tx, ty), this.layer(tx + 1, ty), this.layer(tx, ty + 1), this.layer(tx + 1, ty + 1));
          if (this.layer(x, y) !== base || !this.isRampEntrance(tx, ty)) continue;
          this.cornerHeight[this.idx(x, y)] += 64;
          break;
        }
  }

  idx(x: number, y: number) {
    return y * this.t.columns + x;
  }

  layer(x: number, y: number) {
    return this.t.layerHeight[this.idx(x, y)];
  }

  isCliff(x: number, y: number) {
    if (x < 1 || x > this.cols - 1 || y < 1 || y > this.rows - 1) return false;
    const a = this.layer(x, y);
    return a !== this.layer(x + 1, y) || a !== this.layer(x, y + 1) || a !== this.layer(x + 1, y + 1);
  }

  rampCorner(x: number, y: number) {
    return (this.t.flags[this.idx(x, y)] & 1) !== 0;
  }

  /** A tile inside a ramp (all corners flagged, not a flat diagonal) – drawn as ground. */
  isRampEntrance(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    const r = (dx: number, dy: number) => this.rampCorner(x + dx, y + dy);
    if (!(r(0, 0) && r(1, 0) && r(0, 1) && r(1, 1))) return false;
    return !(this.layer(x, y) === this.layer(x + 1, y + 1) && this.layer(x, y + 1) === this.layer(x + 1, y));
  }

  isRamp(x: number, y: number) {
    const f = this.t.flags;
    let n = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (f[this.idx(x + dx, y + dy)] & 1) n++;
    return n >= 2;
  }

  cliffTextureAt(x: number, y: number) {
    const c = this.t.cliffTexture[this.idx(x, y)];
    return c === 15 ? 1 : c;
  }

  /**
   * Ground texture of a corner – cliff and ramp-model neighbours force the cliff's ground tile, like the game
   * (HiveWE real_tile_texture); a ramp interior keeps its own texture.
   */
  cornerTexture(x: number, y: number, cliffGroundIndex: (cliff: number) => number, blightIndex: number) {
    const romp = (tx: number, ty: number) => this.romp.has(ty * this.cols + tx);
    search: for (let dy = -1; dy < 1; dy++) {
      for (let dx = -1; dx < 1; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
        const cliff = this.isCliff(cx, cy);
        if (cliff) {
          const allRamp = this.rampCorner(cx, cy) && this.rampCorner(cx + 1, cy) && this.rampCorner(cx, cy + 1) && this.rampCorner(cx + 1, cy + 1);
          if (allRamp && !romp(cx, cy) && !romp(cx + 1, cy) && !romp(cx, cy + 1) && !romp(cx + 1, cy + 1)) break search;
        }
        if (cliff || romp(cx, cy)) return cliffGroundIndex(this.cliffTextureAt(cx, cy));
      }
    }
    const i = this.idx(x, y);
    if (this.t.flags[i] & 2) return blightIndex;
    return this.t.groundTexture[i];
  }

  /** Interpolated ground height at world position. */
  heightAt(wx: number, wy: number) {
    const fx = Math.min(Math.max((wx - this.ox) / 128, 0), this.cols - 0.0001);
    const fy = Math.min(Math.max((wy - this.oy) / 128, 0), this.rows - 0.0001);
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    const sx = fx - cx;
    const sy = fy - cy;
    const h = this.cornerHeight;
    const i = this.idx(cx, cy);
    const c = this.t.columns;
    const bl = h[i];
    const br = h[i + 1];
    const tl = h[i + c];
    const tr = h[i + c + 1];
    // Same triangle split as the mesh (bl-br-tl / br-tr-tl).
    if (sx + sy < 1) return bl + (br - bl) * sx + (tl - bl) * sy;
    return tr + (tl - tr) * (1 - sx) + (br - tr) * (1 - sy);
  }

  get width() {
    return this.cols * 128;
  }
  get height() {
    return this.rows * 128;
  }
}

export interface TerrainLayerSource {
  /** RGBA 512x256 in extended layout, or real texture resampled by layerFromImage. */
  data: Uint8ClampedArray;
  extended: boolean;
}

export interface TerrainOptions {
  /** Real ground textures in the order of terrain.groundTilesets (null entries fall back to procedural). */
  groundLayers?: (TerrainLayerSource | null)[];
  cliffLayers?: (TerrainLayerSource | null)[];
  /** Cliff tile id → ground tile id (from CliffTypes.slk). */
  cliffGroundTiles?: Record<string, string>;
  /** Cliff tiles (index y * cols + x) that are covered by original cliff models and must stay empty. */
  cliffModelTiles?: Set<number>;
  shadows?: { width: number; height: number; data: Uint8Array } | null;
  /** Size of every texture-array layer; real layers must already have this size (see layerFromImage). */
  layerSize?: [number, number];
}

export function buildTerrainMesh(grid: TerrainGrid, opts: TerrainOptions = {}) {
  const t = grid.t;
  const groundStyles: TileStyle[] = t.groundTilesets.map((id) => TILE_STYLES[id] ?? { ...TILE_STYLES.Zdrt, name: id });
  const cliffStyles: TileStyle[] = t.cliffTilesets.map((id) => CLIFF_STYLES[id] ?? { ...CLIFF_STYLES.CZdi, name: id });

  // Layers: ground tilesets, blight, cliffs. Procedural stand-ins are scaled up to the layer size of real textures.
  const [LW, LH] = opts.layerSize ?? [LAYER_W, LAYER_H];
  const generated = (s: TileStyle, seed: number): TerrainLayerSource => ({
    data: resample({ width: LAYER_W, height: LAYER_H, data: generateTileLayer(s, seed) }, LW, LH),
    extended: true,
  });
  const layers: TerrainLayerSource[] = [];
  groundStyles.forEach((s, i) => layers.push(opts.groundLayers?.[i] ?? generated(s, i + 1)));
  const blightIndex = layers.length;
  layers.push(generated(BLIGHT_STYLE, 99));
  const cliffBase = layers.length;
  cliffStyles.forEach((s, i) => layers.push(opts.cliffLayers?.[i] ?? generated(s, 50 + i)));

  const cliffGroundIndex = (cliff: number) => {
    const cliffId = t.cliffTilesets[cliff] ?? t.cliffTilesets[0];
    const tile = opts.cliffGroundTiles?.[cliffId] ?? CLIFF_STYLES[cliffId]?.groundTile;
    const i = tile ? t.groundTilesets.indexOf(tile) : -1;
    return i >= 0 ? i : 0;
  };

  const getVariation = (layer: number, variation: number) => {
    if (layers[layer].extended) {
      if (variation < 16) return 16 + variation;
      if (variation === 16) return 15;
      return 0;
    }
    return variation === 0 ? 0 : 15;
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const local: number[] = [];
  const texAttr: number[] = [];
  const varAttr: number[] = [];
  const indices: number[] = [];
  const C = t.columns;
  const H = grid.cornerHeight;

  const normalAt = (x: number, y: number) => {
    const h = (cx: number, cy: number) => H[Math.min(Math.max(cy, 0), t.rows - 1) * C + Math.min(Math.max(cx, 0), C - 1)];
    const n = new THREE.Vector3(h(x - 1, y) - h(x + 1, y), h(x, y - 1) - h(x, y + 1), 256).normalize();
    return n;
  };

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const cliff = grid.isCliff(x, y) && !grid.isRamp(x, y);
      if (cliff && opts.cliffModelTiles?.has(y * grid.cols + x)) continue;

      const tex = [0, 0, 0, 0];
      const vars = [0, 0, 0, 0];
      if (cliff) {
        // Fallback: draw the cliff face as steep ground with the cliff texture projected in world space.
        tex[0] = cliffBase + grid.cliffTextureAt(x, y) + 1;
        vars[0] = 255;
      } else {
        const bl = grid.cornerTexture(x, y, cliffGroundIndex, blightIndex);
        const br = grid.cornerTexture(x + 1, y, cliffGroundIndex, blightIndex);
        const tl = grid.cornerTexture(x, y + 1, cliffGroundIndex, blightIndex);
        const tr = grid.cornerTexture(x + 1, y + 1, cliffGroundIndex, blightIndex);
        const unique = [...new Set([bl, br, tl, tr])].sort((a, b) => a - b);
        tex[0] = unique[0] + 1;
        vars[0] = getVariation(unique[0], t.groundVariation[grid.idx(x, y)]);
        for (let k = 1; k < unique.length; k++) {
          const u = unique[k];
          let bits = 0;
          if (br === u) bits |= 1;
          if (bl === u) bits |= 2;
          if (tr === u) bits |= 4;
          if (tl === u) bits |= 8;
          tex[k] = u + 1;
          vars[k] = bits;
        }
      }

      const base = positions.length / 3;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = x + dx;
        const cy = y + dy;
        positions.push(grid.ox + cx * 128, grid.oy + cy * 128, H[cy * C + cx]);
        const n = normalAt(cx, cy);
        normals.push(n.x, n.y, n.z);
        local.push(dx, dy);
        texAttr.push(...tex);
        varAttr.push(...vars);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(local, 2));
  geo.setAttribute('aTex', new THREE.Float32BufferAttribute(texAttr, 4));
  geo.setAttribute('aVar', new THREE.Float32BufferAttribute(varAttr, 4));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

  const array = new Uint8Array(LW * LH * 4 * layers.length);
  layers.forEach((l, i) => array.set(l.data, i * LW * LH * 4));
  const tileTex = new THREE.DataArrayTexture(array, LW, LH, layers.length);
  tileTex.format = THREE.RGBAFormat;
  tileTex.colorSpace = THREE.SRGBColorSpace;
  tileTex.magFilter = THREE.LinearFilter;
  tileTex.minFilter = THREE.LinearMipmapLinearFilter;
  tileTex.generateMipmaps = true;
  tileTex.anisotropy = 4;
  tileTex.needsUpdate = true;

  let shadowTex: THREE.DataTexture;
  if (opts.shadows) {
    const s = opts.shadows;
    shadowTex = new THREE.DataTexture(s.data, s.width, s.height, THREE.RedFormat, THREE.UnsignedByteType);
    shadowTex.magFilter = THREE.LinearFilter;
    shadowTex.minFilter = THREE.LinearFilter;
  } else {
    shadowTex = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  }
  shadowTex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTiles: { value: tileTex },
      uExtended: { value: layers.map((l) => (l.extended ? 1 : 0)) },
      uPixel: { value: new THREE.Vector2(1 / LW, 1 / LH) },
      uShadow: { value: shadowTex },
      uMapOrigin: { value: new THREE.Vector2(grid.ox, grid.oy) },
      uMapSize: { value: new THREE.Vector2(grid.width, grid.height) },
      uSunDir: { value: new THREE.Vector3(-0.3, -0.3, 0.9).normalize() },
      uAmbient: { value: new THREE.Color(0.55, 0.55, 0.6) },
      uSun: { value: new THREE.Color(0.75, 0.72, 0.65) },
      uOverlay: { value: null as THREE.Texture | null },
      uOverlayStrength: { value: 0 },
      uPlayable: { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) },
    },
    vertexShader: /* glsl */ `
      in vec2 aLocal;
      in vec4 aTex;
      in vec4 aVar;
      out vec2 vLocal;
      flat out vec4 vTex;
      flat out vec4 vVar;
      out vec3 vNormal;
      out vec3 vWorld;
      void main() {
        vLocal = aLocal;
        vTex = aTex;
        vVar = aVar;
        vNormal = normal;
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler2DArray;
      layout(location = 0) out highp vec4 outColor;
      #define gl_FragColor outColor
      uniform sampler2DArray uTiles;
      uniform float uExtended[${layers.length}];
      uniform vec2 uPixel;
      uniform sampler2D uShadow;
      uniform sampler2D uOverlay;
      uniform float uOverlayStrength;
      uniform vec4 uPlayable;
      uniform vec2 uMapOrigin;
      uniform vec2 uMapSize;
      uniform vec3 uSunDir;
      uniform vec3 uAmbient;
      uniform vec3 uSun;
      in vec2 vLocal;
      flat in vec4 vTex;
      flat in vec4 vVar;
      in vec3 vNormal;
      in vec3 vWorld;

      vec2 getCell(float variation) {
        if (variation < 16.0) return vec2(mod(variation, 4.0), floor(variation / 4.0));
        variation -= 16.0;
        return vec2(4.0 + mod(variation, 4.0), floor(variation / 4.0));
      }

      vec4 sampleTile(float tex, float variation) {
        int layer = int(tex - 0.5);
        if (variation > 254.0) {
          // Cliff fallback: world-space projection so steep faces are not smeared.
          vec2 uv = vec2(vWorld.x + vWorld.y, vWorld.z) / 128.0;
          vec2 cell = vec2(4.0, 0.0) + vec2(mod(floor(uv.x), 4.0), mod(floor(uv.y), 4.0));
          vec2 st = (cell + fract(uv)) * vec2(0.125, 0.25);
          return textureGrad(uTiles, vec3(st, float(layer)), dFdx(uv) * vec2(0.125, 0.25), dFdy(uv) * vec2(0.125, 0.25));
        }
        bool extended = uExtended[layer] > 0.5;
        vec2 cell = getCell(variation);
        vec2 cellSize = vec2(extended ? 0.125 : 0.25, 0.25);
        vec2 uv = vec2(vLocal.x, 1.0 - vLocal.y);
        vec2 st = clamp((cell + uv) * cellSize, cell * cellSize + uPixel, (cell + 1.0) * cellSize - uPixel);
        return textureGrad(uTiles, vec3(st, float(layer)), dFdx(vLocal * cellSize), dFdy(vLocal * cellSize));
      }

      void main() {
        vec4 color = sampleTile(vTex.x, vVar.x);
        if (vTex.y > 0.5) { vec4 t = sampleTile(vTex.y, vVar.y); color.rgb = mix(color.rgb, t.rgb, t.a); }
        if (vTex.z > 0.5) { vec4 t = sampleTile(vTex.z, vVar.z); color.rgb = mix(color.rgb, t.rgb, t.a); }
        if (vTex.w > 0.5) { vec4 t = sampleTile(vTex.w, vVar.w); color.rgb = mix(color.rgb, t.rgb, t.a); }

        vec3 n = normalize(vNormal);
        float diffuse = max(dot(n, uSunDir), 0.0);
        vec2 mapUv = (vWorld.xy - uMapOrigin) / uMapSize;
        float shadow = texture(uShadow, mapUv).r;
        vec3 light = uAmbient + uSun * diffuse * (1.0 - shadow * 0.55);
        vec3 rgb = color.rgb * light;
        if (uOverlayStrength > 0.0) {
          vec4 o = texture(uOverlay, mapUv);
          rgb = mix(rgb, o.rgb, o.a * uOverlayStrength);
        }
        // Outside the playable area the game draws the map boundary black.
        if (vWorld.x < uPlayable.x || vWorld.y < uPlayable.y || vWorld.x > uPlayable.z || vWorld.y > uPlayable.w) rgb *= 0.12;
        gl_FragColor = vec4(rgb, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain';
  return { mesh, material, layerCount: layers.length };
}

export interface CliffInstance {
  path: string;
  /** Tiles (y * cols + x) the model covers – 1 for cliffs, 2 for ramps. */
  covers: number[];
  /** Footprint in tiles (ramps are 1×2 or 2×1). */
  w: number;
  h: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  z: number;
  texture: number;
}

/**
 * Bakes cliff model instances into one mesh per cliff texture. Like the game (and mdx-m3-viewer's cliffs.vert),
 * every vertex is lifted by the bilinear ground height (w3e groundHeight, without layers) of its tile within the
 * model footprint.
 */
export function buildCliffMeshes(grid: TerrainGrid, instances: CliffInstance[], models: Map<string, THREE.BufferGeometry[]>, materials: THREE.Material[]) {
  const t = grid.t;
  const gh = (x: number, y: number) => t.groundHeight[grid.idx(x, y)] * 128;
  const byTexture = new Map<number, { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }>();
  for (const inst of instances) {
    const geos = models.get(inst.path);
    if (!geos) continue;
    let acc = byTexture.get(inst.texture);
    if (!acc) byTexture.set(inst.texture, (acc = { pos: [], nrm: [], uv: [], idx: [] }));
    const lift = (px: number, py: number) => {
      // Model space: x from -128 * w (left) to 0 (right), y from 0 (bottom) to 128 * h.
      const fx = THREE.MathUtils.clamp(inst.w + px / 128, 0, inst.w);
      const fy = THREE.MathUtils.clamp(py / 128, 0, inst.h);
      const cx = Math.min(Math.floor(fx), inst.w - 1);
      const cy = Math.min(Math.floor(fy), inst.h - 1);
      const sx = fx - cx;
      const sy = fy - cy;
      const tx = inst.tx + cx;
      const ty = inst.ty + cy;
      const bottom = gh(tx, ty) + (gh(tx + 1, ty) - gh(tx, ty)) * sx;
      const top = gh(tx, ty + 1) + (gh(tx + 1, ty + 1) - gh(tx, ty + 1)) * sx;
      return bottom + (top - bottom) * sy;
    };
    for (const g of geos) {
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      const base = acc.pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i);
        const py = p.getY(i);
        acc.pos.push(px + inst.x, py + inst.y, p.getZ(i) + inst.z + lift(px, py));
        acc.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
        acc.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      }
      const index = g.getIndex()!;
      for (let i = 0; i < index.count; i++) acc.idx.push(base + index.getX(i));
    }
  }
  const group = new THREE.Group();
  group.name = 'cliffs';
  for (const [texture, a] of byTexture) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    geo.setIndex(a.idx);
    geo.computeBoundingSphere();
    group.add(new THREE.Mesh(geo, materials[texture] ?? materials[0]));
  }
  return group;
}

/**
 * Cliff and ramp model instances for when original models are available (port of mdx-m3-viewer / HiveWE).
 * Ramps: two tiles long transition models `<RampDir>\<RampDir><BL><TL><TR><BR>0` (corners of the 1?2 / 2?1
 * footprint, same order as cliffs; verified on the model geometry) where a non-ramp corner is 'A' + layer above the
 * base and a ramp corner 'L' (low) / 'H' (high); `exists` decides whether the model is available, otherwise the
 * tile falls back to a cliff. Detection follows HiveWE.
 */
export function cliffInstances(grid: TerrainGrid, cliffDirs: string[], rampDirs: string[] = [], exists: (path: string) => boolean = () => true) {
  const out: CliffInstance[] = [];
  const t = grid.t;
  const L = (x: number, y: number) => grid.layer(x, y);
  const R = (x: number, y: number) => grid.rampCorner(x, y);
  const ch = (x: number, y: number, base: number) => String.fromCharCode(R(x, y) ? 76 - (L(x, y) - base) * 4 : 65 + L(x, y) - base);
  const tile = (x: number, y: number) => y * grid.cols + x;
  grid.romp.clear();
  const ramp = (x: number, y: number, name: string, w: number, h: number) => {
    const texture = grid.cliffTextureAt(x, y);
    const dir = rampDirs[texture] || (cliffDirs[texture] === 'CityCliffs' ? 'CityCliffTrans' : 'CliffTrans');
    const path = `Doodads\\Terrain\\${dir}\\${dir}${name}0`;
    if (!exists(path)) return false;
    const base = Math.min(L(x, y), L(x + 1, y), L(x, y + 1), L(x + 1, y + 1));
    const covers = w === 1 ? [tile(x, y), tile(x, y + 1)] : [tile(x, y), tile(x + 1, y)];
    for (const c of covers) grid.romp.add(c);
    out.push({ path, covers, w, h, tx: x, ty: y, x: grid.ox + (x + w) * 128, y: grid.oy + y * 128, z: (base - 2) * 128, texture });
    return true;
  };
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      // Vertical ramp (tiles x,y and x,y+1).
      if (y < grid.rows - 1) {
        const ae = Math.min(L(x, y), L(x, y + 2));
        const cf = Math.min(L(x + 1, y), L(x + 1, y + 2));
        if (L(x, y + 1) === ae && L(x + 1, y + 1) === cf) {
          const base = Math.min(ae, cf);
          const left = R(x, y);
          const right = R(x + 1, y);
          if (left === R(x, y + 1) && left === R(x, y + 2) && right === R(x + 1, y + 1) && right === R(x + 1, y + 2) && left !== right) {
            const name = ch(x, y, base) + ch(x, y + 2, base) + ch(x + 1, y + 2, base) + ch(x + 1, y, base);
            if (ramp(x, y, name, 1, 2)) continue;
          }
        }
      }
      // Horizontal ramp (tiles x,y and x+1,y).
      if (x < grid.cols - 1) {
        const ae = Math.min(L(x, y), L(x + 2, y));
        const bf = Math.min(L(x, y + 1), L(x + 2, y + 1));
        if (L(x + 1, y) === ae && L(x + 1, y + 1) === bf) {
          const base = Math.min(ae, bf);
          const bottom = R(x, y);
          const top = R(x, y + 1);
          if (bottom === R(x + 1, y) && bottom === R(x + 2, y) && top === R(x + 1, y + 1) && top === R(x + 2, y + 1) && bottom !== top) {
            const name = ch(x, y, base) + ch(x, y + 1, base) + ch(x + 2, y + 1, base) + ch(x + 2, y, base);
            if (ramp(x, y, name, 2, 1)) continue;
          }
        }
      }
      if (!grid.isCliff(x, y) || grid.romp.has(tile(x, y)) || grid.isRampEntrance(x, y)) continue;
      const bl = grid.layer(x, y);
      const br = grid.layer(x + 1, y);
      const tl = grid.layer(x, y + 1);
      const tr = grid.layer(x + 1, y + 1);
      const base = Math.min(bl, br, tl, tr);
      const name = String.fromCharCode(65 + bl - base, 65 + tl - base, 65 + tr - base, 65 + br - base);
      if (name === 'AAAA') continue;
      const texture = grid.cliffTextureAt(x, y);
      const dir = cliffDirs[texture] ?? 'Cliffs';
      const variation = cliffVariation(dir, name, t.cliffVariation[grid.idx(x, y)]);
      out.push({ path: `Doodads\\Terrain\\${dir}\\${dir}${name}${variation}`, covers: [tile(x, y)], w: 1, h: 1, tx: x, ty: y, x: grid.ox + (x + 1) * 128, y: grid.oy + y * 128, z: (base - 2) * 128, texture });
    }
  }
  return out;
}

const CLIFF_VAR: Record<string, number> = { AAAB: 1, AAAC: 1, AABA: 1, AABB: 2, AACA: 1, AACC: 1, ABAA: 1, ABAB: 1, ABBA: 2, ABBB: 1, ACAA: 1, ACAC: 1, ACCA: 1, ACCC: 1, BAAA: 1, BAAB: 1, BABA: 1, BABB: 1, BBAA: 1, BBAB: 1, BBBA: 1, CAAA: 1, CAAC: 1, CACA: 1, CACC: 1, CCAA: 1, CCAC: 1, CCCA: 1 };
const CITY_CLIFF_VAR: Record<string, number> = { AAAB: 2, AAAC: 1, AABA: 1, AABB: 3, AACA: 1, AACC: 3, ABAA: 1, ABAB: 2, ABBA: 3, ACAA: 1, ACAC: 2, ACCA: 3, ACCC: 1, BAAA: 1, BAAB: 3, BABA: 2, BBAA: 3, BBAB: 1, BBBA: 1, CAAA: 1, CAAC: 3, CACA: 2, CACC: 1, CCAA: 3, CCAC: 1, CCCA: 1 };

function cliffVariation(dir: string, tag: string, variation: number) {
  const table = dir === 'Cliffs' ? CLIFF_VAR : CITY_CLIFF_VAR;
  return Math.min(variation, table[tag] ?? 0);
}
