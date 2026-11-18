import type { GameConfig, MapData } from '../data/types';
import { ObjectDB, type UnitDef } from '../data/objects';
import { PathingGrid } from './pathing';
import { armorMultiplier, attackMultiplier, randomInt, rollDamage } from './combat';

type Thread = Generator<number, void, void>;

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
  upgrading: { to: string; total: number; elapsed: number } | null;
  queue: { kind: 'train' | 'research'; id: string; level: number; total: number; elapsed: number }[];
  userData: number;
  rects: Set<string>;
  kills: number;
  /** Visual animation hint for the renderer. */
  anim: 'stand' | 'walk' | 'attack' | 'death' | 'birth';
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
  /** Stun duration applied on impact instead of damage (Coin Basher). */
  stun: number;
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
}

type Events = {
  message: { text: string; duration: number };
  clearMessages: void;
  sound: { file: string; volume?: number; pitch?: number; x?: number; y?: number };
  floatText: { text: string; x: number; y: number; color: string; lifespan: number };
  effect: { model: string; x: number; y: number; color: number };
  lightning: { from: Unit; to: Unit; color: number };
  fade: { dir: 'in' | 'out'; duration: number };
  dialog: { title: string; buttons: { label: string; id: number }[]; timeout: number } | null;
  doodadAnim: { id: string; anim: 'birth' | 'death' };
  unitAdded: Unit;
  unitRemoved: Unit;
  missileAdded: Missile;
  end: { victory: boolean; text: string };
  quest: void;
};

export const PLAYER_COLORS = ['#ff0303', '#0042ff', '#1ce6b9', '#540081', '#fffc01', '#fe8a0e', '#20c000', '#e55bb0', '#959697', '#7ebff1', '#106246', '#4a2a04'];
const PLAYER_NAMES = ['Player 1 (Red)', 'Player 2 (Blue)', 'Player 3 (Teal)'];
export const CREEP_PLAYER = 3;
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
  /** Trigger "threads": generators that yield the number of seconds to sleep (TriggerSleepAction). */
  private threads: { gen: Thread; at: number; seq: number }[] = [];
  private threadSeq = 0;
  private listeners: { [K in keyof Events]?: ((e: Events[K]) => void)[] } = {};
  private ancestors = new Map<string, Set<string>>();
  private difficultyChosen = false;
  private rnd: () => number = Math.random;
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
  private run(gen: Thread) {
    const r = gen.next();
    if (!r.done) this.threads.push({ gen, at: this.time + Math.max(0, r.value), seq: this.threadSeq++ });
  }

  private resumeThreads() {
    for (;;) {
      let next: (typeof this.threads)[number] | null = null;
      for (const t of this.threads) if (t.at <= this.time && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t;
      if (!next) return;
      this.threads.splice(this.threads.indexOf(next), 1);
      const r = next.gen.next();
      if (!r.done) this.threads.push({ gen: next.gen, at: Math.max(this.time, next.at + Math.max(0, r.value)), seq: this.threadSeq++ });
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
      this.players.push({ id: i, name: PLAYER_NAMES[i], color: PLAYER_COLORS[i], playing: i < this.humanPlayers, gold: 0, kills: 0, research: {} });
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
    this.run(this.trigIntialization());
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

  private *trigIntialization(): Thread {
    this.emit('fade', { dir: 'out', duration: 0 });
    this.playerCount = this.players.filter((p) => p.playing).length;
    yield 0.5;
    for (const p of this.players) if (p.playing) p.gold = this.cfg.startGold;
    for (const [i, name] of ['gg_unit_h002_0007', 'gg_unit_h002_0002', 'gg_unit_h002_0009'].entries()) {
      const b = this.named[name];
      if (b && !this.players[i].playing) b.hidden = true;
    }
    yield 0.5;
    for (const d of Object.values(this.destructables)) if (d.id === 'ZTg1') d.invulnerable = true;
    this.emit('doodadAnim', { id: 'D004', anim: 'death' });
    yield 0.5;
    this.lives = this.cfg.livesPerPlayer * this.playerCount;
    yield 0.5;
    this.trigDialogButton();
    this.run(this.trigQuests());
  }

  private *trigQuests(): Thread {
    yield 2;
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
    this.run(this.trigSlowSelector());
  }

  private *trigSlowSelector(): Thread {
    yield this.cfg.difficultyTimeout;
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
    this.run(this.trigStartingGame());
  }

  private *trigStartingGame(): Thread {
    this.multiboardTitle = this.str('TRIGSTR_326');
    this.emit('fade', { dir: 'in', duration: 3 });
    yield 3;
    this.emit('clearMessages', undefined);
    this.message('TRIGSTR_559');
    this.playSound('gg_snd_GoodJob');
    this.multiboardVisible = true;
    yield 8;
    this.emit('clearMessages', undefined);
    this.message('TRIGSTR_560');
    this.playSound('gg_snd_Hint');
    const w = this.cfg.waves[0];
    this.spawnUnit = w.unit;
    this.spawnName = w.name;
    this.spawnCooldown = w.spawnCooldown;
    this.waveSound = w.sound;
    yield 8;
    this.emit('clearMessages', undefined);
    this.run(this.trigWaveSpawn());
  }

  private spawnPoint() {
    const r = this.rects['Spawn Region'];
    return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  }

  private rectCenter(name: string) {
    const r = this.rects[name];
    return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  }

  private *trigWaveSpawn(): Thread {
    this.emit('doodadAnim', { id: 'D004', anim: 'birth' });
    const sp = this.spawnPoint();
    this.playSound('gg_snd_Gateway_Opens', sp.x, sp.y);
    yield 1;
    this.message(`|CFF6DCFF6Wave ${this.wave}:|r ${this.spawnName}`);
    this.multiboardTitle = `Wave ${this.wave}`;
    if (this.waveSound) this.emit('sound', { file: this.waveSound });
    yield 1;
    for (let i = 0; i < this.cfg.unitsPerWave; i++) {
      if (this.ended) return;
      this.createUnit(this.spawnUnit, CREEP_PLAYER, sp.x, sp.y, 0);
      if (i < this.cfg.unitsPerWave - 1) yield this.spawnCooldown;
    }
    yield 1;
    this.emit('doodadAnim', { id: 'D004', anim: 'death' });
    this.playSound('gg_snd_Gateway_Closes', sp.x, sp.y);
  }

  private onCreepDeath() {
    // Trig_Wave_Clear: no living units of the current spawn type left.
    if (this.units.some((u) => u.alive && u.owner === CREEP_PLAYER && u.def.id === this.spawnUnit)) return;
    this.run(this.trigWaveClear());
  }

  private *trigWaveClear(): Thread {
    if (this.wave > this.cfg.lastWave - 1) {
      this.run(this.trigVictory());
      return;
    }
    const bonus = this.wave * 10 + Math.floor((this.wave * this.wave) / this.playerCount);
    for (const p of this.players) if (p.playing) p.gold += bonus;
    this.message(`All players receive |cffffcc00${bonus} |rextra gold for surviving the wave.`);
    this.playSound('gg_snd_GoodJob');
    this.multiboardTitle = `Wave ${this.wave} completed!`;
    const g1 = this.destructables.gg_dest_ZTg1_0091;
    const g2 = this.destructables.gg_dest_ZTg1_0092;
    for (const g of [g1, g2]) if (g) this.modifyGate(g, true);
    yield 3;
    this.wave++;
    this.nextWaveTimer = { end: this.time + this.cfg.nextWaveDelay };
    this.timerUpdate = true;
    yield this.cfg.nextWaveDelay - 0.1;
    this.trigNextWaveSet();
    yield 0.05;
    if (g1) {
      this.modifyGate(g1, false);
      this.playSound('gg_snd_LockUp_Doors', g1.x, g1.y);
    }
    yield 0.05;
    if (g2) {
      this.modifyGate(g2, false);
      this.playSound('gg_snd_LockUp_Doors', g2.x, g2.y);
    }
    this.timerUpdate = false;
    this.nextWaveTimer = null;
    this.trigClearPath();
    this.run(this.trigWaveSpawn());
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

  private *trigVictory(): Thread {
    this.message('TRIGSTR_561');
    const portal = this.destructables.gg_dest_OTsp_0074;
    if (portal) portal.alive = false;
    this.emit('fade', { dir: 'out', duration: 5 });
    this.multiboardTitle = this.str('TRIGSTR_562');
    yield 2.5;
    this.multiboardTitle = this.str('TRIGSTR_563');
    yield 1.8;
    this.ended = { victory: true };
    this.emit('end', { victory: true, text: 'Victory!' });
  }

  private *lifeLost(u: Unit): Thread {
    if (this.ended) return;
    if (this.lives > 0) {
      this.lives--;
      this.message(`|CFF6DCFF6An unit has entered the gate! ${this.lives} lives remaining!|r`);
      this.playSound('gg_snd_Warning');
      const sp = this.spawnPoint();
      this.teleport(u, sp.x, sp.y);
    } else {
      this.lifeLostEnabled = false;
      const portal = this.destructables.gg_dest_OTsp_0074;
      if (portal) portal.alive = false;
      this.emit('fade', { dir: 'out', duration: 5 });
      this.message('TRIGSTR_221');
      this.multiboardTitle = this.str('TRIGSTR_336');
      yield 4;
      this.ended = { victory: false };
      this.emit('end', { victory: false, text: this.str('TRIGSTR_218') });
    }
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
        if (this.lifeLostEnabled) this.run(this.lifeLost(u));
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

  build(builder: Unit, id: string, x: number, y: number): string | null {
    const def = this.db.unit(id);
    const p = this.players[builder.owner];
    const missing = this.missingRequirements(builder.owner, def);
    if (missing.length) return `Requires: ${missing.join(', ')}`;
    if (p.gold < def.gold) return 'Not enough gold.';
    [x, y] = this.grid.snap(x, y, 4);
    if (!this.grid.canBuild(x, y, 4)) return 'Unable to build there.';
    p.gold -= def.gold;
    const t = this.createUnit(id, builder.owner, x, y, (270 * Math.PI) / 180);
    t.constructing = { total: Math.max(0.1, def.buildTime), elapsed: 0 };
    t.hp = Math.max(1, def.hp * 0.1);
    t.anim = 'birth';
    // Builder walks next to the site (construction itself runs independently).
    this.orderMove(builder, x - 90, y - 90);
    return null;
  }

  /** Like the engine: object gold costs of upgraded structures are cumulative, an upgrade charges the difference. */
  upgradeCost(tower: Unit, to: string) {
    return Math.max(0, this.db.unit(to).gold - tower.def.gold);
  }

  upgrade(tower: Unit, to: string): string | null {
    if (tower.constructing || tower.upgrading) return 'Busy.';
    const def = this.db.unit(to);
    const p = this.players[tower.owner];
    const missing = this.missingRequirements(tower.owner, def);
    if (missing.length) return `Requires: ${missing.join(', ')}`;
    const cost = this.upgradeCost(tower, to);
    if (p.gold < cost) return 'Not enough gold.';
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
    if (missing.length) return `Requires: ${missing.join(', ')}`;
    if (p.gold < def.gold) return 'Not enough gold.';
    if (building.queue.length >= 7) return 'Queue is full.';
    p.gold -= def.gold;
    building.queue.push({ kind: 'train', id, level: 0, total: Math.max(0.5, def.buildTime), elapsed: 0 });
    return null;
  }

  research(building: Unit, id: string): string | null {
    const up = this.db.upgrade(id);
    const p = this.players[building.owner];
    const queued = building.queue.filter((q) => q.id === id).length;
    const level = (p.research[id] ?? 0) + queued + 1;
    if (level > up.levels) return 'Already researched.';
    const req = up.requires(level);
    const reqLevel = up.requiresLevel(level) || 1;
    for (const r of req) if (/^R/.test(r) && (p.research[r] ?? 0) < reqLevel) return `Requires: ${this.db.upgrade(r).name(reqLevel)}`;
    if (p.gold < up.gold(level)) return 'Not enough gold.';
    p.gold -= up.gold(level);
    building.queue.push({ kind: 'research', id, level, total: Math.max(0.5, up.time(level)), elapsed: 0 });
    return null;
  }

  /** Buying from the Hightower shop (Life Bought / Gate Repaired triggers). */
  buy(playerId: number, id: string): string | null {
    const def = this.db.unit(id);
    const stock = this.shopStock[id];
    const p = this.players[playerId];
    if (!stock || stock.stock <= 0) return 'Out of stock.';
    if (p.gold < def.gold) return 'Not enough gold.';
    p.gold -= def.gold;
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
    this.emit('unitRemoved', builder);
    this.emit('unitAdded', builder);
  }

  /** A010 – Coin Basher (Trig_Coin_Basher): costs gold equal to the wave number, stuns the target. */
  coinBash(builder: Unit, target: Unit): string | null {
    const ab = this.db.ability(this.cfg.coinBasherAbility);
    const range = Number(ab.fields['aran@1'] ?? 1000);
    const cd = Number(ab.fields['acdn@1'] ?? 8);
    if ((builder.abilityCd[ab.id] ?? 0) > this.time) return 'Ability is on cooldown.';
    if (Math.hypot(target.x - builder.x, target.y - builder.y) > range) return 'Target is out of range.';
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
    return null;
  }

  orderMove(u: Unit, x: number, y: number) {
    u.moveTarget = { x, y };
    u.attackGate = false;
    const straight = u.flying || u.def.moveType === '' || u.kind === 'creep';
    u.path = straight ? [[x, y]] : this.grid.findPath(u.x, u.y, x, y) ?? [[x, y]];
  }

  orderAttack(u: Unit, target: Unit) {
    if (u.def.attack) u.forcedTarget = target;
  }

  stop(u: Unit) {
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

  private step(dt: number) {
    this.time += dt;
    this.resumeThreads();
    for (const s of Object.values(this.shopStock)) {
      if (s.stock < s.max && s.nextAt && s.nextAt <= this.time) {
        s.stock++;
        s.nextAt = s.stock < s.max ? this.time + s.regen : 0;
      }
    }

    const detectors = this.detectors();
    const auras = this.auraSources();

    for (const u of this.units) {
      if (!u.alive) continue;
      u.animTime += dt;
      if (u.constructing) {
        u.constructing.elapsed += dt;
        u.hp = Math.min(u.maxHp, u.maxHp * (0.1 + 0.9 * (u.constructing.elapsed / u.constructing.total)));
        if (u.constructing.elapsed >= u.constructing.total) {
          u.constructing = null;
          u.anim = 'stand';
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
        }
        continue;
      }
      if (u.queue.length) this.processQueue(u, dt);
      if (u.poison && u.poison.until > this.time) this.damage(u, u.poison.dps * dt, 'spells', u.poison.source, true);
      else u.poison = null;
      if (!u.alive) continue;
      if (u.stunUntil > this.time) continue;
      if (u.slow && u.slow.until <= this.time) u.slow = null;

      if (u.kind === 'creep') this.updateCreep(u, dt);
      else if (u.speed > 0 && u.path) this.moveAlong(u, dt);

      if (u.def.attack && u.kind !== 'creep' && !u.hidden) this.updateAttacker(u, dt, detectors, auras);
    }

    // Region events.
    for (const u of this.units) {
      if (!u.alive) continue;
      const now = this.rectsAt(u.x, u.y);
      for (const r of now) if (!u.rects.has(r)) this.onEnterRect(u, r);
      u.rects = now;
    }

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
    } else {
      const p = this.players[u.owner];
      p.research[q.id] = Math.max(p.research[q.id] ?? 0, q.level);
      this.message(`Research complete: ${this.db.upgrade(q.id).name(q.level)}`, 5);
    }
  }

  private effectiveSpeed(u: Unit) {
    let s = u.speed;
    if (u.slow) s *= 1 - u.slow.move;
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
        u.cooldown = a.cooldown * (u.slow ? 1 + u.slow.attack : 1);
        u.animTime = 0;
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
    const out: { u: Unit; base: string; range: number; value: number }[] = [];
    for (const u of this.units) {
      if (!u.alive || u.constructing || u.owner >= 3) continue;
      for (const id of u.def.abilities) {
        const ab = this.db.ability(id);
        if (ab.base === 'AOae') out.push({ u, base: 'AOae', range: Number(ab.fields['aare@1'] ?? 900), value: Number(ab.fields['Oae2@1'] ?? 0) });
        else if (ab.base === 'ACac') out.push({ u, base: 'ACac', range: Number(ab.fields['aare@1'] ?? 900), value: Number(ab.fields['Cac1@1'] ?? 0) });
      }
    }
    return out;
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
    u.target = t;
    if (!t) {
      if (u.anim === 'attack' && u.animTime > 0.6) u.anim = 'stand';
      return;
    }
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    if (u.cooldown > 0) return;
    const speedBonus = this.auraBonus(u, auras, 'AOae');
    u.cooldown = a.cooldown / (1 + speedBonus);
    u.anim = 'attack';
    u.animTime = 0;

    let dmg = rollDamage(a.damageBase, a.dice, a.sides, this.rnd);
    dmg *= 1 + this.auraBonus(u, auras, 'ACac');
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
      if (a.missileSpeed <= 0 || a.weaponType === 'instant') this.emit('lightning', { from: u, to: t, color });
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
    const sz = src.kind === 'tower' ? Number(src.def.fields.ulpz ?? 140) : 60;
    const m: Missile = {
      id: this.missileSeq++,
      source: src,
      target,
      tx: target.x,
      ty: target.y,
      x: src.x,
      y: src.y,
      z: sz,
      sx: src.x,
      sy: src.y,
      sz,
      speed,
      arc,
      traveled: 0,
      total: Math.hypot(target.x - src.x, target.y - src.y),
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
      const targetZ = m.target ? m.target.fly + 50 : 50;
      m.z = m.sz + (targetZ - m.sz) * t + m.arc * total * 2 * t * (1 - t);
    }
    this.missiles = this.missiles.filter((m) => !m.done);
  }

  private impact(m: Missile) {
    if (m.stun && m.target?.alive) {
      m.target.stunUntil = this.time + m.stun;
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
        this.emit('floatText', { text: 'miss', x: t.x, y: t.y, color: '#ff4040', lifespan: 1.5 });
        return;
      }
      const immune = t.def.abilities.includes('Amim');
      for (const id of src.def.abilities) {
        const ab = this.db.ability(id);
        const f = ab.fields;
        if (ab.base === 'ACbh' && this.rnd() * 100 < Number(f['Hbh1@1'] ?? 0)) {
          damage += Number(f['Hbh3@1'] ?? 0);
          t.stunUntil = Math.max(t.stunUntil, this.time + Number(f['adur@1'] ?? 1));
        }
        if (ab.base === 'Aspo' && !immune) {
          const dur = Number(f['adur@1'] ?? 3);
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
