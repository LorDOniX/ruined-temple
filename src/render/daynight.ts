import { evalVecTrackAt, type Wc3Assets } from './mdx';

type RGB = [number, number, number];

interface DncLight {
  light: any;
  interval: [number, number];
  globals: number[];
}

/**
 * Day/night cycle like the game: Environment\DNC\DNC<tileset>{Terrain,Unit}.mdl each contain one directional
 * light whose ambient (KLAC) and diffuse (KLBC) colours are animated over a "Stand" sequence spanning 24 hours of
 * game time. MDX stores light colours as BGR. The scene was calibrated at noon, so the result is returned as
 * per-channel factors relative to 12:00 that multiply the existing light setup.
 */
export class DayNight {
  private constructor(
    private readonly terrain: DncLight | null,
    private readonly unit: DncLight | null,
  ) {}

  static async load(assets: Wc3Assets, terrainPath: string, unitPath: string) {
    const parse = async (path: string): Promise<DncLight | null> => {
      const model = await assets.loadRawModel(path).catch(() => null);
      const light = model?.lights?.[0];
      const seq = model?.sequences?.[0];
      if (!light || !seq) return null;
      return { light, interval: [seq.interval[0], seq.interval[1]], globals: Array.from(model.globalSequences ?? []) };
    };
    const [t, u] = await Promise.all([parse(terrainPath), parse(unitPath)]);
    return t || u ? new DayNight(t, u) : null;
  }

  private color(l: DncLight | null, track: 'KLAC' | 'KLBC', hour: number): RGB {
    if (!l) return [1, 1, 1];
    const [start, end] = l.interval;
    const frame = start + ((((hour % 24) + 24) % 24) / 24) * (end - start);
    const fb = track === 'KLAC' ? l.light.ambientColor : l.light.color;
    const bgr = evalVecTrackAt(l.light, track, fb, l.interval, frame, l.globals, 0);
    return [bgr[2], bgr[1], bgr[0]];
  }

  private relative(l: DncLight | null, track: 'KLAC' | 'KLBC', hour: number): RGB {
    const c = this.color(l, track, hour);
    const noon = this.color(l, track, 12);
    return [0, 1, 2].map((i) => c[i] / Math.max(0.05, noon[i])) as RGB;
  }

  /** Colour factors (relative to noon) for terrain / unit ambient and diffuse light at a time of day (hours). */
  factors(hour: number) {
    return {
      terrainAmbient: this.relative(this.terrain, 'KLAC', hour),
      terrainDiffuse: this.relative(this.terrain, 'KLBC', hour),
      unitAmbient: this.relative(this.unit ?? this.terrain, 'KLAC', hour),
      unitDiffuse: this.relative(this.unit ?? this.terrain, 'KLBC', hour),
    };
  }
}
