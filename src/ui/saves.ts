import type { SaveData } from '../game/game';

/** Saved games in localStorage: an index of slots and one entry per save (Game.save() + camera). */
export interface SaveMeta {
  id: string;
  name: string;
  date: number;
  wave: number;
  time: number;
}

interface SaveEntry {
  data: SaveData;
  camera: { x: number; y: number };
}

const INDEX = 'ruined-temple-saves';
const PREFIX = 'ruined-temple-save:';
/** Save to load after the page reloads (a fresh scene is the simplest way to rebuild every view). */
const PENDING = 'ruined-temple-load';

export function listSaves(): SaveMeta[] {
  try {
    return (JSON.parse(localStorage.getItem(INDEX) ?? '[]') as SaveMeta[]).sort((a, b) => b.date - a.date);
  } catch {
    return [];
  }
}

/** Stores a save (overwrites a slot with the same name); returns an error text or null. */
export function writeSave(name: string, data: SaveData, camera: { x: number; y: number }, wave: number, time: number): string | null {
  const list = listSaves();
  const old = list.find((s) => s.name === name);
  const meta: SaveMeta = { id: old?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, date: Date.now(), wave, time };
  try {
    localStorage.setItem(PREFIX + meta.id, JSON.stringify({ data, camera } satisfies SaveEntry));
    localStorage.setItem(INDEX, JSON.stringify([meta, ...list.filter((s) => s.id !== meta.id)]));
    return null;
  } catch {
    return 'Hru nelze uložit – úložiště prohlížeče je plné. Smažte některou uloženou hru.';
  }
}

export function deleteSave(id: string) {
  localStorage.removeItem(PREFIX + id);
  localStorage.setItem(INDEX, JSON.stringify(listSaves().filter((s) => s.id !== id)));
}

/** Loads a save: reloads the page and restores it during start-up (takePendingLoad). */
export function requestLoad(id: string) {
  sessionStorage.setItem(PENDING, id);
  location.reload();
}

export function takePendingLoad(): SaveEntry | null {
  const id = sessionStorage.getItem(PENDING);
  if (!id) return null;
  sessionStorage.removeItem(PENDING);
  try {
    return JSON.parse(localStorage.getItem(PREFIX + id) ?? 'null') as SaveEntry | null;
  } catch {
    return null;
  }
}

export function formatGameTime(seconds: number) {
  const t = Math.floor(seconds);
  return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
