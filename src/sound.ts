import type { Wc3Assets } from './render/mdx';

/**
 * Plays original game sounds from public/war3 when available (classic .wav, Reforged .flac/.mp3).
 * Without game files the game is silent – the sound paths are still logged once for reference.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private warned = new Set<string>();
  volume = 0.6;

  constructor(private readonly assets: Wc3Assets | null) {}

  private music: HTMLAudioElement | null = null;
  private playlist: string[] = [];
  private track = 0;
  musicOn = true;
  musicVolume = 0.35;

  /** SetMapMusic(list, random=true): plays the playlist in random order, looping; starts after the first user gesture if autoplay is blocked. */
  startMusic(files: string[]) {
    if (!this.assets) return;
    this.playlist = files.filter((f) => this.assets!.has(f)).sort(() => Math.random() - 0.5);
    if (!this.playlist.length) return;
    this.music = new Audio();
    this.music.volume = this.musicVolume;
    this.music.addEventListener('ended', () => this.nextTrack());
    this.nextTrack();
  }

  private nextTrack() {
    if (!this.music || !this.playlist.length) return;
    this.music.src = this.assets!.url(this.playlist[this.track++ % this.playlist.length]);
    if (this.musicOn) this.resume();
  }

  private resume() {
    this.music?.play().catch(() => {
      const go = () => {
        removeEventListener('pointerdown', go);
        removeEventListener('keydown', go);
        if (this.musicOn) void this.music?.play();
      };
      addEventListener('pointerdown', go);
      addEventListener('keydown', go);
    });
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicOn) this.resume();
    else this.music?.pause();
    return this.musicOn;
  }

  get hasMusic() {
    return this.playlist.length > 0;
  }

  private resolve(file: string) {
    if (!this.assets) return null;
    const base = file.replace(/\.(wav|mp3|flac)$/i, '');
    for (const ext of ['.wav', '.flac', '.mp3']) if (this.assets.has(base + ext)) return base + ext;
    return null;
  }

  play(file: string, volume = 100, pitch = 1) {
    const path = this.resolve(file);
    if (!path) {
      if (!this.warned.has(file)) {
        this.warned.add(file);
        console.debug('[sound] missing', file);
      }
      return;
    }
    this.ctx ??= new AudioContext();
    const ctx = this.ctx;
    let p = this.cache.get(path);
    if (!p) {
      p = fetch(this.assets!.url(path))
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.cache.set(path, p);
    }
    void p.then((buf) => {
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch || 1;
      const gain = ctx.createGain();
      gain.gain.value = this.volume * Math.min(1.5, (volume || 100) / 100);
      src.connect(gain).connect(ctx.destination);
      src.start();
    });
  }
}
