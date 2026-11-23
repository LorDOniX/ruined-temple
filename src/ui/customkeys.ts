/**
 * Keyboard shortcuts of the command card: the object data defaults, a QWER grid layout (key by button position),
 * or the game's CustomKeys.txt (see CustomKeyInfo.txt of the game: sections by object / ability / upgrade id or
 * CmdMove, CmdAttack …; Hotkey / Unhotkey / Researchhotkey, Buttonpos / Unbuttonpos, Tip / Untip; values per
 * level separated by commas; numeric key codes such as 512 = Esc).
 */
import { wc3ToHtml } from '../data/objects';

export type KeyLayout = 'default' | 'grid' | 'custom';

export interface KeyEntry {
  hotkey?: string;
  unhotkey?: string;
  buttonpos?: string;
  unbuttonpos?: string;
  tip?: string;
  untip?: string;
}

/** Source of a command card button for CustomKeys lookups. */
export interface KeyRef {
  /** Candidate sections, most specific first (custom id, then base id / generic command). */
  ids: string[];
  /** The "off" state (Unhotkey / Unbuttonpos / Untip). */
  un?: boolean;
  /** Level of upgrades with per-level hotkeys (1-based). */
  level?: number;
}

export interface KeyedButton {
  x: number;
  y: number;
  hotkey: string;
  tooltip: () => string;
  keys?: KeyRef;
}

export const GRID = [
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
];

export function parseCustomKeys(text: string) {
  const out = new Map<string, KeyEntry>();
  let cur: KeyEntry | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      cur = {};
      out.set(sec[1].trim().toLowerCase(), cur);
      continue;
    }
    const eq = line.indexOf('=');
    if (!cur || eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key === 'hotkey' || key === 'unhotkey' || key === 'buttonpos' || key === 'unbuttonpos' || key === 'tip' || key === 'untip') cur[key] = value;
  }
  return out;
}

/** "Q" / "512" (Esc) → command hotkey; `level` picks from "X,Y,Z". */
export function keyName(value: string, level = 1) {
  const parts = value.split(',').map((s) => s.trim());
  const v = parts[Math.min(parts.length, Math.max(1, level)) - 1] ?? '';
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n === 512) return 'ESCAPE';
    return n >= 32 && n < 127 ? String.fromCharCode(n).toUpperCase() : '';
  }
  return v.length === 1 ? v.toUpperCase() : '';
}

const pick = (value: string | undefined, level = 1) => {
  if (!value) return undefined;
  const parts = value.split(',').map((s) => s.trim());
  return parts[Math.min(parts.length, Math.max(1, level)) - 1];
};

/** Applies the layout to command card buttons (before slot collisions are resolved). */
export function applyKeys(cmds: KeyedButton[], layout: KeyLayout, keys: Map<string, KeyEntry> | null) {
  if (layout === 'default') return;
  for (const c of cmds) {
    const before = c.hotkey;
    let tip: string | undefined;
    if (layout === 'grid') {
      if (c.hotkey !== 'ESCAPE') c.hotkey = GRID[c.y]?.[c.x] ?? c.hotkey;
    } else if (keys && c.keys) {
      const e = c.keys.ids.map((id) => keys.get(id.toLowerCase())).find(Boolean);
      if (!e) continue;
      const level = c.keys.level ?? 1;
      const hk = c.keys.un ? e.unhotkey ?? e.hotkey : e.hotkey;
      if (hk) c.hotkey = keyName(hk, level) || c.hotkey;
      const pos = c.keys.un ? e.unbuttonpos ?? e.buttonpos : e.buttonpos;
      const m = pos && /^\s*(\d+)\s*,\s*(\d+)/.exec(pos);
      if (m) {
        c.x = Math.min(3, Number(m[1]));
        c.y = Math.min(2, Number(m[2]));
      }
      tip = pick(c.keys.un ? e.untip ?? e.tip : e.tip, level);
    }
    if (c.hotkey === before && !tip) continue;
    const base = c.tooltip;
    const key = c.hotkey === 'ESCAPE' ? 'Esc' : c.hotkey;
    c.tooltip = () => {
      const html = base();
      const title = /^<div class="tt-title">([\s\S]*?)<\/div>/.exec(html);
      if (!title) return html;
      const old = before === 'ESCAPE' ? 'Esc' : before;
      const text = tip ? wc3ToHtml(tip) : old ? title[1].replace(new RegExp(`\\s*\\((?:<[^>]+>)*${old}(?:<[^>]+>)*\\)`, 'i'), '') : title[1];
      return `<div class="tt-title">${text} <span class="tt-hotkey">[${key}]</span></div>${html.slice(title[0].length)}`;
    };
  }
}
