import type { Wc3Assets } from '../render/mdx';

/** Cursor states = sequences of the race cursor model (UI\Cursor\HumanCursor.mdl). */
export type CursorState = 'Normal' | 'Select' | 'Target' | 'TargetSelect' | 'InvalidTarget' | 'Scroll';
export type CursorTint = 'none' | 'enemy' | 'friend' | 'neutral';

interface CursorSequence {
  /** Texture rectangle of the visible quad (u0, v0, u1, v1) before the texture animation. */
  rect: [number, number, number, number];
  /** Texture animation keys: time (s, from the sequence start) → UV translation. */
  frames: { t: number; du: number; dv: number }[];
  duration: number;
  /** Quad size in UI units (screen height = 0.6) and the hotspot (model origin) inside it, 0–1. */
  size: [number, number];
  hotspot: [number, number];
}

const TINTS: Record<Exclude<CursorTint, 'none'>, [number, number, number]> = { enemy: [255, 40, 40], friend: [40, 255, 40], neutral: [255, 255, 40] };
/** Scroll arrows: one quad rotated per direction (the texture arrow points right). */
const SCROLL_ANGLE: Record<string, number> = { '1,0': 0, '1,1': -45, '0,1': -90, '-1,1': -135, '-1,0': 180, '-1,-1': 135, '0,-1': 90, '1,-1': 45 };

/**
 * The game cursor drawn as a DOM sprite. The cursor model is a set of screen-space quads using one sprite sheet;
 * each sequence shows one quad (geoset alpha) whose texture coordinates are animated by translation keys (KTAT),
 * which is replayed here as background-position frames. Size is taken from the model in UI units (screen
 * height = 0.6), so the cursor scales with the resolution like the console. The system cursor stays visible
 * until the model has loaded.
 */
export class GameCursor {
  private el: HTMLDivElement;
  private seqs = new Map<string, CursorSequence>();
  private sheets = new Map<CursorTint, string>();
  private state: CursorState = 'Normal';
  private tint: CursorTint = 'none';
  private angle = 0;
  private time = 0;
  private x = -100;
  private y = -100;
  private ready = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'game-cursor';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    addEventListener('mousemove', (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
    });
    document.addEventListener('mouseleave', () => (this.el.hidden = true));
    document.addEventListener('mouseenter', () => (this.el.hidden = !this.ready));
  }

  async load(assets: Wc3Assets, path: string) {
    const model = await assets.loadRawModel(path).catch(() => null);
    if (!model) return;
    const texPath = (model.textures as any[]).find((t) => t.path)?.path;
    const img = texPath ? await assets.decodeImage(texPath) : null;
    if (!img) return;
    this.sheets.set('none', toUrl(img));
    for (const [k, c] of Object.entries(TINTS)) this.sheets.set(k as CursorTint, toUrl(tinted(img, c)));
    for (const s of model.sequences as any[]) {
      const seq = parseSequence(model, s);
      if (!seq) continue;
      const name = String(s.name).trim();
      // All "Scroll <dir>" sequences show the same arrow animation.
      this.seqs.set(name.startsWith('Scroll') ? 'Scroll' : name, seq);
    }
    if (!this.seqs.has('Normal')) return;
    this.ready = true;
    this.el.hidden = false;
    document.documentElement.classList.add('game-cursor');
  }

  /** @param dir edge scroll direction (x right, y up) for the Scroll state. */
  set(state: CursorState, tint: CursorTint = 'none', dir: [number, number] = [0, 0]) {
    if (!this.seqs.has(state)) state = 'Normal';
    if (state !== this.state) this.time = 0;
    this.state = state;
    this.tint = tint;
    this.angle = state === 'Scroll' ? SCROLL_ANGLE[`${dir[0]},${dir[1]}`] ?? 0 : 0;
  }

  update(dt: number) {
    if (!this.ready) return;
    this.time += dt;
    const seq = this.seqs.get(this.state)!;
    const sy = innerHeight / 0.6;
    const w = seq.size[0] * sy;
    const h = seq.size[1] * sy;
    // Looping texture animation; the last key holds until the end of the sequence.
    const t = seq.duration > 0 ? this.time % seq.duration : 0;
    let du = 0;
    let dv = 0;
    for (const f of seq.frames) {
      if (f.t > t) break;
      du = f.du;
      dv = f.dv;
    }
    const [u0, v0, u1, v1] = seq.rect;
    const bw = w / (u1 - u0);
    const bh = h / (v1 - v0);
    const s = this.el.style;
    s.width = `${w}px`;
    s.height = `${h}px`;
    s.backgroundImage = `url(${this.sheets.get(this.tint) ?? this.sheets.get('none')})`;
    s.backgroundSize = `${bw}px ${bh}px`;
    s.backgroundPosition = `${-(u0 + du) * bw}px ${-(v0 + dv) * bh}px`;
    s.transformOrigin = `${seq.hotspot[0] * 100}% ${seq.hotspot[1] * 100}%`;
    s.transform = `translate(${this.x - seq.hotspot[0] * w}px, ${this.y - seq.hotspot[1] * h}px) rotate(${this.angle}deg)`;
  }
}

/** The quad shown in a sequence (geoset alpha > 0 at its start) and its texture animation keys. */
export function parseSequence(model: any, s: any): CursorSequence | null {
  const [start, end] = [s.interval[0], s.interval[1]];
  const geosets = model.geosets as any[];
  for (let gi = 0; gi < geosets.length; gi++) {
    const g = geosets[gi];
    const ga = (model.geosetAnimations as any[]).find((a) => a.geosetId === gi);
    if (ga && trackAt(ga, 'KGAO', ga.alpha, start, end) < 0.5) continue;
    const layer = model.materials[g.materialId]?.layers?.[0];
    // Quads without the sprite sheet (e.g. the held item icon, replaceable texture) are not the cursor.
    if (!layer || !model.textures[layer.textureId]?.path) continue;
    const uv: Float32Array = g.uvSets[0];
    const v: Float32Array = g.vertices;
    const us = [0, 2, 4, 6].map((i) => uv[i]);
    const vs = [1, 3, 5, 7].map((i) => uv[i]);
    const xs = [0, 3, 6, 9].map((i) => v[i]);
    const ys = [1, 4, 7, 10].map((i) => v[i]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const frames: CursorSequence['frames'] = [];
    const ta = layer.textureAnimationId >= 0 ? model.textureAnimations[layer.textureAnimationId] : null;
    const kt = (ta?.animations as any[] | undefined)?.find((a) => a.name === 'KTAT');
    if (kt) {
      const inside = (kt.frames as number[]).map((f, i) => [f, i] as const).filter(([f]) => f >= start && f <= end);
      for (const [f, i] of inside) frames.push({ t: (f - start) / 1000, du: kt.values[i][0], dv: kt.values[i][1] });
    }
    return {
      rect: [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)],
      frames,
      duration: Math.max(0, (end - start) / 1000),
      size: [maxX - minX, maxY - minY],
      hotspot: [(0 - minX) / Math.max(1e-6, maxX - minX), (maxY - 0) / Math.max(1e-6, maxY - minY)],
    };
  }
  return null;
}

/** Track value in a sequence: only keys inside its interval count (first key's value before it), else the static value. */
function trackAt(obj: any, name: string, fallback: number, start: number, end: number) {
  const a = (obj.animations as any[] | undefined)?.find((x) => x.name === name);
  if (!a) return fallback;
  let value: number | null = null;
  for (let i = 0; i < a.frames.length; i++) {
    const f = a.frames[i];
    if (f < start || f > end) continue;
    if (value === null || f <= start) value = a.values[i][0];
  }
  return value ?? fallback;
}

function toUrl(img: ImageData) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL();
}

function tinted(img: ImageData, [r, g, b]: [number, number, number]) {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] * r) / 255;
    d[i + 1] = (d[i + 1] * g) / 255;
    d[i + 2] = (d[i + 2] * b) / 255;
  }
  return out;
}
