/**
 * Warcraft III damage rules as of patch 1.21/1.22 (the map is from Dec 2007).
 * Values are percentages of damage dealt by attack type (rows) against defense type (columns).
 */
const ARMOR = ['small', 'medium', 'large', 'fort', 'normal', 'hero', 'divine', 'none'] as const;
const TABLE: Record<string, number[]> = {
  normal: [100, 150, 100, 70, 100, 100, 5, 100],
  pierce: [200, 75, 100, 35, 100, 50, 5, 150],
  siege: [100, 50, 100, 150, 100, 50, 5, 150],
  magic: [125, 75, 200, 35, 100, 50, 5, 100],
  chaos: [100, 100, 100, 100, 100, 100, 100, 100],
  spells: [100, 100, 100, 100, 100, 70, 100, 100],
  hero: [100, 100, 100, 50, 100, 100, 5, 100],
};

export function attackMultiplier(attackType: string, defenseType: string) {
  const row = TABLE[attackType] ?? TABLE.normal;
  const col = ARMOR.indexOf((defenseType || 'none') as (typeof ARMOR)[number]);
  return row[col < 0 ? 7 : col] / 100;
}

/** Armor reduction: 6% per point (diminishing), negative armor amplifies. */
export function armorMultiplier(armor: number) {
  if (armor >= 0) return 1 - (armor * 0.06) / (1 + armor * 0.06);
  return 2 - Math.pow(0.94, -armor);
}

export function rollDamage(base: number, dice: number, sides: number, rnd: () => number) {
  let d = base;
  for (let i = 0; i < dice; i++) d += 1 + Math.floor(rnd() * Math.max(1, sides));
  return d;
}

/** GetRandomInt semantics: inclusive, tolerates swapped bounds. */
export function randomInt(a: number, b: number, rnd: () => number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.floor(rnd() * (hi - lo + 1));
}
