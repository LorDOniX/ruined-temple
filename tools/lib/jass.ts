import type { GameConfig, JassSound, WaveData } from '../../src/data/types';

/**
 * Pulls game-logic constants out of the World-Editor-generated war3map.j.
 * The script is GUI generated, so the patterns are very regular. Anything that cannot be
 * found throws, so a different map version fails loudly instead of silently diverging.
 */
export function parseJass(src: string, S: (v: unknown) => unknown): GameConfig {
  const fn = (name: string) => {
    const m = new RegExp(`^function ${name} takes[^\\n]*\\n([\\s\\S]*?)^endfunction`, 'm').exec(src);
    if (!m) throw new Error(`JASS function ${name} not found`);
    return m[1];
  };
  const str = (v: string) => String(S(v));
  const unq = (s: string) => s.replace(/^"|"$/g, '').replace(/\\\\/g, '\\');

  // Regions
  const regions: GameConfig['regions'] = {};
  for (const m of fn('CreateRegions').matchAll(/set gg_rct_(\w+) = Rect\( ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+) \)/g)) {
    regions[m[1].replace(/_/g, ' ')] = { minX: +m[2], minY: +m[3], maxX: +m[4], maxY: +m[5] };
  }

  // Sounds
  const sounds: Record<string, JassSound> = {};
  const initSounds = fn('InitSounds');
  for (const m of initSounds.matchAll(/set (gg_snd_\w+) = CreateSound\( ("(?:[^"\\]|\\.)*"), (true|false), (true|false), (true|false), \d+, \d+, ("[^"]*") \)/g)) {
    sounds[m[1]] = { file: unq(m[2]), looping: m[3] === 'true', is3D: m[4] === 'true', eax: unq(m[6]) };
  }
  for (const m of initSounds.matchAll(/call SetSound(Volume|Pitch|Duration)\( (gg_snd_\w+), ([\d.]+) \)/g)) {
    const s = sounds[m[2]];
    if (s) s[m[1].toLowerCase() as 'volume' | 'pitch' | 'duration'] = +m[3];
  }

  // Waves: wave 1 comes from InitGlobals + Starting_Game, the rest from Next_Wave_Set.
  const globals = fn('InitGlobals');
  const g = (re: RegExp) => {
    const m = re.exec(globals);
    if (!m) throw new Error(`Global not found: ${re}`);
    return m[1];
  };
  const waveSound = (v: string) => (sounds[v] ? sounds[v].file : null);
  const startGame = fn('Trig_Starting_Game_Actions');
  const firstSound = /set udg_Wave_Sound = (gg_snd_\w+)/.exec(startGame)?.[1] ?? '';
  const waves: WaveData[] = [
    {
      wave: +g(/set udg_Wave_Count = (\d+)/),
      unit: g(/set udg_Spawn_Unit = '(\w{4})'/),
      name: g(/set udg_Spawn_Unit_Name = "([^"]*)"/),
      spawnCooldown: +g(/set udg_Spawn_Cooldown = ([\d.]+)/),
      sound: waveSound(firstSound),
    },
  ];
  const condWave: Record<string, number> = {};
  for (const m of src.matchAll(/function (Trig_Next_Wave_Set_Func\d+C) takes nothing returns boolean\s+if \( not \( udg_Wave_Count == (\d+) \) \)/g)) {
    condWave[m[1]] = +m[2];
  }
  const nextWave = fn('Trig_Next_Wave_Set_Actions');
  for (const m of nextWave.matchAll(/if \( (Trig_Next_Wave_Set_Func\d+C)\(\) \) then([\s\S]*?)return/g)) {
    const body = m[2];
    const get = (re: RegExp) => re.exec(body)?.[1];
    waves.push({
      wave: condWave[m[1]],
      unit: get(/set udg_Spawn_Unit = '(\w{4})'/)!,
      name: get(/set udg_Spawn_Unit_Name = "([^"]*)"/)!,
      spawnCooldown: +get(/set udg_Spawn_Cooldown = ([\d.]+)/)!,
      sound: waveSound(get(/set udg_Wave_Sound = (gg_snd_\w+)/) ?? ''),
    });
  }
  waves.sort((a, b) => a.wave - b.wave);
  waves.forEach((w, i) => {
    if (w.wave !== i + 1 || !w.unit) throw new Error(`Wave table is not contiguous at ${i + 1}`);
  });

  const waveSpawn = fn('Trig_Wave_Spawn_Actions');
  const unitsPerWave = (waveSpawn.match(/CreateNUnitsAtLoc\( 1, udg_Spawn_Unit/g) ?? []).length;

  const waveClear = src.match(/udg_Wave_Count > (\d+)/);
  const lastWave = waveClear ? +waveClear[1] + 1 : waves.length;

  const init = fn('Trig_Intialization_Actions');
  const livesPerPlayer = +(/set udg_Lives = \( (\d+) \* udg_Player_Count \)/.exec(init)?.[1] ?? 10);
  const startGold = +(/PLAYER_STATE_RESOURCE_GOLD, (\d+) \)/.exec(init)?.[1] ?? 0);
  const nextWaveDelay = +(/StartTimerBJ\( udg_Next_Wave_Timer, false, ([\d.]+) \)/.exec(fn('Trig_Wave_Clear_Actions'))?.[1] ?? 15);

  // Path: Spawn Region -> Path[1..10] -> Gate -> Goal (see Trig_PathN triggers).
  const setPath = fn('Trig_SetPathPoints_Actions');
  const pathRects: string[] = [];
  for (const m of setPath.matchAll(/set udg_Path\[(\d+)\] = gg_rct_(\w+)/g)) pathRects[+m[1]] = m[2].replace(/_/g, ' ');
  const spawnRect = /udg_SpawnPoint = GetRectCenter\(gg_rct_(\w+)\)/.exec(setPath)?.[1].replace(/_/g, ' ') ?? 'Spawn Region';
  const path = [spawnRect, ...pathRects.filter(Boolean), 'Gate', 'Goal'];

  // Bounty tables (multiplayer). Order of assignments matters – the original has a typo that overwrites Dice[20].
  const gold = fn('Trig_Gold_System_Actions');
  const base: number[] = new Array(lastWave + 1).fill(0);
  const dice: number[] = new Array(lastWave + 1).fill(0);
  for (const m of gold.matchAll(/set udg_(BountyBase|Bounty_Dice)\[(\d+)\] = (\d+)/g)) {
    (m[1] === 'BountyBase' ? base : dice)[+m[2]] = +m[3];
  }

  // Difficulty dialog
  const dialog = fn('Trig_Dialog_Button_Actions');
  const btn = [...dialog.matchAll(/DialogAddButtonBJ\( udg_Difficulty_Dialog, "(TRIGSTR_\d+)" \)\s+set udg_Difficulty_(\w+) =/g)];
  const setDiff = fn('Trig_Set_Difficulty_Actions');
  const factors = [...setDiff.matchAll(/set udg_Difficulty_Factor = ([\d.]+)[\s\S]*?DisplayTimedTextToForce\( GetPlayersAll\(\), [\d.]+, "(TRIGSTR_\d+)" \)/g)];
  // Order in the script: Easy branch, Normal branch, else (Hard).
  const order = ['Easy', 'Normal', 'Hard'];
  const difficulties = order.map((id, i) => {
    const b = btn.find((x) => x[2] === id);
    return { id, label: b ? str(b[1]) : id, factor: +factors[i][1], message: str(factors[i][2]) };
  });
  const slow = fn('Trig_Slow_Selector_Actions');
  const defaultFactor = +(/set udg_Difficulty_Factor = ([\d.]+)/.exec(slow)?.[1] ?? 100);
  const difficultyTimeout = +(/StartTimerBJ\( udg_Difficulty_Timer, false, ([\d.]+) \)/.exec(dialog)?.[1] ?? 10);

  const sell = /GetSpellAbilityId\(\) == '(\w{4})'[\s\S]*?function Trig_Sell_Tower_Actions[\s\S]*?\* ([\d.]+) \)/.exec(src);
  const coin = /function Trig_Coin_Basher_Conditions[\s\S]*?GetSpellAbilityId\(\) == '(\w{4})'/.exec(src);
  const repair = /function Trig_Gate_Repaired_Conditions[\s\S]*?GetUnitTypeId\(GetEnteringUnit\(\)\) == '(\w{4})'/.exec(src);
  const lifeBuy = /function Trig_Life_Bought_Conditions[\s\S]*?GetUnitTypeId\(GetEnteringUnit\(\)\) == '(\w{4})'/.exec(src);
  const temple = fn('Trig_Units_Stay_In_Temple_Func002C');
  const templeUnits = [...temple.matchAll(/== '(\w{4})'/g)].map((m) => m[1]);

  const messages: Record<string, string> = {};
  for (const m of src.matchAll(/"(TRIGSTR_\d+)"/g)) messages[m[1]] = str(m[1]);

  const quests: GameConfig['quests'] = [];
  for (const m of fn('Trig_Quests_Actions').matchAll(/CreateQuestBJ\( \w+, "(TRIGSTR_\d+)", "(TRIGSTR_\d+)", "([^"]+)" \)\s+call CreateQuestItemBJ\( GetLastCreatedQuestBJ\(\), "(TRIGSTR_\d+)" \)/g)) {
    quests.push({ title: str(m[1]), description: str(m[2]), icon: unq(`"${m[3]}"`), item: str(m[4]) });
  }

  const destructables: GameConfig['destructables'] = [];
  for (const m of fn('CreateAllDestructables').matchAll(/set (gg_dest_\w+) = CreateDestructable\( '(\w{4})', ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), \d+ \)/g)) {
    destructables.push({ variable: m[1], id: m[2], x: +m[3], y: +m[4], angle: +m[5], scale: +m[6] });
  }
  const preplacedUnits: GameConfig['preplacedUnits'] = [];
  for (const m of src.matchAll(/function Create(?:Buildings|Units)ForPlayer(\d+)[\s\S]*?set (gg_unit_\w+) = CreateUnit\( p, '(\w{4})', ([-\d.]+), ([-\d.]+), ([-\d.]+) \)/g)) {
    preplacedUnits.push({ player: +m[1], variable: m[2], id: m[3], x: +m[4], y: +m[5], angle: +m[6] });
  }

  if (!waves.length || !unitsPerWave || !sell || !coin || !repair || !lifeBuy) throw new Error('Unexpected war3map.j structure');

  return {
    regions,
    sounds,
    waves,
    unitsPerWave,
    lastWave,
    livesPerPlayer,
    startGold,
    nextWaveDelay,
    path,
    bounty: { base, dice },
    difficulties,
    defaultDifficulty: difficulties.findIndex((d) => d.factor === defaultFactor),
    difficultyTimeout,
    sellAbility: sell[1],
    sellRatio: +sell[2],
    coinBasherAbility: coin[1],
    gateRepairUnit: repair[1],
    lifeBuyUnit: lifeBuy[1],
    templeUnits,
    messages,
    quests,
    destructables,
    preplacedUnits,
  };
}
