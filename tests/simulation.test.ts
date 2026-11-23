/**
 * Headless tests of the game simulation (src/game) – no renderer, the triggers run in game time.
 * They use public/map/map.json (npm run extract) and, when present, public/war3/catalog.json (npm run assets).
 */
import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import type { AssetCatalog, MapData } from '../src/data/types';
import { ObjectDB } from '../src/data/objects';
import { CREEP_PLAYER, ERR, Game, type Unit } from '../src/game/game';
import { TerrainGrid } from '../src/render/terrain';

const map: MapData = JSON.parse(readFileSync('public/map/map.json', 'utf8'));
const catalog: AssetCatalog | null = existsSync('public/war3/catalog.json') ? JSON.parse(readFileSync('public/war3/catalog.json', 'utf8')) : null;
const grid = new TerrainGrid(map.terrain);

function newGame(seed = 1) {
  const game = new Game(map, new ObjectDB(map, catalog), (x, y) => grid.heightAt(x, y), 1);
  game.cat = catalog;
  game.seed(seed);
  game.start();
  return game;
}

/** Advances the simulation by `seconds` of game time. */
function run(game: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) game.update(0.05);
}

/** Starts a game on the first difficulty and waits until the whole first wave has spawned. */
function startWave(seed = 1) {
  const game = newGame(seed);
  run(game, 3);
  game.chooseDifficulty(0);
  const w = game.cfg.waves[0];
  run(game, 25 + w.spawnCooldown * game.cfg.unitsPerWave);
  return game;
}

const creeps = (g: Game) => g.units.filter((u) => u.alive && u.owner === CREEP_PLAYER);
const builder = (g: Game) => g.units.find((u) => u.kind === 'builder' && u.owner === 0)!;
const rectCenter = (g: Game, name: string) => {
  const r = g.cfg.regions[name];
  return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
};

/** Orders the builder to build at the first free spot around it, waits until the tower is finished. */
function buildTower(game: Game, id = 'h001') {
  const b = builder(game);
  game.players[0].gold = Math.max(game.players[0].gold, 1000);
  for (let r = 400; r < 1500; r += 64)
    for (let a = 0; a < 16; a++) {
      if (game.build(b, id, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r)) continue;
      for (let i = 0; i < 400 && !game.units.some((u) => u.kind === 'tower' && u.def.id === id && !u.constructing); i++) run(game, 0.25);
      return game.units.find((u) => u.kind === 'tower' && u.def.id === id && !u.constructing)!;
    }
  throw new Error('no place to build');
}

/** A free building spot around the builder (at least `min` units away). */
function freeSite(game: Game, min = 500): [number, number] {
  const b = builder(game);
  for (let r = min; r < 1500; r += 64)
    for (let a = 0; a < 16; a++) {
      const [x, y] = game.grid.snap(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, 4);
      if (game.canPlace(x, y) && game.grid.canBuild(x, y, 4)) return [x, y];
    }
  throw new Error('no place to build');
}

function kill(game: Game, u: Unit, killer: Unit | null) {
  (game as unknown as { kill(t: Unit, k: Unit | null): void }).kill(u, killer);
}

describe('game start', () => {
  it('gives start gold and lives, and spawns the first wave after the difficulty is chosen', () => {
    const game = startWave();
    expect(game.players[0].gold).toBe(game.cfg.startGold);
    expect(game.lives).toBe(game.cfg.livesPerPlayer);
    const wave = creeps(game);
    expect(wave.length).toBe(game.cfg.unitsPerWave);
    expect(new Set(wave.map((u) => u.def.id))).toEqual(new Set([game.cfg.waves[0].unit]));
  });
});

describe('construction', () => {
  it('starts when the builder arrives and only progresses while it works', () => {
    const game = newGame();
    run(game, 3);
    const b = builder(game);
    game.players[0].gold = 1000;
    let site: [number, number] | null = null;
    for (let r = 500; r < 1500 && !site; r += 64)
      for (let a = 0; a < 16 && !site; a++) {
        const x = b.x + Math.cos(a) * r;
        const y = b.y + Math.sin(a) * r;
        if (!game.build(b, 'h001', x, y)) site = [x, y];
      }
    expect(site).not.toBeNull();
    const cost = game.db.unit('h001').gold;
    expect(game.players[0].gold).toBe(1000 - cost);
    expect(game.units.some((u) => u.kind === 'tower')).toBe(false);
    run(game, 0.2);
    expect(game.units.some((u) => u.kind === 'tower')).toBe(false);
    for (let i = 0; i < 200 && !game.units.some((u) => u.kind === 'tower'); i++) run(game, 0.1);
    const tower = game.units.find((u) => u.kind === 'tower')!;
    expect(tower.constructing).not.toBeNull();
    run(game, 0.5);
    expect(b.anim).toBe('work');
    // The builder walks away: construction pauses.
    game.orderMove(b, b.x - 700, b.y);
    run(game, 1);
    const paused = tower.constructing!.elapsed;
    run(game, 2);
    expect(tower.constructing!.elapsed).toBe(paused);
    // Right click on the site: work resumes and the tower is finished.
    expect(game.resumeConstruction(b, tower)).toBe(true);
    run(game, 40);
    expect(tower.constructing).toBeNull();
  });

  it('refunds an order dropped before the site is founded', () => {
    const game = newGame();
    run(game, 3);
    const b = builder(game);
    game.players[0].gold = 1000;
    const [x, y] = freeSite(game, 600);
    expect(game.build(b, 'h001', x, y)).toBeNull();
    expect(game.players[0].gold).toBeLessThan(1000);
    game.orderMove(b, b.x, b.y + 50);
    expect(game.players[0].gold).toBe(1000);
  });

  it('builds queued (Shift) buildings one after another', () => {
    const game = newGame();
    run(game, 3);
    const b = builder(game);
    game.players[0].gold = 1000;
    const [x1, y1] = freeSite(game, 500);
    expect(game.build(b, 'h001', x1, y1, true)).toBeNull();
    // A second site that does not overlap the first one (planned sites block their area).
    expect(game.build(b, 'h001', x1, y1, true)).toBe(ERR.cantPlace);
    let second = false;
    for (let r = 200; r < 1500 && !second; r += 64)
      for (let a = 0; a < 16 && !second; a++) second = !game.build(b, 'h001', x1 + Math.cos(a) * r, y1 + Math.sin(a) * r, true);
    expect(second).toBe(true);
    expect(game.plannedSites().length).toBe(2);
    run(game, 60);
    const towers = game.units.filter((u) => u.kind === 'tower');
    expect(towers.length).toBe(2);
    expect(towers.every((t) => !t.constructing)).toBe(true);
    expect(game.players[0].built).toBe(2);
  });

  it('rejects building without gold or on blocked ground', () => {
    const game = newGame();
    run(game, 3);
    const b = builder(game);
    game.players[0].gold = 0;
    const [x, y] = freeSite(game);
    expect(game.build(b, 'h001', x, y)).toBe(ERR.noGold);
    game.players[0].gold = 1000;
    const path = rectCenter(game, game.cfg.path[1]);
    expect(game.build(b, 'h001', path.x, path.y)).toBe(ERR.cantPlace);
  });

  it('a second builder speeds up construction (Power Build) for a fee', () => {
    const progress = (helpers: number) => {
      const game = newGame();
      run(game, 3);
      const b = builder(game);
      game.players[0].gold = 1000;
      const [x, y] = freeSite(game, 300);
      expect(game.build(b, 'h001', x, y)).toBeNull();
      for (let i = 0; i < 200 && !b.constructs; i++) run(game, 0.1);
      const site = b.constructs!;
      for (let i = 0; i < helpers; i++) {
        const h = game.createUnit(b.def.id, 0, b.x + 20 * (i + 1), b.y, 0);
        expect(game.orderRepair(h, site)).toBeNull();
      }
      // Let the helper walk to the site, then measure a short stretch of the build.
      for (let i = 0; i < 40 && game.units.filter((u) => u.constructs === site && u.anim === 'work').length < helpers + 1; i++) run(game, 0.05);
      const gold = game.players[0].gold;
      const start = site.constructing!.elapsed;
      run(game, 1);
      return { done: site.constructing!.elapsed - start, paid: gold - game.players[0].gold };
    };
    const alone = progress(0);
    const helped = progress(1);
    expect(helped.done / alone.done).toBeCloseTo(1.6, 1);
    expect(alone.paid).toBe(0);
    expect(helped.paid).toBeGreaterThanOrEqual(0);
  });

  it('repair restores a damaged building and costs gold', () => {
    const game = newGame();
    run(game, 3);
    const b = builder(game);
    const tower = buildTower(game);
    tower.hp = tower.maxHp * 0.3;
    game.players[0].gold = 1000;
    expect(game.orderRepair(b, tower)).toBeNull();
    for (let i = 0; i < 400 && tower.hp < tower.maxHp; i++) run(game, 0.25);
    expect(tower.hp).toBe(tower.maxHp);
    expect(game.players[0].gold).toBeLessThan(1000);
    expect(game.orderRepair(b, tower)).toBe(ERR.notDamaged);
  });
});

describe('waves', () => {
  it('pays bounty and the wave bonus (wave·10 + wave²/players) and starts the next wave', () => {
    const game = startWave();
    const tower = buildTower(game);
    const before = game.players[0].gold;
    const wave = creeps(game);
    const b = wave[0].def.bounty;
    for (const c of wave) kill(game, c, tower);
    expect(game.players[0].kills).toBe(game.cfg.unitsPerWave);
    // Single player: native bounty base + dice × 1..sides per creep; the last death pays the wave bonus at once.
    const bounty = game.players[0].gold - before - (1 * 10 + 1);
    expect(bounty).toBeGreaterThanOrEqual(wave.length * (b.base + b.dice));
    expect(bounty).toBeLessThanOrEqual(wave.length * (b.base + b.dice * b.sides));
    run(game, 3);
    expect(game.wave).toBe(2);
    run(game, game.cfg.nextWaveDelay + 10);
    expect(creeps(game).some((u) => u.def.id === game.cfg.waves[1].unit)).toBe(true);
  });

  it('wins after the last wave is cleared', () => {
    const game = startWave();
    game.wave = game.cfg.lastWave;
    for (const c of creeps(game)) kill(game, c, null);
    run(game, 10);
    expect(game.ended).toEqual({ victory: true });
  });
});

describe('lives', () => {
  it('a creep reaching the goal costs a life and is sent back; with no lives left the game is lost', () => {
    const game = startWave();
    const goal = rectCenter(game, 'Goal');
    const [a, b] = creeps(game);
    a.x = goal.x;
    a.y = goal.y;
    run(game, 0.5);
    expect(game.lives).toBe(game.cfg.livesPerPlayer - 1);
    const spawn = rectCenter(game, 'Spawn Region');
    expect(Math.hypot(a.x - spawn.x, a.y - spawn.y)).toBeLessThan(400);
    game.lives = 0;
    b.x = goal.x;
    b.y = goal.y;
    run(game, 8);
    expect(game.ended).toEqual({ victory: false });
  });
});

describe('towers', () => {
  it('sell refunds 75 % of the point value', () => {
    const game = startWave();
    const tower = buildTower(game);
    const gold = game.players[0].gold;
    game.sell(tower);
    expect(game.players[0].gold - gold).toBe(Math.trunc(tower.def.pointValue * game.cfg.sellRatio));
    expect(tower.alive).toBe(false);
  });

  it('shoot creeps in range', () => {
    const game = startWave();
    const tower = buildTower(game);
    const c = creeps(game)[0];
    c.path = null;
    c.x = tower.x + tower.def.attack!.range - 50;
    c.y = tower.y;
    const hp = c.hp;
    run(game, 5);
    expect(c.hp).toBeLessThan(hp);
  });
});

describe('defenders', () => {
  /** A defender on a free spot and one standing creep on its way to a destination well beyond the acquisition range. */
  const setup = () => {
    const game = startWave();
    const sg = game.units.find((u) => u.kind === 'spawning' && u.owner === 0)!;
    const id = sg.def.trains.find((t) => game.db.unit(t).attack && game.db.unit(t).speed > 0)!;
    const [x, y] = freeSite(game, 400);
    const d = game.createUnit(id, 0, x, y, 0);
    const [c, ...rest] = creeps(game);
    for (const o of rest) kill(game, o, null);
    const reach = d.def.attack!.acquire + d.def.attack!.range;
    c.path = null;
    c.x = x + 500;
    c.y = y;
    return { game, d, c, dest: { x: x + 500 + reach + 300, y } };
  };

  it('a move order walks past enemies without fighting', () => {
    const { game, d, c, dest } = setup();
    const hp = c.hp;
    game.orderMove(d, dest.x, dest.y);
    for (let i = 0; i < 200 && d.moveTarget; i++) run(game, 0.25);
    expect(d.moveTarget).toBeNull();
    expect(c.hp).toBe(hp);
  });

  it('an attack-move fights enemies met on the way and then continues', () => {
    const { game, d, c, dest } = setup();
    const hp = c.hp;
    game.orderAttackMove(d, dest.x, dest.y);
    for (let i = 0; i < 400 && d.attackMove; i++) run(game, 0.25);
    expect(c.hp).toBeLessThan(hp);
    expect(d.attackMove).toBeNull();
    expect(Math.hypot(d.x - dest.x, d.y - dest.y)).toBeLessThan(64);
  });
  it('units do not overlap and two units sent to one point both stop', () => {
    const { game, d } = setup();
    for (const c of creeps(game)) kill(game, c, null);
    const e = game.createUnit(d.def.id, 0, d.x, d.y, 0);
    run(game, 1);
    const min = (Number(d.def.fields.ucol) || 16) * 2;
    expect(Math.hypot(d.x - e.x, d.y - e.y)).toBeGreaterThan(min * 0.9);
    game.orderMove(d, d.x - 300, d.y);
    game.orderMove(e, d.x - 300, d.y);
    run(game, 8);
    expect(d.path).toBeNull();
    expect(e.path).toBeNull();
    expect(Math.hypot(d.x - e.x, d.y - e.y)).toBeGreaterThan(min * 0.9);
  });
});

describe('creep spells', () => {
  it('a Shaman casts Bloodlust on a fighting ally at its cast point, not on idle ones', () => {
    const game = startWave();
    for (const c of creeps(game)) kill(game, c, null);
    run(game, 2);
    const [x, y] = freeSite(game, 400);
    const shaman = game.createUnit('n007', CREEP_PLAYER, x, y, 0);
    const idle = game.createUnit(game.cfg.waves[0].unit, CREEP_PLAYER, x + 80, y, 0);
    const fighter = game.createUnit(game.cfg.waves[0].unit, CREEP_PLAYER, x - 80, y, 0);
    for (const u of [shaman, idle, fighter]) u.path = null;
    // Keep the allies in place (stunned units do not walk or attack the gate).
    idle.stunUntil = fighter.stunUntil = Infinity;
    fighter.lastDamaged = game.time;
    run(game, 0.1);
    expect(shaman.anim).toBe('spell');
    const cast = shaman.casting;
    expect(cast).not.toBeNull();
    expect(Object.keys(fighter.buffs)).toHaveLength(0);
    run(game, Number(shaman.def.fields.ucpt ?? 0.3));
    expect(Object.keys(fighter.buffs)).toHaveLength(1);
    expect(Object.keys(idle.buffs)).toHaveLength(0);
    run(game, Number(shaman.def.fields.ucbs ?? 0.51));
    expect(shaman.casting).not.toBe(cast);
  });
});

describe('saved games', () => {
  it('a game loaded from a save continues exactly like the original', () => {
    const game = startWave(3);
    buildTower(game);
    run(game, 7);
    const data = JSON.parse(JSON.stringify(game.save()));
    const loaded = newGame(99);
    loaded.load(data);
    expect(loaded.units.map((u) => u.uid)).toEqual(game.units.map((u) => u.uid));
    for (const g of [game, loaded]) run(g, 60);
    const state = (g: Game) => ({
      wave: g.wave,
      lives: g.lives,
      gold: g.players[0].gold,
      kills: g.players[0].kills,
      units: g.units.filter((u) => u.alive).map((u) => [u.uid, u.def.id, Math.round(u.x), Math.round(u.y), Math.round(u.hp)]),
    });
    expect(state(loaded)).toEqual(state(game));
    expect(loaded.players[0].kills).toBeGreaterThan(0);
  });
});

describe('shop', () => {
  it('sells only to a player with a unit near the shop', () => {
    const game = newGame();
    run(game, 3);
    const shop = game.units.find((u) => u.kind === 'shop')!;
    const id = shop.def.sells[0];
    game.players[0].gold = 1000;
    for (const u of game.units) if (u.owner === 0 && u.speed > 0 && Math.hypot(u.x - shop.x, u.y - shop.y) <= 450) u.x += 5000;
    expect(game.buy(0, id)).toBe(ERR.noShopper);
    const b = builder(game);
    b.x = shop.x + 200;
    b.y = shop.y;
    expect(game.buy(0, id)).toBeNull();
  });
});

describe('determinism', () => {
  it('the same seed gives the same game', () => {
    const snapshot = (seed: number) => {
      const game = startWave(seed);
      buildTower(game);
      run(game, 30);
      return JSON.stringify({ gold: game.players.map((p) => p.gold), kills: game.players[0].kills, units: game.units.map((u) => [u.def.id, Math.round(u.x), Math.round(u.y), Math.round(u.hp)]) });
    };
    expect(snapshot(42)).toBe(snapshot(42));
  });
});
