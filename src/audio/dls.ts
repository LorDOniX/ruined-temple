/**
 * Ambient sounds of Warcraft III maps (SetAmbientDaySound / SetAmbientNightSound): the game plays a MIDI file
 * with the instruments of a DLS level 1 sound bank through DirectMusic. Browsers have neither, so this module
 * parses both and plays the notes with WebAudio: every note is a buffer source of the region's sample, pitched
 * from the region's unity note, with the loop of the sample while the note is held, channel volume (CC7),
 * pan (CC10) and velocity. The sequence repeats when it ends (the ambient files are 3-minute loops).
 */

interface Loop {
  start: number;
  length: number;
}

interface Region {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  wave: number;
  unityNote: number | null;
  fineTune: number;
  gain: number;
  loop: Loop | null;
}

interface Instrument {
  bank: number;
  program: number;
  drum: boolean;
  regions: Region[];
}

interface Wave {
  rate: number;
  channels: number;
  bits: number;
  data: Uint8Array;
  unityNote: number;
  fineTune: number;
  gain: number;
  loop: Loop | null;
}

export interface DlsBank {
  instruments: Instrument[];
  waves: Wave[];
}

export interface MidiNote {
  time: number;
  duration: number;
  channel: number;
  key: number;
  velocity: number;
  program: number;
  volume: number;
  pan: number;
}

export interface MidiSong {
  notes: MidiNote[];
  length: number;
}

const fourcc = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

/** Walks RIFF chunks of a range; LIST chunks are reported with their list type and the offset after it. */
function chunks(v: DataView, start: number, end: number, cb: (id: string, o: number, size: number, listType?: string) => void) {
  for (let o = start; o + 8 <= end; ) {
    const id = fourcc(v, o);
    const size = v.getUint32(o + 4, true);
    if (id === 'LIST' || id === 'RIFF') cb(id, o + 12, size - 4, fourcc(v, o + 8));
    else cb(id, o + 8, size);
    o += 8 + size + (size & 1);
  }
}

function wsmp(v: DataView, o: number) {
  const cb = v.getUint32(o, true);
  const unityNote = v.getUint16(o + 4, true);
  const fineTune = v.getInt16(o + 6, true);
  const gain = v.getInt32(o + 8, true);
  const loops = v.getUint32(o + 16, true);
  let loop: Loop | null = null;
  if (loops > 0) {
    const l = o + cb;
    loop = { start: v.getUint32(l + 8, true), length: v.getUint32(l + 12, true) };
  }
  return { unityNote, fineTune, gain, loop };
}

/** DLS level 1 (RIFF "DLS "): instruments → regions → wave pool (ptbl offsets into wvpl). */
export function parseDls(buf: ArrayBuffer): DlsBank {
  const v = new DataView(buf);
  if (fourcc(v, 0) !== 'RIFF' || fourcc(v, 8) !== 'DLS ') throw new Error('not a DLS file');
  const instruments: Instrument[] = [];
  const waves: Wave[] = [];
  const cues: number[] = [];
  const waveAt = new Map<number, number>();
  chunks(v, 12, 8 + v.getUint32(4, true), (id, o, size, type) => {
    if (id === 'ptbl') {
      const cb = v.getUint32(o, true);
      const n = v.getUint32(o + 4, true);
      for (let i = 0; i < n; i++) cues.push(v.getUint32(o + cb + i * 4, true));
    } else if (id === 'LIST' && type === 'lins') {
      chunks(v, o, o + size, (iid, io, isize, itype) => {
        if (iid !== 'LIST' || itype !== 'ins ') return;
        const ins: Instrument = { bank: 0, program: 0, drum: false, regions: [] };
        chunks(v, io, io + isize, (cid, co, csize, ctype) => {
          if (cid === 'insh') {
            const bank = v.getUint32(co + 4, true);
            ins.drum = (bank & 0x80000000) !== 0;
            ins.bank = bank & 0x3fff;
            ins.program = v.getUint32(co + 8, true) & 0x7f;
          } else if (cid === 'LIST' && ctype === 'lrgn') {
            chunks(v, co, co + csize, (rid, ro, rsize, rtype) => {
              if (rid !== 'LIST' || rtype !== 'rgn ') return;
              const r: Region = { keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, wave: 0, unityNote: null, fineTune: 0, gain: 0, loop: null };
              chunks(v, ro, ro + rsize, (sid, so) => {
                if (sid === 'rgnh') {
                  r.keyLo = v.getUint16(so, true);
                  r.keyHi = v.getUint16(so + 2, true);
                  r.velLo = v.getUint16(so + 4, true);
                  r.velHi = v.getUint16(so + 6, true) || 127;
                } else if (sid === 'wsmp') {
                  const w = wsmp(v, so);
                  r.unityNote = w.unityNote;
                  r.fineTune = w.fineTune;
                  r.gain = w.gain;
                  r.loop = w.loop;
                } else if (sid === 'wlnk') r.wave = v.getUint32(so + 8, true);
              });
              ins.regions.push(r);
            });
          }
        });
        instruments.push(ins);
      });
    } else if (id === 'LIST' && type === 'wvpl') {
      // ptbl offsets are relative to the first byte after the "wvpl" list type (= o).
      chunks(v, o, o + size, (wid, wo, wsize, wtype) => {
        if (wid !== 'LIST' || wtype !== 'wave') return;
        const w: Wave = { rate: 22050, channels: 1, bits: 16, data: new Uint8Array(0), unityNote: 60, fineTune: 0, gain: 0, loop: null };
        chunks(v, wo, wo + wsize, (sid, so, ssize) => {
          if (sid === 'fmt ') {
            w.channels = v.getUint16(so + 2, true);
            w.rate = v.getUint32(so + 4, true);
            w.bits = v.getUint16(so + 14, true);
          } else if (sid === 'wsmp') Object.assign(w, wsmp(v, so));
          else if (sid === 'data') w.data = new Uint8Array(buf, so, ssize);
        });
        waveAt.set(wo - 12 - o, waves.length);
        waves.push(w);
      });
    }
  });
  // Region wave links are cue indices into the pool table.
  for (const ins of instruments) for (const r of ins.regions) r.wave = waveAt.get(cues[r.wave] ?? -1) ?? r.wave;
  return { instruments, waves };
}

/** Standard MIDI file → absolute-time notes with the channel's program, volume and pan at note-on. */
export function parseMidi(buf: ArrayBuffer): MidiSong {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  if (fourcc(v, 0) !== 'MThd') throw new Error('not a MIDI file');
  const ntracks = v.getUint16(10);
  const division = v.getUint16(12);
  type Ev = { tick: number; kind: 'on' | 'off' | 'prog' | 'cc' | 'tempo'; ch: number; a: number; b: number };
  const events: Ev[] = [];
  let o = 8 + v.getUint32(4);
  let lastTick = 0;
  for (let t = 0; t < ntracks && o + 8 <= b.length; t++) {
    const len = v.getUint32(o + 4);
    let p = o + 8;
    const end = p + len;
    let tick = 0;
    let running = 0;
    const vlq = () => {
      let x = 0;
      let c: number;
      do {
        c = b[p++];
        x = (x << 7) | (c & 0x7f);
      } while (c & 0x80);
      return x;
    };
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++;
      else st = running;
      if (st === 0xff) {
        const type = b[p++];
        const l = vlq();
        if (type === 0x51) events.push({ tick, kind: 'tempo', ch: 0, a: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2], b: 0 });
        p += l;
      } else if (st === 0xf0 || st === 0xf7) p += vlq();
      else {
        running = st;
        const hi = st & 0xf0;
        const ch = st & 15;
        const a = b[p++];
        const bb = hi === 0xc0 || hi === 0xd0 ? 0 : b[p++];
        if (hi === 0x90 && bb > 0) events.push({ tick, kind: 'on', ch, a, b: bb });
        else if (hi === 0x80 || hi === 0x90) events.push({ tick, kind: 'off', ch, a, b: 0 });
        else if (hi === 0xc0) events.push({ tick, kind: 'prog', ch, a, b: 0 });
        else if (hi === 0xb0) events.push({ tick, kind: 'cc', ch, a, b: bb });
      }
    }
    lastTick = Math.max(lastTick, tick);
    o = end;
  }
  // Note-offs first at the same tick, controllers before notes.
  const order = { off: 0, tempo: 1, prog: 2, cc: 3, on: 4 };
  events.sort((x, y) => x.tick - y.tick || order[x.kind] - order[y.kind]);
  // Ticks → seconds through the tempo map.
  let tempo = 500000;
  let lastT = 0;
  let secs = 0;
  const time = (tick: number) => secs + ((tick - lastT) * tempo) / 1e6 / division;
  const state = Array.from({ length: 16 }, () => ({ program: 0, volume: 100, pan: 64 }));
  const open = new Map<string, MidiNote>();
  const notes: MidiNote[] = [];
  for (const e of events) {
    const now = time(e.tick);
    if (e.kind === 'tempo') {
      secs = now;
      lastT = e.tick;
      tempo = e.a;
    } else if (e.kind === 'prog') state[e.ch].program = e.a;
    else if (e.kind === 'cc') {
      if (e.a === 7) state[e.ch].volume = e.b;
      if (e.a === 10) state[e.ch].pan = e.b;
    } else if (e.kind === 'on') {
      const s = state[e.ch];
      const n: MidiNote = { time: now, duration: 0, channel: e.ch, key: e.a, velocity: e.b, program: s.program, volume: s.volume, pan: s.pan };
      notes.push(n);
      open.set(`${e.ch}:${e.a}`, n);
    } else {
      const n = open.get(`${e.ch}:${e.a}`);
      if (n) {
        n.duration = now - n.time;
        open.delete(`${e.ch}:${e.a}`);
      }
    }
  }
  const length = time(lastTick);
  for (const n of open.values()) n.duration = length - n.time;
  return { notes, length };
}

/** PCM of a DLS wave as an AudioBuffer (8-bit unsigned or 16-bit signed). */
function toBuffer(ctx: BaseAudioContext, w: Wave): AudioBuffer | null {
  const bytes = w.bits / 8;
  const frames = Math.floor(w.data.byteLength / (bytes * w.channels));
  if (!frames || (bytes !== 1 && bytes !== 2)) return null;
  const out = ctx.createBuffer(w.channels, frames, w.rate);
  const dv = new DataView(w.data.buffer, w.data.byteOffset, w.data.byteLength);
  for (let c = 0; c < w.channels; c++) {
    const ch = out.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      const o = (i * w.channels + c) * bytes;
      ch[i] = bytes === 1 ? (dv.getUint8(o) - 128) / 128 : dv.getInt16(o, true) / 32768;
    }
  }
  return out;
}

/** Plays a MIDI song with a DLS bank in a loop until stopped; `output` receives the mix. */
export class DlsPlayer {
  private buffers: (AudioBuffer | null)[];
  private sources: { src: AudioBufferSourceNode; gain: GainNode; end: number }[] = [];
  private timer: number | null = null;
  private stopped = true;

  constructor(
    private readonly ctx: AudioContext,
    private readonly bank: DlsBank,
    private readonly song: MidiSong,
    private readonly output: AudioNode,
  ) {
    this.buffers = bank.waves.map((w) => toBuffer(ctx, w));
  }

  get playing() {
    return !this.stopped;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(this.ctx.currentTime + 0.05);
  }

  /** Stops all voices with a fade-out (seconds). */
  stop(fade = 0.5) {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    for (const s of this.sources) {
      s.gain.gain.cancelScheduledValues(now);
      s.gain.gain.setValueAtTime(s.gain.gain.value, now);
      s.gain.gain.linearRampToValueAtTime(0, now + fade);
      try {
        s.src.stop(now + fade + 0.02);
      } catch {
        /* not started yet */
      }
    }
    this.sources = [];
  }

  private schedule(t0: number) {
    if (this.stopped || this.song.length <= 0) return;
    for (const n of this.song.notes) this.note(n, t0);
    // Next pass of the loop, scheduled a moment before this one ends.
    const next = t0 + this.song.length;
    this.timer = window.setTimeout(() => {
      this.sources = this.sources.filter((s) => s.end > this.ctx.currentTime);
      this.schedule(next);
    }, Math.max(0, (next - this.ctx.currentTime - 2) * 1000));
  }

  private note(n: MidiNote, t0: number) {
    const ins = this.bank.instruments.find((i) => !i.drum && i.program === n.program) ?? this.bank.instruments.find((i) => i.program === n.program);
    const r = ins?.regions.find((x) => n.key >= x.keyLo && n.key <= x.keyHi && n.velocity >= x.velLo && n.velocity <= x.velHi) ?? ins?.regions.find((x) => n.key >= x.keyLo && n.key <= x.keyHi);
    const w = r ? this.bank.waves[r.wave] : undefined;
    const buf = r ? this.buffers[r.wave] : null;
    if (!r || !w || !buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const own = r.unityNote !== null;
    const unity = own ? r.unityNote! : w.unityNote;
    const fine = (own ? r.fineTune : w.fineTune) / 100;
    src.playbackRate.value = Math.pow(2, (n.key - unity + fine) / 12);
    const loop = (own ? r.loop : null) ?? w.loop;
    if (loop && loop.length > 0) {
      src.loop = true;
      src.loopStart = loop.start / w.rate;
      src.loopEnd = (loop.start + loop.length) / w.rate;
    }
    // lGain is in 1/655360 dB; MIDI volume and velocity follow the DLS default (squared) curves.
    const db = (own ? r.gain : w.gain) / 655360;
    const g = Math.pow(10, db / 20) * Math.pow(n.velocity / 127, 2) * Math.pow(n.volume / 127, 2);
    const gain = ctx.createGain();
    const start = t0 + n.time;
    const end = start + (src.loop ? n.duration : Math.min(n.duration + 2, buf.duration / src.playbackRate.value));
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(g, start + 0.02);
    gain.gain.setValueAtTime(g, Math.max(start + 0.02, end - 0.3));
    gain.gain.linearRampToValueAtTime(0, end);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (n.pan - 64) / 64));
    src.connect(gain).connect(pan).connect(this.output);
    src.start(start);
    src.stop(end + 0.02);
    this.sources.push({ src, gain, end });
  }
}
