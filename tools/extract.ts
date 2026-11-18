/**
 * Extracts everything usable from the .w3x map file into web-friendly data:
 *   public/map/map.json      – terrain, doodads, units, regions, sounds, objects, strings, game logic
 *   public/map/minimap.png   – war3mapMap.blp
 *   public/map/preview.png   – war3mapPreview.tga
 *   public/map/war3map.j     – original JASS script (reference)
 *   data/raw/*               – raw files from the MPQ archive
 *
 * Usage: npm run extract [-- path/to/map.w3x]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PNG } from 'pngjs';
import './lib/imagedata-polyfill';
import { parsers } from 'mdx-m3-viewer';
import { parseJass } from './lib/jass';
import { decodeTga } from './lib/tga';
import type { MapData, ObjectTable, TerrainData } from '../src/data/types';

const MAP_FILE = process.argv[2] ?? 'Ruined Temple TD v.1.04.w3x';
const OUT = 'public/map';
const RAW = 'data/raw';

const toArrayBuffer = (b: Uint8Array) => new Uint8Array(b).slice().buffer;

function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(RAW, { recursive: true });

  const map = new parsers.w3x.Map();
  map.load(toArrayBuffer(readFileSync(MAP_FILE)), true);

  const files: Record<string, Uint8Array> = {};
  for (const f of map.archive.files) {
    const bytes = f.bytes();
    if (!bytes) continue;
    files[f.name.toLowerCase()] = bytes;
    writeFileSync(join(RAW, f.name.replace(/[()]/g, '_')), bytes);
  }
  const need = (name: string) => {
    const b = files[name.toLowerCase()];
    if (!b) throw new Error(`Missing ${name} in map archive`);
    return b;
  };
  const text = (name: string) => new TextDecoder('utf-8').decode(need(name));

  // --- Strings -------------------------------------------------------------
  const wts = new parsers.w3x.wts.File();
  wts.load(text('war3map.wts'));
  const strings: Record<string, string> = {};
  for (const [k, v] of wts.stringMap) strings[`TRIGSTR_${String(k).padStart(3, '0')}`] = v;
  const S = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('TRIGSTR_')) {
      const n = Number(v.slice(8));
      return wts.getString(n) ?? v;
    }
    return v;
  };

  // --- Map info --------------------------------------------------------------
  const w3i = new parsers.w3x.w3i.File();
  w3i.load(need('war3map.w3i'));

  // --- Terrain ---------------------------------------------------------------
  const w3e = new parsers.w3x.w3e.File();
  w3e.load(need('war3map.w3e'));
  const [columns, rows] = Array.from(w3e.mapSize);
  const n = columns * rows;
  const terrain: TerrainData = {
    tileset: w3e.tileset,
    groundTilesets: w3e.groundTilesets,
    cliffTilesets: w3e.cliffTilesets,
    columns,
    rows,
    centerOffset: [w3e.centerOffset[0], w3e.centerOffset[1]],
    groundHeight: new Array(n),
    waterHeight: new Array(n),
    layerHeight: new Array(n),
    groundTexture: new Array(n),
    groundVariation: new Array(n),
    cliffTexture: new Array(n),
    cliffVariation: new Array(n),
    flags: new Array(n),
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const c = w3e.corners[y][x];
      const i = y * columns + x;
      terrain.groundHeight[i] = c.groundHeight;
      terrain.waterHeight[i] = c.waterHeight;
      terrain.layerHeight[i] = c.layerHeight;
      terrain.groundTexture[i] = c.groundTexture;
      terrain.groundVariation[i] = c.groundVariation;
      terrain.cliffTexture[i] = c.cliffTexture;
      terrain.cliffVariation[i] = c.cliffVariation;
      terrain.flags[i] = (c.ramp ? 1 : 0) | (c.blight ? 2 : 0) | (c.water ? 4 : 0) | (c.boundary ? 8 : 0) | (c.mapEdge ? 16 : 0);
    }
  }

  // --- Pathing / shadows ------------------------------------------------------
  const wpm = new parsers.w3x.wpm.File();
  wpm.load(need('war3map.wpm'));
  const shd = files['war3map.shd'];

  // --- Doodads & destructables ------------------------------------------------
  const doo = new parsers.w3x.doo.File();
  doo.load(need('war3map.doo'), 0);
  const doodads = doo.doodads.map((d) => ({
    id: d.id,
    variation: d.variation,
    x: d.location[0],
    y: d.location[1],
    z: d.location[2],
    angle: d.angle,
    scale: [d.scale[0], d.scale[1], d.scale[2]] as [number, number, number],
    flags: d.flags,
    life: d.life,
    editorId: d.editorId,
  }));

  // --- Units --------------------------------------------------------------------
  const unitsDoo = new parsers.w3x.unitsdoo.File();
  unitsDoo.load(need('war3mapUnits.doo'), 0);
  const units = unitsDoo.units.map((u) => ({
    id: u.id,
    variation: u.variation,
    player: u.player,
    x: u.location[0],
    y: u.location[1],
    z: u.location[2],
    angle: u.angle,
    scale: [u.scale[0], u.scale[1], u.scale[2]] as [number, number, number],
    hitpoints: u.hitpoints,
    creationNumber: u.creationNumber,
  }));

  // --- Regions (the parser names the fields in file order: left, right, bottom, top
  //     but the file stores minX, minY, maxX, maxY – verified against Rect() calls in war3map.j)
  const w3r = new parsers.w3x.w3r.File();
  w3r.load(need('war3map.w3r'));
  const regions = w3r.regions.map((r) => ({
    name: r.name,
    minX: r.left,
    minY: r.right,
    maxX: r.bottom,
    maxY: r.top,
    color: [r.color[0], r.color[1], r.color[2]] as [number, number, number],
    weather: r.weatherEffectId?.replace(/\0/g, '') || '',
    ambientSound: r.ambientSound || '',
  }));

  // --- Sounds -----------------------------------------------------------------
  const w3s = new parsers.w3x.w3s.File();
  w3s.load(need('war3map.w3s'));
  const sounds = w3s.sounds.map((s) => ({
    name: s.name,
    file: s.file,
    eax: s.eaxEffect,
    flags: s.flags,
    volume: s.volume,
    pitch: s.pitch,
    channel: s.channel,
    minDistance: s.minDistance,
    maxDistance: s.maxDistance,
  }));

  // --- Object data (w3u/w3t/w3b/w3d/w3a/w3h/w3q) ---------------------------------
  const objects: Record<string, ObjectTable> = {};
  for (const ext of ['w3u', 'w3t', 'w3b', 'w3d', 'w3a', 'w3h', 'w3q']) {
    const bytes = files[`war3map.${ext}`];
    if (!bytes) continue;
    const usesLevels = ext === 'w3d' || ext === 'w3a' || ext === 'w3q';
    const file = usesLevels ? new parsers.w3x.w3d.File() : new parsers.w3x.w3u.File();
    file.load(bytes);
    const table: ObjectTable = {};
    for (const t of [file.originalTable, file.customTable]) {
      for (const o of t.objects) {
        const newId = (o.newId ?? '').replace(/\0/g, '').trim();
        const id = newId || o.oldId;
        const fields: Record<string, string | number> = {};
        for (const m of o.modifications) {
          const key = m.levelOrVariation ? `${m.id}@${m.levelOrVariation}` : m.id;
          fields[key] = S(m.value) as string | number;
        }
        table[id] = { base: o.oldId, custom: !!newId, fields };
      }
    }
    objects[ext] = table;
  }

  // --- Script (game logic) --------------------------------------------------------
  const jass = text('war3map.j');
  writeFileSync(join(OUT, 'war3map.j'), jass);
  const game = parseJass(jass, S);

  // Cross-check regions against the script.
  for (const r of regions) {
    const j = game.regions[r.name];
    if (!j || j.minX !== r.minX || j.minY !== r.minY || j.maxX !== r.maxX || j.maxY !== r.maxY) {
      throw new Error(`Region mismatch for ${r.name}: w3r=${JSON.stringify(r)} jass=${JSON.stringify(j)}`);
    }
  }

  const misc = parseIni(text('war3mapMisc.txt'));
  const extra = parseIni(text('war3mapExtra.txt'));

  const data: MapData = {
    source: MAP_FILE,
    info: {
      name: S(w3i.name) as string,
      author: S(w3i.author) as string,
      description: S(w3i.description) as string,
      recommendedPlayers: S(w3i.recommendedPlayers) as string,
      tileset: w3i.tileset,
      cameraBounds: Array.from(w3i.cameraBounds),
      cameraBoundsComplements: Array.from(w3i.cameraBoundsComplements),
      playableSize: [w3i.playableSize[0], w3i.playableSize[1]],
      flags: w3i.flags,
      fog: { enabled: !!w3i.useTerrainFog, start: w3i.fogHeight[0], end: w3i.fogHeight[1], density: w3i.fogDensity, color: Array.from(w3i.fogColor) },
      waterVertexColor: Array.from(w3i.waterVertexColor),
      players: w3i.players.map((p) => ({ id: p.id, type: p.type, race: p.race, name: S(p.name) as string, startLocation: [p.startLocation[0], p.startLocation[1]] })),
      forces: w3i.forces.map((f) => ({ flags: f.flags, playerMask: f.playerMasks, name: S(f.name) as string })),
      misc,
      extra,
    },
    terrain,
    pathing: { width: wpm.size[0], height: wpm.size[1], data: Buffer.from(wpm.pathing).toString('base64') },
    shadows: shd ? { width: wpm.size[0], height: wpm.size[1], data: Buffer.from(shd).toString('base64') } : null,
    doodads,
    units,
    regions,
    sounds,
    objects,
    strings,
    game,
  };

  writeFileSync(join(OUT, 'map.json'), JSON.stringify(data));

  // --- Images ---------------------------------------------------------------------
  const minimap = files['war3mapmap.blp'];
  if (minimap) {
    const blp = new parsers.blp.Image();
    blp.load(minimap);
    writePng(join(OUT, 'minimap.png'), blp.getMipmap(0));
  }
  const preview = files['war3mappreview.tga'];
  if (preview) writePng(join(OUT, 'preview.png'), decodeTga(preview));

  console.log(`Extracted ${Object.keys(files).length} files from "${MAP_FILE}"`);
  console.log(`  terrain ${columns}x${rows} corners, tileset ${terrain.tileset}`);
  console.log(`  ${doodads.length} doodads, ${units.length} units, ${regions.length} regions, ${sounds.length} sounds`);
  console.log(`  objects: ${Object.entries(objects).map(([k, v]) => `${k}=${Object.keys(v).length}`).join(', ')}`);
  console.log(`  ${game.waves.length} waves, ${game.unitsPerWave} units/wave, lives/player ${game.livesPerPlayer}, start gold ${game.startGold}`);
  if (!existsSync('public/war3')) console.log('  (no game assets in public/war3 – placeholders will be used; see docs/IMPLEMENTACE.md)');
}

function writePng(path: string, img: { width: number; height: number; data: Uint8ClampedArray }) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  writeFileSync(path, PNG.sync.write(png));
}

function parseIni(src: string) {
  const out: Record<string, Record<string, string>> = {};
  let section = '';
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith(';')) continue;
    const m = /^\[(.+)\]$/.exec(line);
    if (m) {
      section = m[1];
      out[section] = {};
    } else if (section) {
      const eq = line.indexOf('=');
      if (eq > 0) out[section][line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return out;
}

main();
