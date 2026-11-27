import type { Game, Unit } from '../game/game';
import { CREEP_PLAYER, ERR } from '../game/game';
import { plainText, wc3ToHtml, type UnitDef } from '../data/objects';
import type { MapData } from '../data/types';
import type { Wc3Assets } from '../render/mdx';
import { applyKeys, type KeyEntry, type KeyLayout, type KeyRef } from './customkeys';

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
  /** Current order – green frame (human-activebutton). */
  active?: boolean;
  /** Autocast switched on – animated golden corners. */
  autocast?: boolean;
  /** Small number in the corner (shop stock). */
  count?: number;
  /** Right click (autocast toggle); without it a right click on an autocast button runs it. */
  rightClick?: () => void;
  /** Remaining cooldown 0–1: dark clock sweep over the icon (UI\Feedback\Cooldown\UI-Cooldown-Indicator.mdl). */
  cooldown?: number;
  /** CustomKeys.txt sections of the button. */
  keys?: KeyRef;
}

const $ = (id: string) => document.getElementById(id)!;
const CB = 'ReplaceableTextures\\CommandButtons\\';
const W = 'UI\\Widgets\\Console\\Human\\';
const HK = (k: string) => `|cffffcc00${k}|r`;

/** UI\war3skins.txt InfoPanelIconDamage* / InfoPanelIconArmor* (attack / defense type → info card icon). */
const ATTACK_ICON: Record<string, string> = { normal: 'melee', pierce: 'piercing', siege: 'siege', magic: 'magic', chaos: 'chaos', hero: 'hero', spells: 'magic' };
const ARMOR_ICON: Record<string, string> = { small: 'small', medium: 'medium', large: 'large', fort: 'fortified', normal: 'small', hero: 'hero', divine: 'divine', none: 'unarmored' };
const ATTACK_NAME: Record<string, string> = { normal: 'Normální', pierce: 'Průrazný', siege: 'Obléhací', magic: 'Magický', chaos: 'Chaos', hero: 'Hrdinský', spells: 'Kouzla' };
const ARMOR_NAME: Record<string, string> = { small: 'Lehká', medium: 'Střední', large: 'Těžká', fort: 'Opevněná', normal: 'Normální', hero: 'Hrdinská', divine: 'Božská', none: 'Žádná' };

function hotkeyOf(def: { hotkey: string; tooltip: string }) {
  if (def.hotkey && def.hotkey.length === 1) return def.hotkey.toUpperCase();
  const m = /\|c[0-9a-f]{8}(\w)\|r/i.exec(def.tooltip);
  return m ? m[1].toUpperCase() : '';
}

/** Shows the TexCoord sub-rectangle of a texture stretched over the element (FDF "TexCoord u0, u1, v0, v1"). */
function subTexture(el: HTMLElement, url: string, u0: number, u1: number, v0: number, v1: number) {
  const pos = (a: number, span: number) => (span >= 1 ? 0 : (a / (1 - span)) * 100);
  el.style.backgroundImage = `url(${url})`;
  el.style.backgroundSize = `${100 / (u1 - u0)}% ${100 / (v1 - v0)}%`;
  el.style.backgroundPosition = `${pos(u0, u1 - u0)}% ${pos(v0, v1 - v0)}%`;
}

const hpColor = (ratio: number) => (ratio > 0.66 ? '#20ff20' : ratio > 0.33 ? '#ffe020' : '#ff2020');

/**
 * DOM HUD imitating the Warcraft III (TFT 1.26) Human console: console textures from the game files laid out
 * per UI\FrameDef\UI\ConsoleUI.fdf, upper menu buttons, resource bar, day/night clock, multiboard, minimap with
 * its buttons, 3D portrait hole, info panel, 4×3 command card and tooltips.
 */
export class Hud {
  mode: { kind: 'normal' } | { kind: 'ping' } | { kind: 'build'; id: string } | { kind: 'target'; ability: 'coin' | 'attack' | 'move' | 'drain' | 'storm' | 'repair'; id?: string } = { kind: 'normal' };
  /** Minimap buttons: terrain (Alt+T), ally colours (Alt+A), creeps (Alt+C), formation movement (Alt+F). */
  /** allyColors like the game: 0 = player colours, 1 = ally colours on the minimap only, 2 = minimap and units. */
  readonly minimapOpts = { terrain: true, allyColors: 0 as 0 | 1 | 2, creeps: true, formation: false };
  /** Minimap signals (Alt+G): position and start (performance.now()). */
  private pings: { x: number; y: number; start: number }[] = [];
  /** White ping textures of Minimap-Ping.mdl (ring, converging arrows), tinted per colour on demand. */
  private pingImgs: { ring: HTMLImageElement; arrows: HTMLImageElement } | null = null;
  private tinted = new Map<string, HTMLCanvasElement>();
  /** A signal was placed (the renderer plays the MapPing sound). */
  onPing: (x: number, y: number) => void = () => {};
  /** Ally colour mode changed (units are recoloured: you blue, allies teal, enemies red). */
  onAllyColors: (on: boolean) => void = () => {};
  submenu: 'build' | null = null;
  private commands: Command[] = [];
  private messages: { el: HTMLElement; until: number }[] = [];
  private minimapImg = new Image();
  private minimapCtx: CanvasRenderingContext2D;
  private dialogTimer: { end: number; el: HTMLElement } | null = null;
  private lastCardKey = '';
  private lastInfoKey = '';
  private lastMbKey = '';
  private icons = new Map<string, Promise<string | null>>();
  private coinUrl = '';
  private pausedByMenu = false;
  onSelect: (u: Unit | null) => void = () => {};
  /** The game menu was opened (it starts on its main panel). */
  onMenuOpen: () => void = () => {};
  /** Error reported to the player (a sound accompanies the red message in the game). */
  onError: (err: string) => void = () => {};
  /** A command button was pressed (interface click sound). */
  onCommand: () => void = () => {};
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
      if (this.mode.kind === 'ping') {
        const rect = mm.getBoundingClientRect();
        const [x, y] = this.fromMinimap(((e.clientX - rect.left) / rect.width) * 256, ((e.clientY - rect.top) / rect.height) * 256);
        this.ping(x, y);
        this.mode = { kind: 'normal' };
        return;
      }
      if (e.button !== 0) return;
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
    game.on('quest', () => this.addMessage(`|cffffcc00Úkoly byly aktualizovány (F9).|r`, 6));
    game.on('end', (e) => this.showEnd(e.victory, e.text));
    game.on('completed', (u) => {
      if (u.owner === this.localPlayer) this.addMessage(`|cffffcc00Dokončeno: ${plainText(u.def.name)}|r`, 6, 'sys-messages');
    });

    $('btn-quests').addEventListener('click', () => this.showQuests());
    $('btn-menu').addEventListener('click', () => this.toggleMenu());
    $('btn-menu-close').addEventListener('click', () => this.toggleMenu(false));
    $('btn-allies').addEventListener('click', () => this.showAllies());
    $('btn-chat').addEventListener('click', () => this.openChat());
    const chatInput = $('chat-input') as HTMLInputElement;
    chatInput.addEventListener('keydown', (e) => {
      // Typing must not reach hotkeys, camera keys or control groups.
      e.stopPropagation();
      if (e.key === 'Enter') {
        this.sendChat(chatInput.value);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    chatInput.addEventListener('blur', () => this.closeChat());
    $('btn-help').addEventListener('click', () => {
      this.toggleMenu(false);
      this.showHelp();
    });
    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('idle-worker').addEventListener('click', () => this.selectBuilder());
    $('mb-min').addEventListener('click', () => $('multiboard').classList.toggle('minimized'));
    for (const id of ['mm-ping', 'mm-terrain', 'mm-ally', 'mm-creep', 'mm-formation']) $(id).addEventListener('mousedown', (e) => e.stopPropagation());
    $('mm-ping').addEventListener('click', () => this.toggleMinimapOption('ping'));
    $('mm-terrain').addEventListener('click', () => this.toggleMinimapOption('terrain'));
    $('mm-ally').addEventListener('click', () => this.toggleMinimapOption('allyColors'));
    $('mm-creep').addEventListener('click', () => this.toggleMinimapOption('creeps'));
    $('mm-formation').addEventListener('click', () => this.toggleMinimapOption('formation'));

    addEventListener('keydown', (e) => this.onKey(e));
    const layout = () => {
      const app = $('app');
      app.style.setProperty('--sx', `${innerWidth / 0.8}px`);
      app.style.setProperty('--sy', `${innerHeight / 0.6}px`);
    };
    addEventListener('resize', layout);
    layout();
    void this.setupTextures();
  }

  // --- console textures ------------------------------------------------------------------------------

  private async setupTextures() {
    if (!this.assets) {
      $('ui').classList.add('no-assets');
      return;
    }
    const T = (n: number) => `UI\\Console\\Human\\HumanUITile0${n}.blp`;
    // UI\FrameDef\UI\ConsoleUI.fdf: top strip = v 0..0.125, bottom = v 0.3125..1 (tile 2: 0.4140625..1).
    const tiles: [string, string, number, number, number, number][] = [
      ['t1-top', T(1), 0, 1, 0, 0.125],
      ['t2-top-l', T(2), 0, 0.33984375, 0, 0.125],
      ['t2-top-r', T(2), 0.79296875, 1, 0, 0.125],
      ['t3-top', T(3), 0, 1, 0, 0.125],
      ['t4-top', T(4), 0, 1, 0, 0.125],
      ['t1-bottom', T(1), 0, 1, 0.3125, 1],
      ['t2-bottom', T(2), 0, 1, 0.4140625, 1],
      ['t3-bottom', T(3), 0, 1, 0.3125, 1],
      ['t4-bottom', T(4), 0, 1, 0.3125, 1],
      ['clock-frame', 'UI\\Console\\Human\\HumanUITile-TimeIndicatorFrame.blp', 0, 1, 0, 1],
      ['inventory-cover', 'UI\\Console\\Human\\HumanUITile-InventoryCover.blp', 0, 1, 0, 1],
    ];
    for (const [id, path, u0, u1, v0, v1] of tiles) void this.iconUrl(path).then((url) => url && subTexture($(id), url, u0, u1, v0, v1));
    const bg = (el: HTMLElement, path: string) => void this.iconUrl(path).then((url) => url && (el.style.backgroundImage = `url(${url})`));
    bg($('clock-sky'), 'UI\\Console\\Human\\HumanUITile-TimeIndicator.blp');
    document.querySelectorAll<HTMLElement>('button.upper').forEach((el) => bg(el, `${W}human-console-buttonstates2.blp`));
    bg($('ri-gold'), 'UI\\Feedback\\Resources\\ResourceGold.blp');
    bg($('ri-lumber'), 'UI\\Feedback\\Resources\\ResourceLumber.blp');
    bg($('ri-supply'), 'UI\\Feedback\\Resources\\ResourceSupply.blp');
    bg($('mb-min'), 'UI\\Widgets\\Glues\\Gluescreen-Scrollbar-UpArrow.blp');
    this.refreshMinimapButtons();
    void Promise.all(['ping2', 'ping5'].map((n) => this.iconUrl(`UI\\MiniMap\\${n}.blp`))).then(([ring, arrows]) => {
      if (!ring || !arrows) return;
      const img = (src: string) => Object.assign(new Image(), { src });
      this.pingImgs = { ring: img(ring), arrows: img(arrows) };
    });
    bg($('idle-worker'), `${CB}BTNPeasant.blp`);
    this.coinUrl = (await this.iconUrl('UI\\Widgets\\ToolTips\\Human\\ToolTipGoldIcon.blp')) ?? '';
    // Backdrops (BackdropEdgeFile = 8 square pieces: L, R, T, B, UL, UR, BL, BR; T and B are stored rotated).
    const [box, boxBg, tip, tipBg, panel, panelBg] = await Promise.all([
      this.edgeImage('UI\\Widgets\\EscMenu\\Human\\editbox-border.blp'),
      this.iconUrl('UI\\Widgets\\EscMenu\\Human\\editbox-background.blp'),
      this.edgeImage('UI\\Widgets\\ToolTips\\Human\\human-tooltip-border.blp'),
      this.iconUrl('UI\\Widgets\\ToolTips\\Human\\human-tooltip-background.blp'),
      this.edgeImage('UI\\Widgets\\EscMenu\\Human\\human-options-menu-border.blp'),
      this.iconUrl('UI\\Widgets\\EscMenu\\Human\\human-options-menu-background.blp'),
    ]);
    const css: string[] = [];
    if (box) css.push(`.wc3-box { border-image-source: url(${box.url}); border-image-slice: ${box.size}; }`);
    if (boxBg) css.push(`.wc3-box::before { background-image: url(${boxBg}); }`);
    if (tip) css.push(`.wc3-tooltip { border-image-source: url(${tip.url}); border-image-slice: ${tip.size}; }`);
    if (tipBg) css.push(`.wc3-tooltip::before { background-image: url(${tipBg}); }`);
    if (panel) css.push(`.wc3-panel { border-image-source: url(${panel.url}); border-image-slice: ${panel.size}; }`);
    if (panelBg) css.push(`.wc3-panel::before { background-image: url(${panelBg}); }`);
    const style = document.createElement('style');
    style.textContent = css.join('\n');
    document.head.appendChild(style);
  }

  /** Converts a WC3 backdrop edge file into a 3×3 nine-slice image for CSS border-image. */
  private async edgeImage(path: string): Promise<{ url: string; size: number } | null> {
    const img = await this.assets?.decodeImage(path);
    if (!img) return null;
    const s = img.height;
    const src = document.createElement('canvas');
    src.width = img.width;
    src.height = img.height;
    src.getContext('2d')!.putImageData(img, 0, 0);
    const cv = document.createElement('canvas');
    cv.width = cv.height = s * 3;
    const ctx = cv.getContext('2d')!;
    const piece = (i: number, dx: number, dy: number, rotate = false) => {
      if (!rotate) return ctx.drawImage(src, i * s, 0, s, s, dx, dy, s, s);
      ctx.save();
      ctx.translate(dx + s, dy);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(src, i * s, 0, s, s, 0, 0, s, s);
      ctx.restore();
    };
    piece(4, 0, 0);
    piece(2, s, 0, true);
    piece(5, 2 * s, 0);
    piece(0, 0, s);
    piece(1, 2 * s, s);
    piece(6, 0, 2 * s);
    piece(3, s, 2 * s, true);
    piece(7, 2 * s, 2 * s);
    return { url: cv.toDataURL(), size: s };
  }

  /**
   * Decodes a BLP (or HD PNG) texture from the game files into a data URL. Info card icons carry an empty
   * upgrade-level box in their lower right corner, which the game covers – it is replaced by the mirrored
   * lower left quadrant (frame + background).
   */
  private iconUrl(path: string) {
    if (!this.assets || !path) return Promise.resolve(null);
    const key = path.replace(/\.(tga|blp|dds|png)$/i, '') + '.blp';
    let p = this.icons.get(key);
    if (!p) {
      const infocard = /\\infocard-/i.test(key);
      p = this.assets.decodeImage(key).then((img) => {
        if (!img) return null;
        if (infocard) {
          const { width: w, height: h, data } = img;
          const x0 = Math.floor(w * 0.56);
          const y0 = Math.floor(h * 0.56);
          for (let y = y0; y < h; y++)
            for (let x = x0; x < w; x++) {
              const d = (y * w + x) * 4;
              const s = (y * w + (w - 1 - x)) * 4;
              for (let c = 0; c < 4; c++) data[d + c] = data[s + c];
            }
        }
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        cv.getContext('2d')!.putImageData(img, 0, 0);
        // toBlob encodes off the main thread (toDataURL blocks a frame for every new icon); icons are kept for the session.
        return new Promise<string | null>((resolve) => cv.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null)));
      });
      this.icons.set(key, p);
    }
    return p;
  }

  private applyIcons(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
      void this.iconUrl(el.dataset.icon!).then((url) => url && (el.style.backgroundImage = `url(${url})`));
    });
  }

  // --- menus -----------------------------------------------------------------------------------------

  togglePause() {
    this.game.paused = !this.game.paused;
    this.pausedByMenu = false;
    $('btn-pause').classList.toggle('on', this.game.paused);
    $('btn-pause').textContent = this.game.paused ? 'Pokračovat ve hře (Pause)' : 'Pozastavit hru (Pause)';
  }

  /** Nabídka (F10): like the single-player game menu it pauses the game while open. */
  toggleMenu(open = $('menu').hidden) {
    const el = $('menu');
    if (open === !el.hidden) return;
    el.hidden = !open;
    if (open) this.onMenuOpen();
    if (open && !this.game.paused) {
      this.game.paused = true;
      this.pausedByMenu = true;
    } else if (!open && this.pausedByMenu) {
      this.game.paused = false;
      this.pausedByMenu = false;
    }
  }

  private selectBuilder() {
    const b = this.game.units.find((u) => u.kind === 'builder' && u.owner === this.localPlayer && u.alive);
    if (b) this.onSelect(b);
  }

  // --- minimap -------------------------------------------------------------------------------------

  /** Button textures follow the state like the game (active / inactive, ally colours off / on, formation off / on). */
  private refreshMinimapButtons() {
    const o = this.minimapOpts;
    const set = (id: string, file: string) => void this.iconUrl(`${W}${file}.blp`).then((url) => url && ($(id).style.backgroundImage = `url(${url})`));
    set('mm-ping', this.mode.kind === 'ping' ? 'human-minimap-ping-active-down' : 'human-minimap-ping-active');
    set('mm-terrain', `human-minimap-terrain-${o.terrain ? 'active' : 'inactive'}`);
    set('mm-ally', `human-minimap-ally-${['off', 'inactive', 'active'][o.allyColors]}`);
    set('mm-creep', `human-minimap-creep-${o.creeps ? 'active' : 'inactive'}`);
    set('mm-formation', `human-formation-${o.formation ? 'on' : 'off'}`);
  }

  toggleMinimapOption(which: 'ping' | keyof Hud['minimapOpts']) {
    this.onCommand();
    if (which === 'ping') this.mode = this.mode.kind === 'ping' ? { kind: 'normal' } : { kind: 'ping' };
    else if (which === 'allyColors') {
      const o = this.minimapOpts;
      o.allyColors = ((o.allyColors + 1) % 3) as 0 | 1 | 2;
      this.onAllyColors(o.allyColors === 2);
      const text = ['Barvy hráčů', 'Barvy spojenců na minimapě', 'Barvy spojenců na minimapě i na jednotkách'][o.allyColors];
      this.addMessage(`|cffffcc00${text}|r`, 3, 'sys-messages');
    } else this.minimapOpts[which] = !this.minimapOpts[which];
    this.refreshMinimapButtons();
  }

  /** Signal on the minimap (pulsing ping icon for 4 s, like Alt+G in the game). */
  ping(x: number, y: number) {
    this.pings.push({ x, y, start: performance.now() });
    this.onPing(x, y);
    this.refreshMinimapButtons();
  }

  /** The white texture multiplied by a colour (the engine tints the ping model with the player colour). */
  private tint(img: HTMLImageElement, color: string) {
    const key = `${img.src.length}|${img.src.slice(-32)}|${color}`;
    let cv = this.tinted.get(key);
    if (!cv && img.complete && img.width) {
      cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const c = cv.getContext('2d')!;
      c.drawImage(img, 0, 0);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = color;
      c.fillRect(0, 0, cv.width, cv.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(img, 0, 0);
      this.tinted.set(key, cv);
    }
    return cv ?? null;
  }

  /** Minimap colour of a unit: player colours, or with ally colours you blue, allies teal, enemies red. */
  private dotColor(owner: number) {
    if (owner === CREEP_PLAYER) return '#ff2020';
    if (owner >= CREEP_PLAYER) return '#ffff80';
    if (this.minimapOpts.allyColors) return owner === this.localPlayer ? '#0042ff' : '#1ce6b9';
    return this.game.players[owner].color;
  }

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
    if (this.minimapImg.complete && this.minimapOpts.terrain) {
      const { s, ox, oy } = this.minimapScale();
      const p = this.playable;
      ctx.drawImage(this.minimapImg, ox, oy, (p.maxX - p.minX) * s, (p.maxY - p.minY) * s);
    }
    for (const u of this.game.units) {
      if (!u.alive || u.hidden || (u.owner === CREEP_PLAYER && !this.minimapOpts.creeps)) continue;
      const [x, y] = this.toMinimap(u.x, u.y);
      const size = u.kind === 'tower' || u.kind === 'spawning' || u.kind === 'shop' ? 5 : 3;
      ctx.fillStyle = this.dotColor(u.owner);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.start < 4000);
    for (const p of this.pings) {
      const [x, y] = this.toMinimap(p.x, p.y);
      // Like Minimap-Ping.mdl: a ring pulsing outwards and four arrows converging on the point, ~1 s per cycle.
      const t = ((now - p.start) % 1000) / 1000;
      const color = this.minimapOpts.allyColors ? '#0042ff' : this.game.players[this.localPlayer]?.color ?? '#20ff20';
      const ring = this.pingImgs && this.tint(this.pingImgs.ring, color);
      const arrows = this.pingImgs && this.tint(this.pingImgs.arrows, color);
      ctx.save();
      if (ring && arrows) {
        // The ping textures are additive (black = transparent), like the model's Additive layers.
        ctx.globalCompositeOperation = 'lighter';
        const r = 6 + t * 18;
        ctx.globalAlpha = 1 - t * 0.8;
        ctx.drawImage(ring, x - r, y - r, r * 2, r * 2);
        const a = 26 - t * 14;
        ctx.globalAlpha = Math.min(1, 0.4 + t);
        ctx.drawImage(arrows, x - a, y - a, a * 2, a * 2);
      } else {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4 + t * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (view.length === 4) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
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

  // --- chat ----------------------------------------------------------------------------------------

  openChat() {
    const box = $('chat');
    box.hidden = false;
    ($('chat-input') as HTMLInputElement).focus();
  }

  private closeChat() {
    const input = $('chat-input') as HTMLInputElement;
    input.value = '';
    $('chat').hidden = true;
    input.blur();
  }

  /** Chat message to all players: "[Všem] name: text" with the name in the player's colour (no other players here). */
  private sendChat(text: string) {
    const msg = text.trim();
    if (!msg) return;
    const p = this.game.players[this.localPlayer];
    const hex = (p?.color ?? '#ffffff').replace('#', '');
    this.addMessage(`[Všem] |cff${hex}${p?.name ?? ''}|r: ${msg.replace(/\|/g, '||')}`, 15);
  }

  // --- messages / dialogs ----------------------------------------------------------------------------

  addMessage(text: string, duration = 10, container = 'messages') {
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = wc3ToHtml(text);
    $(container).appendChild(el);
    this.messages.push({ el, until: performance.now() + duration * 1000 });
    const mine = this.messages.filter((m) => m.el.parentElement?.id === container);
    if (mine.length > 8) {
      mine[0].el.remove();
      this.messages = this.messages.filter((m) => m !== mine[0]);
    }
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

  /**
   * End of the game (CustomVictoryBJ / CustomDefeatBJ): score screen like the game's (ScoreScreen.fdf) – tabs
   * Overview / Units / Heroes / Resources with a row per player, and a graph of the score over time.
   */
  showEnd(victory: boolean, text: string) {
    const g = this.game;
    if (!g.ended) g.sampleScores();
    const players = g.players.filter((p) => p.playing);
    const t = Math.floor(g.time);
    const time = `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const name = (p: (typeof players)[number]) => `<td class="score-player" style="color:${p.color}">${p.name}</td>`;
    const table = (cols: string[], row: (p: (typeof players)[number]) => (string | number)[]) =>
      `<table class="score-table"><tr><th>Hráč</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${players.map((p) => `<tr>${name(p)}${row(p).map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</table>`;
    const tabs: Record<string, () => string> = {
      Přehled: () =>
        table(['Jednotky', 'Hrdinové', 'Suroviny', 'Celkové skóre'], (p) => {
          const s = g.score(p);
          return [s.units, s.heroes, s.resources, `<b>${s.total}</b>`];
        }) + `<p class="score-summary">Dosažená vlna ${Math.min(g.wave, g.cfg.lastWave)} / ${g.cfg.lastWave} · zbývající životy ${g.lives} · délka hry ${time}</p>`,
      Jednotky: () => table(['Vyrobené jednotky', 'Zabité jednotky', 'Postavené budovy', 'Zničené budovy', 'Největší armáda'], (p) => [p.trained, p.kills, p.built, 0, p.largestArmy]),
      Hrdinové: () => table(['Hrdinové', 'Zabití hrdinové', 'Získané předměty', 'Najatí žoldnéři', 'Získané zkušenosti'], (p) => [0, 0, p.bought, 0, 0]),
      Suroviny: () => table(['Získané zlato', 'Získané dřevo', 'Obchodované suroviny', 'Daň za údržbu'], (p) => [p.earned, 0, 0, 0]),
      Graf: () => this.scoreGraph(players, this.graphMetric),
    };
    const el = $('end-screen');
    el.className = `wc3-panel ${victory ? 'victory' : 'defeat'}`;
    const render = (tab: string) => {
      el.innerHTML = `<h1>${victory ? 'Vítězství!' : 'Porážka!'}</h1><p class="end-text">${wc3ToHtml(text)}</p><div class="score-tabs">${Object.keys(tabs).map((k) => `<button class="score-tab${k === tab ? ' active' : ''}" data-tab="${k}">${k}</button>`).join('')}</div><div class="score-body">${tabs[tab]()}</div><div class="end-buttons"><button id="end-continue">Pokračovat</button><button id="end-restart">Hrát znovu</button></div>`;
      el.querySelectorAll<HTMLElement>('.score-tab').forEach((b) => b.addEventListener('click', () => render(b.dataset.tab!)));
      el.querySelectorAll<HTMLElement>('.graph-metric').forEach((b) =>
        b.addEventListener('click', () => {
          this.graphMetric = b.dataset.metric as typeof this.graphMetric;
          render('Graf');
        }),
      );
      $('end-continue').addEventListener('click', () => (el.hidden = true));
      $('end-restart').addEventListener('click', () => location.reload());
    };
    render('Přehled');
    el.hidden = false;
  }

  private graphMetric: 'units' | 'resources' | 'total' = 'total';

  /** Score over time (samples every 10 s) as an SVG line chart, one line per player in the player colour. */
  private scoreGraph(players: Game['players'], metric: 'units' | 'resources' | 'total') {
    const W = 600;
    const H = 220;
    const pad = 36;
    const end = Math.max(1, ...players.flatMap((p) => p.history.map((s) => s.t)));
    const top = Math.max(10, ...players.flatMap((p) => p.history.map((s) => s[metric])));
    const x = (t: number) => pad + (t / end) * (W - pad - 8);
    const y = (v: number) => H - 20 - (v / top) * (H - 30);
    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => `<line x1="${pad}" x2="${W - 8}" y1="${y(top * f)}" y2="${y(top * f)}" class="grid"/><text x="${pad - 4}" y="${y(top * f) + 4}" text-anchor="end">${Math.round(top * f)}</text>`)
      .join('');
    const minutes = Math.floor(end / 60);
    const step = Math.max(1, Math.ceil(minutes / 8));
    let ticks = '';
    for (let m = 0; m <= minutes; m += step) ticks += `<text x="${x(m * 60)}" y="${H - 4}" text-anchor="middle">${m}:00</text>`;
    const lines = players
      .map((p) => `<polyline fill="none" stroke="${p.color}" stroke-width="2" points="${p.history.map((s) => `${x(s.t).toFixed(1)},${y(s[metric]).toFixed(1)}`).join(' ')}"/>`)
      .join('');
    const names = { units: 'Jednotky', resources: 'Suroviny', total: 'Celkové skóre' } as const;
    const buttons = (Object.keys(names) as (keyof typeof names)[]).map((k) => `<button class="graph-metric score-tab${k === metric ? ' active' : ''}" data-metric="${k}">${names[k]}</button>`).join('');
    return `<div class="score-tabs">${buttons}</div><svg class="score-graph" viewBox="0 0 ${W} ${H}">${grid}${ticks}${lines}</svg>`;
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
    this.showModal('Úkoly', q);
  }

  private showAllies() {
    const rows = this.game.players
      .map((p) => `<p><span style="color:${p.color}">■</span> ${p.playing ? p.name : '<span style="color:#888">-prázdné-</span>'}</p>`)
      .join('');
    this.showModal('Spojenci', rows);
  }

  showHelp() {
    this.showModal(
      'Ovládání',
      `<p><b>Levé tlačítko</b> – výběr jednotky / budovy, potvrzení stavby; <b>tažením</b> výběr více jednotek (max. 12, jednotky mají přednost před budovami), <b>Shift</b> přidá / odebere z výběru.
<b>Pravé tlačítko</b> – pohyb builderem, u věže vynucení cíle (útok na příšeru).
<b>Šipky / okraj obrazovky / prostřední tlačítko</b> – posun kamery, <b>kolečko</b> – zoom.
<b>Alt</b> – ukazatele zdraví všech jednotek, <b>Klávesové zkratky</b> – jako ve hře (zvýrazněné písmeno v popisku tlačítka), <b>Esc</b> – zrušit.
<b>F9</b> – úkoly, <b>F10</b> – nabídka (pauza, rychlost, hudba, regiony, mapa průchodnosti), <b>F11</b> – spojenci, <b>F2</b> – regiony a trasa příšer, <b>F3</b> – mapa průchodnosti, <b>Pause</b> – pauza, <b>Tab</b> – vybrat buildera.</p>
<p>Data mapy (terén, doodady, regiony, vlny, věže, odměny, triggery) jsou extrahována přímo z <i>${this.map.source}</i>,
modely, textury, rozhraní a zvuky pocházejí z nainstalované hry – viz <code>docs/IMPLEMENTACE.md</code>.</p>`,
    );
  }

  /** Bounds of the portrait hole (the 3D portrait is rendered there into the main canvas). */
  portraitRect() {
    return $('portrait').getBoundingClientRect();
  }

  // --- per-frame ----------------------------------------------------------------------------------------

  update(selected: Unit | null) {
    const g = this.game;
    const p = g.players[this.localPlayer];
    $('gold').textContent = String(p?.gold ?? 0);
    $('lumber').textContent = '0';
    let used = 0;
    let made = 0;
    for (const u of g.units) {
      if (!u.alive || u.owner !== this.localPlayer || u.constructing) continue;
      used += Number(u.def.fields.ufoo) || 0;
      made += Number(u.def.fields.ufma) || 0;
    }
    $('supply').textContent = `${used}/${Math.max(10, made)}`;

    // Day/night clock: the game day lasts 8 minutes and starts at 8:00; the sky texture has the sun at its
    // edges (noon) and the moon in the middle (midnight).
    const sky = $('clock-sky');
    const tod = (8 + (g.time * 24) / 480) % 24;
    const d = sky.clientHeight;
    sky.style.backgroundPositionX = `${d / 2 - (((tod - 12 + 24) % 24) / 24) * 2 * d}px`;

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

    this.updateMultiboard();
    const builders = g.units.filter((u) => u.kind === 'builder' && u.owner === this.localPlayer && u.alive);
    const idle = $('idle-worker');
    idle.hidden = !builders.length;
    (idle.firstElementChild as HTMLElement).textContent = String(builders.length);

    this.updateInfo(selected);
    this.updateCard(selected);
  }

  /** Multiboard of Trig_Multiboard_Set / Timer_Update (widths are % of the screen width, icons per item). */
  private updateMultiboard() {
    const g = this.game;
    const mb = $('multiboard');
    mb.hidden = !g.multiboardVisible;
    if (!g.multiboardVisible) return;
    const title = g.timerUpdate && g.nextWaveTimer ? `Wave ${g.wave} starting in: ${Math.max(0, g.nextWaveTimer.end - g.time).toFixed(3)}` : g.multiboardTitle;
    const icon = (path: string) => `<span class="mb-icon" data-icon="${path}"></span>`;
    const cell = (w: number, html: string) => `<td style="width:calc(var(--sx) * ${w})">${html}</td>`;
    const row = (cells: string[]) => `<tr>${cells.join('')}</tr>`;
    const rows: string[] = [];
    rows.push(`<tr><td colspan="3"><table style="border-collapse:collapse"><tr>${cell(0.065, '')}${cell(0.08, icon(`${CB}BTNSnazzyPotion.blp`) + wc3ToHtml(`|CFF6DCFF6Lives:|r ${g.lives}`))}${cell(0.045, '')}</tr></table></td></tr>`);
    rows.push(row([cell(0.1, wc3ToHtml(g.str('TRIGSTR_327'))), cell(0.045, wc3ToHtml(g.str('TRIGSTR_328'))), cell(0.045, wc3ToHtml(g.str('TRIGSTR_329')))]));
    const empty = [
      ['TRIGSTR_330', 'TRIGSTR_508'],
      ['TRIGSTR_331', 'TRIGSTR_507'],
      ['TRIGSTR_332', 'TRIGSTR_510'],
    ];
    g.players.forEach((pl, i) => {
      const name = pl.playing ? pl.name : wc3ToHtml(g.str(empty[i][0]));
      const kills = pl.playing ? String(pl.kills) : wc3ToHtml(g.str(empty[i][1]));
      rows.push(row([cell(0.1, icon(`${CB}BTNPeasant.blp`) + name), cell(0.045, icon(`${CB}BTNDeathCoil.blp`) + kills), cell(0.045, icon('UI\\Feedback\\Resources\\ResourceGold.blp') + pl.gold)]));
    });
    const key = title + rows.join('');
    if (key === this.lastMbKey) return;
    this.lastMbKey = key;
    $('mb-title').innerHTML = wc3ToHtml(title);
    $('mb-table').innerHTML = rows.join('');
    this.applyIcons($('mb-table'));
  }

  private updateInfo(u: Unit | null) {
    const hp = $('portrait-hp');
    const mp = $('portrait-mp');
    const units = this.group.filter((x) => x.alive);
    mp.textContent = u && u.alive && u.maxMana > 0 ? `${Math.floor(u.mana)} / ${Math.round(u.maxMana)}` : '';
    if (!u || (!u.alive && u.owner !== CREEP_PLAYER)) {
      hp.textContent = '';
      this.setInfo('', []);
      return;
    }
    const d = u.def;
    const invulnerable = d.abilities.includes('Avul');
    const ratio = Math.max(0, u.hp / u.maxHp);
    if (d.isBuilding && invulnerable) hp.textContent = '';
    else {
      hp.textContent = `${Math.ceil(Math.max(0, u.hp))} / ${u.maxHp}`;
      hp.style.color = hpColor(ratio);
    }

    if (units.length > 1) return this.renderGroup(units);

    const tips: string[] = [];
    const parts: string[] = [`<div class="name">${wc3ToHtml(d.name)}</div>`];
    if (u.kind === 'creep') parts.push(`<div class="class">Úroveň ${d.level}</div>`);
    const progress = u.constructing ? u.constructing.elapsed / u.constructing.total : u.upgrading ? u.upgrading.elapsed / u.upgrading.total : u.queue[0] ? u.queue[0].elapsed / u.queue[0].total : null;
    if (progress !== null) {
      const db = this.game.db;
      const what = u.constructing ? 'Výstavba' : u.upgrading ? `Vylepšování na ${plainText(db.unit(u.upgrading.to).name)}` : u.queue[0].kind === 'train' ? `Výcvik: ${plainText(db.unit(u.queue[0].id).name)}` : `Výzkum: ${plainText(db.upgrade(u.queue[0].id).name(u.queue[0].level))}`;
      // Production queue like the game (UI\war3skins.txt BuildQueueBackdrop): the current item in the big slot with
      // the progress bar next to it, the rest below; a click on an icon cancels that item.
      if (u.queue.length && !u.constructing && !u.upgrading) {
        parts.push(`<div class="queue-backdrop" data-icon="${W}human-unitqueue-border.blp"></div>`);
        u.queue.slice(0, 7).forEach((q, i) => {
          const icon = q.kind === 'train' ? db.unit(q.id).icon : db.upgrade(q.id).icon(q.level);
          const name = q.kind === 'train' ? plainText(db.unit(q.id).name) : plainText(db.upgrade(q.id).name(q.level));
          tips.push(`<div class="tt-title">${name}</div>Kliknutím zrušíte.`);
          parts.push(`<div class="queue-slot q${i}" data-queue="${i}" data-tip="${tips.length - 1}" data-icon="${icon}"></div>`);
        });
      }
      parts.push(`<div class="progress-label${u.queue.length && !u.constructing && !u.upgrading ? ' queued' : ''}">${what}</div><div class="build-bar${u.queue.length && !u.constructing && !u.upgrading ? ' queued' : ''}"><div class="fill" data-icon="UI\\Feedback\\BuildProgressBar\\human-buildprogressbar-fill.blp" style="clip-path:inset(0 ${(100 - progress * 100).toFixed(1)}% 0 0)"></div><div class="border" data-icon="UI\\Feedback\\BuildProgressBar\\human-buildprogressbar-border.blp"></div></div>`);
      return this.setInfo(parts.join(''), tips, u);
    }
    const prefix = `${W}infocard-${u.owner === this.localPlayer ? '' : 'neutral-'}`;
    const stats: { icon: string; label: string; value: string; tip: string }[] = [];
    const a = d.attack;
    // Weapons that can only hit debris / trees / items / wards are not shown (the wave creeps' "debris" attack).
    if (a && a.targets.some((t) => !['debris', 'tree', 'item', 'ward', 'none'].includes(t))) {
      const lo = a.damageBase + a.dice;
      const hi = a.damageBase + a.dice * a.sides;
      const splash = a.splashFull + a.splashMedium + a.splashSmall > 0 ? `<br>Plošné poškození: ${a.splashFull} / ${a.splashMedium} / ${a.splashSmall}` : '';
      stats.push({
        icon: `${prefix}attack-${ATTACK_ICON[a.attackType] ?? 'melee'}.blp`,
        label: 'Útok:',
        value: `${lo} - ${hi}`,
        tip: `<div class="tt-title">Útok: ${lo} - ${hi}</div>Typ útoku: ${ATTACK_NAME[a.attackType] ?? a.attackType}<br>Prodleva útoku: ${a.cooldown.toFixed(2)} s<br>Dosah: ${a.range}${splash}${u.kills ? `<br>Zabito: ${u.kills}` : ''}`,
      });
    }
    const armorType = ARMOR_ICON[d.defenseType] ?? 'small';
    const armorIcon = armorType === 'hero' || armorType === 'divine' ? `${W}infocard-armor-${armorType}.blp` : `${prefix}armor-${armorType}.blp`;
    const reduction = d.armor > 0 ? ((d.armor * 0.06) / (1 + d.armor * 0.06)) * 100 : 0;
    const extra: string[] = [];
    if (u.kind === 'creep') {
      extra.push(`Rychlost: ${d.speed}${u.slow ? ' (zpomalen)' : ''}`);
      if (u.flying) extra.push('Létající');
      if (u.invisible) extra.push('Neviditelný');
      if (d.abilities.includes('Amim')) extra.push('Imunní vůči kouzlům');
    }
    stats.push({
      icon: armorIcon,
      label: 'Zbroj:',
      value: invulnerable ? '<span style="color:#ff2020">Nezranitelný</span>' : String(Math.round(d.armor)),
      tip: `<div class="tt-title">Zbroj: ${invulnerable ? 'Nezranitelný' : Math.round(d.armor)}</div>Typ zbroje: ${ARMOR_NAME[d.defenseType] ?? d.defenseType}${invulnerable ? '' : `<br>Snižuje poškození o ${reduction.toFixed(0)} %`}${extra.length ? `<br>${extra.join('<br>')}` : ''}`,
    });
    stats.forEach((s, i) => {
      tips.push(s.tip);
      parts.push(`<div class="stat s${i}" data-tip="${tips.length - 1}"><div class="stat-icon" data-icon="${s.icon}"></div><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`);
    });
    if (!d.isBuilding) {
      const status: string[] = [];
      if (u.slow) status.push('Zpomalen');
      if (u.stunUntil > this.game.time) status.push('Omráčen');
      if (u.poison) status.push('Otráven');
      parts.push(`<div class="status"><span style="color:var(--gold)">Stav:</span> ${status.join(', ')}</div>`);
    }
    this.setInfo(parts.join(''), tips);
  }

  /** Replaces the info panel content only when it changed (keeps hover tooltips working). */
  private setInfo(html: string, tips: string[], unit: Unit | null = null) {
    if (html === this.lastInfoKey) return;
    // Only the progress changed: update the bar in place (keeps hover state and avoids reloading icons).
    const bar = $('info').querySelector<HTMLElement>('.build-bar .fill');
    const clip = /clip-path:(inset\([^)]*\))/;
    const strip = (h: string) => h.replace(clip, '');
    if (bar && strip(html) === strip(this.lastInfoKey)) {
      this.lastInfoKey = html;
      bar.style.clipPath = clip.exec(html)?.[1] ?? bar.style.clipPath;
      return;
    }
    this.lastInfoKey = html;
    const el = $('info');
    el.innerHTML = html;
    this.applyIcons(el);
    el.querySelectorAll<HTMLElement>('[data-queue]').forEach((s) => {
      s.addEventListener('click', () => {
        if (!unit || unit.owner !== this.localPlayer) return;
        this.onCommand();
        this.game.cancelQueued(unit, Number(s.dataset.queue));
      });
    });
    el.querySelectorAll<HTMLElement>('[data-tip]').forEach((s) => {
      const tip = tips[Number(s.dataset.tip)];
      s.addEventListener('mouseenter', () => this.showTooltip(tip));
      s.addEventListener('mouseleave', () => this.showTooltip(null));
    });
  }

  /** Order of the selection grid: kept while Tab only reorders the group (a new selection resets it). */
  private gridOrder: Unit[] = [];
  /** Tab in a mixed selection: the next unit type becomes the active subgroup (command card, info). */
  onSubgroup: (units: Unit[]) => void = () => {};

  /**
   * Tab like the game: with several unit types selected it switches the active subgroup – the units of the next
   * type move to the front of the selection (the grid keeps its order and highlights the subgroup). Returns false
   * when the selection has only one type.
   */
  nextSubgroup() {
    const units = this.group.filter((u) => u.alive);
    const types = [...new Set(this.orderedGroup(units).map((u) => u.def.id))];
    if (types.length < 2) return false;
    const next = types[(types.indexOf(units[0].def.id) + 1) % types.length];
    this.onSubgroup([...units.filter((u) => u.def.id === next), ...units.filter((u) => u.def.id !== next)]);
    return true;
  }

  private orderedGroup(units: Unit[]) {
    const same = units.length === this.gridOrder.length && units.every((u) => this.gridOrder.includes(u));
    if (!same) this.gridOrder = [...units];
    return this.gridOrder;
  }

  /** Multi-selection: unit icons with health bars like the WC3 console (click selects only that unit). */
  private renderGroup(units: Unit[]) {
    const active = units[0].def.id;
    const cells = this.orderedGroup(units).slice(0, 12).map((u) => {
      const r = Math.max(0, u.hp / u.maxHp);
      return `<div class="group-unit${u === units[0] ? ' primary' : u.def.id === active ? ' sub' : ''}" data-uid="${u.uid}" data-icon="${u.def.icon}" title="${plainText(u.def.name)}"><div class="hpbar"><div style="width:${(r * 100).toFixed(0)}%;background:${hpColor(r)}"></div></div></div>`;
    });
    const html = `<div id="group">${cells.join('')}</div>`;
    if (html === this.lastInfoKey) return;
    this.lastInfoKey = html;
    const el = $('info');
    el.innerHTML = html;
    this.applyIcons(el);
    el.querySelectorAll<HTMLElement>('.group-unit').forEach((c) => {
      c.addEventListener('click', () => {
        const u = units.find((x) => x.uid === Number(c.dataset.uid));
        if (u) this.onSelect(u);
      });
    });
  }

  /** Selected own units of the same type as the primary one (shared commands like Stop apply to all of them). */
  private sameType(u: Unit) {
    const same = this.group.filter((x) => x.alive && x.owner === u.owner && x.def.id === u.def.id);
    return same.length ? same : [u];
  }

  // --- command card ----------------------------------------------------------------------------------

  private costLine(cost: number | undefined) {
    if (!cost) return '';
    const coin = this.coinUrl ? `<span class="coin" style="background-image:url(${this.coinUrl})"></span>` : '';
    return `<div class="tt-cost">${coin}${cost}</div>`;
  }

  private unitTooltip(def: UnitDef, cost: number, missing: string[]) {
    return `<div class="tt-title">${wc3ToHtml(def.tooltip || def.name)}</div>${this.costLine(cost)}<div>${wc3ToHtml(def.description)}</div>${missing.length ? `<div class="tt-req">Vyžaduje: ${missing.join(', ')}</div>` : ''}`;
  }

  private basic(x: number, y: number, title: string, hotkey: string, icon: string, desc: string, run: () => void, extra: Partial<Command> = {}): Command {
    return { x, y, label: plainText(title), hotkey, enabled: true, icon: CB + icon, tooltip: () => `<div class="tt-title">${wc3ToHtml(title)}</div>${desc}`, run, ...extra };
  }

  private orderButtons(u: Unit, mobile: boolean): Command[] {
    const g = this.game;
    const stop = () => this.sameType(u).forEach((x) => g.stop(x));
    const moving = !!u.path || !!u.moveTarget;
    const cmds: Command[] = [];
    if (mobile) {
      cmds.push(this.basic(0, 0, `Přesun (${HK('M')})`, 'M', 'BTNMove.blp', 'Přesune jednotku na zvolené místo.', () => (this.mode = { kind: 'target', ability: 'move' }), { active: moving, keys: { ids: ['CmdMove'] } }));
      cmds.push(this.basic(2, 0, `Držet pozici (${HK('H')})`, 'H', 'BTNHoldPosition.blp', 'Jednotka zůstane na místě a nebude pronásledovat nepřátele.', () => this.sameType(u).forEach((x) => g.hold(x)), { active: u.holdPosition, keys: { ids: ['CmdHoldPos'] } }));
      cmds.push(this.basic(0, 1, `Hlídka (${HK('P')})`, 'P', 'BTNPatrol.blp', 'Jednotka bude hlídkovat mezi současnou pozicí a cílovým místem.', () => (this.mode = { kind: 'target', ability: 'move' }), { keys: { ids: ['CmdPatrol'] } }));
    }
    cmds.push(this.basic(1, 0, `Stát (${HK('S')})`, 'S', 'BTNStop.blp', 'Zastaví jednotku a zruší její rozkazy.', stop, { keys: { ids: ['CmdStop'] } }));
    if (u.def.attack) cmds.push(this.basic(3, 0, `Útok (${HK('A')})`, 'A', 'BTNAttack.blp', 'Zaútočí na zvolený cíl. Při zadání místa jednotka dojde na místo a útočí na nepřátele, na které cestou narazí.', () => (this.mode = { kind: 'target', ability: 'attack' }), { active: !!u.forcedTarget || !!u.attackMove, keys: { ids: ['CmdAttack'] } }));
    return cmds;
  }

  private buildCommands(u: Unit | null): Command[] {
    const g = this.game;
    const cmds: Command[] = [];
    if (!u || !u.alive || u.owner !== this.localPlayer) {
      if (u?.kind === 'shop' && u.alive) return this.shopCommands(u);
      return cmds;
    }
    const cancel = (run: () => void, cmd = 'CmdCancel'): Command => ({ x: 3, y: 2, label: 'Zrušit', hotkey: 'ESCAPE', enabled: true, icon: `${CB}BTNCancel.blp`, tooltip: () => `<div class="tt-title">Zrušit (${HK('Esc')})</div>`, run, keys: { ids: [cmd, 'CmdCancel'] } });
    if (u.constructing || u.upgrading) return [cancel(() => g.cancel(u), 'CmdCancelBuild')];

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
              if (missing.length) return this.addMessage(`|cffff4040Vyžaduje: ${missing.join(', ')}|r`, 3);
              this.mode = { kind: 'build', id };
            },
            keys: { ids: [id] },
          });
        }
        cmds.push(cancel(() => (this.submenu = null)));
        return cmds;
      }
      cmds.push(...this.orderButtons(u, true));
      cmds.push(
        this.repairButton(u),
      );
      if (u.def.builds.length) cmds.push(this.basic(0, 2, `Postavit ${HK('b')}udovu`, 'B', 'BTNHumanBuild.blp', 'Vyvolá seznam dostupných budov, z kterého si můžete vybrat stavbu, kterou postavíte.', () => (this.submenu = 'build'), { keys: { ids: ['CmdBuildHuman', 'CmdBuild'] } }));
      for (const id of u.def.abilities) {
        const ab = g.db.ability(id);
        if (ab.base === 'Arav') {
          const toAir = u.def.id !== String(ab.fields['Emeu@1'] ?? 'h018');
          cmds.push({ x: Number(ab.fields.abpx ?? 2), y: 2, label: toAir ? 'Fly' : 'Land', icon: String(toAir ? ab.fields.aart ?? '' : ab.fields.auar ?? ''), hotkey: hotkeyOf({ hotkey: String(toAir ? ab.fields.ahky ?? '' : ab.fields.auhk ?? ''), tooltip: String(toAir ? ab.fields['atp1@1'] ?? '' : ab.fields['aut1@1'] ?? '') }), enabled: true, tooltip: () => `<div class="tt-title">${wc3ToHtml(String(toAir ? ab.fields['atp1@1'] ?? 'Fly' : ab.fields['aut1@1'] ?? 'Land'))}</div>${wc3ToHtml(String(toAir ? ab.fields['aub1@1'] ?? '' : ab.fields['auu1@1'] ?? ''))}`, run: () => g.morph(u), keys: { ids: [id, ab.base], un: !toAir } });
        }
        if (id === g.cfg.coinBasherAbility) {
          const cd = Math.max(0, (u.abilityCd[id] ?? 0) - g.time);
          cmds.push({ x: Number(ab.fields.abpx ?? 3), y: Number(ab.fields.abpy ?? 0) === 0 ? 2 : Number(ab.fields.abpy), label: ab.name, icon: ab.icon, hotkey: hotkeyOf({ hotkey: String(ab.fields.ahky ?? ''), tooltip: ab.tooltip }), enabled: cd === 0, cost: g.wave, cooldown: cd > 0 ? cd / Math.max(0.01, Number(ab.fields['acdn@1'] ?? 8)) : undefined, tooltip: () => `<div class="tt-title">${wc3ToHtml(ab.tooltip)}</div>${this.costLine(g.wave)}${wc3ToHtml(ab.description)}`, run: () => (this.mode = { kind: 'target', ability: 'coin' }), keys: { ids: [id, ab.base] } });
        }
      }
      return cmds;
    }

    if (u.kind === 'tower') {
      cmds.push(...this.orderButtons(u, false));
      for (const to of u.def.upgradesTo) {
        const def = g.db.unit(to);
        const missing = g.missingRequirements(u.owner, def);
        cmds.push({ x: def.buttonPos[0], y: def.buttonPos[1], label: `↑ ${plainText(def.name)}`, hotkey: hotkeyOf(def), enabled: !missing.length, cost: g.upgradeCost(u, to), icon: def.icon, tooltip: () => this.unitTooltip(def, g.upgradeCost(u, to), missing), run: () => this.report(g.upgrade(u, to)), keys: { ids: [to] } });
      }
      const sell = g.db.ability(g.cfg.sellAbility);
      if (u.def.abilities.includes(g.cfg.sellAbility)) {
        const value = Math.trunc(u.def.pointValue * g.cfg.sellRatio);
        cmds.push({ x: Number(sell.fields.abpx ?? 3), y: 2, label: `${sell.name} +${value}`, icon: sell.icon, hotkey: hotkeyOf({ hotkey: String(sell.fields.ahky ?? ''), tooltip: sell.tooltip }), enabled: true, tooltip: () => `<div class="tt-title">${wc3ToHtml(sell.tooltip)}</div>${wc3ToHtml(sell.description)}<div class="tt-cost" style="margin-top:4px">+${value}</div>`, run: () => g.sell(u), keys: { ids: [g.cfg.sellAbility, sell.base] } });
      }
      return cmds;
    }

    if (u.kind === 'spawning') {
      for (const id of u.def.trains) {
        const def = g.db.unit(id);
        const missing = g.missingRequirements(u.owner, def);
        cmds.push({ x: def.buttonPos[0], y: def.buttonPos[1], label: plainText(def.name), hotkey: hotkeyOf(def), enabled: !missing.length, cost: def.gold, icon: def.icon, tooltip: () => this.unitTooltip(def, def.gold, missing), run: () => this.report(g.train(u, id)), keys: { ids: [id] } });
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
          tooltip: () => `<div class="tt-title">${wc3ToHtml(up.tooltip(l) || up.name(l))}</div>${done ? '' : this.costLine(up.gold(l))}${wc3ToHtml(up.description(l))}`,
          run: () => this.report(g.research(u, id)),
          keys: { ids: [id], level: l },
        });
      }
      if (u.queue.length) cmds.push(cancel(() => g.cancel(u), 'CmdCancelTrain'));
      return cmds;
    }

    if (u.kind === 'defender') {
      cmds.push(...this.orderButtons(u, true));
      cmds.push(...this.spellButtons(u));
    }
    return cmds;
  }

  /**
   * Repair (Ahrp): target a damaged own building / machine or an unfinished building; right click toggles autocast
   * (an idle builder then repairs damaged buildings nearby by itself). Texts and hotkey from the ability data.
   */
  private repairButton(u: Unit): Command {
    const g = this.game;
    const id = u.def.abilities.find((a) => g.db.ability(a).base === 'Ahrp');
    const ab = id ? g.db.ability(id) : null;
    const f = ab?.fields ?? {};
    const auto = id ? u.autocast[id] !== false : false;
    const hotkey = hotkeyOf({ hotkey: String(f.ahky ?? 'R'), tooltip: ab?.tooltip ?? '' }) || 'R';
    const title = ab?.tooltip || `Oprava (${HK(hotkey)})`;
    return {
      x: 1,
      y: 1,
      label: plainText(title),
      hotkey,
      enabled: !!id,
      icon: `${CB}BTNRepair.blp`,
      active: !!u.repairs,
      autocast: auto,
      tooltip: () => `<div class="tt-title">${wc3ToHtml(title)}</div>${wc3ToHtml(ab?.description || 'Opraví poškozenou mechanickou jednotku nebo budovu.')}<br><span style="color:#ffcc00">Automatické opravování zapnete / vypnete pravým tlačítkem.</span>`,
      run: () => (this.mode = { kind: 'target', ability: 'repair' }),
      rightClick: id ? () => g.setAutocast(u, id, !auto) : undefined,
      keys: { ids: id ? [id, 'Ahrp'] : ['Ahrp'] },
    };
  }

  /**
   * Active spells of the temple defenders: Share Mana (Arpm, autocast – right click toggles), Mana Drain (AHdr,
   * target a creep), Bless Weapons (ACro, instant) and Skyfury (ACmo, target an area). Mana cost and cooldown as in the game.
   */
  private spellButtons(u: Unit): Command[] {
    const g = this.game;
    const out: Command[] = [];
    for (const id of u.def.abilities) {
      const ab = g.db.ability(id);
      if (!['Arpm', 'AHdr', 'ACro', 'ACmo'].includes(ab.base)) continue;
      const f = ab.fields;
      const cd = Math.max(0, (u.abilityCd[id] ?? 0) - g.time);
      const cost = Number(f['amcs@1'] ?? 0);
      const total = Math.max(0.01, Number(f['acdn@1'] ?? 1));
      const mana = cost ? `<div class="tt-mana">${cost} many</div>` : '';
      const report = (err: string | null) => this.report(err);
      const run = () => {
        if (ab.base === 'Arpm') report(g.castShareMana(u, id));
        else if (ab.base === 'ACro') report(g.castRoar(u, id));
        else this.mode = { kind: 'target', ability: ab.base === 'AHdr' ? 'drain' : 'storm', id };
      };
      const auto = ab.base === 'Arpm' ? u.autocast[id] !== false : undefined;
      out.push({
        x: Number(f.abpx ?? 0),
        y: Number(f.abpy ?? 2),
        label: ab.name,
        icon: ab.base === 'Arpm' && auto === false ? String(f.auar ?? ab.icon) : ab.icon,
        hotkey: hotkeyOf({ hotkey: String(f.ahky ?? ''), tooltip: ab.tooltip }),
        enabled: cd === 0 && u.mana >= cost,
        cooldown: cd > 0 ? cd / total : undefined,
        autocast: auto,
        tooltip: () => `<div class="tt-title">${wc3ToHtml(ab.tooltip)}</div>${mana}${wc3ToHtml(ab.description)}${auto !== undefined ? '<br><span style="color:#ffcc00">Automatické sesílání zapnete / vypnete pravým tlačítkem.</span>' : ''}`,
        run,
        rightClick: auto !== undefined ? () => g.setAutocast(u, id, !auto) : undefined,
        keys: { ids: [id, ab.base] },
      });
    }
    return out;
  }

  private shopCommands(shop: Unit): Command[] {
    const g = this.game;
    const near = g.shopperNear(this.localPlayer, shop);
    return shop.def.sells.map((id) => {
      const def = g.db.unit(id);
      const s = g.shopStock[id];
      return {
        x: def.buttonPos[0],
        y: def.buttonPos[1],
        label: `${plainText(def.name)} (${s?.stock ?? 0})`,
        hotkey: hotkeyOf(def),
        enabled: near && (s?.stock ?? 0) > 0,
        cost: def.gold,
        icon: def.icon,
        count: s?.stock ?? 0,
        tooltip: () => this.unitTooltip(def, def.gold, []) + (s && s.stock < s.max && s.nextAt ? `<div style="color:#b0b0b0">Doplnění za ${Math.max(0, s.nextAt - g.time).toFixed(0)} s</div>` : '') + (near ? '' : `<div class="tt-req">${ERR.noShopper}</div>`),
        run: () => this.report(g.buy(this.localPlayer, id)),
        keys: { ids: [id] },
      };
    });
  }

  report(err: string | null) {
    if (!err) return;
    this.addMessage(`|cffff4040${err}|r`, 3);
    this.onError(err);
  }

  /** Command card shortcuts: object data, QWER grid or CustomKeys.txt (Options). */
  keyLayout: KeyLayout = 'default';
  customKeys: Map<string, KeyEntry> | null = null;

  private updateCard(u: Unit | null) {
    this.commands = this.buildCommands(u);
    applyKeys(this.commands, this.keyLayout, this.customKeys);
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
    const cardKey = this.commands.map((c) => `${c.x}${c.y}${c.hotkey}${c.label}${c.enabled}${c.cost}${c.active}${c.autocast}${c.count}${c.cooldown !== undefined}`).join('|') + (u?.uid ?? '');
    // The cooldown sweep changes every frame – updated in place without rebuilding the card.
    for (const c of this.commands) {
      if (c.cooldown === undefined) continue;
      const el = $('card').querySelector<HTMLElement>(`[data-slot="${c.x},${c.y}"] .cooldown`);
      if (el) el.style.background = cooldownSweep(c.cooldown);
    }
    if (cardKey === this.lastCardKey) return;
    this.lastCardKey = cardKey;
    const card = $('card');
    card.innerHTML = '';
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const c = this.commands.find((k) => k.x === x && k.y === y);
        const el = document.createElement('div');
        el.className = 'cmd' + (c ? (c.enabled || c.cooldown !== undefined ? '' : ' disabled') + (c.autocast ? ' autocast' : '') : ' empty');
        if (c) {
          el.dataset.slot = `${x},${y}`;
          el.innerHTML = `<span class="lbl">${c.label}</span>${c.active ? `<div class="active-hl" data-icon="${W}CommandButton\\human-activebutton.blp"></div>` : ''}${c.count !== undefined ? `<span class="count">${c.count}</span>` : ''}${c.cooldown !== undefined ? `<div class="cooldown" style="background:${cooldownSweep(c.cooldown)}"></div>` : ''}`;
          el.addEventListener('click', () => {
            this.onCommand();
            c.run();
          });
          el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (c.rightClick) c.rightClick();
            else if (c.autocast !== undefined) c.run();
          });
          if (c.icon) void this.iconUrl(c.icon).then((url) => url && ((el.style.backgroundImage = `url(${url})`), el.classList.add('has-icon')));
          el.addEventListener('mouseenter', () => this.showTooltip(c.tooltip()));
          el.addEventListener('mouseleave', () => this.showTooltip(null));
          this.applyIcons(el);
        }
        card.appendChild(el);
      }
    }
  }

  showTooltip(html: string | null) {
    const el = $('tooltip');
    el.hidden = !html;
    if (html) el.innerHTML = html;
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'Enter' || e.key === 'F12') {
      e.preventDefault();
      if ($('menu').hidden) this.openChat();
      return;
    }
    if (e.altKey) {
      const opt = ({ KeyG: 'ping', KeyT: 'terrain', KeyA: 'allyColors', KeyC: 'creeps', KeyF: 'formation' } as const)[e.code as 'KeyG'];
      if (opt) {
        e.preventDefault();
        this.toggleMinimapOption(opt);
        return;
      }
    }
    if (e.key === 'F9') {
      e.preventDefault();
      this.showQuests();
      return;
    }
    if (e.key === 'F10') {
      e.preventDefault();
      this.toggleMenu();
      return;
    }
    if (e.key === 'F11') {
      e.preventDefault();
      this.showAllies();
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      this.showHelp();
      return;
    }
    if (e.key === 'Pause') {
      this.togglePause();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('menu').hidden) this.toggleMenu(false);
      else if (this.mode.kind !== 'normal') {
        this.mode = { kind: 'normal' };
        this.refreshMinimapButtons();
      }
      else if (this.submenu) this.submenu = null;
      else if (!$('modal').hidden) $('modal').hidden = true;
      else this.commands.find((c) => c.hotkey === 'ESCAPE')?.run();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Mixed selection: switch the subgroup; otherwise (as before) select the builder.
      if (!this.nextSubgroup()) this.selectBuilder();
      return;
    }
    if (!$('menu').hidden) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : '';
    const c = k && this.commands.find((x) => x.hotkey === k);
    if (c) {
      e.preventDefault();
      this.onCommand();
      c.run();
    }
  }
}

/** Cooldown clock: the remaining part as a dark sector that shrinks clockwise from 12 o'clock like the game. */
function cooldownSweep(remaining: number) {
  const done = (1 - Math.max(0, Math.min(1, remaining))) * 360;
  return `conic-gradient(transparent 0deg ${done.toFixed(1)}deg, rgba(0, 0, 0, 0.62) ${done.toFixed(1)}deg 360deg)`;
}
