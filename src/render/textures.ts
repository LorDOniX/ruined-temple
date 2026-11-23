/**
 * Procedural stand-ins for the Warcraft 3 terrain textures.
 *
 * They use exactly the same layout as the original "extended" tileset textures (512x256):
 *   left 4x4 cells  – blend masks, cell index = bitset of corners that use this texture
 *                     (1 = bottom-right, 2 = bottom-left, 4 = top-right, 8 = top-left; 0 and 15 are full tiles)
 *   right 4x4 cells – 16 full-tile variations
 * so that real textures from TerrainArt\*.blp can be dropped in without touching the shader.
 */

export interface TileStyle {
  name: string;
  /** Guessed original texture path (TerrainArt\...) – overridden by catalog.json when game data is available. */
  file: string;
  base: [number, number, number];
  accent: [number, number, number];
  pattern: 'noise' | 'pebbles' | 'grass' | 'bricksSmall' | 'bricksLarge' | 'roundTiles' | 'sand' | 'rock' | 'blight';
}

/** Sunken Ruins (tileset Z) ground tiles + a few generic fallbacks. */
export const TILE_STYLES: Record<string, TileStyle> = {
  Zdrt: { name: 'Dirt', file: 'TerrainArt\\Ruins\\Ruins_Dirt', base: [112, 88, 60], accent: [88, 68, 46], pattern: 'noise' },
  Zdtr: { name: 'Rough Dirt', file: 'TerrainArt\\Ruins\\Ruins_DirtRough', base: [98, 80, 58], accent: [70, 58, 42], pattern: 'pebbles' },
  Zdrg: { name: 'Grassy Dirt', file: 'TerrainArt\\Ruins\\Ruins_DirtGrass', base: [100, 98, 58], accent: [74, 92, 44], pattern: 'grass' },
  Zbks: { name: 'Small Bricks', file: 'TerrainArt\\Ruins\\Ruins_SmallBricks', base: [138, 128, 106], accent: [92, 84, 70], pattern: 'bricksSmall' },
  Zsan: { name: 'Sand', file: 'TerrainArt\\Ruins\\Ruins_Sand', base: [178, 160, 116], accent: [150, 132, 94], pattern: 'sand' },
  Zbkl: { name: 'Large Bricks', file: 'TerrainArt\\Ruins\\Ruins_LargeBricks', base: [126, 118, 100], accent: [82, 76, 64], pattern: 'bricksLarge' },
  Ztil: { name: 'Round Tiles', file: 'TerrainArt\\Ruins\\Ruins_RoundTiles', base: [132, 126, 112], accent: [90, 86, 76], pattern: 'roundTiles' },
  Zgrs: { name: 'Grass', file: 'TerrainArt\\Ruins\\Ruins_Grass', base: [68, 104, 44], accent: [50, 82, 32], pattern: 'grass' },
  Zvin: { name: 'Dark Grass', file: 'TerrainArt\\Ruins\\Ruins_GrassDark', base: [44, 78, 38], accent: [30, 60, 28], pattern: 'grass' },
};

export const CLIFF_STYLES: Record<string, TileStyle & { groundTile: string; modelDir: string; rampDir: string }> = {
  CZdi: { name: 'Dirt Cliff', file: 'ReplaceableTextures\\Cliff\\Cliff0', base: [104, 86, 66], accent: [70, 58, 46], pattern: 'rock', groundTile: 'Zdrt', modelDir: 'Cliffs', rampDir: 'CliffTrans' },
  CZlb: { name: 'Large Bricks Cliff', file: 'ReplaceableTextures\\Cliff\\Cliff1', base: [120, 114, 100], accent: [76, 72, 64], pattern: 'bricksLarge', groundTile: 'Zbkl', modelDir: 'CityCliffs', rampDir: 'CityCliffTrans' },
};

export const BLIGHT_STYLE: TileStyle = { name: 'Blight', file: 'TerrainArt\\Blight\\Ruins_Blight', base: [70, 60, 78], accent: [40, 34, 46], pattern: 'blight' };

export const LAYER_W = 512;
export const LAYER_H = 256;

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Tileable fbm over a 64x64 cell. */
function fbm(x: number, y: number, seed: number) {
  let v = 0;
  let amp = 0.5;
  let f = 4;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise((x / 64) * f, (y / 64) * f, f, seed + o * 17);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

/** Returns [shade 0..1, accentMix 0..1] for a pixel of a 64x64 tile. */
function patternAt(style: TileStyle, x: number, y: number, seed: number): [number, number] {
  const n = fbm(x, y, seed);
  switch (style.pattern) {
    case 'pebbles': {
      const cx = Math.floor(x / 8);
      const cy = Math.floor(y / 8);
      const px = cx * 8 + 4 + (hash(cx, cy, seed) - 0.5) * 4;
      const py = cy * 8 + 4 + (hash(cy, cx, seed) - 0.5) * 4;
      const r = 1.5 + hash(cx, cy, seed + 1) * 2;
      const inside = Math.hypot(x - px, y - py) < r && hash(cx, cy, seed + 2) > 0.45;
      return [0.75 + n * 0.5, inside ? 0.9 : n * 0.5];
    }
    case 'grass': {
      const blade = hash(Math.floor(x), Math.floor(y / 3), seed) > 0.7 ? 0.25 : 0;
      return [0.7 + n * 0.55 + blade, Math.max(0, n - 0.35) * 1.5];
    }
    case 'bricksSmall':
    case 'bricksLarge': {
      const bw = style.pattern === 'bricksSmall' ? 16 : 32;
      const bh = style.pattern === 'bricksSmall' ? 8 : 16;
      const row = Math.floor(y / bh);
      const off = (row % 2) * (bw / 2);
      const bx = (x + off) % bw;
      const by = y % bh;
      const mortar = bx < 1.5 || by < 1.5;
      const brickShade = 0.85 + hash(Math.floor((x + off) / bw), row, seed) * 0.3;
      return [mortar ? 0.55 : brickShade * (0.85 + n * 0.3), mortar ? 1 : n * 0.3];
    }
    case 'roundTiles': {
      const s = 16;
      const cx = (Math.floor(x / s) + 0.5) * s;
      const cy = (Math.floor(y / s) + 0.5) * s;
      const d = Math.hypot(x - cx, y - cy);
      const ring = d > s * 0.42 ? 1 : 0;
      return [ring ? 0.6 : 0.9 + n * 0.25, ring ? 1 : n * 0.25];
    }
    case 'sand':
      return [0.85 + n * 0.3 + Math.sin((x + n * 20) * 0.4) * 0.04, n * 0.4];
    case 'rock': {
      const crack = Math.abs(fbm(x * 1.7, y * 0.6, seed + 9) - 0.5) < 0.03;
      return [0.65 + n * 0.6, crack ? 1 : n * 0.6];
    }
    case 'blight':
      return [0.6 + n * 0.6, n];
    default:
      return [0.7 + n * 0.6, Math.max(0, n - 0.4) * 1.4];
  }
}

const CORNERS: [number, number, number][] = [
  // bit, x, y (tile local, y up)
  [1, 1, 0],
  [2, 0, 0],
  [4, 1, 1],
  [8, 0, 1],
];

function maskAt(bits: number, u: number, v: number, seed: number) {
  if (bits === 0 || bits === 15) return 1;
  let a = 0;
  const wobble = (valueNoise(u * 6, v * 6, 6, seed) - 0.5) * 0.18;
  for (const [bit, cx, cy] of CORNERS) {
    if (!(bits & bit)) continue;
    const d = Math.hypot(u - cx, v - cy) + wobble;
    a = Math.max(a, 1 - smoothstep(0.42, 0.62, d));
  }
  return a;
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Generates one 512x256 RGBA layer in the extended tileset layout. */
export function generateTileLayer(style: TileStyle, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(LAYER_W * LAYER_H * 4);
  const cell = 64;
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      const isMask = cx < 4;
      const bits = isMask ? cy * 4 + cx : 15;
      const varSeed = seed * 31 + (isMask ? 0 : cy * 4 + (cx - 4));
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          const [shade, accent] = patternAt(style, px, py, isMask ? seed : varSeed);
          const u = (px + 0.5) / cell;
          const v = 1 - (py + 0.5) / cell;
          const alpha = isMask ? maskAt(bits, u, v, seed) : 1;
          const o = ((cy * cell + py) * LAYER_W + cx * cell + px) * 4;
          for (let c = 0; c < 3; c++) {
            const col = style.base[c] * (1 - accent) + style.accent[c] * accent;
            out[o + c] = col * shade;
          }
          out[o + 3] = alpha * 255;
        }
      }
    }
  }
  return out;
}

/** Resamples a texture into a terrain layer of the given size (box filter when shrinking). */
export function layerFromImage(img: { width: number; height: number; data: Uint8ClampedArray }, width = LAYER_W, height = LAYER_H): { data: Uint8ClampedArray; extended: boolean } {
  return { data: resample(img, width, height), extended: img.width > img.height };
}

export function resample(img: { width: number; height: number; data: Uint8ClampedArray }, width: number, height: number) {
  if (img.width === width && img.height === height) return new Uint8ClampedArray(img.data);
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  const fx = Math.max(1, Math.round(sx));
  const fy = Math.max(1, Math.round(sy));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const y0 = Math.floor(y * sy);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < fy; dy++) {
        for (let dx = 0; dx < fx; dx++) {
          const s = (Math.min(img.height - 1, y0 + dy) * img.width + Math.min(img.width - 1, x0 + dx)) * 4;
          r += img.data[s];
          g += img.data[s + 1];
          b += img.data[s + 2];
          a += img.data[s + 3];
        }
      }
      const n = fx * fy;
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}
