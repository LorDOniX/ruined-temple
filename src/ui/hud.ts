import type { Game, Unit } from '../game/game';
import { CREEP_PLAYER } from '../game/game';
import { plainText, wc3ToHtml, type UnitDef } from '../data/objects';
import type { MapData } from '../data/types';
import type { Wc3Assets } from '../render/mdx';

export interface Command {
  x: number;
  y: number;
  label: string;
  hotkey: string;
  enabled: boolean;
  cost?: number;
  icon?: string;
  tooltip: () => string;
  run: () => void;
}

const $ = (id: string) => document.getElementById(id)!;

function hotkeyOf(def: { hotkey: string; tooltip: string }) {
  if (def.hotkey && def.hotkey.length === 1) return def.hotkey.toUpperCase();
  const m = /\|c[0-9a-f]{8}(\w)\|r/i.exec(def.tooltip);
  return m ? m[1].toUpperCase() : '';
}

/** DOM based HUD imitating the Warcraft III interface (resources, multiboard, info panel, command card, minimap). */
export class Hud {
  mode: { kind: 'normal' } | { kind: 'build'; id: string } | { kind: 'target'; ability: 'coin' | 'attack' | 'move' } = { kind: 'normal' };
  submenu: 'build' | null = null;
  private commands: Command[] = [];
  private messages: { el: HTMLElement; until: number }[] = [];
  private minimapImg = new Image();
  private minimapCtx: CanvasRenderingContext2D;
  private dialogTimer: { end: number; el: HTMLElement } | null = null;
  private lastCardKey = '';
  private icons = new Map<string, Promise<string | null>>();
  onSelect: (u: Unit | null) => void = () => {};
  /** All selected units (the first one drives the info panel and command card). */
  group: Unit[] = [];
  onMinimapClick: (x: number, y: number) => void = () => {};

  readonly playable: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(private readonly game: Game, private readonly map: MapData, readonly localPlayer = 0, private readonly assets: Wc3Assets | null = null) {
    const t = map.terrain;
    const [l, r, b, top] = map.info.cameraBoundsComplements;
    this.playable = {
      minX: t.centerOffset[0] + l * 128,
      maxX: t.centerOffset[0] + (t.columns - 1 - r) * 128,
      minY: t.centerOffset[1] + b * 128,
      maxY: t.centerOffset[1] + (t.rows - 1 - top) * 128,
    };
    this.minimapImg.src = 'map/minimap.png';
    this.minimapCtx = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
    const mm = $('minimap') as HTMLCanvasElement;
    const mmClick = (e: MouseEvent) => {
      const rect = mm.getBoundingClientRect();
      const [x, y] = this.fromMinimap(((e.clientX - rect.left) / rect.width) * 256, ((e.clientY - rect.top) / rect.height) * 256);
      this.onMinimapClick(x, y);
    };
    mm.addEventListener('mousedown', (e) => {
      mmClick(e);
      const move = (ev: MouseEvent) => mmClick(ev);
      addEventListener('mousemove', move);
      addEventListener('mouseup', () => removeEventListener('mousemove', move), { once: true });
    });

    game.on('message', (m) => this.addMessage(m.text, m.duration));
    game.on('clearMessages', () => {
      this.messages.forEach((m) => m.el.remove());
      this.messages = [];
    });
    game.on('fade', (f) => {
      const el = $('fade');
      el.style.transition = `opacity ${f.duration}s linear`;
      el.style.opacity = f.dir === 'out' ? '1' : '0';
    });
    game.on('dialog', (d) => this.showDialog(d));
    game.on('quest', () => this.addMessage('|cffffcc00Quest log updated (F9).|r', 6));
    game.on('end', (e) => this.showModal(e.victory ? 'Vítězství!' : 'Porážka', `<p>${wc3ToHtml(e.text)}</p><p><button onclick="location.reload()">Hrát znovu</button></p>`));

    $('btn-quests').addEventListener('click', () => this.showQuests());
    $('btn-help').addEventListener('click', () => this.showHelp());
    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('btn-speed').addEventListener('click', () => {
      game.speed = game.speed >= 4 ? 1 : game.speed * 2;
      $('btn-speed').textContent = `${game.speed}×`;
    });

    addEventListener('keydown', (e) => this.onKey(e));
  }

  togglePause() {
    this.game.paused = !this.game.paused;
    $('btn-pause').classList.toggle('on', this.game.paused);
  }

  // --- minimap -------------------------------------------------------------------------------------

  private minimapScale() {
    const p = this.playable;
    const w = p.maxX - p.minX;
    const h = p.maxY - p.minY;
    const s = 256 / Math.max(w, h);
    return { s, ox: (256 - w * s) / 2, oy: (256 - h * s) / 2 };
  }

  toMinimap(x: number, y: number): [number, number] {
    const { s, ox, oy } = this.minimapScale();
    return [ox + (x - this.playable.minX) * s, oy + (this.playable.maxY - y) * s];
  }

  fromMinimap(px: number, py: number): [number, number] {
    const { s, ox, oy } = this.minimapScale();
    return [this.playable.minX + (px - ox) / s, this.playable.maxY - (py - oy) / s];
  }

  drawMinimap(view: { x: number; y: number }[]) {
    const ctx = this.minimapCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    if (this.minimapImg.complete) ctx.drawImage(this.minimapImg, 0, 0, 256, 256);
    for (const u of this.game.units) {
      if (!u.alive || u.hidden) continue;
      const [x, y] = this.toMinimap(u.x, u.y);
      const size = u.kind === 'tower' || u.kind === 'spawning' || u.kind === 'shop' ? 5 : 3;
      ctx.fillStyle = u.owner === CREEP_PLAYER ? '#ff2020' : u.owner < 3 ? this.game.players[u.owner].color : '#ffff80';
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    if (view.length === 4) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      view.forEach((p, i) => {
        const [x, y] = this.toMinimap(p.x, p.y);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  // --- messages / dialogs ----------------------------------------------------------------------------

  addMessage(text: string, duration = 10) {
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = wc3ToHtml(text);
    $('messages').appendChild(el);
    this.messages.push({ el, until: performance.now() + duration * 1000 });
    while (this.messages.length > 8) this.messages.shift()!.el.remove();
  }

  private showDialog(d: { title: string; buttons: { label: string; id: number }[]; timeout: number } | null) {
    const el = $('dialog');
    if (!d) {
      el.hidden = true;
      this.dialogTimer = null;
      return;
    }
    el.innerHTML = `<h2>${wc3ToHtml(d.title)}</h2>`;
    for (const b of d.buttons) {
      const btn = document.createElement('button');
      btn.innerHTML = wc3ToHtml(b.label);
      btn.addEventListener('click', () => this.game.chooseDifficulty(b.id));
      el.appendChild(btn);
    }
    const timer = document.createElement('div');
    timer.className = 'timer';
    el.appendChild(timer);
    this.dialogTimer = { end: this.game.time + d.timeout, el: timer };
    el.hidden = false;
  }

  showModal(title: string, html: string) {
    const el = $('modal');
    el.innerHTML = `<button class="close">✕</button><h2>${title}</h2>${html}`;
    el.querySelector('.close')!.addEventListener('click', () => (el.hidden = true));
    el.hidden = false;
  }

  showQuests() {
    const q = this.game.cfg.quests
      .map((x) => `<h3>${wc3ToHtml(x.title)}</h3><p>${wc3ToHtml(x.description)}</p><p><i>${wc3ToHtml(x.item)}</i></p>`)
      .join('');
    this.showModal('Quests', q);
  }

  showHelp() {
    this.showModal(
      'Ovládání',
      `<p><b>Levé tlačítko</b> – výběr jednotky / budovy, potvrzení stavby; <b>tažením</b> výběr více jednotek (max. 12, jednotky mají přednost před budovami), <b>Shift</b> přidá / odebere z výběru.
<b>Pravé tlačítko</b> – pohyb builderem, u věže vynucení cíle (útok na creepa).
<b>Šipky / okraj obrazovky / prostřední tlačítko</b> – posun kamery, <b>kolečko</b> – zoom.
<b>Klávesové zkratky</b> – jako ve hře (Q, W, E, R … podle pozice v command card), <b>Esc</b> – zrušit.
<b>F9</b> – questy, <b>R</b> – regiony a trasa creepů, <b>P</b> – pathing mapa, <b>Pause</b> – pauza, <b>Tab</b> – vybrat buildera.</p>
<p>Data mapy (terén, doodady, regiony, vlny, věže, odměny, triggery) jsou extrahována přímo z <i>${this.map.source}</i>.
Modely a textury jsou zástupné, dokud nejsou dodány originální herní soubory – viz <code>docs/IMPLEMENTACE.md</code>.</p>`,
    );
  }

  // --- per-frame ----------------------------------------------------------------------------------------

  update(selected: Unit | null) {
    const g = this.game;
    const p = g.players[this.localPlayer];
    $('gold').textContent = String(p?.gold ?? 0);
    $('lives').textContent = String(g.lives);
    const t = Math.floor(g.time);
    $('clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

    const now = performance.now();
    for (const m of this.messages) if (m.until - now < 600) m.el.style.opacity = '0';
    this.messages = this.messages.filter((m) => {
      if (m.until < now) {
        m.el.remove();
        return false;
      }
      return true;
    });

    if (this.dialogTimer) this.dialogTimer.el.textContent = `${Math.max(0, this.dialogTimer.end - g.time).toFixed(0)} s`;

    // Multiboard (Trig_Multiboard_Set / Timer_Update).
    const mb = $('multiboard');
    mb.hidden = !g.multiboardVisible;
    if (g.multiboardVisible) {
      const title = g.timerUpdate && g.nextWaveTimer ? `Wave ${g.wave} starting in: ${Math.max(0, g.nextWaveTimer.end - g.time).toFixed(3)}` : g.multiboardTitle;
      $('mb-title').innerHTML = wc3ToHtml(title);
      const rows = [`<tr><td></td><td colspan="2">${wc3ToHtml(`|CFF6DCFF6Lives:|r ${g.lives}`)}</td></tr>`, `<tr><td>${wc3ToHtml(g.str('TRIGSTR_327'))}</td><td class="num">${wc3ToHtml(g.str('TRIGSTR_328'))}</td><td class="num">${wc3ToHtml(g.str('TRIGSTR_329'))}</td></tr>`];
      g.players.forEach((pl, i) => {
        if (pl.playing) rows.push(`<tr><td style="color:${pl.color}">${pl.name}</td><td class="num">${pl.kills}</td><td class="num">${pl.gold}</td></tr>`);
        else rows.push(`<tr><td>${wc3ToHtml(g.str(['TRIGSTR_330', 'TRIGSTR_331', 'TRIGSTR_332'][i]))}</td><td class="num">-</td><td class="num">-</td></tr>`);
      });
      $('mb-table').innerHTML = rows.join('');
    }

    this.updateInfo(selected);
    this.updateGroup();
    this.updateCard(selected);
  }

  private updateInfo(u: Unit | null) {
    const el = $('info');
    if (!u || (!u.alive && u.owner !== CREEP_PLAYER)) {
      el.innerHTML = `<div class="k">${wc3ToHtml(this.map.info.name)}</div><div>${wc3ToHtml(this.map.info.description)}</div>`;
      return;
    }
    const d = u.def;
    const parts: string[] = [];
    parts.push(`<h3>${wc3ToHtml(d.name)}</h3>`);
    const owner = u.owner === CREEP_PLAYER ? 'Creeps' : u.owner < 3 ? this.game.players[u.owner].name : 'Neutral';
    parts.push(`<div class="k">${owner}${u.kind === 'creep' ? ` – level ${d.level}` : ''}</div>`);
    const progress = u.constructing ? u.constructing.elapsed / u.constructing.total : u.upgrading ? u.upgrading.elapsed / u.upgrading.total : u.queue[0] ? u.queue[0].elapsed / u.queue[0].total : null;
    if (progress !== null) {
      const what = u.constructing ? 'Constructing' : u.upgrading ? `Upgrading to ${this.game.db.unit(u.upgrading.to).name}` : u.queue[0].kind === 'train' ? `Training ${this.game.db.unit(u.queue[0].id).name}` : `Researching ${this.game.db.upgrade(u.queue[0].id).name(u.queue[0].level)}`;
      parts.push(`<div>${wc3ToHtml(what)}</div><div class="bar progress"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>`);
      if (u.queue.length > 1) parts.push(`<div class="k">Queue: ${u.queue.length}</div>`);
    }
    parts.push(`<div class="bar"><div style="width:${((u.hp / u.maxHp) * 100).toFixed(1)}%"></div></div><div>${Math.ceil(u.hp)} / ${u.maxHp}</div>`);
    const row: string[] = [];
    const a = d.attack;
    if (a) {
      const lo = a.damageBase + a.dice;
      const hi = a.damageBase + a.dice * a.sides;
      row.push(`<span><span class="k">Damage:</span> ${lo}-${hi} (${a.attackType})</span>`);
      row.push(`<span><span class="k">Cooldown:</span> ${a.cooldown.toFixed(2)} s</span>`);
      row.push(`<span><span class="k">Range:</span> ${a.range}</span>`);
      if (a.splashFull + a.splashMedium + a.splashSmall > 0) row.push(`<span><span class="k">Splash:</span> ${a.splashFull}/${a.splashMedium}/${a.splashSmall}</span>`);
    }
    if (u.kind === 'creep') {
      row.push(`<span><span class="k">Armor:</span> ${d.armor} (${d.defenseType})</span>`);
      row.push(`<span><span class="k">Speed:</span> ${d.speed}${u.slow ? ' (slowed)' : ''}</span>`);
      if (u.flying) row.push('<span class="k">Flying</span>');
      if (u.invisible) row.push('<span class="k">Invisible</span>');
      if (d.abilities.includes('Amim')) row.push('<span class="k">Spell immune</span>');
    }
    if (u.kills) row.push(`<span><span class="k">Kills:</span> ${u.kills}</span>`);
    parts.push(`<div class="row">${row.join('')}</div>`);
    const abil = d.abilities.filter((id) => !['Avul', 'A003', 'Ahrp'].includes(id) && this.game.db.hasAbility(id)).map((id) => this.game.db.ability(id).name);
    if (abil.length) parts.push(`<div class="k">Abilities: ${abil.map((x) => wc3ToHtml(x)).join(', ')}</div>`);
    if (d.description && u.kind !== 'creep') parts.push(`<div>${wc3ToHtml(d.description)}</div>`);
    el.innerHTML = parts.join('');
  }

  /** Multi-selection overview (like the unit grid in the WC3 console); click a unit to select only it. */
  private lastGroupKey = '';
  private updateGroup() {
    let el = document.getElementById('group');
    const units = this.group.filter((u) => u.alive);
    if (units.length < 2) {
      if (el) el.remove();
      this.lastGroupKey = '';
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'group';
      $('info').prepend(el);
    }
    const key = units.map((u) => `${u.uid}:${Math.round((u.hp / u.maxHp) * 20)}`).join('|');
    if (key === this.lastGroupKey) return;
    this.lastGroupKey = key;
    el.innerHTML = '';
    for (const u of units.slice(0, 12)) {
      const card = document.createElement('div');
      card.className = 'group-unit' + (u === units[0] ? ' primary' : '');
      card.title = plainText(u.def.name);
      card.innerHTML = `<span>${plainText(u.def.name)}</span><div class="bar"><div style="width:${((u.hp / u.maxHp) * 100).toFixed(0)}%"></div></div>`;
      if (u.def.icon) void this.iconUrl(u.def.icon).then((url) => url && (card.style.backgroundImage = `url(${url})`, card.classList.add('has-icon')));
      card.addEventListener('click', () => this.onSelect(u));
      el.appendChild(card);
    }
  }

  /** Selected own units of the same type as the primary one (shared commands like Stop apply to all of them). */
  private sameType(u: Unit) {
    const same = this.group.filter((x) => x.alive && x.owner === u.owner && x.def.id === u.def.id);
    return same.length ? same : [u];
  }

  // --- command card ----------------------------------------------------------------------------------

  private unitTooltip(def: UnitDef, cost: number, missing: string[]) {
    return `<div class="tt-title">${wc3ToHtml(def.tooltip || def.name)}</div>${cost ? `<div class="tt-cost">${cost} gold</div>` : ''}<div>${wc3ToHtml(def.description)}</div>${missing.length ? `<div class="tt-req">Requires: ${missing.join(', ')}</div>` : ''}`;
  }

  private buildCommands(u: Unit | null): Command[] {
    const g = this.game;
    const cmds: Command[] = [];
    if (!u || !u.alive || u.owner !== this.localPlayer) {
      if (u?.kind === 'shop') return this.shopCommands(u);
      return cmds;
    }
    const cancel = (run: () => void): Command => ({ x: 3, y: 2, label: 'Cancel', hotkey: 'ESCAPE', enabled: true, icon: 'ReplaceableTextures\\CommandButtons\\BTNCancel.blp', tooltip: () => 'Cancel', run });
    if (u.constructing || u.upgrading) return [cancel(() => g.cancel(u))];

    if (u.kind === 'builder') {
      if (this.submenu === 'build') {
        for (const id of u.def.builds) {
          const def = g.db.unit(id);
          const missing = g.missingRequirements(u.owner, def);
          cmds.push({
            x: def.buttonPos[0],
            y: def.buttonPos[1],
            label: plainText(def.name),
            hotkey: hotkeyOf(def),
            enabled: !missing.length,
            cost: def.gold,
            icon: def.icon,
            tooltip: () => this.unitTooltip(def, def.gold, missing),
            run: () => {
              if (missing.length) return this.addMessage(`|cffff4040Requires: ${missing.join(', ')}|r`, 3);
              this.mode = { kind: 'build', id };
            },
          });
        }
        cmds.push(cancel(() => (this.submenu = null)));
        return cmds;
      }
      cmds.push({ x: 0, y: 0, label: 'Move', hotkey: 'M', enabled: true, icon: 'ReplaceableTextures\\CommandButtons\\BTNMove.blp', tooltip: () => '<b>Move</b> (M)', run: () => (this.mode = { kind: 'target', ability: 'move' }) });
      cmds.push({ x: 1, y: 0, label: 'Stop', hotkey: 'S', enabled: true, icon: 'ReplaceableTextures\\CommandButtons\\BTNStop.blp', tooltip: () => '<b>Stop</b> (S)', run: () => this.sameType(u).forEach((x) => g.stop(x)) });
      if (u.def.builds.length) cmds.push({ x: 0, y: 2, label: 'Build', hotkey: 'B', enabled: true, icon: 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp', tooltip: () => '<b>Build Tower</b> (B)', run: () => (this.submenu = 'build') });
      for (const id of u.def.abilities) {
        const ab = g.db.ability(id);
        if (ab.base === 'Arav') {
          const toAir = u.def.id !== String(ab.fields['Emeu@1'] ?? 'h018');
          cmds.push({ x: Number(ab.fields.abpx ?? 2), y: 2, label: toAir ? 'Fly' : 'Land', icon: String(toAir ? ab.fields.aart ?? '' : ab.fields.auar ?? ''), hotkey: hotkeyOf({ hotkey: String(toAir ? ab.fields.ahky ?? '' : ab.fields.auhk ?? ''), tooltip: String(toAir ? ab.fields['atp1@1'] ?? '' : ab.fields['aut1@1'] ?? '') }), enabled: true, tooltip: () => `<div class="tt-title">${wc3ToHtml(String(toAir ? ab.fields['atp1@1'] ?? 'Fly' : ab.fields['aut1@1'] ?? 'Land'))}</div>${wc3ToHtml(String(toAir ? ab.fields['aub1@1'] ?? '' : ab.fields['auu1@1'] ?? ''))}`, run: () => g.morph(u) });
        }
        if (id === g.cfg.coinBasherAbility) {
          const cd = Math.max(0, (u.abilityCd[id] ?? 0) - g.time);
          cmds.push({ x: Number(ab.fields.abpx ?? 3), y: Number(ab.fields.abpy ?? 0) === 0 ? 2 : Number(ab.fields.abpy), label: cd ? `${ab.name} (${cd.toFixed(0)})` : ab.name, icon: ab.icon, hotkey: hotkeyOf({ hotkey: String(ab.fields.ahky ?? ''), tooltip: ab.tooltip }), enabled: cd === 0, cost: g.wave, tooltip: () => `<div class="tt-title">${wc3ToHtml(ab.tooltip)}</div><div class="tt-cost">${g.wave} gold</div>${wc3ToHtml(ab.description)}`, run: () => (this.mode = { kind: 'target', ability: 'coin' }) });
        }
      }
      return cmds;
    }

    if (u.kind === 'tower') {
      for (const to of u.def.upgradesTo) {
        const def = g.db.unit(to);
        const missing = g.missingRequirements(u.owner, def);
        cmds.push({ x: def.buttonPos[0], y: def.buttonPos[1], label: `↑ ${plainText(def.name)}`, hotkey: hotkeyOf(def), enabled: !missing.length, cost: g.upgradeCost(u, to), icon: def.icon, tooltip: () => this.unitTooltip(def, g.upgradeCost(u, to), missing), run: () => this.report(g.upgrade(u, to)) });
      }
      const sell = g.db.ability(g.cfg.sellAbility);
      if (u.def.abilities.includes(g.cfg.sellAbility)) {
        const value = Math.trunc(u.def.pointValue * g.cfg.sellRatio);
        cmds.push({ x: Number(sell.fields.abpx ?? 3), y: 2, label: `${sell.name} +${value}`, icon: sell.icon, hotkey: hotkeyOf({ hotkey: String(sell.fields.ahky ?? ''), tooltip: sell.tooltip }), enabled: true, tooltip: () => `<div class="tt-title">${wc3ToHtml(sell.tooltip)}</div>${wc3ToHtml(sell.description)}<div class="tt-cost">+${value} gold</div>`, run: () => g.sell(u) });
      }
      cmds.push({ x: 1, y: 0, label: 'Stop', hotkey: 'S', enabled: true, tooltip: () => '<b>Stop</b> – clear forced target', run: () => this.sameType(u).forEach((x) => g.stop(x)) });
      return cmds;
    }

    if (u.kind === 'spawning') {
      for (const id of u.def.trains) {
        const def = g.db.unit(id);
        const missing = g.missingRequirements(u.owner, def);
        cmds.push({ x: def.buttonPos[0], y: def.buttonPos[1], label: plainText(def.name), hotkey: hotkeyOf(def), enabled: !missing.length, cost: def.gold, icon: def.icon, tooltip: () => this.unitTooltip(def, def.gold, missing), run: () => this.report(g.train(u, id)) });
      }
      for (const id of u.def.researches) {
        const up = g.db.upgrade(id);
        const lvl = (g.players[u.owner].research[id] ?? 0) + u.queue.filter((q) => q.id === id).length + 1;
        const done = lvl > up.levels;
        const l = Math.min(lvl, up.levels);
        cmds.push({
          x: up.buttonPos[0],
          y: up.buttonPos[1],
          label: plainText(up.name(l)) + (done ? ' ✓' : ''),
          hotkey: hotkeyOf({ hotkey: String(up.fields[`ghk1@${l}`] ?? ''), tooltip: up.tooltip(l) }),
          enabled: !done,
          cost: done ? undefined : up.gold(l),
          icon: up.icon(l),
          tooltip: () => `<div class="tt-title">${wc3ToHtml(up.tooltip(l) || up.name(l))}</div>${done ? '' : `<div class="tt-cost">${up.gold(l)} gold, ${up.time(l)} s</div>`}${wc3ToHtml(up.description(l))}`,
          run: () => this.report(g.research(u, id)),
        });
      }
      if (u.queue.length) cmds.push(cancel(() => g.cancel(u)));
      return cmds;
    }

    if (u.kind === 'defender') {
      cmds.push({ x: 0, y: 0, label: 'Move', hotkey: 'M', enabled: true, tooltip: () => '<b>Move</b> (M)', run: () => (this.mode = { kind: 'target', ability: 'move' }) });
      cmds.push({ x: 1, y: 0, label: 'Stop', hotkey: 'S', enabled: true, tooltip: () => '<b>Stop</b> (S)', run: () => this.sameType(u).forEach((x) => g.stop(x)) });
    }
    return cmds;
  }

  private shopCommands(shop: Unit): Command[] {
    const g = this.game;
    return shop.def.sells.map((id) => {
      const def = g.db.unit(id);
      const s = g.shopStock[id];
      return {
        x: def.buttonPos[0],
        y: def.buttonPos[1],
        label: `${plainText(def.name)} (${s?.stock ?? 0})`,
        hotkey: hotkeyOf(def),
        enabled: (s?.stock ?? 0) > 0,
        cost: def.gold,
        icon: def.icon,
        tooltip: () => this.unitTooltip(def, def.gold, []) + (s && s.stock < s.max && s.nextAt ? `<div class="k">Restock in ${Math.max(0, s.nextAt - g.time).toFixed(0)} s</div>` : ''),
        run: () => this.report(g.buy(this.localPlayer, id)),
      };
    });
  }

  report(err: string | null) {
    if (err) this.addMessage(`|cffff4040${err}|r`, 3);
  }

  private updateCard(u: Unit | null) {
    this.commands = this.buildCommands(u);
    // Resolve slot collisions (button positions come from object data).
    const used = new Set<string>();
    for (const c of this.commands) {
      let key = `${c.x},${c.y}`;
      if (used.has(key)) {
        outer: for (let y = 0; y < 3; y++)
          for (let x = 0; x < 4; x++)
            if (!used.has(`${x},${y}`)) {
              c.x = x;
              c.y = y;
              break outer;
            }
        key = `${c.x},${c.y}`;
      }
      used.add(key);
    }
    const cardKey = this.commands.map((c) => `${c.x}${c.y}${c.label}${c.enabled}${c.cost}`).join('|') + (u?.uid ?? '');
    if (cardKey === this.lastCardKey) return;
    this.lastCardKey = cardKey;
    const card = $('card');
    card.innerHTML = '';
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const c = this.commands.find((k) => k.x === x && k.y === y);
        const el = document.createElement('div');
        el.className = 'cmd' + (c ? (c.enabled ? '' : ' disabled') : ' empty');
        if (c) {
          el.innerHTML = `<span class="hk">${c.hotkey === 'ESCAPE' ? 'Esc' : c.hotkey}</span><span class="lbl">${c.label}</span>${c.cost ? `<span class="cost">${c.cost}</span>` : ''}`;
          el.addEventListener('click', () => c.run());
          if (c.icon) void this.iconUrl(c.icon).then((url) => url && (el.style.backgroundImage = `url(${url})`, el.classList.add('has-icon')));
          el.addEventListener('mouseenter', () => this.showTooltip(c.tooltip()));
          el.addEventListener('mouseleave', () => this.showTooltip(null));
        }
        card.appendChild(el);
      }
    }
  }

  /** Decodes a BLP icon from the game files into a data URL (only when assets are installed). */
  private iconUrl(path: string) {
    if (!this.assets || !path) return Promise.resolve(null);
    const key = path.replace(/\.(tga|blp)$/i, '') + '.blp';
    let p = this.icons.get(key);
    if (!p) {
      p = this.assets.decodeImage(key).then((img) => {
        if (!img) return null;
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        cv.getContext('2d')!.putImageData(img, 0, 0);
        return cv.toDataURL();
      });
      this.icons.set(key, p);
    }
    return p;
  }

  showTooltip(html: string | null) {
    const el = $('tooltip');
    el.hidden = !html;
    if (html) el.innerHTML = html;
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'F9') {
      e.preventDefault();
      this.showQuests();
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      this.showHelp();
      return;
    }
    if (e.key === 'Pause' || e.key === 'F10') {
      this.togglePause();
      return;
    }
    if (e.key === 'Escape') {
      if (this.mode.kind !== 'normal') this.mode = { kind: 'normal' };
      else if (this.submenu) this.submenu = null;
      else if (!$('modal').hidden) $('modal').hidden = true;
      else this.commands.find((c) => c.hotkey === 'ESCAPE')?.run();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const b = this.game.units.find((u) => u.kind === 'builder' && u.owner === this.localPlayer && u.alive);
      if (b) this.onSelect(b);
      return;
    }
    const k = e.key.length === 1 ? e.key.toUpperCase() : '';
    const c = k && this.commands.find((x) => x.hotkey === k);
    if (c) {
      e.preventDefault();
      c.run();
    }
  }
}
