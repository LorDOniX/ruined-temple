/**
 * Writes docs/DATA.md – a human readable overview of what was extracted from the map
 * (waves, creeps, towers, tech tree, abilities, regions). Usage: npm run report
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ObjectDB, plainText } from '../src/data/objects';
import type { AssetCatalog, MapData } from '../src/data/types';

const map: MapData = JSON.parse(readFileSync('public/map/map.json', 'utf8'));
const catalog: AssetCatalog | null = existsSync('public/war3/catalog.json') ? JSON.parse(readFileSync('public/war3/catalog.json', 'utf8')) : null;
const db = new ObjectDB(map, catalog);
const g = map.game;
const clean = (s: string) => plainText(s).replace(/\r?\n/g, ' ').replace(/\|/g, '/').trim();
const lines: string[] = [];
const L = (s = '') => lines.push(s);

L('# Ruined Temple TD v1.04 – vytěžená data');
L();
L(`> Vygenerováno skriptem \`npm run report\` z \`public/map/map.json\` (zdroj: \`${map.source}\`).`);
L(catalog
  ? '> Nezměněná pole objektů jsou doplněna z originálních SLK tabulek hry (public/war3/catalog.json).'
  : '> Hodnoty označené * pocházejí z odhadnutých výchozích hodnot základních objektů hry – spusťte `npm run assets` (viz IMPLEMENTACE.md).');
L();
L('## Mapa');
L();
L(`- Název: ${clean(map.info.name)}, autor: ${clean(map.info.author)}, hráči: ${clean(map.info.recommendedPlayers)}`);
L(`- Tileset: \`${map.terrain.tileset}\` (Sunken Ruins), velikost ${map.terrain.columns - 1}×${map.terrain.rows - 1} dlaždic, hratelná plocha ${map.info.playableSize.join('×')}`);
L(`- Pozemní textury: ${map.terrain.groundTilesets.join(', ')}; útesy: ${map.terrain.cliffTilesets.join(', ')}`);
L(`- ${map.doodads.length} doodadů/destructables, ${map.units.length} předem umístěných jednotek, ${map.regions.length} regionů, ${map.sounds.length} zvuků`);
L(`- Životy: ${g.livesPerPlayer} × počet hráčů, startovní zlato ${g.startGold}, ${g.unitsPerWave} jednotek na vlnu, pauza mezi vlnami ${g.nextWaveDelay} s, vítězství po vlně ${g.lastWave}`);
L(`- Trasa creepů: ${g.path.join(' → ')}`);
L(`- Obtížnost (handicap creepů × počet hráčů): ${g.difficulties.map((d) => `${d.label} ${d.factor} %`).join(', ')} (výchozí po ${g.difficultyTimeout} s: ${g.difficulties[g.defaultDifficulty].label})`);
L(`- Odměna za vlnu: \`wave*10 + wave²/hráči\`; prodej věže: ${g.sellRatio * 100} % z point value (\`upoi\`)`);
L();
L('## Vlny');
L();
L('| # | Jednotka | Název vlny | HP (100 %) | Brnění | Rychlost | Pohyb | Bounty (1 hráč) | Bounty MP (base–dice) | Spawn cooldown | Schopnosti |');
L('|---|---|---|---|---|---|---|---|---|---|---|');
for (const w of g.waves) {
  const u = db.unit(w.unit);
  const b = u.bounty;
  L(`| ${w.wave} | \`${w.unit}\` ${clean(u.name)} | ${w.name} | ${u.hp} | ${u.armor} ${u.defenseType} | ${u.speed} | ${u.moveType || 'none'}${u.flyHeight ? ` (${u.flyHeight})` : ''} | ${b.base}+${b.dice}d${b.sides}${catalog ? '' : '*'} | ${g.bounty.base[w.wave]}–${g.bounty.dice[w.wave]} | ${w.spawnCooldown} s | ${u.abilities.join(', ')} |`);
}
L();
L('## Věže a jednotky hráče');
L();
L('| ID | Název | Cena | Point value | Poškození | Cooldown | Dosah | Typ útoku | Splash / odrazy | Upgrade na | Požadavky | Schopnosti |');
L('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const id of Object.keys(map.objects.w3u)) {
  const u = db.unit(id);
  if (!['hgtw', 'nhea', 'ocat'].includes(u.base)) continue;
  const a = u.attack;
  const dmg = a ? `${a.damageBase + a.dice}–${a.damageBase + a.dice * a.sides}` : '–';
  L(`| \`${id}\` | ${clean(u.name)} | ${u.gold} | ${u.pointValue} | ${dmg} | ${a ? a.cooldown.toFixed(2) : '–'} | ${a?.range ?? '–'} | ${a?.attackType ?? '–'} | ${a?.weaponType === 'mbounce' ? `${a.maxTargets} cíle, −${Math.round(a.damageLoss * 100)} %/odraz, ${a.splashFull}` : a && a.splashFull + a.splashMedium ? `${a.splashFull}/${a.splashMedium}/${a.splashSmall}` : ''} | ${u.upgradesTo.join(', ')} | ${u.requires.join(', ')} | ${u.abilities.filter((x) => x !== 'Avul' && x !== 'A003').map((x) => `${x} ${clean(db.ability(x).name)}`).join('; ')} |`);
}
L();
L('## Builder, budovy, obchod');
L();
for (const id of ['h002', 'h018', 'h000', 'h00A', 'h017', 'h00X']) {
  const u = db.unit(id);
  L(`- \`${id}\` **${clean(u.name)}** – ${[u.builds.length ? `staví ${u.builds.join(', ')}` : '', u.trains.length ? `trénuje ${u.trains.join(', ')}` : '', u.researches.length ? `výzkumy ${u.researches.join(', ')}` : '', u.sells.length ? `prodává ${u.sells.join(', ')}` : '', u.gold ? `cena ${u.gold}` : '', u.abilities.length ? `schopnosti ${u.abilities.join(', ')}` : ''].filter(Boolean).join('; ')}`);
}
L();
L('## Výzkumy');
L();
for (const id of Object.keys(map.objects.w3q ?? {})) {
  const up = db.upgrade(id);
  L(`- \`${id}\` (základ \`${up.base}\`) **${clean(up.name(1))}** – ${up.levels} úrovní, cena ${Array.from({ length: up.levels }, (_, i) => up.gold(i + 1)).join('/')}${catalog ? '' : '*'}, čas ${Array.from({ length: up.levels }, (_, i) => up.time(i + 1)).join('/')} s – ${clean(up.description(1))}`);
}
L();
L('## Schopnosti (w3a)');
L();
L('| ID | Základ | Název | Upravená pole |');
L('|---|---|---|---|');
for (const [id, o] of Object.entries(map.objects.w3a ?? {})) {
  const f = Object.entries(o.fields)
    .filter(([k]) => /^[A-Z][a-z]{2}\d|^(adur|aare|aran|acdn)/.test(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  L(`| \`${id}\` | \`${o.base}\` | ${clean(String(o.fields.anam ?? ''))} | ${f} |`);
}
L();
L('## Regiony');
L();
L('| Název | minX | minY | maxX | maxY |');
L('|---|---|---|---|---|');
for (const r of map.regions) L(`| ${r.name} | ${r.minX} | ${r.minY} | ${r.maxX} | ${r.maxY} |`);
L();
L('## Doodady (počty podle ID)');
L();
const counts: Record<string, number> = {};
for (const d of map.doodads) counts[d.id] = (counts[d.id] ?? 0) + 1;
L(
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `\`${id}\`×${n}${map.objects.w3d?.[id]?.fields?.dfil ? ` (${map.objects.w3d[id].fields.dfil})` : ''}`)
    .join(', '),
);
L();
writeFileSync('docs/DATA.md', lines.join('\n'));
console.log(`docs/DATA.md written (${lines.length} lines)`);
