import type { AssetCatalog, GameConfig, MapData } from '../data/types';
import { ObjectDB, type UnitDef } from '../data/objects';
import { PathingGrid } from './pathing';
import { armorMultiplier, attackMultiplier, randomInt, rollDamage } from './combat';

type Thread = Generator<number, void, void>;
/**
 * Resumable trigger thread: the generator keeps its progress in this plain object (pc = completed sleeps, loop
 * counters), so a saved game can recreate the generator and continue after the last TriggerSleepAction.
 */
/** Saved game (Game.save / Game.load) – plain JSON. */
export interface SaveData {
  version: 1;
  scalars: Record<string, unknown>;
  players: PlayerState[];
  goldDebt: number[];
  shopStock: Game['shopStock'];
  destructables: Record<string, Destructable>;
  named: Record<string, number>;
  units: (Omit<Unit, 'def' | 'target' | 'forcedTarget' | 'chase' | 'constructs' | 'repairs' | 'drain' | 'poison' | 'casting' | 'rects'> & {
    def: string;
    target: number | null;
    forcedTarget: number | null;
    chase: number | null;
    constructs: number | null;
    repairs: number | null;
    drain: (Omit<NonNullable<Unit['drain']>, 'target'> & { target: number }) | null;
    poison: (Omit<NonNullable<Unit['poison']>, 'source'> & { source: number | null }) | null;
    casting: null;
    rects: string[];
  })[];
  missiles: (Omit<Missile, 'source' | 'target' | 'bounce'> & { source: number; target: number | null; bounce: (Omit<NonNullable<Missile['bounce']>, 'hit'> & { hit: number[] }) | null })[];
  storms: (Omit<Game['storms'][number], 'source'> & { source: number })[];
  pendingShots: { u: number; t: number; at: number }[];
  threads: { state: ThreadState; at: number; seq: number }[];
  /** Pathing occupancy as runs: start, length, value. */
  occupied: number[];
}

export interface ThreadState {
  kind: 'init' | 'quests' | 'slowSelector' | 'startingGame' | 'waveSpawn' | 'waveClear' | 'victory' | 'lifeLost';
  pc: number;
  i?: number;
}

export type UnitKind = 'creep' | 'tower' | 'builder' | 'defender' | 'spawning' | 'shop' | 'other';

export interface Unit {
  uid: number;
  def: UnitDef;
  kind: UnitKind;
  owner: number;
  x: number;
  y: number;
  /** Height above ground (flyers). */
  fly: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  hidden: boolean;
  invisible: boolean;
  speed: number;
  flying: boolean;
  moveTarget: { x: number; y: number } | null;
  path: [number, number][] | null;
  attackGate: boolean;
  target: Unit | null;
  forcedTarget: Unit | null;
  cooldown: number;
  slow: { move: number; attack: number; until: number } | null;
  poison: { dps: number; until: number; source: Unit | null } | null;
  stunUntil: number;
  phaseUntil: number;
  phaseReady: number;
  barrageCd: number;
  abilityCd: Record<string, number>;
  constructing: { total: number; elapsed: number } | null;
  /** Builder: ordered constructions (gold already paid, refunded when the order is dropped before the site is founded). */
  buildQueue: { id: string; x: number; y: number }[];
  /** Builder: the unfinished building it works on – construction only progresses while it stands there. */
  constructs: Unit | null;
  /** Unit / building this builder repairs (Ahrp). */
  repairs: Unit | null;
  /** Mana (unit fields umpi initial, umpm maximum, umpr regeneration per second). */
  mana: number;
  maxMana: number;
  manaRegen: number;
  /** Active buffs by buff id (Bblo bloodlust, B002 blessed weapons, Bdtm drained …) with their effect values. */
  buffs: Record<string, { until: number; move?: number; attack?: number; scale?: number; damage?: number }>;
  /** Autocast state of abilities (Share Mana). */
  autocast: Record<string, boolean>;
  /** Last time the unit took damage – creep spell casters react to combat. */
  lastDamaged: number;
  /** Hold Position: the unit attacks only what is in range and never chases. */
  holdPosition: boolean;
  /** Target the unit walks to (auto-acquired within acquisition range or ordered); path refresh time. */
  chase: Unit | null;
  chaseRepath: number;
  /** Attack-move destination: the unit walks there, engaging enemies it meets on the way (null = plain move). */
  attackMove: { x: number; y: number } | null;
  /** Channelled Mana Drain. */
  drain: { target: Unit; until: number; rate: number; range: number; ability: string } | null;
  /** A spell being cast: the effect happens at the cast point (ucpt), the unit stays busy until the backswing (ucbs) ends. */
  casting: { fireAt: number; until: number; apply: (() => void) | null } | null;
  upgrading: { to: string; total: number; elapsed: number } | null;
  queue: { kind: 'train' | 'research'; id: string; level: number; total: number; elapsed: number }[];
  userData: number;
  rects: Set<string>;
  kills: number;
  /** Visual animation hint for the renderer. */
  anim: 'stand' | 'walk' | 'attack' | 'death' | 'birth' | 'work' | 'spell';
  animTime: number;
  removeAt: number;
  footprint: number;
}

export interface Missile {
  id: number;
  source: Unit;
  target: Unit | null;
  tx: number;
  ty: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  speed: number;
  arc: number;
  traveled: number;
  total: number;
  homing: boolean;
  damage: number;
  bounce: { left: number; factor: number; loss: number; range: number; hit: Set<number> } | null;
  isAbility: boolean;
  /** Stun duration applied on impact instead of damage (Coin Basher); `stunHero` for resistant targets. */
  stun: number;
  stunHero?: number;
  color: number;
  model: string;
  done: boolean;
}

export interface Destructable {
  variable: string;
  id: string;
  x: number;
  y: number;
  angle: number;
  scale: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  open: boolean;
  invulnerable: boolean;
}

export interface PlayerState {
  id: number;
  name: string;
  color: string;
  playing: boolean;
  gold: number;
  kills: number;
  research: Record<string, number>;
  /** Score screen: gold from bounties and wave bonuses, buildings founded. */
  earned: number;
  built: number;
  /** Units trained, shop purchases, largest army (own mobile units at once). */
  trained: number;
  bought: number;
  largestArmy: number;
  /** Sum of point values (upoi) of produced units / buildings and of killed enemies – the unit score. */
  producedValue: number;
  killValue: number;
  /** Score over time for the score screen graph (every 10 s of game time). */
  history: ScoreSample[];
}

export interface ScoreSample {
  t: number;
  units: number;
  resources: number;
  total: number;
}

type Events = {
  message: { text: string; duration: number };
  clearMessages: void;
  sound: { file: string; volume?: number; pitch?: number; x?: number; y?: number };
  floatText: { text: string; x: number; y: number; color: string; lifespan: number };
  effect: { model: string; x: number; y: number; color: number };
  /** Instant attack (missile speed 0): lightning from the attacker to the target, the weapon's model plays at the target. */
  lightning: { from: Unit; to: Unit; color: number; model: string };
  fade: { dir: 'in' | 'out'; duration: number };
  dialog: { title: string; buttons: { label: string; id: number }[]; timeout: number } | null;
  doodadAnim: { id: string; anim: 'birth' | 'death' };
  unitAdded: Unit;
  unitRemoved: Unit;
  missileAdded: Missile;
  /** Instant weapon hit: impact sound = weapon sound (ucs1) + target armour sound (UI\SoundInfo\UnitCombatSounds.slk). */
  combatHit: { weaponSound: string; armor: string; x: number; y: number };
  /** A buff was applied to / removed from a unit (its art is attached to the model). */
  buff: { unit: Unit; id: string; on: boolean };
  /** One-shot spell art at a place (caster / target / effect art of an ability or buff). */
  spellArt: { model: string; x: number; y: number; unit?: Unit; sound?: string; duration?: number };
  /** Lasting lightning between two units (Mana Drain), until `until` (game time) or `link` set to null. */
  link: { id: number; from: Unit; to: Unit; lightning: string; until: number; sound?: string };
  /** Error of an order that failed later (shown like a HUD error to its owner). */
  error: { owner: number; text: string };
  /** Construction or upgrade finished (engine message "Dokončeno: …"). */
  completed: Unit;
  /** Construction / upgrade of a building finished (emitted together with `completed`). */
  constructed: Unit;
  upgraded: Unit;
  /** A unit was trained (its "Ready" acknowledgement plays). */
  trained: Unit;
  researched: { owner: number; id: string; level: number };
  end: { victory: boolean; text: string };
  quest: void;
};

export const PLAYER_COLORS = ['#ff0303', '#0042ff', '#1ce6b9', '#540081', '#fffc01', '#fe8a0e', '#20c000', '#e55bb0', '#959697', '#7ebff1', '#106246', '#4a2a04'];
const PLAYER_NAMES = ['Player 1 (Red)', 'Player 2 (Blue)', 'Player 3 (Teal)'];
/**
 * Engine messages in the wording of the Czech client (Units\CommandStrings.txt, UI\FrameDef\GlobalStrings.fdf);
 * texts from the map itself stay as the map has them (English).
 */
export const ERR = {
  noGold: 'Nedostatek zlata.', // Nogold
  cantPlace: 'Zde nelze stavět.', // Cantplace
  cooldown: 'Kouzlo zatím není připraveno.', // Cooldown
  notInRange: 'Cíl je mimo dostřel.', // Notinrange
  outOfStock: 'Vyprodáno', // Outofstock
  targetEnemy: 'Cílem musí být nepřátelská jednotka.', // Targetenemy
  requires: 'Požadavky:', // REQUIRESTOOLTIP
  miss: 'minul', // MISS
  noMana: 'Nedostatek many.', // Nomana
  targetManaUser: 'Cílem musí být jednotka s manou.', // Targetmanauser
  busy: 'Budova je zaneprázdněná.',
  queueFull: 'Fronta je plná.',
  researched: 'Již vyzkoumáno.',
  targetRepair: 'Cílem musí být budova nebo mechanická jednotka.', // Targetrepair
  notDamaged: 'Cíl není poškozen.', // RepairHPmaxed
  noShopper: 'Žádná vaše jednotka není poblíž obchodu.',
};
export const CREEP_PLAYER = 3;
/** Numeric object field ('-' / '' / missing = 0). */
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
/** Distance from the centre of a building site at which a builder founds / works on it. */
const BUILD_REACH = 150;
export const NEUTRAL_PASSIVE = 15;

export class Game {
  readonly cfg: GameConfig;
  readonly db: ObjectDB;
  readonly grid: PathingGrid;
  time = 0;
  speed = 1;
  paused = false;
  players: PlayerState[] = [];
  playerCount = 0;
  lives = 0;
  wave = 1;
  spawnUnit = '';
  spawnName = '';
  spawnCooldown = 0;
  waveSound: string | null = null;
  difficultyFactor = 100;
  handicap = 100;
  multiboardTitle = '';
  multiboardVisible = false;
  nextWaveTimer: { end: number } | null = null;
  timerUpdate = false;
  ended: null | { victory: boolean } = null;
  units: Unit[] = [];
  missiles: Missile[] = [];
  destructables: Record<string, Destructable> = {};
  shopStock: Record<string, { stock: number; max: number; regen: number; nextAt: number }> = {};
  readonly rects: GameConfig['regions'];
  private uidSeq = 1;
  private missileSeq = 1;
  private nextAuraRefresh = 0;
  /** Attacks between the start of the swing and their damage point. */
  /** Skyfury storms in progress. */
  storms: { x: number; y: number; owner: number; source: Unit; until: number; next: number; interval: number; damage: number; radius: number; buff: string }[] = [];
  /** Asset catalog (buff art, ability sounds) – optional, set by the renderer side. */
  cat: AssetCatalog | null = null;
  private pendingShots: { u: Unit; t: Unit; at: number; auras: ReturnType<Game['auraSources']> }[] = [];
  /** Trigger "threads": generators that yield the number of seconds to sleep (TriggerSleepAction). */
  private threads: { gen: Thread; state: ThreadState; at: number; seq: number }[] = [];
  private threadSeq = 0;
  private listeners: { [K in keyof Events]?: ((e: Events[K]) => void)[] } = {};
  private ancestors = new Map<string, Set<string>>();
  private difficultyChosen = false;
  /** Seeded generator state (mulberry32); null = Math.random. Kept as a number so saved games continue the sequence. */
  private rndState: number | null = null;
  private rnd = (): number => {
    if (this.rndState === null) return Math.random();
    const a = (this.rndState = (this.rndState + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  readonly heightAt: (x: number, y: number) => number;
  /** Variables of pre-placed units (gg_unit_*). */
  readonly named: Record<string, Unit> = {};

  constructor(readonly map: MapData, db: ObjectDB, heightAt: (x: number, y: number) => number, readonly humanPlayers = 1) {
    this.cfg = map.game;
    this.db = db;
    this.heightAt = heightAt;
    this.rects = map.game.regions;
    const p = map.pathing;
    this.grid = new PathingGrid(p.width, p.height, Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0)), map.terrain.centerOffset[0], map.terrain.centerOffset[1]);
    this.buildAncestors();
  }

  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void) {
    ((this.listeners[type] ??= []) as ((e: Events[K]) => void)[]).push(fn);
  }

  private emit<K extends keyof Events>(type: K, e: Events[K]) {
    for (const fn of (this.listeners[type] ?? []) as ((e: Events[K]) => void)[]) fn(e);
  }

  /** TriggerExecute: runs the thread synchronously until its first sleep, then schedules it in game time. */
  private run(kind: ThreadState['kind'], u?: Unit) {
    const state: ThreadState = { kind, pc: 0 };
    const gen = this.threadGen(state, u);
    const r = gen.next();
    if (!r.done) this.threads.push({ gen, state, at: this.time + Math.max(0, r.value), seq: this.threadSeq++ });
  }

  private threadGen(s: ThreadState, u?: Unit): Thread {
    switch (s.kind) {
      case 'init':
        return this.trigIntialization(s);
      case 'quests':
        return this.trigQuests(s);
      case 'slowSelector':
        return this.trigSlowSelector(s);
      case 'startingGame':
        return this.trigStartingGame(s);
      case 'waveSpawn':
        return this.trigWaveSpawn(s);
      case 'waveClear':
        return this.trigWaveClear(s);
      case 'victory':
        return this.trigVictory(s);
      case 'lifeLost':
        return this.lifeLost(s, u);
    }
  }

  /** Spawn portal doodad (D004): "birth" opens it while a wave spawns, "death" closes it. */
  portalOpen = false;
  private portal(anim: 'birth' | 'death') {
    this.portalOpen = anim === 'birth';
    this.emit('doodadAnim', { id: 'D004', anim });
  }

  private resumeThreads() {
    for (;;) {
      let next: (typeof this.threads)[number] | null = null;
      for (const t of this.threads) if (t.at <= this.time && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t;
      if (!next) return;
      this.threads.splice(this.threads.indexOf(next), 1);
      const r = next.gen.next();
      if (!r.done) this.threads.push({ gen: next.gen, state: next.state, at: Math.max(this.time, next.at + Math.max(0, r.value)), seq: this.threadSeq++ });
    }
  }

  str(key: string) {
    return this.cfg.messages[key] ?? this.map.strings[key] ?? key;
  }

  private message(text: string, duration = 10) {
    this.emit('message', { text: this.str(text), duration });
  }

  private playSound(variable: string | null, x?: number, y?: number) {
    if (!variable) return;
    const s = this.cfg.sounds[variable];
    if (s) this.emit('sound', { file: s.file, volume: s.volume, pitch: s.pitch, x, y });
    else this.emit('sound', { file: variable });
  }

  // ---------------------------------------------------------------------------------------------
  // Setup (main → CreateAllDestructables, CreateAllUnits, InitCustomTriggers, Intialization)
  // ---------------------------------------------------------------------------------------------

  start() {
    for (let i = 0; i < 3; i++) {
      this.players.push({ id: i, name: PLAYER_NAMES[i], color: PLAYER_COLORS[i], playing: i < this.humanPlayers, gold: 0, kills: 0, research: {}, earned: 0, built: 0, trained: 0, bought: 0, largestArmy: 0, producedValue: 0, killValue: 0, history: [] });
    }
    for (const d of this.cfg.destructables) {
      const hp = this.db.destructableLife(d.id);
      this.destructables[d.variable] = { ...d, angle: (d.angle * Math.PI) / 180, hp, maxHp: hp, alive: true, open: false, invulnerable: false };
      if (d.id === 'ZTg1' || d.id === 'ZTsg') this.setGatePathing(this.destructables[d.variable], true);
    }
    // Pathing blockers from war3map.doo (destructables are not baked into war3map.wpm).
    for (const d of this.map.doodads) if (d.id === 'YTpb') this.grid.setFootprint(d.x, d.y, 2, 1);

    for (const u of this.map.units) {
      if (u.id === 'sloc') continue;
      const pre = this.cfg.preplacedUnits.find((p) => p.id === u.id && Math.abs(p.x - u.x) < 1 && Math.abs(p.y - u.y) < 1);
      const owner = u.player === NEUTRAL_PASSIVE || u.player > 11 ? NEUTRAL_PASSIVE : u.player;
      const unit = this.createUnit(u.id, owner, u.x, u.y, u.angle);
      if (pre) this.named[pre.variable] = unit;
    }
    const shop = this.units.find((u) => u.kind === 'shop');
    if (shop) {
      for (const id of shop.def.sells) {
        const f = this.db.unit(id).fields;
        const max = Number(f.usma ?? 1) || 1;
        this.shopStock[id] = { stock: max, max, regen: Number(f.usrg ?? 60), nextAt: 0 };
      }
    }
    this.run('init');
  }

  private setGatePathing(d: Destructable, block: boolean) {
    // ZTsg (temple gate) spans the corridor; ZTg1 are portcullis gates. Footprints approximate the original pathing textures.
    if (d.id === 'ZTsg') {
      for (let dy = -192; dy <= 192; dy += 32) this.grid.setFootprint(d.x, d.y + dy, 2, block ? 1 : 0);
    } else {
      for (let dx = -96; dx <= 96; dx += 32) this.grid.setFootprint(d.x + dx, d.y, 2, block ? 1 : 0);
    }
  }

  private buildAncestors() {
    const all = Object.keys(this.map.objects.w3u ?? {});
    const parents = new Map<string, string[]>();
    for (const id of all) for (const to of this.db.unit(id).upgradesTo) parents.set(to, [...(parents.get(to) ?? []), id]);
    const collect = (id: string, out: Set<string>) => {
      for (const p of parents.get(id) ?? []) if (!out.has(p)) collect(p, out.add(p));
      return out;
    };
    for (const id of all) this.ancestors.set(id, collect(id, new Set()));
  }

  createUnit(id: string, owner: number, x: number, y: number, facing: number): Unit {
    const def = this.db.unit(id);
    let kind: UnitKind = 'other';
    if (owner === CREEP_PLAYER) kind = 'creep';
    else if (def.base === 'hgtw') kind = 'tower';
    else if (def.base === 'hpea' && def.builds.length + def.abilities.length > 0 && def.speed > 0) kind = 'builder';
    else if (def.trains.length || def.researches.length) kind = 'spawning';
    else if (def.sells.length) kind = 'shop';
    else if (def.attack && def.speed > 0) kind = 'defender';
    const maxHp = kind === 'creep' ? Math.max(1, Math.round((def.hp * this.handicap) / 100)) : def.hp;
    const u: Unit = {
      uid: this.uidSeq++,
      def,
      kind,
      owner,
      x,
      y,
      fly: def.moveType === 'fly' ? def.flyHeight || 200 : 0,
      facing,
      hp: maxHp,
      maxHp,
      alive: true,
      hidden: false,
      invisible: def.abilities.includes('Apiv'),
      speed: def.speed,
      flying: def.moveType === 'fly',
      moveTarget: null,
      path: null,
      attackGate: false,
      target: null,
      forcedTarget: null,
      cooldown: 0,
      slow: null,
      poison: null,
      stunUntil: 0,
      phaseUntil: 0,
      phaseReady: 0,
      barrageCd: 0,
      abilityCd: {},
      constructing: null,
      buildQueue: [],
      constructs: null,
      repairs: null,
      mana: num(def.fields.umpi),
      maxMana: num(def.fields.umpm),
      manaRegen: num(def.fields.umpr),
      buffs: {},
      autocast: {},
      lastDamaged: -Infinity,
      holdPosition: false,
      chase: null,
      chaseRepath: 0,
      attackMove: null,
      drain: null,
      casting: null,
      upgrading: null,
      queue: [],
      userData: 0,
      rects: new Set(),
      kills: 0,
      anim: 'stand',
      animTime: 0,
      removeAt: 0,
      footprint: kind === 'tower' ? 4 : kind === 'spawning' || kind === 'shop' ? 8 : 0,
    };
    if (u.footprint) this.grid.setFootprint(x, y, u.footprint, 1);
    this.units.push(u);
    // Like CreateUnit in WC3, a new unit fires 'enters region' events on the next tick.
    u.rects = new Set();
    this.emit('unitAdded', u);
    return u;
  }

  private removeUnit(u: Unit) {
    if (u.footprint) this.grid.setFootprint(u.x, u.y, u.footprint, 0);
    u.alive = false;
    u.removeAt = this.time;
  }

  // ---------------------------------------------------------------------------------------------
  // Triggers (ported from war3map.j)
  // ---------------------------------------------------------------------------------------------

  private *trigIntialization(s: ThreadState): Thread {
    if (s.pc < 1) {
      this.emit('fade', { dir: 'out', duration: 0 });
      this.playerCount = this.players.filter((p) => p.playing).length;
      s.pc = 1;
      yield 0.5;
    }
    if (s.pc < 2) {
      for (const p of this.players) if (p.playing) p.gold = this.cfg.startGold;
      for (const [i, name] of ['gg_unit_h002_0007', 'gg_unit_h002_0002', 'gg_unit_h002_0009'].entries()) {
        const b = this.named[name];
        if (b && !this.players[i].playing) b.hidden = true;
      }
      s.pc = 2;
      yield 0.5;
    }
    if (s.pc < 3) {
      for (const d of Object.values(this.destructables)) if (d.id === 'ZTg1') d.invulnerable = true;
      this.portal('death');
      s.pc = 3;
      yield 0.5;
    }
    if (s.pc < 4) {
      this.lives = this.cfg.livesPerPlayer * this.playerCount;
      s.pc = 4;
      yield 0.5;
    }
    this.trigDialogButton();
    this.run('quests');
  }

  private *trigQuests(s: ThreadState): Thread {
    if (s.pc < 1) {
      s.pc = 1;
      yield 2;
    }
    this.emit('quest', undefined);
  }

  private trigDialogButton() {
    const host = this.players.find((p) => p.playing)!;
    this.emit('dialog', {
      title: this.str('TRIGSTR_544'),
      buttons: this.cfg.difficulties.map((d, i) => ({ label: d.label, id: i })),
      timeout: this.cfg.difficultyTimeout,
    });
    for (const p of this.players) if (p.playing && p !== host) this.message(`${host.name} is selecting difficulty...`, 10);
    this.run('slowSelector');
  }

  private *trigSlowSelector(s: ThreadState): Thread {
    if (s.pc < 1) {
      s.pc = 1;
      yield this.cfg.difficultyTimeout;
    }
    if (!this.difficultyChosen) {
      this.difficultyChosen = true;
      this.setDifficulty(this.cfg.defaultDifficulty, this.str('TRIGSTR_558'));
    }
  }

  /** Called by the UI (difficulty dialog). */
  chooseDifficulty(index: number) {
    if (this.difficultyChosen) return;
    this.difficultyChosen = true;
    this.emit('clearMessages', undefined);
    this.setDifficulty(index, this.cfg.difficulties[index].message);
  }

  private setDifficulty(index: number, msg: string) {
    this.difficultyFactor = this.cfg.difficulties[index].factor;
    this.handicap = this.difficultyFactor * this.playerCount;
    this.emit('dialog', null);
    this.message(msg, 3);
    this.run('startingGame');
  }

  private *trigStartingGame(s: ThreadState): Thread {
    if (s.pc < 1) {
      this.multiboardTitle = this.str('TRIGSTR_326');
      this.emit('fade', { dir: 'in', duration: 3 });
      s.pc = 1;
      yield 3;
    }
    if (s.pc < 2) {
      this.emit('clearMessages', undefined);
      this.message('TRIGSTR_559');
      this.playSound('gg_snd_GoodJob');
      this.multiboardVisible = true;
      s.pc = 2;
      yield 8;
    }
    if (s.pc < 3) {
      this.emit('clearMessages', undefined);
      this.message('TRIGSTR_560');
      this.playSound('gg_snd_Hint');
      const w = this.cfg.waves[0];
      this.spawnUnit = w.unit;
      this.spawnName = w.name;
      this.spawnCooldown = w.spawnCooldown;
      this.waveSound = w.sound;
      s.pc = 3;
      yield 8;
    }
    this.emit('clearMessages', undefined);
    this.run('waveSpawn');
  }

  private spawnPoint() {
    const r = this.rects['Spawn Region'];
    return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  }

  private rectCenter(name: string) {
    const r = this.rects[name];
    return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  }

  private *trigWaveSpawn(s: ThreadState): Thread {
    const sp = this.spawnPoint();
    if (s.pc < 1) {
      this.portal('birth');
      this.playSound('gg_snd_Gateway_Opens', sp.x, sp.y);
      s.pc = 1;
      yield 1;
    }
    if (s.pc < 2) {
      this.message(`|CFF6DCFF6Wave ${this.wave}:|r ${this.spawnName}`);
      this.multiboardTitle = `Wave ${this.wave}`;
      if (this.waveSound) this.emit('sound', { file: this.waveSound });
      s.pc = 2;
      s.i = 0;
      yield 1;
    }
    if (s.pc < 3) {
      while ((s.i ?? 0) < this.cfg.unitsPerWave) {
        if (this.ended) return;
        this.createUnit(this.spawnUnit, CREEP_PLAYER, sp.x, sp.y, 0);
        s.i = (s.i ?? 0) + 1;
        if (s.i < this.cfg.unitsPerWave) yield this.spawnCooldown;
      }
      s.pc = 3;
      yield 1;
    }
    this.portal('death');
    this.playSound('gg_snd_Gateway_Closes', sp.x, sp.y);
  }

  private onCreepDeath() {
    // Trig_Wave_Clear: no living units of the current spawn type left.
    if (this.units.some((u) => u.alive && u.owner === CREEP_PLAYER && u.def.id === this.spawnUnit)) return;
    this.run('waveClear');
  }

  private *trigWaveClear(s: ThreadState): Thread {
    const g1 = this.destructables.gg_dest_ZTg1_0091;
    const g2 = this.destructables.gg_dest_ZTg1_0092;
    if (s.pc < 1) {
      if (this.wave > this.cfg.lastWave - 1) {
        this.run('victory');
        return;
      }
      const bonus = this.wave * 10 + Math.floor((this.wave * this.wave) / this.playerCount);
      for (const p of this.players) if (p.playing) {
        p.gold += bonus;
        p.earned += bonus;
      }
      this.message(`All players receive |cffffcc00${bonus} |rextra gold for surviving the wave.`);
      this.playSound('gg_snd_GoodJob');
      this.multiboardTitle = `Wave ${this.wave} completed!`;
      for (const g of [g1, g2]) if (g) this.modifyGate(g, true);
      s.pc = 1;
      yield 3;
    }
    if (s.pc < 2) {
      this.wave++;
      this.nextWaveTimer = { end: this.time + this.cfg.nextWaveDelay };
      this.timerUpdate = true;
      s.pc = 2;
      yield this.cfg.nextWaveDelay - 0.1;
    }
    if (s.pc < 3) {
      this.trigNextWaveSet();
      s.pc = 3;
      yield 0.05;
    }
    if (s.pc < 4) {
      if (g1) {
        this.modifyGate(g1, false);
        this.playSound('gg_snd_LockUp_Doors', g1.x, g1.y);
      }
      s.pc = 4;
      yield 0.05;
    }
    if (g2) {
      this.modifyGate(g2, false);
      this.playSound('gg_snd_LockUp_Doors', g2.x, g2.y);
    }
    this.timerUpdate = false;
    this.nextWaveTimer = null;
    this.trigClearPath();
    this.run('waveSpawn');
  }

  private modifyGate(d: Destructable, open: boolean) {
    d.open = open;
    this.setGatePathing(d, !open);
  }

  private trigNextWaveSet() {
    const w = this.cfg.waves.find((x) => x.wave === this.wave);
    if (!w) return;
    this.spawnUnit = w.unit;
    this.spawnName = w.name;
    this.waveSound = w.sound;
    this.spawnCooldown = w.spawnCooldown;
  }

  private trigClearPath() {
    const r = this.rects['Final Path'];
    for (const u of this.units) {
      if (!u.alive || !this.cfg.templeUnits.includes(u.def.id)) continue;
      if (u.x >= r.minX && u.x <= r.maxX && u.y >= r.minY && u.y <= r.maxY) this.sendHome(u);
    }
  }

  private sendHome(u: Unit) {
    const homes = ['gg_unit_h000_0001', 'gg_unit_h000_0005', 'gg_unit_h000_0006'];
    const home = this.named[homes[Math.min(u.owner, 2)]];
    if (home) {
      u.x = home.x;
      u.y = home.y;
      u.moveTarget = null;
      u.path = null;
      u.rects = this.rectsAt(u.x, u.y);
      this.emit('effect', { model: 'Abilities\\Spells\\Human\\MassTeleport\\MassTeleportTarget.mdl', x: u.x, y: u.y, color: 0x80c0ff });
    }
  }

  private *trigVictory(s: ThreadState): Thread {
    if (s.pc < 1) {
      this.message('TRIGSTR_561');
      const portal = this.destructables.gg_dest_OTsp_0074;
      if (portal) portal.alive = false;
      this.emit('fade', { dir: 'out', duration: 5 });
      this.multiboardTitle = this.str('TRIGSTR_562');
      s.pc = 1;
      yield 2.5;
    }
    if (s.pc < 2) {
      this.multiboardTitle = this.str('TRIGSTR_563');
      s.pc = 2;
      yield 1.8;
    }
    this.ended = { victory: true };
    this.sampleScores();
    this.emit('end', { victory: true, text: 'Victory!' });
  }

  private *lifeLost(s: ThreadState, u?: Unit): Thread {
    if (s.pc < 1) {
      if (this.ended) return;
      if (this.lives > 0) {
        this.lives--;
        this.message(`|CFF6DCFF6An unit has entered the gate! ${this.lives} lives remaining!|r`);
        this.playSound('gg_snd_Warning');
        const sp = this.spawnPoint();
        if (u) this.teleport(u, sp.x, sp.y);
        return;
      }
      this.lifeLostEnabled = false;
      const portal = this.destructables.gg_dest_OTsp_0074;
      if (portal) portal.alive = false;
      this.emit('fade', { dir: 'out', duration: 5 });
      this.message('TRIGSTR_221');
      this.multiboardTitle = this.str('TRIGSTR_336');
      s.pc = 1;
      yield 4;
    }
    this.ended = { victory: false };
    this.sampleScores();
    this.emit('end', { victory: false, text: this.str('TRIGSTR_218') });
  }
  private lifeLostEnabled = true;

  private teleport(u: Unit, x: number, y: number) {
    u.x = x;
    u.y = y;
    u.path = null;
    u.moveTarget = null;
    u.attackGate = false;
    // Entering the new location fires region events on the next tick.
  }

  private gateDies() {
    this.message('TRIGSTR_047');
    this.playSound('gg_snd_Warning');
    const goal = this.rectCenter('Goal');
    for (const u of this.unitsInRect('Gate', CREEP_PLAYER)) this.orderMove(u, goal.x, goal.y);
  }

  private gateRepaired() {
    this.message('TRIGSTR_405');
    this.playSound('gg_snd_Gate_Repaired');
    const gate = this.destructables.gg_dest_ZTsg_0000;
    gate.alive = true;
    gate.hp = gate.maxHp;
    this.setGatePathing(gate, true);
    for (const u of this.unitsInRect('Gate', CREEP_PLAYER)) {
      u.attackGate = true;
      u.moveTarget = null;
      u.path = null;
    }
  }

  private unitsInRect(name: string, owner: number) {
    return this.units.filter((u) => u.alive && u.owner === owner && u.rects.has(name));
  }

  private rectsAt(x: number, y: number) {
    const s = new Set<string>();
    for (const [name, r] of Object.entries(this.rects)) if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) s.add(name);
    return s;
  }

  /** Region enter events (TriggerRegisterEnterRectSimple). */
  private onEnterRect(u: Unit, rect: string) {
    if (u.owner === CREEP_PLAYER) {
      const path = this.cfg.path;
      const idx = path.indexOf(rect);
      if (rect === 'Gate') {
        u.userData = 11;
        if (this.destructables.gg_dest_ZTsg_0000?.alive) {
          u.attackGate = true;
          u.moveTarget = null;
          u.path = null;
        } else {
          const g = this.rectCenter('Goal');
          this.orderMove(u, g.x, g.y);
        }
      } else if (rect === 'Goal') {
        if (this.lifeLostEnabled) this.run('lifeLost', u);
      } else if (idx >= 0 && idx < path.length - 2) {
        const next = this.rectCenter(path[idx + 1]);
        this.orderMove(u, next.x, next.y);
        u.userData = idx;
      }
    } else if (rect === 'Gate' && this.cfg.templeUnits.includes(u.def.id)) {
      this.sendHome(u);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Player commands
  // ---------------------------------------------------------------------------------------------

  player(id: number) {
    return this.players[id];
  }

  /** Can the player use (build/train/upgrade to) this unit type? Returns missing requirement names. */
  missingRequirements(playerId: number, def: UnitDef): string[] {
    const missing: string[] = [];
    const p = this.players[playerId];
    def.requires.forEach((req, i) => {
      if (/^R/.test(req)) {
        const lvl = def.requiresLevels[i] || def.requiresLevels[def.requiresLevels.length - 1] || 1;
        if ((p.research[req] ?? 0) < lvl) missing.push(`${this.db.upgrade(req).name(lvl)}${lvl > 1 ? ` (level ${lvl})` : ''}`);
      } else if (!this.hasUnitType(playerId, req)) {
        missing.push(this.db.unit(req).name);
      }
    });
    return missing;
  }

  private hasUnitType(playerId: number, id: string) {
    return this.units.some((u) => u.alive && u.owner === playerId && !u.constructing && (u.def.id === id || this.ancestors.get(u.def.id)?.has(id)));
  }

  canPlace(x: number, y: number) {
    return this.grid.canBuild(x, y, 4);
  }

  /** Like the engine: object gold costs of upgraded structures are cumulative, an upgrade charges the difference. */
  upgradeCost(tower: Unit, to: string) {
    return Math.max(0, this.db.unit(to).gold - tower.def.gold);
  }

  upgrade(tower: Unit, to: string): string | null {
    if (tower.constructing || tower.upgrading) return ERR.busy;
    const def = this.db.unit(to);
    const p = this.players[tower.owner];
    const missing = this.missingRequirements(tower.owner, def);
    if (missing.length) return `${ERR.requires} ${missing.join(', ')}`;
    const cost = this.upgradeCost(tower, to);
    if (p.gold < cost) return ERR.noGold;
    p.gold -= cost;
    tower.upgrading = { to, total: Math.max(0.1, def.buildTime), elapsed: 0 };
    return null;
  }

  cancel(u: Unit) {
    const p = this.players[u.owner];
    if (u.upgrading) {
      p.gold += this.upgradeCost(u, u.upgrading.to);
      u.upgrading = null;
    } else if (u.constructing) {
      p.gold += u.def.gold;
      this.removeUnit(u);
    } else if (u.queue.length) {
      const q = u.queue.pop()!;
      p.gold += q.kind === 'train' ? this.db.unit(q.id).gold : this.db.upgrade(q.id).gold(q.level);
    }
  }

  /**
   * Human construction like the engine: the order costs the gold at once, the builder walks to the site and only
   * then founds the building; it keeps working on it (hammer animation, "Stand Work") and construction progresses
   * only while it stays. Leaving pauses the building – it is not functional until another order to the
   * unfinished building (right click) resumes the work. Shift queues further buildings.
   */
  build(builder: Unit, id: string, x: number, y: number, queued = false): string | null {
    const def = this.db.unit(id);
    const p = this.players[builder.owner];
    const missing = this.missingRequirements(builder.owner, def);
    if (missing.length) return `${ERR.requires} ${missing.join(', ')}`;
    [x, y] = this.grid.snap(x, y, 4);
    // Without Shift the builder's own planned buildings are dropped (refunded) by this order.
    const refund = queued ? 0 : builder.buildQueue.reduce((n, q) => n + this.db.unit(q.id).gold, 0);
    const taken = this.plannedSites(queued ? null : builder).some((s) => Math.abs(s.x - x) < 128 && Math.abs(s.y - y) < 128);
    if (!this.grid.canBuild(x, y, 4) || taken) return ERR.cantPlace;
    if (p.gold + refund < def.gold) return ERR.noGold;
    if (!queued) this.clearOrders(builder);
    p.gold -= def.gold;
    builder.buildQueue.push({ id, x, y });
    if (builder.buildQueue.length === 1 && !builder.constructs) this.approachSite(builder);
    return null;
  }

  /** Paid construction orders whose builder has not reached the site yet. */
  plannedSites(except: Unit | null = null) {
    const out: { id: string; x: number; y: number; owner: number }[] = [];
    for (const u of this.units) if (u.alive && u !== except) for (const b of u.buildQueue) out.push({ ...b, owner: u.owner });
    return out;
  }

  /** Right click on an own unfinished building: the builder resumes its construction. */
  resumeConstruction(builder: Unit, site: Unit): boolean {
    if (builder.kind !== 'builder' || !site.alive || !site.constructing || site.owner !== builder.owner) return false;
    this.clearOrders(builder);
    builder.constructs = site;
    this.approach(builder, site.x, site.y);
    return true;
  }

  /** Drops pending construction orders (refund) and stops working on a building. */
  private clearOrders(u: Unit) {
    if (u.buildQueue.length) {
      const p = this.players[u.owner];
      for (const b of u.buildQueue) if (p) p.gold += this.db.unit(b.id).gold;
      u.buildQueue = [];
    }
    u.constructs = null;
    u.repairs = null;
    if (u.anim === 'work') u.anim = 'stand';
  }

  private approachSite(u: Unit) {
    const b = u.buildQueue[0];
    if (b) this.approach(u, b.x, b.y);
  }

  /** Walks next to a building site (its footprint is 4×4 cells = 128 units). */
  private approach(u: Unit, x: number, y: number) {
    const d = Math.hypot(u.x - x, u.y - y);
    if (d <= BUILD_REACH) return;
    const k = (d - 110) / d;
    this.moveTo(u, x + (u.x - x) * (1 - k), y + (u.y - y) * (1 - k));
  }

  /** Construction orders of a builder, run every tick. */
  private updateBuilder(u: Unit, dt = 0) {
    if (u.repairs) return this.updateRepair(u, dt);
    if (!u.constructs && !u.buildQueue.length) this.autoRepair(u);
    if (u.repairs) return;
    const site = u.constructs;
    if (site) {
      if (!site.alive || !site.constructing || !this.units.includes(site)) {
        u.constructs = null;
        if (u.anim === 'work') u.anim = 'stand';
        this.approachSite(u);
        return;
      }
      if (Math.hypot(site.x - u.x, site.y - u.y) > BUILD_REACH) {
        if (!u.path) this.approach(u, site.x, site.y);
        return;
      }
      u.path = null;
      u.moveTarget = null;
      u.facing = Math.atan2(site.y - u.y, site.x - u.x);
      u.anim = 'work';
      return;
    }
    const b = u.buildQueue[0];
    if (!b) return;
    const d = Math.hypot(b.x - u.x, b.y - u.y);
    if (d > BUILD_REACH && u.path) return;
    // At the site (or as close as the path got): found the building; the place may have been taken meanwhile → refund.
    u.buildQueue.shift();
    u.moveTarget = null;
    const def = this.db.unit(b.id);
    if (d > BUILD_REACH * 2.5 || !this.grid.canBuild(b.x, b.y, 4)) {
      this.players[u.owner].gold += def.gold;
      this.emit('error', { owner: u.owner, text: ERR.cantPlace });
      this.approachSite(u);
      return;
    }
    const t = this.createUnit(b.id, u.owner, b.x, b.y, (270 * Math.PI) / 180);
    t.constructing = { total: Math.max(0.1, def.buildTime), elapsed: 0 };
    t.hp = Math.max(1, def.hp * 0.1);
    t.anim = 'birth';
    u.constructs = t;
    this.players[u.owner].built++;
    this.players[u.owner].producedValue += def.pointValue;
  }

  // --- spells ----------------------------------------------------------------------------------

  /** Resistant Skin (ACrk): negative spells last only their hero duration (ahdu) like on heroes. */
  private resistant(u: Unit) {
    return u.def.abilities.some((id) => this.db.ability(id).base === 'ACrk');
  }

  private spellDuration(t: Unit, f: Record<string, string | number>, fallback: number) {
    const normal = Number(f['adur@1'] ?? fallback);
    return this.resistant(t) ? Math.min(normal, Number(f['ahdu@1'] ?? normal)) : normal;
  }

  applyBuff(u: Unit, id: string, duration: number, data: Omit<Unit['buffs'][string], 'until'>) {
    const had = !!u.buffs[id];
    u.buffs[id] = { ...data, until: Math.max(u.buffs[id]?.until ?? 0, this.time + duration) };
    if (!had) this.emit('buff', { unit: u, id, on: true });
  }

  private removeBuff(u: Unit, id: string) {
    if (!u.buffs[id]) return;
    delete u.buffs[id];
    this.emit('buff', { unit: u, id, on: false });
  }

  private buffSum(u: Unit, key: 'move' | 'attack' | 'scale' | 'damage') {
    let s = 0;
    for (const b of Object.values(u.buffs)) s += b[key] ?? 0;
    return s;
  }

  /** Model scale factor from buffs (Bloodlust makes units bigger). */
  buffScale(u: Unit) {
    return 1 + this.buffSum(u, 'scale');
  }

  private art(ab: { fields: Record<string, string | number> }, field: 'acat' | 'atat' | 'asat' | 'aeat') {
    return String(ab.fields[field] ?? '').split(',')[0].trim();
  }

  /** Per-unit spell logic: creep autocasts (Bloodlust), Share Mana autocast, Mana Drain channel, Skyfury storms. */
  private updateSpells(u: Unit, dt: number) {
    if (u.drain) this.updateDrain(u, dt);
    for (const id of u.def.abilities) {
      const ab = this.db.ability(id);
      if ((u.abilityCd[id] ?? 0) > this.time) continue;
      const f = ab.fields;
      const cost = Number(f['amcs@1'] ?? 0);
      if (u.mana < cost) continue;
      if (ab.base === 'Ablo' && u.owner === CREEP_PLAYER) {
        if (u.casting) continue;
        const buff = String(f['abuf@1'] ?? 'Bblo');
        const target = this.bloodlustTarget(u, f, buff);
        if (!target) continue;
        // Like an ordered cast: stop, face the target, play "spell"; the buff lands at the cast point.
        u.abilityCd[id] = this.time + Number(f['acdn@1'] ?? 1);
        this.startCast(u, target, () => {
          if (!target.alive || target.buffs[buff] || u.mana < cost) return;
          u.mana -= cost;
          this.applyBuff(target, buff, this.spellDuration(target, f, 60), { attack: Number(f['Blo1@1'] ?? 0), move: Number(f['Blo2@1'] ?? 0), scale: Number(f['Blo3@1'] ?? 0) });
        });
      } else if (ab.base === 'Arpm' && u.autocast[id] !== false && u.owner !== CREEP_PLAYER) {
        this.castShareMana(u, id, true);
      }
    }
    for (const s of this.storms) if (s.next <= this.time && s.until > this.time) this.stormStrike(s);
    this.storms = this.storms.filter((s) => s.until > this.time);
  }

  /**
   * Bloodlust autocast target of a computer caster: an own organic ground / air unit within cast range (aran) that
   * fights – attacks the gate or took damage in the last 3 s – and has no Bloodlust yet. Units already attacking
   * come first, then the nearest one.
   */
  private bloodlustTarget(u: Unit, f: Record<string, string | number>, buff: string) {
    const range = Number(f['aran@1'] ?? 600);
    const organicOnly = String(f['atar@1'] ?? 'organic').includes('organic');
    let best: Unit | null = null;
    let bestScore = Infinity;
    for (const c of this.units) {
      if (!c.alive || c.owner !== u.owner || c.hidden || c.def.isBuilding || c.buffs[buff]) continue;
      if (organicOnly && String(c.def.fields.utyp ?? '').includes('mechanical')) continue;
      const fighting = c.attackGate || this.time - c.lastDamaged < 3;
      if (!fighting) continue;
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d > range) continue;
      const score = d + (c.attackGate ? 0 : 10000);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  /** Starts a cast animation: effect at the unit's cast point (ucpt), busy until the backswing (ucbs) ends. */
  private startCast(u: Unit, target: Unit, apply: () => void) {
    const point = Number(u.def.fields.ucpt ?? 0.3) || 0;
    const back = Number(u.def.fields.ucbs ?? 0.51) || 0;
    if (target !== u) u.facing = Math.atan2(target.y - u.y, target.x - u.x);
    u.anim = 'spell';
    u.animTime = 0;
    u.casting = { fireAt: this.time + point, until: this.time + point + back, apply };
    if (point <= 0) this.updateCasting(u);
  }

  private updateCasting(u: Unit) {
    const c = u.casting!;
    if (c.apply && this.time >= c.fireAt) {
      const fire = c.apply;
      c.apply = null;
      fire();
    }
    if (this.time >= c.until) {
      u.casting = null;
      if (u.anim === 'spell') u.anim = 'stand';
    }
  }

  /** Arpm (Share Mana): restores Rpb6 mana to nearby allies that miss it (autocast or by hand). */
  castShareMana(u: Unit, id: string, auto = false): string | null {
    const ab = this.db.ability(id);
    const f = ab.fields;
    if ((u.abilityCd[id] ?? 0) > this.time) return ERR.cooldown;
    const cost = Number(f['amcs@1'] ?? 0);
    if (u.mana < cost) return ERR.noMana;
    const amount = Number(f['Rpb6@1'] ?? 10);
    const area = Number(f['aare@1'] ?? 500);
    const allies = this.units.filter((c) => c.alive && c !== u && c.owner === u.owner && c.maxMana > 0 && c.maxMana - c.mana >= (auto ? amount : 1) && Math.hypot(c.x - u.x, c.y - u.y) <= area);
    if (!allies.length) return auto ? null : ERR.targetManaUser;
    u.mana -= cost;
    u.abilityCd[id] = this.time + Number(f['acdn@1'] ?? 1);
    this.emit('spellArt', { model: this.art(ab, 'acat'), x: u.x, y: u.y, unit: u, sound: this.cat?.abilityFx?.[ab.base]?.effectSound });
    for (const c of allies) {
      c.mana = Math.min(c.maxMana, c.mana + amount);
      this.emit('spellArt', { model: this.art(ab, 'atat'), x: c.x, y: c.y, unit: c });
    }
    return null;
  }

  /** ACro (Bless Weapons, a Roar): +Roa1 damage for own units around the caster. */
  castRoar(u: Unit, id: string): string | null {
    const ab = this.db.ability(id);
    const f = ab.fields;
    if ((u.abilityCd[id] ?? 0) > this.time) return ERR.cooldown;
    const cost = Number(f['amcs@1'] ?? 0);
    if (u.mana < cost) return ERR.noMana;
    u.mana -= cost;
    u.abilityCd[id] = this.time + Number(f['acdn@1'] ?? 10);
    const area = Number(f['aare@1'] ?? 600);
    const buff = String(f['abuf@1'] ?? 'Broa').split(',')[0];
    this.emit('spellArt', { model: this.art(ab, 'acat'), x: u.x, y: u.y, unit: u });
    for (const c of this.units) {
      if (!c.alive || c.owner !== u.owner || c.def.isBuilding || !c.def.attack || Math.hypot(c.x - u.x, c.y - u.y) > area) continue;
      this.applyBuff(c, buff, Number(f['adur@1'] ?? 45), { damage: Number(f['Roa1@1'] ?? 0) });
    }
    return null;
  }

  /** AHdr (Mana Drain): channels Ndr2 mana per second from an enemy into the caster. */
  castDrain(u: Unit, id: string, target: Unit): string | null {
    const ab = this.db.ability(id);
    const f = ab.fields;
    if ((u.abilityCd[id] ?? 0) > this.time) return ERR.cooldown;
    if (target.owner !== CREEP_PLAYER || !target.alive) return ERR.targetEnemy;
    if (target.maxMana <= 0) return ERR.targetManaUser;
    if (Math.hypot(target.x - u.x, target.y - u.y) > Number(f['aran@1'] ?? 900)) return ERR.notInRange;
    const cost = Number(f['amcs@1'] ?? 0);
    if (u.mana < cost) return ERR.noMana;
    u.mana -= cost;
    u.abilityCd[id] = this.time + Number(f['acdn@1'] ?? 5);
    const duration = Number(f['adur@1'] ?? 10);
    if (u.drain) this.stopDrain(u);
    u.drain = { target, until: this.time + duration, rate: Number(f['Ndr2@1'] ?? 10), range: Number(f['aare@1'] ?? 1000), ability: id };
    const lightning = this.cat?.abilityFx?.[ab.base]?.lightning;
    this.emit('link', { id: u.uid, from: u, to: target, lightning: lightning?.[2] ?? lightning?.[0] ?? 'DRAM', until: u.drain.until, sound: this.cat?.abilityFx?.[ab.base]?.loopSound });
    this.applyBuff(u, 'Bdcm', duration, {});
    this.applyBuff(target, 'Bdtm', duration, {});
    return null;
  }

  private updateDrain(u: Unit, dt: number) {
    const d = u.drain!;
    const t = d.target;
    if (!t.alive || t.hidden || this.time >= d.until || Math.hypot(t.x - u.x, t.y - u.y) > d.range || u.stunUntil > this.time) return this.stopDrain(u);
    const amount = Math.min(d.rate * dt, t.mana, u.maxMana - u.mana);
    t.mana -= amount;
    u.mana += amount;
  }

  private stopDrain(u: Unit) {
    const d = u.drain;
    if (!d) return;
    u.drain = null;
    this.removeBuff(u, 'Bdcm');
    this.removeBuff(d.target, 'Bdtm');
    this.emit('link', { id: u.uid, from: u, to: d.target, lightning: '', until: this.time });
  }

  /** ACmo (Skyfury, a Monsoon): lightning strikes in an area every Esf2 seconds for the duration. */
  castStorm(u: Unit, id: string, x: number, y: number): string | null {
    const ab = this.db.ability(id);
    const f = ab.fields;
    if ((u.abilityCd[id] ?? 0) > this.time) return ERR.cooldown;
    if (Math.hypot(x - u.x, y - u.y) > Number(f['aran@1'] ?? 1000)) return ERR.notInRange;
    const cost = Number(f['amcs@1'] ?? 0);
    if (u.mana < cost) return ERR.noMana;
    u.mana -= cost;
    u.abilityCd[id] = this.time + Number(f['acdn@1'] ?? 10);
    const duration = Number(f['adur@1'] ?? 20);
    const effect = String(f['aeff@1'] ?? '');
    const buff = String(f['abuf@1'] ?? '');
    this.storms.push({ x, y, owner: u.owner, source: u, until: this.time + duration, next: this.time, interval: Math.max(0.1, Number(f['Esf2@1'] ?? 2)), damage: Number(f['Esf1@1'] ?? 50), radius: Number(f['aare@1'] ?? 250), buff });
    const fx = this.cat?.buffs?.[effect];
    if (fx?.effectArt[0]) this.emit('spellArt', { model: fx.effectArt[0], x, y, sound: fx.loopSound, duration });
    return null;
  }

  private stormStrike(s: Game['storms'][number]) {
    s.next += s.interval;
    const art = this.cat?.buffs?.[s.buff]?.targetArt[0] ?? '';
    for (const c of this.units) {
      if (!c.alive || c.owner !== CREEP_PLAYER || c.hidden || Math.hypot(c.x - s.x, c.y - s.y) > s.radius) continue;
      if (c.def.abilities.includes('Amim')) continue;
      if (art) this.emit('spellArt', { model: art, x: c.x, y: c.y, unit: c });
      this.damage(c, s.damage, 'spells', s.source, false);
    }
  }

  setAutocast(u: Unit, id: string, on: boolean) {
    u.autocast[id] = on;
  }

  /** Repair (Ahrp) data of a builder: cost / time ratios and Power Build cost / rate (Rep1–Rep4). */
  private repairData(u: Unit) {
    const id = u.def.abilities.find((a) => this.db.ability(a).base === 'Ahrp');
    const f = id ? this.db.ability(id).fields : {};
    return { id, costRatio: Number(f['Rep1@1'] ?? 0.35), timeRatio: Number(f['Rep2@1'] ?? 1.5), powerCost: Number(f['Rep3@1'] ?? 0.15), powerRate: Number(f['Rep4@1'] ?? 0.6) };
  }

  /** Gold is charged in whole coins: fractions are collected per player and taken once they add up to 1. */
  private goldDebt: number[] = [];
  private chargeFraction(owner: number, amount: number) {
    const p = this.players[owner];
    if (!p) return;
    this.goldDebt[owner] = (this.goldDebt[owner] ?? 0) + amount;
    const whole = Math.floor(this.goldDebt[owner]);
    if (whole > 0) {
      p.gold -= whole;
      this.goldDebt[owner] -= whole;
    }
  }

  /** Mechanical unit or structure (Ahrp targets: mechanical, structure). */
  private repairable(t: Unit) {
    return t.def.isBuilding || /\bmechanical\b/i.test(String(t.def.fields.utyp ?? ''));
  }

  /**
   * Repair (Ahrp) like the engine: on an unfinished building it resumes the construction; on a damaged own mechanical
   * unit or building the builder restores its hit points over buildTime × Rep2 for full health, paying
   * Rep1 × its price in proportion.
   */
  orderRepair(builder: Unit, t: Unit): string | null {
    if (builder.kind !== 'builder' || !this.repairData(builder).id) return null;
    if (t.owner !== builder.owner || !t.alive || !this.repairable(t)) return ERR.targetRepair;
    if (t.constructing) {
      this.resumeConstruction(builder, t);
      return null;
    }
    if (t.hp >= t.maxHp) return ERR.notDamaged;
    this.clearOrders(builder);
    builder.repairs = t;
    this.approach(builder, t.x, t.y);
    return null;
  }

  /** Autocast Repair: an idle builder repairs the nearest damaged own building / machine within 800 units. */
  private autoRepair(u: Unit) {
    const rp = this.repairData(u);
    if (!rp.id || u.autocast[rp.id] === false || u.path || u.buildQueue.length || u.constructs || u.repairs) return;
    let best = 800;
    let target: Unit | null = null;
    for (const t of this.units) {
      if (t.owner !== u.owner || !t.alive || t.constructing || t.hp >= t.maxHp || !this.repairable(t) || t.def.abilities.includes('Avul')) continue;
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (d < best) {
        best = d;
        target = t;
      }
    }
    if (target) {
      u.repairs = target;
      this.approach(u, target.x, target.y);
    }
  }

  private updateRepair(u: Unit, dt: number) {
    const t = u.repairs!;
    const rp = this.repairData(u);
    if (!t.alive || t.hp >= t.maxHp || !this.units.includes(t)) {
      u.repairs = null;
      if (u.anim === 'work') u.anim = 'stand';
      return;
    }
    if (Math.hypot(t.x - u.x, t.y - u.y) > BUILD_REACH) {
      if (!u.path) this.approach(u, t.x, t.y);
      return;
    }
    u.path = null;
    u.moveTarget = null;
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    const heal = Math.min(t.maxHp - t.hp, (t.maxHp * dt) / Math.max(0.1, t.def.buildTime * rp.timeRatio));
    const cost = (heal / t.maxHp) * t.def.gold * rp.costRatio;
    const p = this.players[u.owner];
    if (cost > 0 && p && p.gold - (this.goldDebt[u.owner] ?? 0) < cost) {
      this.emit('error', { owner: u.owner, text: ERR.noGold });
      u.repairs = null;
      u.anim = 'stand';
      return;
    }
    this.chargeFraction(u.owner, cost);
    t.hp += heal;
    u.anim = 'work';
  }

  /** Deterministic random numbers (tests, replays) – mulberry32 instead of Math.random. */
  seed(n: number) {
    this.rndState = n >>> 0;
  }

  // --- saved games ---------------------------------------------------------------------------

  /**
   * Snapshot of the whole simulation as plain JSON: units (references between units as uids, unit types as ids),
   * missiles, storms, players, destructables, pathing occupancy, the random generator and the trigger threads
   * with their progress. Spell casts in their wind-up are dropped (the caster simply casts again).
   */
  save(): SaveData {
    const ref = (u: Unit | null | undefined) => (u ? u.uid : null);
    const units = this.units.map((u) => ({
      ...u,
      def: u.def.id,
      target: ref(u.target),
      forcedTarget: ref(u.forcedTarget),
      chase: ref(u.chase),
      constructs: ref(u.constructs),
      repairs: ref(u.repairs),
      drain: u.drain ? { ...u.drain, target: u.drain.target.uid } : null,
      poison: u.poison ? { ...u.poison, source: ref(u.poison.source) } : null,
      casting: null,
      rects: [...u.rects],
    }));
    const occupied: number[] = [];
    const occ = this.grid.occupied;
    for (let i = 0; i < occ.length; i++) {
      if (!occ[i]) continue;
      let j = i;
      while (j < occ.length && occ[j] === occ[i]) j++;
      occupied.push(i, j - i, occ[i]);
      i = j - 1;
    }
    // ±Infinity (e.g. lastDamaged, endless stuns) would become null in JSON.
    const replacer = (_k: string, v: unknown) => (v === Infinity ? '+Inf' : v === -Infinity ? '-Inf' : v);
    return JSON.parse(
      JSON.stringify({
        version: 1,
        scalars: {
          time: this.time, playerCount: this.playerCount, lives: this.lives, wave: this.wave, spawnUnit: this.spawnUnit, spawnName: this.spawnName,
          spawnCooldown: this.spawnCooldown, waveSound: this.waveSound, difficultyFactor: this.difficultyFactor, handicap: this.handicap,
          multiboardTitle: this.multiboardTitle, multiboardVisible: this.multiboardVisible, nextWaveTimer: this.nextWaveTimer, timerUpdate: this.timerUpdate,
          ended: this.ended, uidSeq: this.uidSeq, missileSeq: this.missileSeq, nextAuraRefresh: this.nextAuraRefresh, difficultyChosen: this.difficultyChosen,
          lifeLostEnabled: this.lifeLostEnabled, nextSample: this.nextSample, threadSeq: this.threadSeq, rndState: this.rndState, portalOpen: this.portalOpen,
        },
        players: this.players,
        goldDebt: this.goldDebt,
        shopStock: this.shopStock,
        destructables: this.destructables,
        named: Object.fromEntries(Object.entries(this.named).map(([k, u]) => [k, u.uid])),
        units,
        missiles: this.missiles.map((m) => ({ ...m, source: m.source.uid, target: ref(m.target), bounce: m.bounce ? { ...m.bounce, hit: [...m.bounce.hit] } : null })),
        storms: this.storms.map((s) => ({ ...s, source: s.source.uid })),
        pendingShots: this.pendingShots.map((p) => ({ u: p.u.uid, t: p.t.uid, at: p.at })),
        threads: this.threads.map((t) => ({ state: t.state, at: t.at, seq: t.seq })),
        occupied,
      }, replacer),
    );
  }

  /**
   * Restores a snapshot from save() into a started game: the current units are replaced (unitRemoved / unitAdded
   * keep the renderer in sync) and the trigger threads continue where they were.
   */
  load(saved: SaveData) {
    if (saved.version !== 1) throw new Error('Nepodporovaná verze uložené hry.');
    const data: SaveData = JSON.parse(JSON.stringify(saved), (_k, v) => (v === '+Inf' ? Infinity : v === '-Inf' ? -Infinity : v));
    for (const u of this.units) this.emit('unitRemoved', u);
    Object.assign(this, data.scalars);
    this.players = data.players;
    this.goldDebt = data.goldDebt;
    this.shopStock = data.shopStock;
    for (const [k, d] of Object.entries(data.destructables)) this.destructables[k] = d;
    const byUid = new Map<number, Unit>();
    const units: Unit[] = data.units.map((s) => {
      const u = { ...s, def: this.db.unit(s.def), rects: new Set(s.rects) } as unknown as Unit;
      byUid.set(u.uid, u);
      return u;
    });
    const get = (uid: number | null | undefined) => (uid === null || uid === undefined ? null : byUid.get(uid) ?? null);
    data.units.forEach((s, i) => {
      const u = units[i];
      u.target = get(s.target);
      u.forcedTarget = get(s.forcedTarget);
      u.chase = get(s.chase);
      u.constructs = get(s.constructs);
      u.repairs = get(s.repairs);
      u.drain = s.drain && get(s.drain.target) ? { ...s.drain, target: get(s.drain.target)! } : null;
      u.poison = s.poison ? { ...s.poison, source: get(s.poison.source) } : null;
      u.casting = null;
      if (u.anim === 'spell') u.anim = 'stand';
    });
    this.units = units;
    for (const k of Object.keys(this.named)) delete this.named[k];
    for (const [k, uid] of Object.entries(data.named)) {
      const u = get(uid);
      if (u) this.named[k] = u;
    }
    this.missiles = data.missiles
      .filter((m) => get(m.source))
      .map((m) => ({ ...m, source: get(m.source)!, target: get(m.target), bounce: m.bounce ? { ...m.bounce, hit: new Set(m.bounce.hit) } : null }));
    this.storms = data.storms.filter((s) => get(s.source)).map((s) => ({ ...s, source: get(s.source)! }));
    const auras = this.auraSources();
    this.pendingShots = data.pendingShots.filter((p) => get(p.u) && get(p.t)).map((p) => ({ u: get(p.u)!, t: get(p.t)!, at: p.at, auras }));
    this.threads = data.threads.map((t) => ({ gen: this.threadGen(t.state), state: t.state, at: t.at, seq: t.seq }));
    this.grid.occupied.fill(0);
    for (let i = 0; i < data.occupied.length; i += 3) this.grid.occupied.fill(data.occupied[i + 2], data.occupied[i], data.occupied[i] + data.occupied[i + 1]);
    for (const u of this.units) this.emit('unitAdded', u);
    for (const m of this.missiles) this.emit('missileAdded', m);
    this.emit('doodadAnim', { id: 'D004', anim: this.portalOpen ? 'birth' : 'death' });
    // The start-up fade / difficulty dialog of the fresh game are replaced by the saved state.
    this.emit('dialog', null);
    if (!this.ended && (this.difficultyChosen || this.threads.some((t) => t.state.kind === 'slowSelector'))) this.emit('fade', { dir: 'in', duration: 0 });
    this.restoreDialog();
  }

  /** Remaining time of the difficulty dialog (for restoring it after loading). */
  get dialogRemaining() {
    if (this.difficultyChosen) return 0;
    const t = this.threads.find((x) => x.state.kind === 'slowSelector');
    return t ? Math.max(0, t.at - this.time) : 0;
  }

  /** Shows the difficulty dialog again after loading a game saved while it was open. */
  restoreDialog() {
    if (this.difficultyChosen) return;
    this.emit('dialog', { title: this.str('TRIGSTR_544'), buttons: this.cfg.difficulties.map((d, i) => ({ label: d.label, id: i })), timeout: this.dialogRemaining });
  }

  /** Click on a queued item in the info panel: removes it and refunds its cost (the first one restarts nothing). */
  cancelQueued(u: Unit, index: number) {
    const q = u.queue[index];
    if (!q) return;
    u.queue.splice(index, 1);
    const p = this.players[u.owner];
    if (p) p.gold += q.kind === 'train' ? this.db.unit(q.id).gold : this.db.upgrade(q.id).gold(q.level);
  }

  /** A003 – Sell (Trig_Sell_Tower). */
  sell(tower: Unit) {
    if (!tower.alive || tower.constructing) return;
    const value = Math.trunc(tower.def.pointValue * this.cfg.sellRatio);
    this.players[tower.owner].gold += value;
    this.emit('floatText', { text: `+${value}`, x: tower.x, y: tower.y, color: '#ffdc00', lifespan: 4 });
    this.emit('effect', { model: 'Abilities\\Spells\\Other\\Transmute\\PileofGold.mdl', x: tower.x, y: tower.y, color: 0xffd040 });
    this.removeUnit(tower);
    tower.anim = 'death';
  }

  train(building: Unit, id: string): string | null {
    const def = this.db.unit(id);
    const p = this.players[building.owner];
    const missing = this.missingRequirements(building.owner, def);
    if (missing.length) return `${ERR.requires} ${missing.join(', ')}`;
    if (p.gold < def.gold) return ERR.noGold;
    if (building.queue.length >= 7) return ERR.queueFull;
    p.gold -= def.gold;
    building.queue.push({ kind: 'train', id, level: 0, total: Math.max(0.5, def.buildTime), elapsed: 0 });
    return null;
  }

  research(building: Unit, id: string): string | null {
    const up = this.db.upgrade(id);
    const p = this.players[building.owner];
    const queued = building.queue.filter((q) => q.id === id).length;
    const level = (p.research[id] ?? 0) + queued + 1;
    if (level > up.levels) return ERR.researched;
    const req = up.requires(level);
    const reqLevel = up.requiresLevel(level) || 1;
    for (const r of req) if (/^R/.test(r) && (p.research[r] ?? 0) < reqLevel) return `${ERR.requires} ${this.db.upgrade(r).name(reqLevel)}`;
    if (p.gold < up.gold(level)) return ERR.noGold;
    p.gold -= up.gold(level);
    building.queue.push({ kind: 'research', id, level, total: Math.max(0.5, up.time(level)), elapsed: 0 });
    return null;
  }

  /** Buying from the Hightower shop (Life Bought / Gate Repaired triggers). */
  /**
   * Neutral shops (Ane2 "Select Unit") serve only a player whose unit stands within the ability's activation
   * radius (Neu1, 450 in 1.26) – like the game, where the shop's buttons are disabled otherwise.
   */
  shopperNear(playerId: number, shop: Unit) {
    const ab = shop.def.abilities.map((a) => this.db.ability(a)).find((a) => a.base === 'Ane2');
    if (!ab) return true;
    const r = Number(ab.fields['Neu1@1'] ?? 450);
    return this.units.some((u) => u.alive && !u.hidden && u.owner === playerId && u.speed > 0 && Math.hypot(u.x - shop.x, u.y - shop.y) <= r);
  }

  buy(playerId: number, id: string): string | null {
    const def = this.db.unit(id);
    const stock = this.shopStock[id];
    const p = this.players[playerId];
    const shop = this.units.find((u) => u.alive && u.kind === 'shop' && u.def.sells.includes(id));
    if (shop && !this.shopperNear(playerId, shop)) return ERR.noShopper;
    if (!stock || stock.stock <= 0) return ERR.outOfStock;
    if (p.gold < def.gold) return ERR.noGold;
    p.gold -= def.gold;
    p.bought++;
    stock.stock--;
    if (stock.nextAt <= this.time) stock.nextAt = this.time + stock.regen;
    if (id === this.cfg.lifeBuyUnit) {
      this.message(`|CFF6DCFF6${p.name} has bought a bonus life.|r`);
      this.playSound('gg_snd_Hint');
      this.lives++;
    } else if (id === this.cfg.gateRepairUnit) {
      this.gateRepaired();
    }
    return null;
  }

  /** A007 – Raven-form style morph between ground and flying builder. */
  morph(builder: Unit) {
    const ab = this.db.ability('A007');
    const ground = String(ab.fields['Eme1@1'] ?? 'h002');
    const air = String(ab.fields['Emeu@1'] ?? 'h018');
    const to = builder.def.id === air ? ground : air;
    const def = this.db.unit(to);
    builder.def = def;
    builder.flying = def.moveType === 'fly';
    builder.fly = builder.flying ? def.flyHeight || 200 : 0;
    builder.speed = def.speed;
    builder.path = null;
    this.clearOrders(builder);
    this.emit('unitRemoved', builder);
    this.emit('unitAdded', builder);
  }

  /** A010 – Coin Basher (Trig_Coin_Basher): costs gold equal to the wave number, stuns the target. */
  coinBash(builder: Unit, target: Unit): string | null {
    const ab = this.db.ability(this.cfg.coinBasherAbility);
    const range = Number(ab.fields['aran@1'] ?? 1000);
    const cd = Number(ab.fields['acdn@1'] ?? 8);
    if ((builder.abilityCd[ab.id] ?? 0) > this.time) return ERR.cooldown;
    if (Math.hypot(target.x - builder.x, target.y - builder.y) > range) return ERR.notInRange;
    const p = this.players[builder.owner];
    if (p.gold < this.wave) {
      this.emit('floatText', { text: this.str('TRIGSTR_751'), x: builder.x, y: builder.y, color: '#ffffff', lifespan: 3 });
      this.playSound('gg_snd_WhatNoGold');
      return null;
    }
    p.gold -= this.wave;
    builder.abilityCd[ab.id] = this.time + cd;
    const m = this.launch(builder, target, 0, 1000, 0.15, 0xffd040, String(ab.fields.amat ?? ''), true);
    m.homing = true;
    m.stun = Number(ab.fields['adur@1'] ?? 5);
    m.stunHero = Number(ab.fields['ahdu@1'] ?? m.stun);
    return null;
  }

  orderMove(u: Unit, x: number, y: number) {
    this.clearOrders(u);
    u.holdPosition = false;
    u.chase = null;
    u.forcedTarget = null;
    u.attackMove = null;
    this.moveTo(u, x, y);
  }

  /**
   * Attack-move (A + click on the ground): like the engine the unit walks to the point, but stops for every enemy
   * it acquires on the way, fights it (chasing within the acquisition range) and then continues. Units without
   * a weapon simply move.
   */
  orderAttackMove(u: Unit, x: number, y: number) {
    this.orderMove(u, x, y);
    if (u.def.attack && u.speed > 0) u.attackMove = { x, y };
  }

  /** Hold Position (H): stop and do not chase enemies. */
  hold(u: Unit) {
    this.stop(u);
    u.holdPosition = true;
  }

  private moveTo(u: Unit, x: number, y: number) {
    u.moveTarget = { x, y };
    u.attackGate = false;
    const straight = u.flying || u.def.moveType === '' || u.kind === 'creep';
    u.path = straight ? [[x, y]] : this.grid.findPath(u.x, u.y, x, y) ?? [[x, y]];
  }

  orderAttack(u: Unit, target: Unit) {
    if (!u.def.attack) return;
    u.forcedTarget = target;
    u.holdPosition = false;
  }

  stop(u: Unit) {
    this.clearOrders(u);
    u.chase = null;
    u.attackMove = null;
    u.holdPosition = false;
    u.moveTarget = null;
    u.path = null;
    u.forcedTarget = null;
    u.target = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------------------------

  update(realDt: number) {
    if (this.paused || this.ended) return;
    let remaining = Math.min(realDt, 0.1) * this.speed;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 30);
      remaining -= dt;
      this.step(dt);
    }
  }

  /**
   * Score screen values. The game's exact formulas are not documented; like it, the unit score sums point values
   * (upoi) of produced and killed units, the resource score is a tenth of the gathered gold; no heroes on this map.
   */
  score(p: PlayerState) {
    const units = p.producedValue + p.killValue;
    const resources = Math.floor(p.earned / 10);
    return { units, heroes: 0, resources, total: units + resources };
  }

  private nextSample = 0;

  /** Largest army and the score graph samples. */
  sampleScores() {
    for (const p of this.players) {
      if (!p.playing) continue;
      const army = this.units.filter((u) => u.alive && u.owner === p.id && !u.def.isBuilding && u.speed > 0).length;
      p.largestArmy = Math.max(p.largestArmy, army);
      const s = this.score(p);
      p.history.push({ t: this.time, units: s.units, resources: s.resources, total: s.total });
    }
  }

  private step(dt: number) {
    this.time += dt;
    if (this.time >= this.nextSample) {
      this.sampleScores();
      this.nextSample = this.time + 10;
    }
    this.resumeThreads();
    for (const s of Object.values(this.shopStock)) {
      if (s.stock < s.max && s.nextAt && s.nextAt <= this.time) {
        s.stock++;
        s.nextAt = s.stock < s.max ? this.time + s.regen : 0;
      }
    }

    const detectors = this.detectors();
    const auras = this.auraSources();
    this.refreshAuraBuffs(auras);

    for (const u of this.units) {
      if (!u.alive) continue;
      u.animTime += dt;
      if (u.constructing) {
        // Progress only while a builder works on it (Human construction). Further builders help (Power Build,
        // Ahrp Rep4 = rate per extra builder), each of them costs Rep3 × the building's price over the whole build.
        const workers = this.units.filter((b) => b.constructs === u && b.alive && b.anim === 'work');
        if (!workers.length) continue;
        let rate = 1;
        const rp = this.repairData(workers[0]);
        for (let i = 1; i < workers.length; i++) {
          const fee = (rp.powerCost * u.def.gold * dt) / u.constructing.total;
          const p = this.players[u.owner];
          if (!p || p.gold < fee) break;
          this.chargeFraction(u.owner, fee);
          rate += rp.powerRate;
        }
        u.constructing.elapsed += dt * rate;
        u.hp = Math.min(u.maxHp, u.maxHp * (0.1 + 0.9 * (u.constructing.elapsed / u.constructing.total)));
        if (u.constructing.elapsed >= u.constructing.total) {
          u.constructing = null;
          u.anim = 'stand';
          this.emit('completed', u);
          this.emit('constructed', u);
        }
        continue;
      }
      if (u.upgrading) {
        u.upgrading.elapsed += dt;
        if (u.upgrading.elapsed >= u.upgrading.total) {
          const def = this.db.unit(u.upgrading.to);
          u.def = def;
          u.maxHp = def.hp;
          u.hp = def.hp;
          u.upgrading = null;
          u.target = null;
          this.emit('unitRemoved', u);
          this.emit('unitAdded', u);
          this.emit('completed', u);
          this.emit('upgraded', u);
        }
        continue;
      }
      if (u.queue.length) this.processQueue(u, dt);
      if (u.maxMana > 0) u.mana = Math.min(u.maxMana, u.mana + u.manaRegen * dt);
      for (const [id, b] of Object.entries(u.buffs)) if (b.until <= this.time) this.removeBuff(u, id);
      if (u.poison && u.poison.until > this.time) this.damage(u, u.poison.dps * dt, 'spells', u.poison.source, true);
      else u.poison = null;
      if (!u.alive) continue;
      if (u.stunUntil > this.time) {
        u.casting = null;
        continue;
      }
      if (u.slow && u.slow.until <= this.time) u.slow = null;
      if (u.casting) {
        this.updateCasting(u);
        continue;
      }

      if (u.kind === 'creep') this.updateCreep(u, dt);
      else if (u.speed > 0 && u.path) this.moveAlong(u, dt);
      if (u.kind === 'builder') this.updateBuilder(u, dt);
      this.updateSpells(u, dt);

      if (u.def.attack && u.kind !== 'creep' && !u.hidden) this.updateAttacker(u, dt, detectors, auras);
    }

    // Region events.
    for (const u of this.units) {
      if (!u.alive) continue;
      const now = this.rectsAt(u.x, u.y);
      for (const r of now) if (!u.rects.has(r)) this.onEnterRect(u, r);
      u.rects = now;
    }

    this.separateUnits(dt);
    this.firePendingShots();
    this.updateMissiles(dt);

    // Cleanup corpses after a short death animation.
    const keep: Unit[] = [];
    for (const u of this.units) {
      if (!u.alive && this.time - u.removeAt > 1.5) this.emit('unitRemoved', u);
      else keep.push(u);
    }
    this.units = keep;
  }

  private processQueue(u: Unit, dt: number) {
    const q = u.queue[0];
    q.elapsed += dt;
    if (q.elapsed < q.total) return;
    u.queue.shift();
    if (q.kind === 'train') {
      const angle = this.rnd() * Math.PI * 2;
      const nu = this.createUnit(q.id, u.owner, u.x + Math.cos(angle) * 220, u.y + Math.sin(angle) * 220, angle);
      nu.anim = 'birth';
      const p = this.players[u.owner];
      if (p) {
        p.trained++;
        p.producedValue += nu.def.pointValue;
      }
      this.emit('trained', nu);
    } else {
      const p = this.players[u.owner];
      p.research[q.id] = Math.max(p.research[q.id] ?? 0, q.level);
      this.message(`|cffffcc00Výzkum dokončen: ${this.db.upgrade(q.id).name(q.level)}|r`, 5);
      this.emit('researched', { owner: u.owner, id: q.id, level: q.level });
    }
  }

  private effectiveSpeed(u: Unit) {
    let s = u.speed;
    if (u.slow) s *= 1 - u.slow.move;
    s *= 1 + this.buffSum(u, 'move');
    const min = Number(this.map.info.misc?.Misc?.MinUnitSpeed ?? 0);
    return u.speed > 0 ? Math.max(Math.min(min, u.speed), s) : 0;
  }

  private updateCreep(u: Unit, dt: number) {
    if (u.attackGate) {
      const gate = this.destructables.gg_dest_ZTsg_0000;
      if (!gate || !gate.alive) {
        u.attackGate = false;
        return;
      }
      const reach = (u.def.attack?.range ?? 90) + 110;
      const d = Math.hypot(gate.x - u.x, gate.y - u.y);
      if (d > reach) {
        this.stepToward(u, gate.x, gate.y, dt, d - reach);
        return;
      }
      u.anim = 'attack';
      u.facing = Math.atan2(gate.y - u.y, gate.x - u.x);
      u.cooldown -= dt;
      if (u.cooldown <= 0 && u.def.attack) {
        const a = u.def.attack;
        u.cooldown = (a.cooldown * (u.slow ? 1 + u.slow.attack : 1)) / (1 + this.buffSum(u, 'attack'));
        u.animTime = 0;
        const weaponSound = String(u.def.fields.ucs1 ?? '');
        if (weaponSound) this.emit('combatHit', { weaponSound, armor: this.db.doodadModel(gate.id)?.armor ?? 'Stone', x: gate.x, y: gate.y });
        if (!gate.invulnerable) {
          gate.hp -= rollDamage(a.damageBase, a.dice, a.sides, this.rnd);
          if (gate.hp <= 0) {
            gate.hp = 0;
            gate.alive = false;
            this.setGatePathing(gate, false);
            this.gateDies();
          }
        }
      }
      return;
    }
    if (u.path) this.moveAlong(u, dt);
  }

  private stepToward(u: Unit, x: number, y: number, dt: number, maxDist = Infinity) {
    const dx = x - u.x;
    const dy = y - u.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(this.effectiveSpeed(u) * dt, d, maxDist);
    if (d > 0.01) {
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      u.facing = Math.atan2(dy, dx);
    }
    u.anim = 'walk';
    return d - step;
  }

  /**
   * Unit collisions (ucol) for the player's ground units (builders, defenders): overlapping units are pushed
   * apart; a moving or working unit pushes an idle one aside, like the engine. A mover whose destination is
   * occupied by an idle unit stops next to it instead of pushing forever. Creeps walk the lane without collisions
   * (their move type is "none", see 6.3), flyers do not collide.
   */
  private separateUnits(dt: number) {
    const list = this.units.filter((u) => u.alive && !u.hidden && !u.flying && u.speed > 0 && u.owner < CREEP_PLAYER && u.kind !== 'creep');
    if (list.length < 2) return;
    const radius = (u: Unit) => Math.max(8, num(u.def.fields.ucol) || 16);
    const busy = (u: Unit) => !!u.path || u.anim === 'work' || u.anim === 'attack';
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = radius(a) + radius(b);
        if (d >= min) continue;
        if (d < 0.01) {
          // Exactly on top of each other: separate along a deterministic direction.
          dx = Math.cos(a.uid);
          dy = Math.sin(a.uid);
          d = 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        const ba = busy(a);
        const bb = busy(b);
        for (const [m, idle] of [[a, b], [b, a]] as const) {
          const dest = m.path?.[m.path.length - 1];
          if (busy(m) && !busy(idle) && dest && Math.hypot(dest[0] - idle.x, dest[1] - idle.y) < min && Math.hypot(dest[0] - m.x, dest[1] - m.y) < min * 1.5) {
            m.path = null;
            m.moveTarget = null;
            if (m.anim === 'walk') m.anim = 'stand';
          }
        }
        // Share of the overlap each unit takes (the idle one yields when the other is busy).
        const shareA = ba === bb ? 0.5 : ba ? 0 : 1;
        const push = Math.min(min - d, 300 * dt);
        this.nudge(a, -nx * push * shareA, -ny * push * shareA);
        this.nudge(b, nx * push * (1 - shareA), ny * push * (1 - shareA));
      }
  }

  /** Moves a unit by (dx, dy) when the target cell is walkable. */
  private nudge(u: Unit, dx: number, dy: number) {
    if (!dx && !dy) return;
    const [cx, cy] = this.grid.cellOf(u.x + dx, u.y + dy);
    if (!this.grid.walkable(cx, cy)) return;
    u.x += dx;
    u.y += dy;
  }

  private moveAlong(u: Unit, dt: number) {
    if (!u.path || !u.path.length) {
      u.path = null;
      u.moveTarget = null;
      if (u.anim === 'walk') u.anim = 'stand';
      return;
    }
    const [tx, ty] = u.path[0];
    if (this.stepToward(u, tx, ty, dt) < 1) {
      u.path.shift();
      if (!u.path.length) {
        u.path = null;
        u.moveTarget = null;
        u.anim = 'stand';
      }
    }
  }

  private canTarget(attacker: Unit, t: Unit, detectors: Unit[]) {
    if (!t.alive || t.hidden || t.owner !== CREEP_PLAYER) return false;
    if (t.phaseUntil > this.time) return false;
    const a = attacker.def.attack!;
    if (t.flying ? !a.targets.includes('air') : !a.targets.includes('ground')) return false;
    if (a.attackType === 'magic' && t.def.abilities.includes('Amim')) return false;
    if (t.invisible && !detectors.some((d) => Math.hypot(d.x - t.x, d.y - t.y) <= this.detectRange(d))) return false;
    return true;
  }

  private detectRange(_d: Unit) {
    return Number(this.db.ability('A00O').fields['aran@1'] ?? 1000);
  }

  /** Aura towers with Magic Sentry (A00O, requires R001) reveal invisible units for all allies. */
  private detectors() {
    return this.units.filter((u) => u.alive && !u.constructing && u.def.abilities.includes('A00O') && (this.players[u.owner]?.research.R001 ?? 0) >= 1);
  }

  private auraSources() {
    const out: { u: Unit; base: string; range: number; value: number; buff: string }[] = [];
    for (const u of this.units) {
      if (!u.alive || u.constructing || u.owner >= 3) continue;
      for (const id of u.def.abilities) {
        const ab = this.db.ability(id);
        const buff = String(ab.fields['abuf@1'] ?? '').split(',')[0];
        if (ab.base === 'AOae') out.push({ u, base: 'AOae', range: Number(ab.fields['aare@1'] ?? 900), value: Number(ab.fields['Oae2@1'] ?? 0), buff: buff || 'BOae' });
        else if (ab.base === 'ACac') out.push({ u, base: 'ACac', range: Number(ab.fields['aare@1'] ?? 900), value: Number(ab.fields['Cac1@1'] ?? 0), buff: buff || 'BOac' });
      }
    }
    return out;
  }

  /**
   * Units inside an aura carry its buff (only for the target art, e.g. GeneralAuraTarget – the bonus itself is
   * computed by auraBonus). Like the engine the buffs are refreshed periodically and linger briefly after leaving.
   */
  private refreshAuraBuffs(auras: ReturnType<Game['auraSources']>) {
    if (this.time < this.nextAuraRefresh) return;
    this.nextAuraRefresh = this.time + 0.25;
    if (!auras.length) return;
    for (const u of this.units) {
      if (!u.alive || u.hidden || u.owner >= CREEP_PLAYER || u.constructing) continue;
      for (const a of auras) {
        if (Math.hypot(a.u.x - u.x, a.u.y - u.y) > a.range + 72) continue;
        this.applyBuff(u, a.buff, 0.6, {});
      }
    }
  }

  private auraBonus(u: Unit, auras: ReturnType<Game['auraSources']>, base: string) {
    let best = 0;
    for (const a of auras) {
      if (a.base !== base || a.value <= best) continue;
      // Aura range is checked against the target's collision edge ("must be touching").
      if (Math.hypot(a.u.x - u.x, a.u.y - u.y) <= a.range + 72) best = a.value;
    }
    return best;
  }

  private updateAttacker(u: Unit, dt: number, detectors: Unit[], auras: ReturnType<Game['auraSources']>) {
    const a = u.def.attack!;
    u.cooldown -= dt;
    let t = u.forcedTarget && this.canTarget(u, u.forcedTarget, detectors) ? u.forcedTarget : null;
    if (!t) u.forcedTarget = null;
    const inRange = (c: Unit) => Math.hypot(c.x - u.x, c.y - u.y) <= a.range + 16;
    if (t && !inRange(t)) t = null;
    if (!t && u.target && this.canTarget(u, u.target, detectors) && inRange(u.target)) t = u.target;
    if (!t) {
      let best = Infinity;
      for (const c of this.units) {
        if (c.owner !== CREEP_PLAYER || !this.canTarget(u, c, detectors)) continue;
        const d = Math.hypot(c.x - u.x, c.y - u.y);
        if (d <= Math.max(a.range, a.acquire) && d < best && inRange(c)) {
          best = d;
          t = c;
        }
      }
    }
    // Mobile units (temple defenders) walk to targets like the engine: an ordered target is followed, otherwise
    // enemies within the acquisition range (uacq) are engaged – unless the unit holds its position or is moving.
    if (u.speed > 0 && u.kind === 'defender') {
      // A plain move order ignores enemies until the unit arrives (only an explicit target is attacked).
      if (u.moveTarget && !u.chase && !u.attackMove && !u.forcedTarget) {
        u.target = null;
        return;
      }
      if (t) {
        if (u.chase || u.attackMove) {
          u.chase = null;
          u.path = null;
          u.moveTarget = null;
        }
      } else {
        const valid = (c: Unit | null) => !!c && c.alive && this.canTarget(u, c, detectors);
        let c: Unit | null = valid(u.forcedTarget) ? u.forcedTarget : null;
        if (!c && valid(u.chase) && Math.hypot(u.chase!.x - u.x, u.chase!.y - u.y) <= a.acquire * 1.25) c = u.chase;
        if (!c && !u.holdPosition && (!u.moveTarget || u.chase || u.attackMove)) {
          let best = a.acquire;
          for (const e of this.units) {
            if (e.owner !== CREEP_PLAYER || !this.canTarget(u, e, detectors)) continue;
            const d = Math.hypot(e.x - u.x, e.y - u.y);
            if (d <= best) {
              best = d;
              c = e;
            }
          }
        }
        if (c) {
          if (u.chase !== c || this.time >= u.chaseRepath || !u.path) {
            this.moveTo(u, c.x, c.y);
            u.chaseRepath = this.time + 0.5;
          }
          u.chase = c;
          u.target = null;
          return;
        }
        if (u.chase) {
          u.chase = null;
          u.path = null;
          u.moveTarget = null;
        }
        // Nothing to fight: an attack-move continues to its destination, which ends the order.
        if (u.attackMove && !u.path) {
          if (Math.hypot(u.attackMove.x - u.x, u.attackMove.y - u.y) < 32) u.attackMove = null;
          else this.moveTo(u, u.attackMove.x, u.attackMove.y);
        }
      }
    }
    u.target = t;
    if (!t) {
      if (u.anim === 'attack' && u.animTime > 0.6) u.anim = 'stand';
      return;
    }
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    if (u.cooldown > 0) return;
    const speedBonus = this.auraBonus(u, auras, 'AOae');
    u.cooldown = a.cooldown / (1 + speedBonus + this.buffSum(u, 'attack'));
    u.anim = 'attack';
    u.animTime = 0;
    // The missile leaves / damage lands at the attack's damage point (udp1), not at the start of the swing.
    if (a.damagePoint > 0) this.pendingShots.push({ u, t, at: this.time + a.damagePoint, auras });
    else this.fire(u, t, auras);
  }

  private firePendingShots() {
    if (!this.pendingShots.length) return;
    const due = this.pendingShots.filter((s) => s.at <= this.time);
    if (!due.length) return;
    this.pendingShots = this.pendingShots.filter((s) => s.at > this.time);
    const detectors = this.detectors();
    for (const s of due) {
      if (!s.u.alive || s.u.hidden || s.u.stunUntil > this.time) continue;
      // Target lost before the damage point: the attack is cancelled and may restart immediately.
      if (!this.canTarget(s.u, s.t, detectors)) {
        s.u.cooldown = 0;
        continue;
      }
      this.fire(s.u, s.t, s.auras);
    }
  }

  private fire(u: Unit, t: Unit, auras: ReturnType<Game['auraSources']>) {
    const a = u.def.attack!;
    const detectors = this.detectors();

    let dmg = rollDamage(a.damageBase, a.dice, a.sides, this.rnd);
    dmg *= 1 + this.auraBonus(u, auras, 'ACac') + this.buffSum(u, 'damage');
    if (u.kind === 'defender') {
      const lvl = this.players[u.owner]?.research.R002 ?? 0;
      if (lvl > 0) {
        const up = this.db.upgrade('R002').fields;
        dmg += Number(up.gba1 ?? 0) + Number(up.gmo1 ?? 0) * (lvl - 1);
      }
    }
    for (const id of u.def.abilities) {
      const ab = this.db.ability(id);
      if (ab.base === 'AHfa') dmg += Number(ab.fields['Hfa1@1'] ?? 0);
    }
    const color = u.def.attack ? attackColor(a.attackType) : 0xffffff;
    if (a.missileSpeed <= 0 || a.weaponType === 'instant' || a.weaponType === 'normal') {
      if (a.missileSpeed <= 0 || a.weaponType === 'instant') this.emit('lightning', { from: u, to: t, color, model: a.missile });
      this.hit(u, t, t.x, t.y, dmg, null);
    } else {
      const m = this.launch(u, t, dmg, a.missileSpeed, a.missileArc, color, a.missile, false);
      // Bouncing weapon (Moon Glaive style): targets, loss and radius come from the unit's weapon fields.
      if (a.weaponType === 'mbounce' && a.maxTargets > 1) {
        m.bounce = { left: a.maxTargets - 1, factor: 1, loss: a.damageLoss, range: a.splashFull || 500, hit: new Set([t.uid]) };
      }
    }
    // Barrage (Aroc): extra missiles at other targets in range.
    for (const id of u.def.abilities) {
      const ab = this.db.ability(id);
      if (ab.base !== 'Aroc') continue;
      const count = Number(ab.fields['Efk3@1'] ?? 1);
      const range = Number(ab.fields['aare@1'] ?? a.range);
      const extra = this.units
        .filter((c) => c !== t && c.owner === CREEP_PLAYER && this.canTarget(u, c, detectors) && Math.hypot(c.x - u.x, c.y - u.y) <= range)
        .sort((p, q) => Math.hypot(p.x - u.x, p.y - u.y) - Math.hypot(q.x - u.x, q.y - u.y))
        .slice(0, count);
      for (const c of extra) {
        const mm = this.launch(u, c, Number(ab.fields['Efk1@1'] ?? dmg) || dmg, Number(ab.fields.amsp ?? 1800), Number(ab.fields.amac ?? 0.1), color, String(ab.fields.amat ?? a.missile), false);
        mm.isAbility = true;
      }
    }
  }

  private launch(src: Unit, target: Unit, damage: number, speed: number, arc: number, color: number, model: string, isAbility: boolean): Missile {
    // Launch point: unit-relative offset (ulpx forward, ulpy left, ulpz up) rotated by the facing.
    const [lx, ly, lz] = src.def.attack?.launch ?? [0, 0, 60];
    const cos = Math.cos(src.facing);
    const sin = Math.sin(src.facing);
    const x0 = src.x + lx * cos - ly * sin;
    const y0 = src.y + lx * sin + ly * cos;
    const sz = lz + src.fly;
    const m: Missile = {
      id: this.missileSeq++,
      source: src,
      target,
      tx: target.x,
      ty: target.y,
      x: x0,
      y: y0,
      z: sz,
      sx: x0,
      sy: y0,
      sz,
      speed,
      arc,
      traveled: 0,
      total: Math.hypot(target.x - x0, target.y - y0),
      homing: src.def.attack?.homing ?? true,
      damage,
      bounce: null,
      isAbility,
      stun: 0,
      color,
      model,
      done: false,
    };
    this.missiles.push(m);
    this.emit('missileAdded', m);
    return m;
  }

  private updateMissiles(dt: number) {
    for (const m of this.missiles) {
      if (m.done) continue;
      if (m.homing && m.target && m.target.alive) {
        m.tx = m.target.x;
        m.ty = m.target.y;
      }
      const dx = m.tx - m.x;
      const dy = m.ty - m.y;
      const d = Math.hypot(dx, dy);
      const step = m.speed * dt;
      if (d <= step) {
        m.x = m.tx;
        m.y = m.ty;
        m.done = true;
        this.impact(m);
        continue;
      }
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
      m.traveled += step;
      const total = Math.max(m.total, m.traveled + d);
      const t = m.traveled / total;
      const targetZ = m.target ? m.target.fly + m.target.def.impactZ : 50;
      m.z = m.sz + (targetZ - m.sz) * t + m.arc * total * 2 * t * (1 - t);
    }
    this.missiles = this.missiles.filter((m) => !m.done);
  }

  private impact(m: Missile) {
    if (m.stun && m.target?.alive) {
      m.target.stunUntil = this.time + (this.resistant(m.target) ? Math.min(m.stun, m.stunHero || m.stun) : m.stun);
      this.emit('effect', { model: 'Abilities\\Spells\\Other\\Transmute\\PileofGold.mdl', x: m.x, y: m.y, color: 0xffd040 });
      return;
    }
    const target = m.target && m.target.alive && Math.hypot(m.target.x - m.x, m.target.y - m.y) < 120 ? m.target : null;
    this.hit(m.source, target, m.x, m.y, m.damage, m);
    if (m.bounce && m.bounce.left > 0 && target) {
      const next = this.units
        .filter((c) => c.alive && c.owner === CREEP_PLAYER && !m.bounce!.hit.has(c.uid) && !c.hidden && (!c.invisible || this.detectors().length) && Math.hypot(c.x - target.x, c.y - target.y) <= m.bounce!.range)
        .sort((p, q) => Math.hypot(p.x - target.x, p.y - target.y) - Math.hypot(q.x - target.x, q.y - target.y))[0];
      if (next) {
        const factor = m.bounce.factor * (1 - m.bounce.loss);
        const nm = this.launch(m.source, next, m.damage * (1 - m.bounce.loss), m.speed, 0, m.color, m.model, false);
        nm.x = nm.sx = target.x;
        nm.y = nm.sy = target.y;
        nm.z = nm.sz = target.fly + 50;
        nm.total = Math.hypot(next.x - target.x, next.y - target.y);
        nm.bounce = { ...m.bounce, left: m.bounce.left - 1, factor, hit: new Set([...m.bounce.hit, next.uid]) };
      }
    }
  }

  private hit(src: Unit, target: Unit | null, x: number, y: number, damage: number, m: Missile | null) {
    const a = src.def.attack;
    const attackType = a?.attackType ?? 'normal';
    const splash = a && !m?.isAbility && (a.weaponType === 'artillery' || a.weaponType === 'msplash' || a.weaponType === 'aline' || a.weaponType === 'mline') && a.splashFull + a.splashMedium + a.splashSmall > 0;
    if (splash && a) {
      for (const c of this.units) {
        if (!c.alive || c.owner !== CREEP_PLAYER || c.phaseUntil > this.time) continue;
        if (c.flying && !a.targets.includes('air')) continue;
        const d = Math.hypot(c.x - x, c.y - y);
        let f = 0;
        if (d <= a.splashFull) f = 1;
        else if (d <= a.splashMedium) f = a.splashMediumFactor;
        else if (d <= a.splashSmall) f = a.splashSmallFactor;
        if (f > 0) this.attackDamage(src, c, damage * f, attackType, c === target);
      }
    } else if (target) {
      this.attackDamage(src, target, damage, attackType, true);
    }
  }

  /** Attack damage incl. on-hit abilities of the source. */
  private attackDamage(src: Unit, t: Unit, damage: number, attackType: string, primary: boolean) {
    if (!t.alive) return;
    if (primary) {
      const ev = t.def.abilities.includes('ACev') ? Number(this.db.ability('ACev').fields['Eev1@1'] ?? 0.1) : 0;
      if (ev > 0 && this.rnd() < ev) {
        this.emit('floatText', { text: ERR.miss, x: t.x, y: t.y, color: '#ff4040', lifespan: 1.5 });
        return;
      }
      const immune = t.def.abilities.includes('Amim');
      for (const id of src.def.abilities) {
        const ab = this.db.ability(id);
        const f = ab.fields;
        if (ab.base === 'ACbh' && this.rnd() * 100 < Number(f['Hbh1@1'] ?? 0)) {
          damage += Number(f['Hbh3@1'] ?? 0);
          t.stunUntil = Math.max(t.stunUntil, this.time + this.spellDuration(t, f, 1));
        }
        if (ab.base === 'Aspo' && !immune) {
          const dur = this.spellDuration(t, f, 3);
          const buff = String(f['abuf@1'] ?? '').split(',')[0];
          if (buff) this.applyBuff(t, buff, dur, {});
          const move = Number(f['Spo2@1'] ?? 0);
          const atk = Number(f['Spo3@1'] ?? 0);
          if (move > 0 || atk > 0) t.slow = { move: Math.max(t.slow?.move ?? 0, move), attack: Math.max(t.slow?.attack ?? 0, atk), until: this.time + dur };
          const dps = Number(f['Spo1@1'] ?? 0);
          if (dps > 0) t.poison = { dps: Math.max(t.poison?.dps ?? 0, dps), until: this.time + dur, source: src };
        }
      }
    }
    const final = damage * attackMultiplier(attackType, t.def.defenseType) * armorMultiplier(t.def.armor);
    this.damage(t, final, attackType, src, false);
  }

  private damage(t: Unit, amount: number, _type: string, src: Unit | null, periodic: boolean) {
    if (!t.alive || t.phaseUntil > this.time) return;
    t.hp -= amount;
    t.lastDamaged = this.time;
    if (!periodic && t.def.abilities.includes('Apsh') && t.phaseReady <= this.time && t.hp > 0) {
      const ab = this.db.ability('Apsh');
      t.phaseUntil = this.time + Number(ab.fields['adur@1'] ?? 1);
      t.phaseReady = this.time + Number(ab.fields['acdn@1'] ?? 7);
    }
    if (t.hp <= 0) this.kill(t, src);
  }

  private kill(t: Unit, killer: Unit | null) {
    t.hp = 0;
    t.alive = false;
    t.removeAt = this.time;
    t.anim = 'death';
    if (t.footprint) this.grid.setFootprint(t.x, t.y, t.footprint, 0);
    if (t.owner !== CREEP_PLAYER) return;
    const owner = killer ? killer.owner : -1;
    if (owner >= 0 && owner < 3) {
      const p = this.players[owner];
      p.kills++;
      p.killValue += t.def.pointValue;
      if (killer) killer.kills++;
      // Bounty: native unit bounty in single player, Trig_Multiplayer_Bounty otherwise.
      let gold: number;
      if (this.playerCount === 1) {
        const b = t.def.bounty;
        gold = b.base;
        for (let i = 0; i < b.dice; i++) gold += 1 + Math.floor(this.rnd() * Math.max(1, b.sides));
      } else {
        gold = randomInt(this.cfg.bounty.base[this.wave] ?? 0, this.cfg.bounty.dice[this.wave] ?? 0, this.rnd) * this.playerCount;
      }
      if (gold > 0) {
        p.gold += gold;
        p.earned += gold;
        this.emit('floatText', { text: `+${gold}`, x: t.x, y: t.y, color: '#ffdc00', lifespan: 3 });
      }
    }
    this.onCreepDeath();
  }

  // ---------------------------------------------------------------------------------------------

  aliveCreeps() {
    return this.units.filter((u) => u.alive && u.owner === CREEP_PLAYER).length;
  }
}

export function attackColor(type: string) {
  return ({ normal: 0xe0e0e0, pierce: 0x9fe070, siege: 0xffa040, magic: 0x70a0ff, chaos: 0xff5050, spells: 0xc080ff, hero: 0xffe060 } as Record<string, number>)[type] ?? 0xffffff;
}
