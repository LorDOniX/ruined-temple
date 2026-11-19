import type { Game } from '../game/game';
import type { RtsCamera } from '../render/camera';
import type { SoundPlayer } from '../sound';
import type { Hud } from './hud';

interface Settings {
  speed: number;
  mouseScroll: number;
  keyScroll: number;
  soundOn: boolean;
  soundVolume: number;
  musicOn: boolean;
  musicVolume: number;
}

const KEY = 'ruined-temple-settings';
const $ = (id: string) => document.getElementById(id)!;

/**
 * Game menu (F10) like the game's escape menu: main panel, options (game speed, scroll speeds, sound and music
 * volume) and end game (restart / give up). Options are kept in localStorage.
 */
export class GameMenu {
  private settings: Settings;

  constructor(
    private readonly game: Game,
    hud: Hud,
    private readonly sound: SoundPlayer,
    private readonly cam: RtsCamera,
  ) {
    const defaults: Settings = { speed: 1, mouseScroll: 1, keyScroll: 1, soundOn: true, soundVolume: sound.volume, musicOn: true, musicVolume: sound.musicVolume };
    let saved: Partial<Settings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* corrupt settings – defaults */
    }
    this.settings = { ...defaults, ...saved };
    this.apply();

    const show = (view: 'main' | 'options' | 'end') => {
      for (const v of ['main', 'options', 'end']) $(`menu-${v}`).hidden = v !== view;
    };
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
  }
}
