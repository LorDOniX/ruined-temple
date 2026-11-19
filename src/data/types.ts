/** Shape of public/map/map.json produced by tools/extract.ts. Coordinates are Warcraft 3 world units (X east, Y north, Z up). */

export interface TerrainData {
  tileset: string;
  groundTilesets: string[];
  cliffTilesets: string[];
  /** Number of corners (tiles + 1). */
  columns: number;
  rows: number;
  centerOffset: [number, number];
  /** Per corner, row-major from bottom-left. Heights are in units of 128 (one cliff layer). */
  groundHeight: number[];
  waterHeight: number[];
  layerHeight: number[];
  groundTexture: number[];
  groundVariation: number[];
  cliffTexture: number[];
  cliffVariation: number[];
  /** bit0 ramp, bit1 blight, bit2 water, bit3 boundary, bit4 map edge */
  flags: number[];
}

export interface Placement {
  id: string;
  variation: number;
  x: number;
  y: number;
  z: number;
  /** radians */
  angle: number;
  scale: [number, number, number];
}

export interface DoodadPlacement extends Placement {
  flags: number;
  life: number;
  editorId: number;
}

export interface UnitPlacement extends Placement {
  player: number;
  hitpoints: number;
  creationNumber: number;
}

export interface RegionData {
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  color: [number, number, number];
  weather: string;
  ambientSound: string;
}

export interface SoundData {
  name: string;
  file: string;
  eax: string;
  flags: number;
  volume: number;
  pitch: number;
  channel: number;
  minDistance: number;
  maxDistance: number;
}

export interface ObjectEntry {
  /** Original (base game) object id the custom object derives from. */
  base: string;
  custom: boolean;
  /** Modified fields, keyed by 4-char field id (with "@level" suffix for leveled data). TRIGSTR references are resolved. */
  fields: Record<string, string | number>;
}
export type ObjectTable = Record<string, ObjectEntry>;

export interface WaveData {
  wave: number;
  unit: string;
  name: string;
  /** Delay between individual spawns (TriggerSleepAction). */
  spawnCooldown: number;
  /** Sound file played when the wave starts. */
  sound: string | null;
}

export interface JassSound {
  file: string;
  looping: boolean;
  is3D: boolean;
  eax: string;
  volume?: number;
  pitch?: number;
  duration?: number;
}

export interface GameConfig {
  regions: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  sounds: Record<string, JassSound>;
  waves: WaveData[];
  unitsPerWave: number;
  /** Victory after the wave with this number is cleared. */
  lastWave: number;
  livesPerPlayer: number;
  startGold: number;
  /** Delay before the next wave (timer), seconds. */
  nextWaveDelay: number;
  /** Ordered list of rect names creeps walk through. */
  path: string[];
  bounty: { base: number[]; dice: number[] };
  difficulties: { id: string; label: string; factor: number; message: string }[];
  defaultDifficulty: number;
  difficultyTimeout: number;
  sellAbility: string;
  sellRatio: number;
  coinBasherAbility: string;
  gateRepairUnit: string;
  lifeBuyUnit: string;
  templeUnits: string[];
  messages: Record<string, string>;
  quests: { title: string; description: string; item: string; icon: string }[];
  destructables: { id: string; x: number; y: number; angle: number; scale: number; variable: string }[];
  preplacedUnits: { variable: string; id: string; player: number; x: number; y: number; angle: number }[];
}

export interface MapData {
  source: string;
  info: {
    name: string;
    author: string;
    description: string;
    recommendedPlayers: string;
    tileset: string;
    cameraBounds: number[];
    cameraBoundsComplements: number[];
    playableSize: [number, number];
    flags: number;
    fog: { enabled: boolean; start: number; end: number; density: number; color: number[] };
    waterVertexColor: number[];
    players: { id: number; type: number; race: number; name: string; startLocation: [number, number] }[];
    forces: { flags: number; playerMask: number; name: string }[];
    misc: Record<string, Record<string, string>>;
    extra: Record<string, Record<string, string>>;
  };
  terrain: TerrainData;
  /** war3map.wpm – 4 cells per tile (32x32 units). Flags: 0x02 no walk, 0x04 no fly, 0x08 no build, 0x40 not water. Base64. */
  pathing: { width: number; height: number; data: string };
  /** war3map.shd – baked doodad shadows, same grid as pathing. Base64. */
  shadows: { width: number; height: number; data: string } | null;
  doodads: DoodadPlacement[];
  units: UnitPlacement[];
  regions: RegionData[];
  sounds: SoundData[];
  objects: Record<string, ObjectTable>;
  strings: Record<string, string>;
  game: GameConfig;
}

/** public/war3/catalog.json produced by tools/assets.ts from the original game data (optional). */
export interface AssetCatalog {
  terrain: Record<string, { file: string; name: string }>;
  cliffs: Record<string, { texture: string; modelDir: string; groundTile: string; name: string }>;
  water: { texture: string; numTex: number; texRate: number; height: number; deep: number[][]; shallow: number[][] } | null;
  /** Doodad/destructable id → model path (without extension) and variation count. */
  doodads: Record<string, { file: string; numVar: number; pathTex?: string; name?: string; category?: string; fixedRotation?: number; texId?: number; texFile?: string; armor?: string }>;
  /** Unit id → merged base data (UnitUI/UnitData/UnitBalance/UnitWeapons) restricted to used fields. */
  units: Record<string, Record<string, string | number>>;
  abilities: Record<string, Record<string, string | number>>;
  upgrades: Record<string, Record<string, string | number>>;
  /** Files that exist under public/war3 (lowercase, forward slashes). */
  files: string[];
  /** In-game music playlist (SetMapMusic "Music" → race playlist from UI\war3skins.txt). */
  music?: string[];
  /** Sound labels (UI\SoundInfo\*.slk: AnimSounds, UnitAckSounds, UnitCombatSounds, UISounds) → files and 3D parameters. */
  sounds?: Record<string, SoundDef>;
  /** Model event objects "SNDx<id>" → sound label (UI\SoundInfo\AnimLookups.slk). */
  eventSounds?: Record<string, string>;
  /** "SPLx<id>" / "FPTx<id>" splats (Splats\SplatData.slk). */
  splats?: Record<string, SplatDef>;
  /** "UBRx<id>" ubersplats (Splats\UberSplatData.slk), also used under buildings (unit field "uubs"). */
  uberSplats?: Record<string, UberSplatDef>;
  /** Buff / effect art (profile Targetart + Targetattach, Effectart, Specialart) and sounds by buff id. */
  buffs?: Record<string, { targetArt: string[]; targetAttach: string[]; effectArt: string[]; specialArt: string[]; effectSound?: string; loopSound?: string }>;
  /** Ability effect sounds and lightning ids by base ability (profile Effectsound / Effectsoundlooped / LightningEffect). */
  abilityFx?: Record<string, { effectSound?: string; loopSound?: string; lightning?: string[] }>;
  /** Lightning effects (Splats\LightningData.slk) by id, e.g. CHIM = "Lightning Attack - Chimera". */
  lightnings?: Record<string, { texture: string; avgSegLen: number; width: number; color: number[]; noiseScale: number; texCoordScale: number; duration: number }>;
  /** "SPNx<id>" spawned models (Splats\SpawnData.slk) – model path without extension. */
  spawns?: Record<string, string>;
  /** UI\war3skins.txt cursor model of the local player's race, UI\MiscData.txt selection circles / shadows. */
  ui?: {
    cursor: string;
    /** Day/night light models (Environment\DNC) for terrain and units. */
    dnc?: { terrain: string; unit: string };
    selectionCircles: { maxSize: number; texture: string }[];
    selectionScale: number;
    selectionColors: { friend: number[]; neutral: number[]; enemy: number[] };
    shadowColor: number[];
  };
}

export interface SoundDef {
  files: string[];
  /** 0–127 */
  volume: number;
  pitch: number;
  pitchVariance: number;
  minDistance: number;
  maxDistance: number;
  distanceCutoff: number;
  channel: number;
  flags: string;
}

export interface SplatDef {
  texture: string;
  rows: number;
  columns: number;
  /** 0 blend, 1 additive, 2 modulate, 3 modulate 2x, 4 alpha key */
  blendMode: number;
  /** Half size of the quad. */
  scale: number;
  lifespan: number;
  decay: number;
  /** Texture cell intervals [start, end, repeat] for the lifespan and decay phases. */
  uvLifespan: number[];
  uvDecay: number[];
  /** Start / middle / end RGBA (0–255). */
  colors: number[][];
  sound?: string;
}

export interface UberSplatDef {
  texture: string;
  blendMode: number;
  scale: number;
  birthTime: number;
  pauseTime: number;
  decay: number;
  colors: number[][];
  sound?: string;
}
