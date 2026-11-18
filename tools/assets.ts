/**
 * Builds public/war3/ (models, textures, icons, sounds) and public/war3/catalog.json from an
 * original Warcraft III installation, so the replica can swap its placeholders for real assets.
 *
 * Sources are searched from the LAST to the FIRST one (later sources override earlier, like patch MPQs):
 *
 *   Classic (<= 1.28, MPQ archives):
 *     npm run assets -- --mpq "C:\Games\Warcraft III\war3.mpq" "C:\Games\Warcraft III\War3x.mpq" "C:\Games\Warcraft III\War3xLocal.mpq" "C:\Games\Warcraft III\War3Patch.mpq"
 *
 *   Reforged (>= 1.32, CASC) – export the folders with CascView / Ladik's CASC Viewer first:
 *     npm run assets -- --dir "D:\wc3-export\war3.w3mod" --dir "D:\wc3-export\war3.w3mod\_locales\enus.w3mod"
 *
 * Only files needed by this map are copied (lower-case paths, forward slashes).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { parsers } from 'mdx-m3-viewer';
import { PNG } from 'pngjs';
import { decodeDds } from './lib/dds';
import { CLIFF_STYLES, TILE_STYLES, resample } from '../src/render/textures';
import type { AssetCatalog, MapData } from '../src/data/types';

type Row = Record<string, string>;

interface Source {
  name: string;
  read(path: string): Uint8Array | null;
}

const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase();

/** Classic MPQ archives via StormLib (WebAssembly) – handles every compression used by WC3 (incl. huffman/ADPCM WAVs). */
async function mpqSources(files: string[]): Promise<Source[]> {
  process.env.NODE_ENV ??= 'production';
  const { FS, MPQ } = await import('@wowserhq/stormjs');
  const out: Source[] = [];
  const mounts = new Map<string, string>();
  for (const file of files) {
    const dir = dirname(resolve(file));
    let mount = mounts.get(dir);
    if (!mount) {
      mount = `/mpq${mounts.size}`;
      FS.mkdir(mount);
      FS.mount(FS.filesystems.NODEFS, { root: dir }, mount);
      mounts.set(dir, mount);
    }
    const archive = await MPQ.open(`${mount}/${basename(file)}`, 'r');
    out.push({
      name: file,
      read(path) {
        const p = path.replace(/\//g, '\\');
        try {
          if (!archive.hasFile(p)) return null;
          const f = archive.openFile(p);
          const data = new Uint8Array(f.read());
          f.close();
          return data;
        } catch {
          return null;
        }
      },
    });
  }
  return out;
}

/** The classic archives of an installed game folder, in patch order. */
function gameArchives(dir: string) {
  const names = ['war3.mpq', 'War3x.mpq', 'War3xLocal.mpq', 'War3Patch.mpq'];
  const present = new Map(readdirSync(dir).map((f) => [f.toLowerCase(), f]));
  return names.map((n) => present.get(n.toLowerCase())).filter((n): n is string => !!n).map((n) => join(dir, n));
}

/**
 * A folder with extracted game files (CascView export, or a mod such as "Classic HD for Classic").
 * Reforged layout is understood: `_tilesets\<t>.w3mod\…` overrides apply for the map's tileset only,
 * other `_*.w3mod` sub-mods (`_hd`, `_teen`, other tilesets) are ignored; a `_retail_` subfolder is used automatically.
 */
function dirSource(root: string, tileset: string): Source {
  if (existsSync(join(root, '_retail_'))) root = join(root, '_retail_');
  const index = new Map<string, string>();
  const overrides = new Map<string, string>();
  const tilesetPrefix = `_tilesets\\${tileset.toLowerCase()}.w3mod\\`;
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      const r = rel ? `${rel}\\${e}` : e;
      if (statSync(full).isDirectory()) {
        const low = `${r.toLowerCase()}\\`;
        if (low.startsWith('_tilesets\\') && low.length > '_tilesets\\'.length && !tilesetPrefix.startsWith(low) && !low.startsWith(tilesetPrefix)) continue;
        if (/^_(?!tilesets)[^\\]*\.w3mod\\$/.test(low) || low === '_locales\\') continue;
        walk(full, r);
      } else {
        const low = r.toLowerCase();
        if (low.startsWith(tilesetPrefix)) overrides.set(low.slice(tilesetPrefix.length), full);
        else index.set(low, full);
      }
    }
  };
  walk(root, '');
  return {
    name: root,
    read(path) {
      const key = norm(path);
      const full = overrides.get(key) ?? index.get(key);
      return full ? new Uint8Array(readFileSync(full)) : null;
    },
  };
}

class Assets {
  constructor(private readonly sources: Source[]) {}
  read(path: string) {
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const b = this.sources[i].read(path);
      if (b) return b;
    }
    return null;
  }
  /** First match in source priority order, trying every candidate path per source (e.g. .dds of an HD mod before an older .blp). */
  readAny(paths: string[]) {
    for (let i = this.sources.length - 1; i >= 0; i--) {
      for (const p of paths) {
        const b = this.sources[i].read(p);
        if (b) return { path: p, bytes: b };
      }
    }
    return null;
  }
  text(path: string) {
    const b = this.read(path);
    return b ? new TextDecoder('utf-8').decode(b) : null;
  }
}

function parseSlk(text: string | null, key?: string): Map<string, Row> {
  const out = new Map<string, Row>();
  if (!text) return out;
  const slk = new parsers.slk.File();
  slk.load(text);
  const [header, ...rows] = slk.rows;
  if (!header) return out;
  const idCol = key ? header.indexOf(key) : 0;
  for (const r of rows) {
    if (!r || !r[idCol]) continue;
    const row: Row = {};
    header.forEach((h, i) => {
      if (h && r[i] !== null && r[i] !== undefined) row[h.toLowerCase()] = String(r[i]);
    });
    out.set(String(r[idCol]), row);
  }
  return out;
}

/** Profile (*.txt) files: [ID] sections with Key=Value; keys are case-insensitive. */
function parseIni(text: string | null, into: Map<string, Row>) {
  if (!text) return;
  let section: Row | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith(';')) continue;
    const m = /^\[(.+)\]$/.exec(line);
    if (m) {
      section = into.get(m[1]) ?? {};
      into.set(m[1], section);
      continue;
    }
    const eq = line.indexOf('=');
    if (section && eq > 0) section[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1);
  }
}

/** Splits a profile list value (comma separated, quotes protect commas). */
function splitList(v: string) {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of v) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const value = (v: string | undefined): string | number | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = v.replace(/^"|"$/g, '');
  if (s === '-' || s === '_') return '';
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
};

async function main() {
  const args = process.argv.slice(2);
  if (!existsSync('public/map/map.json')) {
    console.error('public/map/map.json not found – run "npm run extract" first.');
    process.exit(1);
  }
  const map: MapData = JSON.parse(readFileSync('public/map/map.json', 'utf8'));
  const sources: Source[] = [];
  const take = (i: number) => {
    const list: string[] = [];
    while (args[i + 1] && !args[i + 1].startsWith('--')) list.push(args[++i]);
    return [list, i] as const;
  };
  for (let i = 0; i < args.length; i++) {
    let list: readonly string[];
    if (args[i] === '--game') {
      [list, i] = take(i);
      for (const g of list) sources.push(...(await mpqSources(gameArchives(g))));
    } else if (args[i] === '--mpq') {
      [list, i] = take(i);
      sources.push(...(await mpqSources([...list])));
    } else if (args[i] === '--dir') {
      [list, i] = take(i);
      for (const d of list) sources.push(dirSource(d, map.terrain.tileset));
    }
  }
  if (!sources.length) {
    console.error('Usage: npm run assets -- --game <Warcraft III folder> | --mpq <war3.mpq …> | --dir <exported war3.w3mod | texture mod> (later sources override earlier)');
    process.exit(1);
  }
  console.log(`Sources (later override earlier):\n  ${sources.map((s) => s.name).join('\n  ')}`);
  const A = new Assets(sources);

  // --- game data tables -------------------------------------------------------------------------
  const slk = (p: string, key?: string) => parseSlk(A.text(p), key);
  const terrain = slk('TerrainArt\\Terrain.slk');
  const cliffs = slk('TerrainArt\\CliffTypes.slk');
  const water = slk('TerrainArt\\Water.slk');
  const doodads = slk('Doodads\\Doodads.slk');
  const destructables = slk('Units\\DestructableData.slk');
  const unitTables: Record<string, Map<string, Row>> = {};
  for (const t of ['UnitData', 'UnitBalance', 'UnitUI', 'UnitWeapons', 'UnitAbilities']) unitTables[t.toLowerCase()] = slk(`Units\\${t}.slk`);
  const abilityData = slk('Units\\AbilityData.slk');
  const upgradeData = slk('Units\\UpgradeData.slk');
  const unitMeta = slk('Units\\UnitMetaData.slk');
  const abilityMeta = slk('Units\\AbilityMetaData.slk');
  const upgradeMeta = slk('Units\\UpgradeMetaData.slk');
  const profile = new Map<string, Row>();
  const races = ['Campaign', 'Human', 'NightElf', 'Orc', 'Undead', 'Neutral', 'Item', 'Common'];
  for (const r of races) for (const k of ['UnitFunc', 'UnitStrings', 'AbilityFunc', 'AbilityStrings', 'UpgradeFunc', 'UpgradeStrings']) parseIni(A.text(`Units\\${r}${k}.txt`), profile);
  for (const f of ['UnitSkin', 'AbilitySkin', 'UpgradeSkin', 'DestructableSkin', 'ItemSkin']) parseIni(A.text(`Units\\${f}.txt`), profile);
  parseIni(A.text('Doodads\\DoodadSkins.txt'), profile);
  // Reforged keeps WESTRING_* names in a separate string table.
  const we = new Map<string, Row>();
  parseIni(A.text('UI\\WorldEditStrings.txt'), we);
  const westr = (s: string) => (s.startsWith('WESTRING') ? we.get('WorldEditStrings')?.[s.toLowerCase()] ?? s : s);

  const missingTables = [
    ['TerrainArt\\Terrain.slk', terrain],
    ['TerrainArt\\CliffTypes.slk', cliffs],
    ['Doodads\\Doodads.slk', doodads],
    ['Units\\DestructableData.slk', destructables],
    ['Units\\UnitMetaData.slk', unitMeta],
    ['Units\\AbilityMetaData.slk', abilityMeta],
  ].filter(([, t]) => !(t as Map<string, Row>).size);
  if (missingTables.length) console.warn(`WARNING: missing tables: ${missingTables.map((x) => x[0]).join(', ')}`);

  // --- object fields via metadata ----------------------------------------------------------------
  const fromMeta = (id: string, meta: Map<string, Row>, tables: (slkName: string) => Row | undefined, levels: number, isAbility: boolean) => {
    const out: Record<string, string | number> = {};
    for (const [fieldId, m] of meta) {
      const specific = (m.usespecific ?? '').split(',').filter(Boolean);
      if (isAbility && specific.length && !specific.includes(id)) continue;
      if (isAbility && !specific.length && m.field === 'Data') continue;
      const slkName = (m.slk ?? '').toLowerCase();
      const field = m.field ?? '';
      const repeat = Number(m.repeat ?? 0);
      const index = Number(m.index ?? -1);
      const dataLetter = m.data && Number(m.data) > 0 ? 'ABCDEFGHI'[Number(m.data) - 1] : '';
      const get = (col: string) => {
        if (slkName === 'profile') {
          const sec = profile.get(id);
          return sec?.[col.toLowerCase()];
        }
        return tables(slkName)?.[col.toLowerCase()] ?? profile.get(id)?.[col.toLowerCase()];
      };
      if (repeat > 0) {
        for (let lvl = 1; lvl <= Math.max(1, levels); lvl++) {
          let raw: string | undefined;
          if (slkName === 'profile') {
            const v = get(field);
            raw = v !== undefined ? splitList(v)[lvl - 1] ?? splitList(v).at(-1) : undefined;
          } else raw = get((field === 'Data' ? `Data${dataLetter}` : field) + lvl);
          const val = value(raw);
          if (val !== undefined) out[`${fieldId}@${lvl}`] = typeof val === 'string' ? westr(val) : val;
        }
      } else {
        let raw = get(field);
        if (raw !== undefined && index >= 0) raw = splitList(raw)[index];
        const val = value(raw);
        if (val !== undefined) out[fieldId] = typeof val === 'string' ? westr(val) : val;
      }
    }
    return out;
  };

  const w3u = map.objects.w3u ?? {};
  const w3a = map.objects.w3a ?? {};
  const w3q = map.objects.w3q ?? {};
  const unitIds = new Set<string>(Object.values(w3u).map((o) => o.base));
  const abilityIds = new Set<string>(Object.values(w3a).map((o) => o.base));
  for (const o of Object.values(w3u)) for (const a of String(o.fields.uabi ?? '').split(',')) if (a && !w3a[a]) abilityIds.add(a);
  const upgradeIds = new Set<string>(Object.values(w3q).map((o) => o.base));

  const catalog: AssetCatalog = { terrain: {}, cliffs: {}, water: null, doodads: {}, units: {}, abilities: {}, upgrades: {}, files: [] };
  for (const id of unitIds) catalog.units[id] = fromMeta(id, unitMeta, (t) => unitTables[t]?.get(id), 1, false);
  for (const id of abilityIds) {
    const levels = Number(abilityData.get(id)?.levels ?? 1);
    catalog.abilities[id] = fromMeta(id, abilityMeta, (t) => (t === 'abilitydata' ? abilityData.get(id) : undefined), levels, true);
  }
  for (const id of upgradeIds) {
    const levels = Number(upgradeData.get(id)?.maxlevel ?? 1);
    catalog.upgrades[id] = { ...fromMeta(id, upgradeMeta, (t) => (t === 'upgradedata' ? upgradeData.get(id) : undefined), levels, false), glvl: levels };
  }

  // Without Terrain.slk / CliffTypes.slk (e.g. a texture-only mod) fall back to the known Sunken Ruins paths.
  for (const id of map.terrain.groundTilesets) {
    const r = terrain.get(id);
    if (r) catalog.terrain[id] = { file: `${r.dir}\\${r.file}`, name: westr(r.comment ?? id) };
    else if (TILE_STYLES[id]) catalog.terrain[id] = { file: TILE_STYLES[id].file, name: TILE_STYLES[id].name };
  }
  for (const id of map.terrain.cliffTilesets) {
    const r = cliffs.get(id);
    const g = CLIFF_STYLES[id];
    if (r) catalog.cliffs[id] = { texture: `${r.texdir}\\${r.texfile}`, modelDir: r.cliffmodeldir, groundTile: r.groundtile, name: westr(r.name ?? id) };
    else if (g) catalog.cliffs[id] = { texture: g.file, modelDir: g.modelDir, groundTile: g.groundTile, name: g.name };
  }
  const wr = water.get(`${map.terrain.tileset}Sha`);
  if (wr) {
    const n = (k: string) => Number(wr[k.toLowerCase()] ?? 0);
    catalog.water = {
      texture: wr.texfile,
      numTex: n('numTex'),
      texRate: n('texRate'),
      height: n('height'),
      deep: [[n('Dmin_R'), n('Dmin_G'), n('Dmin_B'), n('Dmin_A')], [n('Dmax_R'), n('Dmax_G'), n('Dmax_B'), n('Dmax_A')]],
      shallow: [[n('Smin_R'), n('Smin_G'), n('Smin_B'), n('Smin_A')], [n('Smax_R'), n('Smax_G'), n('Smax_B'), n('Smax_A')]],
    };
  }
  const doodadIds = new Set<string>([...map.doodads.map((d) => d.id), ...map.game.destructables.map((d) => d.id)]);
  for (const id of doodadIds) {
    const base = map.objects.w3d?.[id]?.base ?? map.objects.w3b?.[id]?.base ?? id;
    const r = doodads.get(base) ?? destructables.get(base);
    const p = profile.get(base);
    if (!r) continue;
    catalog.doodads[id] = {
      file: (r.file ?? p?.file ?? '').replace(/\.md[lx]$/i, ''),
      numVar: Number(r.numvar ?? 1),
      pathTex: r.pathtex,
      name: westr(r.name ?? p?.name ?? id),
      category: r.category,
      fixedRotation: r.fixedrot !== undefined ? Number(r.fixedrot) : undefined,
      texId: r.texid && r.texid !== '_' ? Number(r.texid) : undefined,
      texFile: r.texfile && r.texfile !== '_' ? r.texfile.replace(/\.(blp|dds|tga)$/i, '') : undefined,
    };
  }

  // --- files to copy -----------------------------------------------------------------------------
  const wanted = new Set<string>();
  const want = (p: string | number | undefined | null) => {
    if (typeof p !== 'string' || !p.trim()) return;
    wanted.add(p.trim());
  };
  const wantModel = (p: string | number | undefined | null) => {
    if (typeof p !== 'string' || !p.trim()) return;
    want(`${p.trim().replace(/\.md[lx]$/i, '')}.mdx`);
  };
  for (const t of Object.values(catalog.terrain)) want(`${t.file}.blp`);
  for (const c of Object.values(catalog.cliffs)) want(`${c.texture}.blp`);
  want(`TerrainArt\\Blight\\Ruins_Blight.blp`);
  if (catalog.water) for (let i = 0; i < catalog.water.numTex; i++) want(`${catalog.water.texture}${String(i).padStart(2, '0')}.blp`);
  for (let i = 0; i < 12; i++) {
    want(`ReplaceableTextures\\TeamColor\\TeamColor${String(i).padStart(2, '0')}.blp`);
    want(`ReplaceableTextures\\TeamGlow\\TeamGlow${String(i).padStart(2, '0')}.blp`);
  }
  // Cliff models: every variation of every cliff type used.
  for (const c of Object.values(catalog.cliffs)) {
    const dir = c.modelDir;
    for (const a of 'ABC') for (const b of 'ABC') for (const cc of 'ABC') for (const d of 'ABC') for (let v = 0; v < 4; v++) want(`Doodads\\Terrain\\${dir}\\${dir}${a}${b}${cc}${d}${v}.mdx`);
  }
  for (const [id, d] of Object.entries(catalog.doodads)) {
    const custom = map.objects.w3d?.[id]?.fields?.dfil ?? map.objects.w3b?.[id]?.fields?.bfil;
    if (custom) wantModel(String(custom));
    if (d.texFile) want(`${d.texFile}.blp`);
    if (d.file) {
      if (d.numVar <= 1) wantModel(d.file);
      for (let v = 0; v < Math.max(1, d.numVar); v++) wantModel(`${d.file}${v}`);
    }
  }
  const objectFields = (f: Record<string, string | number>) => {
    for (const [k, v] of Object.entries(f)) {
      if (typeof v !== 'string') continue;
      const key = k.slice(0, 4);
      if (['umdl', 'ua1m', 'ua2m', 'amat', 'atat', 'acat', 'aeat', 'asat', 'aaea', 'ftat', 'fsat', 'fart', 'dfil', 'bfil'].includes(key)) {
        if (key === 'fart') want(v);
        else for (const p of v.split(',')) wantModel(p);
      }
      if (['uico', 'aart', 'auar', 'gar1', 'fart'].includes(key)) want(v);
    }
  };
  for (const t of Object.values(map.objects)) for (const o of Object.values(t)) objectFields(o.fields);
  for (const t of [catalog.units, catalog.abilities, catalog.upgrades]) for (const f of Object.values(t)) objectFields(f);
  for (const p of ['BTNMove', 'BTNStop', 'BTNHumanBuild', 'BTNCancel']) want(`ReplaceableTextures\\CommandButtons\\${p}.blp`);
  want('Abilities\\Spells\\Human\\MassTeleport\\MassTeleportTarget.mdx');
  want('Abilities\\Spells\\Other\\Transmute\\PileofGold.mdx');
  want('Objects\\StartLocation\\StartLocation.mdx');
  const sounds = [...Object.values(map.game.sounds).map((s) => s.file), ...map.sounds.map((s) => s.file)];
  for (const s of sounds) for (const ext of ['.wav', '.flac', '.mp3']) want(s.replace(/\.(wav|flac|mp3)$/i, '') + ext);
  // SetMapMusic("Music", true, 0) = random track from the local player's race playlist (UI\war3skins.txt, TFT = Music_V1).
  const skins = new Map<string, Row>();
  parseIni(A.text('UI\\war3skins.txt'), skins);
  const race = ['', 'Human', 'Orc', 'Undead', 'NightElf'][map.info.players[0]?.race ?? 1] || 'Default';
  const playlist = skins.get(race)?.music_v1 ?? skins.get('Default')?.music_v1 ?? '';
  catalog.music = playlist.split(';').map((s) => s.trim()).filter(Boolean);
  for (const m of catalog.music) want(m);

  // --- copy (models pull in their textures) ------------------------------------------------------
  // Textures: original BLP is copied as-is; DDS (Reforged / HD mods) is decoded and stored as PNG.
  const out = 'public/war3';
  const copied = new Set<string>();
  const done = new Set<string>();
  const missing: string[] = [];
  const queue = [...wanted];
  const optional = (p: string) => /\.(flac|mp3)$/i.test(p) || /\.wav$/i.test(p) || /Terrain\\(City)?Cliffs\\/i.test(p) || /\d\.mdx$/i.test(p);
  const write = (key: string, bytes: Uint8Array) => {
    copied.add(key);
    const dest = join(out, key.replace(/\\/g, '/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  };
  let converted = 0;
  while (queue.length) {
    const p = queue.shift()!;
    const isTexture = /\.(blp|tga|dds)$/i.test(p);
    const base = isTexture ? norm(p).replace(/\.(blp|tga|dds)$/, '') : norm(p);
    if (done.has(base)) continue;
    done.add(base);
    if (isTexture) {
      const hit = A.readAny([`${base}.dds`, `${base}.blp`]);
      if (hit && hit.path.endsWith('.blp')) {
        write(`${base}.blp`, hit.bytes);
        continue;
      }
      if (hit) {
        try {
          let img = decodeDds(hit.bytes);
          // HD textures are up to 4096 px; 1024 is plenty at RTS camera distance and keeps public/war3 small.
          while (Math.max(img.width, img.height) > 1024) img = { width: img.width >> 1, height: img.height >> 1, data: resample(img, img.width >> 1, img.height >> 1) };
          const png = new PNG({ width: img.width, height: img.height });
          png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
          write(`${base}.png`, PNG.sync.write(png));
          converted++;
          continue;
        } catch (e) {
          console.warn(`  could not decode ${base}.dds: ${e}`);
        }
      }
      if (!optional(p)) missing.push(p);
      continue;
    }
    const bytes = A.read(p);
    if (!bytes) {
      if (!optional(p)) missing.push(p);
      continue;
    }
    write(base, bytes);
    if (base.endsWith('.mdx')) {
      try {
        const model = new parsers.mdlx.Model();
        model.load(new Uint8Array(bytes).slice().buffer);
        for (const t of model.textures) if (t.path) queue.push(t.path);
      } catch (e) {
        console.warn(`  could not parse ${p}: ${e}`);
      }
    }
  }
  // Placeholder sounds that were found under another extension are fine; report only real gaps.
  const soundOk = (s: string) => ['.wav', '.flac', '.mp3'].some((ext) => copied.has(norm(s.replace(/\.(wav|flac|mp3)$/i, '') + ext)));
  const missingSounds = sounds.filter((s) => !soundOk(s));

  catalog.files = [...copied].map((p) => p.replace(/\\/g, '/'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'catalog.json'), JSON.stringify(catalog, null, 1));
  writeFileSync(join(out, 'missing.txt'), [...missing, ...missingSounds.map((s) => `${s} (sound)`)].join('\n'));
  console.log(`Copied ${copied.size} files to ${out} (${converted} DDS textures converted to PNG)`);
  console.log(`Catalog: ${Object.keys(catalog.terrain).length} terrain, ${Object.keys(catalog.cliffs).length} cliffs, ${Object.keys(catalog.doodads).length} doodads, ${Object.keys(catalog.units).length} unit bases, ${Object.keys(catalog.abilities).length} abilities, ${Object.keys(catalog.upgrades).length} upgrades`);
  if (missing.length || missingSounds.length) console.log(`Not found: ${missing.length} files, ${missingSounds.length} sounds (see ${out}/missing.txt)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
