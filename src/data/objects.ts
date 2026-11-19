import type { AssetCatalog, MapData, ObjectEntry } from './types';

type Fields = Record<string, string | number>;

/**
 * Values of the *base* game objects the map's custom objects derive from.
 * The map only stores modified fields; everything else comes from the game's SLK tables
 * (Units\UnitData.slk, UnitBalance.slk, UnitWeapons.slk, UnitUI.slk, AbilityData.slk, ...).
 * These are best-effort approximations used until tools/assets.ts fills catalog.json from the
 * original files – every value here is therefore an ASSUMPTION (see docs/IMPLEMENTACE.md).
 */
export const BASE_UNIT_DEFAULTS: Record<string, Fields> = {
  hgtw: {
    unam: 'Guard Tower', umdl: 'buildings\\human\\HumanTower\\HumanTower', uico: 'ReplaceableTextures\\CommandButtons\\BTNGuardTower.blp',
    ua1b: 21, ua1d: 1, ua1s: 5, ua1c: 0.9, ua1r: 700, uacq: 700, ua1t: 'pierce', ua1w: 'missile', ua1m: 'Abilities\\Weapons\\GuardTowerMissile\\GuardTowerMissile.mdl',
    ua1z: 1800, uma1: 0.15, uhd1: 0.5, uqd1: 0.25, ua1f: 0, ua1h: 0, ua1q: 0, upat: 'PathTextures\\4x4SimpleSolid.tga', ucol: 72, ugol: 70, ubld: 25, upoi: 100,
    uhpm: 500, udty: 'fort', usca: 1, umvs: 0, umvt: '', utyp: 'Mechanical,Structure', uimz: 140, ulpz: 140, ussc: 2.1,
  },
  hpea: { unam: 'Peasant', umdl: 'units\\human\\Peasant\\Peasant', uico: 'ReplaceableTextures\\CommandButtons\\BTNPeasant.blp', umvs: 190, umvt: 'foot', usca: 1, ucol: 16, uhpm: 220 },
  hbar: { unam: 'Barracks', umdl: 'buildings\\human\\Barracks\\Barracks', upat: 'PathTextures\\8x8SimpleSolid.tga', usca: 1, ucol: 144 },
  nwlt: {
    unam: 'Timber Wolf', umdl: 'units\\creeps\\TimberWolf\\TimberWolf', uico: 'ReplaceableTextures\\CommandButtons\\BTNTimberWolf.blp', umvs: 350, umvt: 'foot', umvh: 0,
    ua1b: 7, ua1d: 1, ua1s: 4, ua1c: 1.35, ua1r: 100, ua1t: 'normal', ua1w: 'normal', udty: 'medium', udef: 0, ubba: 0, ubdi: 1, ubsi: 1, usca: 1, ucol: 16, uhpm: 180,
  },
  nhea: {
    unam: 'High Elven Archer', umdl: 'units\\creeps\\HighElfArcher\\HighElfArcher', uico: 'ReplaceableTextures\\CommandButtons\\BTNHighElvenArcher.blp', umvs: 270, umvt: 'foot',
    ua1b: 12, ua1d: 1, ua1s: 4, ua1c: 1.5, ua1r: 500, uacq: 600, ua1t: 'pierce', ua1w: 'missile', ua1m: 'Abilities\\Weapons\\Arrow\\ArrowMissile.mdl', ua1z: 900, uma1: 0.15,
    udty: 'medium', usca: 1, ucol: 16, ugol: 50,
  },
  ocat: { unam: 'Catapult', umdl: 'units\\orc\\catapult\\catapult', umvs: 220, umvt: 'foot', ua1t: 'siege', ua1w: 'artillery', ua1d: 1, ua1z: 650, udty: 'fort', usca: 1, ucol: 48, ugol: 200 },
};

export const BASE_ABILITY_DEFAULTS: Record<string, Fields> = {
  Amgl: { 'Mgl1@1': 3, 'Mgl2@1': 0.35, 'aare@1': 500 },
  Aspo: { 'Spo1@1': 0, 'Spo2@1': 0.5, 'Spo3@1': 0, 'adur@1': 3 },
  ACbh: { 'Hbh1@1': 20, 'Hbh3@1': 0, 'adur@1': 2 },
  AOae: { 'aare@1': 900, 'Oae2@1': 0.1 },
  ACac: { 'aare@1': 900, 'Cac1@1': 0.1 },
  AHfa: { 'Hfa1@1': 10, 'amcs@1': 8 },
  Aroc: { 'Efk1@1': 0, 'Efk3@1': 4, 'aare@1': 700 },
  Adts: { 'aran@1': 1000 },
  AHtb: { 'Htb1@1': 100, 'adur@1': 5, 'aran@1': 600 },
};

export const BASE_UPGRADE_DEFAULTS: Record<string, Fields> = {
  Rhac: { gglb: 125, gglm: 75, glvl: 3, gtib: 60, gtim: 15, gnam: 'Improved Masonry' },
  Rhse: { gglb: 125, gglm: 0, glvl: 1, gtib: 45, gtim: 0, gnam: 'Magic Sentry' },
  Rhra: { gglb: 100, gglm: 50, glvl: 3, gtib: 60, gtim: 15, gnam: 'Improved Bows' },
};

export interface AttackDef {
  damageBase: number;
  dice: number;
  sides: number;
  cooldown: number;
  range: number;
  acquire: number;
  attackType: string;
  weaponType: string;
  missile: string;
  missileSpeed: number;
  missileArc: number;
  homing: boolean;
  splashFull: number;
  splashMedium: number;
  splashSmall: number;
  splashMediumFactor: number;
  splashSmallFactor: number;
  /** mbounce: number of targets (utc1) and damage loss per bounce (udl1); bounce radius is ua1f. */
  maxTargets: number;
  damageLoss: number;
  targets: string[];
  /** Seconds from the start of the attack animation until the missile leaves / damage is dealt (udp1). */
  damagePoint: number;
  /** Missile launch offset relative to the unit, x forward / y left / z up (ulpx, ulpy, ulpz). */
  launch: [number, number, number];
}

export interface UnitDef {
  id: string;
  base: string;
  name: string;
  tooltip: string;
  description: string;
  hotkey: string;
  icon: string;
  model: string;
  scale: number;
  selectionScale: number;
  gold: number;
  buildTime: number;
  pointValue: number;
  hp: number;
  armor: number;
  defenseType: string;
  speed: number;
  moveType: string;
  flyHeight: number;
  /** Height at which incoming missiles hit the unit (uimz). */
  impactZ: number;
  level: number;
  bounty: { base: number; dice: number; sides: number };
  abilities: string[];
  attack: AttackDef | null;
  upgradesTo: string[];
  requires: string[];
  requiresLevels: number[];
  builds: string[];
  trains: string[];
  researches: string[];
  sells: string[];
  buttonPos: [number, number];
  isBuilding: boolean;
  fields: Fields;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : v === undefined || v === '' ? d : Number(v) || d);
const str = (v: unknown, d = '') => (v === undefined || v === null ? d : String(v));
const list = (v: unknown) =>
  str(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '_');

/** Strips WC3 color codes (|cAARRGGBB ... |r) and converts |n to newlines. */
export function plainText(s: string) {
  return s.replace(/\|c[0-9a-fA-F]{8}/g, '').replace(/\|r/g, '').replace(/\|n/g, '\n');
}

/** Converts WC3 color codes to HTML. */
export function wc3ToHtml(s: string) {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let open = 0;
  let out = esc.replace(/\|c[0-9a-fA-F]{2}([0-9a-fA-F]{6})|\|r|\|n|\r?\n/gi, (m, rgb) => {
    if (rgb) {
      open++;
      return `<span style="color:#${rgb}">`;
    }
    if (m.toLowerCase() === '|r') {
      if (!open) return '';
      open--;
      return '</span>';
    }
    return '<br>';
  });
  while (open-- > 0) out += '</span>';
  return out;
}

export class ObjectDB {
  private units = new Map<string, UnitDef>();

  constructor(private readonly map: MapData, private readonly catalog: AssetCatalog | null) {}

  rawUnit(id: string): Fields {
    const entry: ObjectEntry | undefined = this.map.objects.w3u?.[id];
    const base = entry?.base ?? id;
    return {
      ...(BASE_UNIT_DEFAULTS[base] ?? {}),
      ...(this.catalog?.units[base] ?? {}),
      ...(entry?.fields ?? {}),
    };
  }

  unit(id: string): UnitDef {
    let def = this.units.get(id);
    if (def) return def;
    const f = this.rawUnit(id);
    const base = this.map.objects.w3u?.[id]?.base ?? id;
    const weaponType = str(f.ua1w, 'missile');
    // "uaen" (attacks enabled) decides whether the unit attacks; missing target lists fall back to ground+air.
    const targets = str(f.ua1g, 'ground,air');
    const hasAttack = num(f.uaen, 1) !== 0 && f.ua1b !== undefined && !['_', 'none', ''].includes(targets);
    const model = str(f.umdl).replace(/\.mdl$/i, '').replace(/\.mdx$/i, '');
    def = {
      id,
      base,
      name: str(f.unam, id),
      tooltip: str(f.utip),
      description: str(f.utub),
      hotkey: str(f.uhot),
      icon: str(f.uico),
      model,
      scale: num(f.usca, 1),
      selectionScale: num(f.ussc, 1),
      gold: num(f.ugol),
      buildTime: num(f.ubld, 1),
      pointValue: num(f.upoi),
      hp: num(f.uhpm, 100),
      armor: num(f.udef),
      defenseType: str(f.udty, 'none') || 'none',
      speed: num(f.umvs),
      moveType: str(f.umvt),
      flyHeight: num(f.umvh),
      impactZ: num(f.uimz, 60),
      level: num(f.ulev, 1),
      bounty: { base: num(f.ubba), dice: num(f.ubdi, 1), sides: num(f.ubsi, 1) },
      abilities: list(f.uabi),
      attack: hasAttack
        ? {
            damageBase: num(f.ua1b),
            dice: num(f.ua1d, 1),
            sides: num(f.ua1s, 1),
            cooldown: num(f.ua1c, 1.5),
            range: num(f.ua1r, 100),
            acquire: Math.max(num(f.uacq, num(f.ua1r, 100)), num(f.ua1r, 100)),
            attackType: str(f.ua1t, 'normal'),
            weaponType,
            missile: str(f.ua1m),
            missileSpeed: num(f.ua1z, 900),
            missileArc: num(f.uma1),
            homing: num(f.umh1) === 1 || weaponType === 'missile',
            splashFull: num(f.ua1f),
            splashMedium: num(f.ua1h),
            splashSmall: num(f.ua1q),
            splashMediumFactor: num(f.uhd1, 0.5),
            splashSmallFactor: num(f.uqd1, 0.25),
            maxTargets: num(f.utc1, 1),
            damageLoss: num(f.udl1, 0),
            targets: list(targets),
            damagePoint: num(f.udp1, 0),
            launch: [num(f.ulpx), num(f.ulpy), num(f.ulpz, 60)],
          }
        : null,
      upgradesTo: list(f.uupt),
      requires: list(f.ureq),
      requiresLevels: list(f.urqa).map(Number),
      builds: list(f.ubui),
      trains: list(f.utra),
      researches: list(f.ures),
      sells: list(f.useu),
      buttonPos: [num(f.ubpx), num(f.ubpy)],
      isBuilding: base === 'hgtw' || base === 'hbar' || str(f.utyp).toLowerCase().includes('structure'),
      fields: f,
    };
    this.units.set(id, def);
    return def;
  }

  hasAbility(id: string) {
    return !!(this.map.objects.w3a?.[id] || this.catalog?.abilities[id] || BASE_ABILITY_DEFAULTS[id]);
  }

  ability(id: string): { id: string; base: string; name: string; tooltip: string; description: string; icon: string; fields: Fields } {
    const entry = this.map.objects.w3a?.[id];
    const base = entry?.base ?? id;
    const fields = { ...(BASE_ABILITY_DEFAULTS[base] ?? {}), ...(this.catalog?.abilities[base] ?? {}), ...(entry?.fields ?? {}) };
    return {
      id,
      base,
      name: str(fields.anam, id),
      tooltip: str(fields['atp1@1']),
      description: str(fields['aub1@1']),
      icon: str(fields.aart),
      fields,
    };
  }

  upgrade(id: string) {
    const entry = this.map.objects.w3q?.[id];
    const base = entry?.base ?? id;
    const f = { ...(BASE_UPGRADE_DEFAULTS[base] ?? {}), ...(this.catalog?.upgrades?.[base] ?? {}), ...(entry?.fields ?? {}) };
    const levels = num(f.glvl, 1);
    return {
      id,
      base,
      levels,
      name: (lvl: number) => str(f[`gnam@${lvl}`] ?? f.gnam ?? f['gnam@1'], id),
      tooltip: (lvl: number) => str(f[`gtp1@${lvl}`] ?? f['gtp1@1'], ''),
      description: (lvl: number) => str(f[`gub1@${lvl}`] ?? f['gub1@1'], ''),
      icon: (lvl: number) => str(f[`gar1@${lvl}`] ?? f['gar1@1'], ''),
      gold: (lvl: number) => num(f.gglb) + num(f.gglm) * (lvl - 1),
      time: (lvl: number) => num(f.gtib, 30) + num(f.gtim) * (lvl - 1),
      requires: (lvl: number) => list(f[`greq@${lvl}`]),
      requiresLevel: (lvl: number) => num(f[`grqc@${lvl}`]),
      buttonPos: [num(f.gbpx), num(f.gbpy)] as [number, number],
      fields: f,
    };
  }

  /** Name of a doodad/destructable (custom ones from w3d/w3b, otherwise catalog). */
  doodadName(id: string) {
    const f = this.map.objects.w3d?.[id]?.fields ?? this.map.objects.w3b?.[id]?.fields;
    return str(f?.dnam ?? f?.bnam ?? this.catalog?.doodads[id]?.name, id);
  }

  doodadModel(id: string): { file: string; numVar: number; texId?: number; texFile?: string } | null {
    const custom = this.map.objects.w3d?.[id]?.fields?.dfil ?? this.map.objects.w3b?.[id]?.fields?.bfil;
    if (custom) return { file: str(custom).replace(/\.md[lx]$/i, ''), numVar: 1 };
    const c = this.catalog?.doodads[id];
    return c ? { file: c.file.replace(/\.md[lx]$/i, ''), numVar: c.numVar, texId: c.texId, texFile: c.texFile } : null;
  }

  destructableLife(id: string) {
    return num(this.map.objects.w3b?.[id]?.fields?.bhps, 100);
  }
}
