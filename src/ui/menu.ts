import type { Game } from '../game/game';
import type { RtsCamera } from '../render/camera';
import type { SoundPlayer } from '../sound';
import type { Hud } from './hud';
import { parseCustomKeys, type KeyLayout } from './customkeys';
import { deleteSave, formatGameTime, listSaves, requestLoad, writeSave } from './saves';

interface Settings {
  speed: number;
  mouseScroll: number;
  keyScroll: number;
  soundOn: boolean;
  soundVolume: number;
  musicOn: boolean;
  musicVolume: number;
  /** Ambient sounds (environment, day / night). */
  ambientOn: boolean;
  /** Video options like the game: particles (max emission factor), texture quality, render resolution, unit shadows. */
  particles: number;
  textures: 'high' | 'low';
  resolution: number;
  shadows: boolean;
  /** Command card shortcuts: object data, QWER grid by button position, or CustomKeys.txt. */
  keys: KeyLayout;
}

/** Hooks of the renderer that the video options control. */
export interface GraphicsHooks {
  setParticles(max: number): void;
  setResolution(scale: number): void;
  setShadows(on: boolean): void;
}

const KEY = 'ruined-temple-settings';
/** Text of a CustomKeys.txt loaded in the options. */
const CUSTOM_KEYS = 'ruined-temple-customkeys';

/** CustomKeys.txt of the Czech / English client is Windows-1250 / 1252 text unless saved as UTF-8. */
export function decodeKeysFile(bytes: ArrayBuffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

/** Saved settings (also read at start-up, before textures load – the texture quality applies after a restart). */
export function savedSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}
const $ = (id: string) => document.getElementById(id)!;

/**
 * Game menu (F10) like the game's escape menu: main panel, options (game speed, scroll speeds, sound and music
 * volume) and end game (restart / give up). Options are kept in localStorage.
 */
export class GameMenu {
  private settings: Settings;
  private startTextures: Settings['textures'];
  private keysNote = '';

  constructor(
    private readonly game: Game,
    private readonly hud: Hud,
    private readonly sound: SoundPlayer,
    private readonly cam: RtsCamera,
    private readonly gfx: GraphicsHooks | null = null,
    /** CustomKeys.txt from the game folder (copied by npm run assets), when there is one. */
    private readonly gameKeys: (() => Promise<string | null>) | null = null,
  ) {
    const defaults: Settings = {
      speed: 1,
      mouseScroll: 1,
      keyScroll: 1,
      soundOn: true,
      soundVolume: sound.volume,
      musicOn: true,
      musicVolume: sound.musicVolume,
      ambientOn: true,
      particles: 1,
      textures: 'high',
      resolution: 1,
      shadows: true,
      keys: 'default',
    };
    this.settings = { ...defaults, ...savedSettings() };
    this.startTextures = this.settings.textures;
    this.apply();

    const show = (view: 'main' | 'options' | 'end' | 'save' | 'load') => {
      for (const v of ['main', 'options', 'end', 'save', 'load']) $(`menu-${v}`).hidden = v !== view;
    };
    // Saved games (localStorage): save under a name (same name = overwrite), load restarts the scene with the save.
    const saveList = (id: string, onPick: (s: ReturnType<typeof listSaves>[number]) => void, withDelete: boolean) => {
      const el = $(id);
      const saves = listSaves();
      el.innerHTML = saves.length
        ? saves.map((s) => `<div class="save-row" data-id="${s.id}"><span class="save-name"></span><span class="save-info">vlna ${s.wave} · ${formatGameTime(s.time)} · ${new Date(s.date).toLocaleString('cs-CZ')}</span>${withDelete ? '<button class="save-delete" title="Smazat">✕</button>' : ''}</div>`).join('')
        : '<p class="save-empty">Žádné uložené hry.</p>';
      el.querySelectorAll<HTMLElement>('.save-row').forEach((row) => {
        const s = saves.find((x) => x.id === row.dataset.id)!;
        row.querySelector('.save-name')!.textContent = s.name;
        row.addEventListener('click', () => onPick(s));
        row.querySelector('.save-delete')?.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSave(s.id);
          saveList(id, onPick, withDelete);
        });
      });
    };
    const nameInput = $('save-name') as HTMLInputElement;
    const doSave = () => {
      if (this.game.ended) return hud.report('Hru po jejím skončení nelze uložit.');
      const name = nameInput.value.trim() || `Vlna ${this.game.wave}`;
      const err = writeSave(name, this.game.save(), { x: this.cam.target.x, y: this.cam.target.y }, this.game.wave, this.game.time);
      if (err) return hud.report(err);
      hud.toggleMenu(false);
      hud.addMessage(`Hra byla uložena: ${name}`, 4);
    };
    $('btn-save').addEventListener('click', () => {
      nameInput.value = `Vlna ${this.game.wave} – ${formatGameTime(this.game.time)}`;
      saveList('save-list-save', (s) => (nameInput.value = s.name), true);
      show('save');
      nameInput.focus();
      nameInput.select();
    });
    nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') doSave();
      else if (e.key === 'Escape') show('main');
    });
    $('btn-save-do').addEventListener('click', doSave);
    $('btn-save-back').addEventListener('click', () => show('main'));
    $('btn-load').addEventListener('click', () => {
      saveList('save-list-load', (s) => requestLoad(s.id), true);
      show('load');
    });
    $('btn-load-back').addEventListener('click', () => show('main'));
    hud.onMenuOpen = () => show('main');
    $('btn-options').addEventListener('click', () => {
      this.syncControls();
      show('options');
    });
    $('btn-options-back').addEventListener('click', () => show('main'));
    $('btn-endgame').addEventListener('click', () => show('end'));
    $('btn-end-back').addEventListener('click', () => show('main'));
    $('btn-restart').addEventListener('click', () => location.reload());
    $('btn-quit').addEventListener('click', () => {
      hud.toggleMenu(false);
      hud.showEnd(false, 'Hra byla ukončena.');
    });
    // Game speed as in the single player options (normal / fast / fastest).
    $('btn-speed').addEventListener('click', () => this.set({ speed: this.settings.speed >= 4 ? 1 : this.settings.speed * 2 }));
    const range = (id: string, key: 'mouseScroll' | 'keyScroll' | 'soundVolume' | 'musicVolume') =>
      $(id).addEventListener('input', (e) => this.set({ [key]: Number((e.target as HTMLInputElement).value) }));
    range('opt-mouse-scroll', 'mouseScroll');
    range('opt-key-scroll', 'keyScroll');
    range('opt-sound-volume', 'soundVolume');
    range('opt-music-volume', 'musicVolume');
    $('opt-sound').addEventListener('change', (e) => this.set({ soundOn: (e.target as HTMLInputElement).checked }));
    $('opt-music').addEventListener('change', (e) => this.set({ musicOn: (e.target as HTMLInputElement).checked }));
    const cycle = <T,>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];
    $('btn-gfx-particles').addEventListener('click', () => this.set({ particles: cycle([1, 0.5, 0.25], this.settings.particles) }));
    $('btn-gfx-textures').addEventListener('click', () => this.set({ textures: this.settings.textures === 'high' ? 'low' : 'high' }));
    $('btn-gfx-resolution').addEventListener('click', () => this.set({ resolution: cycle([1, 0.75, 0.5], this.settings.resolution) }));
    $('opt-ambient').addEventListener('change', (e) => this.set({ ambientOn: (e.target as HTMLInputElement).checked }));
    $('opt-shadows').addEventListener('change', (e) => this.set({ shadows: (e.target as HTMLInputElement).checked }));
    $('btn-keys').addEventListener('click', () => this.set({ keys: cycle<KeyLayout>(['default', 'grid', 'custom'], this.settings.keys) }));
    $('btn-keys-file').addEventListener('click', () => $('opt-keys-file').click());
    $('opt-keys-file').addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = decodeKeysFile(await file.arrayBuffer());
      try {
        localStorage.setItem(CUSTOM_KEYS, text);
      } catch {
        /* storage unavailable – used for this session only */
      }
      this.customText = text;
      this.set({ keys: 'custom' });
    });
    this.syncControls();
  }

  private customText: string | null = null;

  /** Loads the CustomKeys.txt for the "custom" layout: the file loaded in the options, else the game folder's one. */
  private async loadKeys() {
    const hud = this.hud;
    hud.keyLayout = this.settings.keys;
    if (this.settings.keys !== 'custom') {
      hud.customKeys = null;
      this.keysNote = '';
      return;
    }
    let text = this.customText ?? localStorage.getItem(CUSTOM_KEYS);
    let source = 'načtený soubor';
    if (!text && this.gameKeys) {
      text = await this.gameKeys();
      source = 'ze složky hry';
    }
    hud.customKeys = text ? parseCustomKeys(text) : null;
    this.keysNote = text ? `${source}, ${hud.customKeys!.size} položek` : 'soubor nenačten';
    this.syncControls();
  }

  private set(change: Partial<Settings>) {
    this.settings = { ...this.settings, ...change };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
    this.apply();
    this.syncControls();
  }

  private apply() {
    const s = this.settings;
    this.game.speed = s.speed;
    this.cam.mouseScroll = s.mouseScroll;
    this.cam.keyScroll = s.keyScroll;
    this.sound.volume = s.soundOn ? s.soundVolume : 0;
    this.sound.setMusicVolume(s.musicVolume);
    this.sound.setMusic(s.musicOn);
    this.sound.ambientOn = s.ambientOn;
    this.gfx?.setParticles(s.particles);
    this.gfx?.setResolution(s.resolution);
    this.gfx?.setShadows(s.shadows);
    void this.loadKeys();
  }

  private syncControls() {
    const s = this.settings;
    $('btn-speed').textContent = `Rychlost hry: ${s.speed === 1 ? 'normální' : s.speed === 2 ? 'rychlá' : 'nejrychlejší'} (${s.speed}×)`;
    ($('opt-mouse-scroll') as HTMLInputElement).value = String(s.mouseScroll);
    ($('opt-key-scroll') as HTMLInputElement).value = String(s.keyScroll);
    ($('opt-sound-volume') as HTMLInputElement).value = String(s.soundVolume);
    ($('opt-music-volume') as HTMLInputElement).value = String(s.musicVolume);
    ($('opt-sound') as HTMLInputElement).checked = s.soundOn;
    ($('opt-music') as HTMLInputElement).checked = s.musicOn;
    ($('opt-music') as HTMLInputElement).disabled = !this.sound.hasMusic;
    const level = (v: number) => (v >= 1 ? 'vysoké' : v >= 0.5 ? 'střední' : 'nízké');
    $('btn-gfx-particles').textContent = `Částice: ${level(s.particles)}`;
    $('btn-gfx-textures').textContent = `Textury: ${s.textures === 'high' ? 'vysoké' : 'nízké'}${s.textures !== this.startTextures ? ' (po restartu)' : ''}`;
    $('btn-gfx-resolution').textContent = `Rozlišení vykreslování: ${Math.round(s.resolution * 100)} %`;
    ($('opt-shadows') as HTMLInputElement).checked = s.shadows;
    ($('opt-ambient') as HTMLInputElement).checked = s.ambientOn;
    const layout = s.keys === 'grid' ? 'mřížka (QWER)' : s.keys === 'custom' ? `CustomKeys.txt${this.keysNote ? ` – ${this.keysNote}` : ''}` : 'výchozí';
    $('btn-keys').textContent = `Klávesové zkratky: ${layout}`;
  }
}
