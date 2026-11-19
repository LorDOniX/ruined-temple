import type { SoundDef } from './data/types';
import type { Wc3Assets } from './render/mdx';

export interface SoundOptions {
  /** World position of a 3D sound (WANT3D); omitted = played at full volume like interface sounds. */
  x?: number;
  y?: number;
  /** Acknowledgements: only one plays at a time, a new one cuts the previous (CHANNELFULLPREEMPT). */
  ack?: boolean;
}

/** Simultaneous voices of one label / in total – the game also limits sound channels. */
const MAX_PER_LABEL = 3;
const MAX_VOICES = 32;

/**
 * Plays original game sounds from public/war3 when available (classic .wav, Reforged .flac/.mp3).
 * Labelled sounds come from UI\SoundInfo\*.slk (catalog.sounds): a random file of the label, pitch
 * variance, and for 3D sounds distance attenuation (MinDistance → DistanceCutoff) and stereo panning
 * relative to the camera target, as the camera never rotates (screen right = world +X).
 * Without game files the game is silent – the sound paths are still logged once for reference.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private warned = new Set<string>();
  private playing = new Map<string, number>();
  private voices = 0;
  private ack: AudioBufferSourceNode | null = null;
  volume = 0.6;
  /** Listener position (camera target on the ground). */
  listener: () => { x: number; y: number } = () => ({ x: 0, y: 0 });

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

  setMusicVolume(v: number) {
    this.musicVolume = v;
    if (this.music) this.music.volume = v;
  }

  setMusic(on: boolean) {
    if (on !== this.musicOn) this.toggleMusic();
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

  private context() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // Autoplay policy: the context starts suspended until the first user gesture.
      const unlock = () => void this.ctx?.resume();
      addEventListener('pointerdown', unlock);
      addEventListener('keydown', unlock);
    }
    this.master!.gain.value = this.volume;
    return this.ctx;
  }

  private buffer(path: string) {
    const ctx = this.context();
    let p = this.cache.get(path);
    if (!p) {
      p = fetch(this.assets!.url(path))
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.cache.set(path, p);
    }
    return p;
  }

  /** A sound file (map sounds from war3map.w3s / triggers). */
  play(file: string, volume = 100, pitch = 1) {
    const path = this.resolve(file);
    if (!path) {
      if (!this.warned.has(file)) {
        this.warned.add(file);
        console.debug('[sound] missing', file);
      }
      return;
    }
    void this.buffer(path).then((buf) => buf && this.start(buf, Math.min(1.5, (volume || 100) / 100), pitch || 1, 0, path));
  }

  /** Whether the catalog knows a sound label. */
  has(label: string | undefined) {
    return !!label && !!this.assets?.catalog.sounds?.[label];
  }

  /** A labelled sound from UI\SoundInfo (catalog.sounds). */
  playLabel(label: string | undefined, opts: SoundOptions = {}) {
    const def: SoundDef | undefined = label ? this.assets?.catalog.sounds?.[label] : undefined;
    if (!def || !label) return;
    let gain = (def.volume || 127) / 127;
    let pan = 0;
    if (opts.x !== undefined && opts.y !== undefined && def.flags.includes('WANT3D')) {
      const l = this.listener();
      const d = Math.hypot(opts.x - l.x, opts.y - l.y);
      const cutoff = def.distanceCutoff || def.maxDistance || 3000;
      if (d > cutoff) return;
      const min = Math.max(1, def.minDistance || 600);
      gain *= d <= min ? 1 : min / d;
      pan = Math.max(-1, Math.min(1, (opts.x - l.x) / 1600)) * 0.8;
    }
    if ((this.playing.get(label) ?? 0) >= MAX_PER_LABEL || this.voices >= MAX_VOICES) return;
    const files = def.files.map((f) => this.resolve(f)).filter((f): f is string => !!f);
    if (!files.length) return;
    const path = files[Math.floor(Math.random() * files.length)];
    const variance = def.flags.includes('RANDOMPITCH') ? def.pitchVariance : 0;
    const pitch = (def.pitch || 1) * (1 + (Math.random() * 2 - 1) * variance);
    void this.buffer(path).then((buf) => {
      if (!buf) return;
      const src = this.start(buf, gain, pitch, pan, label);
      if (opts.ack && src) {
        try {
          this.ack?.stop();
        } catch {
          /* already finished */
        }
        this.ack = src;
      }
    });
  }

  private start(buf: AudioBuffer, gainValue: number, pitch: number, pan: number, key: string) {
    const ctx = this.context();
    if (ctx.state !== 'running') return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    let node: AudioNode = src.connect(gain);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.master!);
    this.playing.set(key, (this.playing.get(key) ?? 0) + 1);
    this.voices++;
    src.addEventListener('ended', () => {
      this.playing.set(key, (this.playing.get(key) ?? 1) - 1);
      this.voices--;
    });
    src.start();
    return src;
  }
}
