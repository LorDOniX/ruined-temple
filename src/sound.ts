import type { AmbientDef, AssetCatalog, SoundDef } from './data/types';
import type { Wc3Assets } from './render/mdx';
import { DlsPlayer, parseDls, parseMidi } from './audio/dls';

/** A looping sound that runs until stopped (spell loops, construction). */
export interface LoopHandle {
  stop(): void;
}

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
/** Default camera distance (RtsCamera); zooming out further moves the listener away from the ground. */
const BASE_ZOOM = 1650;

interface Voice {
  src: AudioBufferSourceNode;
  priority: number;
}

interface Loop {
  def: SoundDef;
  x?: number;
  y?: number;
  gain: number;
  node: GainNode | null;
  pan: StereoPannerNode | null;
}

/**
 * Plays original game sounds from public/war3 when available (classic .wav, Reforged .flac/.mp3).
 * Labelled sounds come from UI\SoundInfo\*.slk (catalog.sounds): a random file of the label, pitch
 * variance, and for 3D sounds distance attenuation (MinDistance → DistanceCutoff) and stereo panning
 * relative to the camera target, as the camera never rotates (screen right = world +X). Zooming out lifts the
 * listener (distance above the default zoom adds to the 3D distance). When all voices are taken, a sound with
 * a higher SLK Priority replaces the lowest-priority voice; acknowledgement / selection channels play one at a
 * time. Looping sounds update their volume and panning every frame as the camera moves.
 * Without game files the game is silent – the sound paths are still logged once for reference.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private warned = new Set<string>();
  private playing = new Map<string, number>();
  private voices: Voice[] = [];
  private loops = new Set<Loop>();
  private ack: AudioBufferSourceNode | null = null;
  volume = 0.6;
  /** Listener position (camera target on the ground) and camera distance. */
  listener: () => { x: number; y: number; zoom?: number } = () => ({ x: 0, y: 0 });

  /** Gain and panning of a 3D sound at (x, y); null when it is beyond DistanceCutoff. */
  private spatial(def: SoundDef, x: number | undefined, y: number | undefined) {
    const gain = (def.volume || 127) / 127;
    if (x === undefined || y === undefined || !def.flags.includes('WANT3D')) return { gain, pan: 0 };
    const l = this.listener();
    const lift = Math.max(0, (l.zoom ?? BASE_ZOOM) - BASE_ZOOM);
    const d = Math.hypot(x - l.x, y - l.y, lift);
    const cutoff = def.distanceCutoff || def.maxDistance || 3000;
    if (d > cutoff) return null;
    const min = Math.max(1, def.minDistance || 600);
    return { gain: gain * (d <= min ? 1 : min / d), pan: Math.max(-1, Math.min(1, (x - l.x) / 1600)) * 0.8 };
  }

  /** Volume and panning of running loops follow the camera. */
  update() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const l of this.loops) {
      if (!l.node) continue;
      const s = this.spatial(l.def, l.x, l.y);
      l.node.gain.setTargetAtTime(s ? s.gain : 0, now, 0.1);
      l.pan?.pan.setTargetAtTime(s ? s.pan : 0, now, 0.1);
    }
  }

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

  // --- ambience (SetAmbientDaySound / SetAmbientNightSound) ---------------------------------------------

  private ambient: { day: DlsPlayer | null; night: DlsPlayer | null; out: GainNode } | null = null;
  private ambientDef: NonNullable<AssetCatalog['ambient']> | null = null;
  private lastHour = -1;
  ambientOn = true;

  /** Loads the day / night MIDI + DLS ambience; it starts playing with the first setTimeOfDay() call. */
  async loadAmbient(def: AssetCatalog['ambient']) {
    if (!this.assets || !def) return;
    this.ambientDef = def;
    const ctx = this.context();
    const out = ctx.createGain();
    out.connect(this.master!);
    const load = async (a: AmbientDef | undefined) => {
      if (!a || !this.assets!.has(a.midi) || !this.assets!.has(a.dls)) return null;
      try {
        const [mid, dls] = await Promise.all([a.midi, a.dls].map((p) => fetch(this.assets!.url(p)).then((r) => r.arrayBuffer())));
        const gain = ctx.createGain();
        gain.gain.value = (a.volume / 127) * 0.8;
        gain.connect(out);
        return new DlsPlayer(ctx, parseDls(dls), parseMidi(mid), gain);
      } catch (e) {
        console.warn('ambient sound failed', a.midi, e);
        return null;
      }
    };
    const [day, night] = await Promise.all([load(def.day), load(def.night)]);
    this.ambient = { day, night, out };
  }

  /**
   * Game time of day (hours): day ambience from 6:00 to 18:00, night otherwise (cross-faded), a rooster at dawn
   * and a wolf howl at dusk like the engine.
   */
  setTimeOfDay(hour: number) {
    const a = this.ambient;
    const prev = this.lastHour;
    this.lastHour = hour;
    if (!a || !this.ctx || this.ctx.state !== 'running') return;
    const isDay = hour >= 6 && hour < 18;
    const want = !this.ambientOn ? null : isDay ? a.day : a.night;
    for (const p of [a.day, a.night]) if (p && p !== want && p.playing) p.stop(3);
    if (want && !want.playing) want.start();
    if (prev >= 0 && this.ambientOn) {
      const crossed = (h: number) => (prev < h && hour >= h) || (prev > hour && hour >= h && prev >= 23);
      if (crossed(6)) this.playLabel(this.ambientDef?.dawn);
      if (crossed(18)) this.playLabel(this.ambientDef?.dusk);
    }
  }

  // --- looping sounds --------------------------------------------------------------------------------

  /** Starts a looping labelled sound (e.g. MonsoonLoop, SiphonManaLoop); `duration` stops it automatically. */
  playLoop(label: string | undefined, opts: SoundOptions = {}, duration = 0): LoopHandle | null {
    const def: SoundDef | undefined = label ? this.assets?.catalog.sounds?.[label] : undefined;
    if (!def || !label) return null;
    const files = def.files.map((f) => this.resolve(f)).filter((f): f is string => !!f);
    if (!files.length) return null;
    const ctx = this.context();
    let src: AudioBufferSourceNode | null = null;
    const loop: Loop = { def, x: opts.x, y: opts.y, gain: 0, node: null, pan: null };
    let stopped = false;
    const handle: LoopHandle = {
      stop: () => {
        stopped = true;
        this.loops.delete(loop);
        const g = loop.node;
        if (src && g) {
          const now = ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + 0.3);
          src.stop(now + 0.35);
        }
      },
    };
    void this.buffer(files[Math.floor(Math.random() * files.length)]).then((buf) => {
      if (!buf || stopped || ctx.state !== 'running') return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const s = this.spatial(def, opts.x, opts.y);
      loop.node = ctx.createGain();
      loop.node.gain.value = s ? s.gain : 0;
      loop.pan = ctx.createStereoPanner();
      loop.pan.pan.value = s ? s.pan : 0;
      src.connect(loop.node).connect(loop.pan).connect(this.master!);
      this.loops.add(loop);
      src.start();
    });
    if (duration > 0) setTimeout(() => handle.stop(), duration * 1000);
    return handle;
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

  /** Whether a label is a looping sound (flag LOOPING or a "…Loop" label like MonsoonLoop). */
  isLooping(label: string) {
    const def = this.assets?.catalog.sounds?.[label];
    return !!def && (def.flags.includes('LOOPING') || /loop$/i.test(label));
  }

  /** Whether the catalog knows a sound label. */
  has(label: string | undefined) {
    return !!label && !!this.assets?.catalog.sounds?.[label];
  }

  /** A labelled sound from UI\SoundInfo (catalog.sounds). */
  playLabel(label: string | undefined, opts: SoundOptions = {}) {
    const def: SoundDef | undefined = label ? this.assets?.catalog.sounds?.[label] : undefined;
    if (!def || !label) return;
    const s = this.spatial(def, opts.x, opts.y);
    if (!s) return;
    const { gain, pan } = s;
    const priority = def.priority ?? 0;
    if ((this.playing.get(label) ?? 0) >= MAX_PER_LABEL || !this.freeVoice(priority)) return;
    // Unit voice channels (1 selection, 2 acknowledgement, 3 movement, 4 ready): one response at a time.
    const ack = opts.ack || (def.channel >= 1 && def.channel <= 4);
    const files = def.files.map((f) => this.resolve(f)).filter((f): f is string => !!f);
    if (!files.length) return;
    const path = files[Math.floor(Math.random() * files.length)];
    const variance = def.flags.includes('RANDOMPITCH') ? def.pitchVariance : 0;
    const pitch = (def.pitch || 1) * (1 + (Math.random() * 2 - 1) * variance);
    void this.buffer(path).then((buf) => {
      if (!buf) return;
      if (!this.freeVoice(priority)) return;
      const src = this.start(buf, gain, pitch, pan, label, priority);
      if (ack && src) {
        try {
          this.ack?.stop();
        } catch {
          /* already finished */
        }
        this.ack = src;
      }
    });
  }

  /** Whether a voice is available – steals the lowest-priority one when all are taken and it is less important. */
  private freeVoice(priority: number) {
    if (this.voices.length < MAX_VOICES) return true;
    let low: Voice | null = null;
    for (const v of this.voices) if (!low || v.priority < low.priority) low = v;
    if (!low || low.priority >= priority) return false;
    this.voices.splice(this.voices.indexOf(low), 1);
    try {
      low.src.stop();
    } catch {
      /* already finished */
    }
    return true;
  }

  private start(buf: AudioBuffer, gainValue: number, pitch: number, pan: number, key: string, priority = 0) {
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
    const voice: Voice = { src, priority };
    this.voices.push(voice);
    src.addEventListener('ended', () => {
      this.playing.set(key, (this.playing.get(key) ?? 1) - 1);
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    });
    src.start();
    return src;
  }
}
