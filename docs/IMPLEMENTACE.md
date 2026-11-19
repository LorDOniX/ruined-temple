# Ruined Temple TD – replika ve WebGL (three.js + TypeScript + Vite)

## 1. Shrnutí

Z mapy `Ruined Temple TD v.1.04.w3x` (Antsu, 2007) se podařilo vytěžit **veškerá data, která mapa obsahuje** –
terén, rozmístění doodadů a jednotek, regiony, zvukové definice, kompletní object data (81 vlastních jednotek,
42 schopností, buffy, výzkumy, doodady), všechny texty a **celou herní logiku z `war3map.j`**.
Mapa není chráněná, archiv je čitelný celý (27 souborů).

Na tomto základě je hotová hratelná webová replika:

- terén 96×64 dlaždic s výškami, originálními modely útesů, blendingem 9 pozemních textur stejným algoritmem jako hra, zapečenými stíny `.shd` a ztmavením mimo hratelnou plochu,
- 1221 doodadů (instancovaně), destructables (Temple Gate, 2 mříže, portál), budovy, builder, creepové, věže – vše originálními modely,
- **herní logika přepsaná z triggerů 1:1** (vlny, obtížnost, trasa creepů, útok na bránu, životy, odměny, bonus za vlnu, prodej, Coin Basher, nákup života/opravy brány, výzkumy, tech-tree požadavky, obránci chrámu…),
- HUD jako ve hře (Human konzole TFT 1.26 z originálních textur, rozložení podle `UI\FrameDef\UI\*.fdf`): horní tlačítka, zdroje, hodiny dne/noci, multiboard s ikonami, zprávy, minimapa s tlačítky, 3D portrét, info panel s ikonami útoku/zbroje, command card s hotkeyi z dat mapy, tooltipy, menu, dialog obtížnosti, questy.

**Co v mapě není** – 3D modely, textury, ikony, zvuky, hudba a výchozí hodnoty základních objektů – se bere
z lokální instalace hry (**Warcraft III Gold Edition, patch 1.26a**) a z HD texturového modu **Classic HD for Classic**
nástrojem `npm run assets` (kap. 6). Bez nich aplikace stále funguje se zástupnými tvary a procedurálními texturami.

## 2. Spuštění

```bash
npm install
npm run extract      # .w3x → public/map/ (už vygenerováno; spustit znovu jen při změně mapy)
npm run assets -- --game "Warcraft III - Gold Edition" --dir "Classic HD for Classic-15-1-0-1734261393"
npm run dev          # http://127.0.0.1:5199
npm run build        # produkční build do dist/
npm run report       # přehled vytěžených dat → docs/DATA.md
```

Ovládání: levé tlačítko výběr / potvrzení stavby, tažením výběr více jednotek (Shift přidává), pravé pohyb / vynucený cíl věže, šipky + okraj obrazovky + prostřední
tlačítko posun kamery, kolečko zoom, hotkeye jako ve hře (zvýrazněné písmeno v tooltipu), `Tab` / tlačítko nečinného dělníka = builder,
`Alt` ukazatele zdraví, `Esc` zpět, `F9` úkoly, `F10` nabídka (pauza, rychlost 1×/2×/4×, hudba, regiony, pathing, nápověda – v singleplayeru pauzuje hru),
`F11` spojenci, `F2` regiony + trasa creepů, `F3` pathing mapa. Tlačítka Chat, minimapy, Hold/Patrol/Repair jsou jen vizuální (Patrol = pohyb).
V konzoli prohlížeče jsou k dispozici objekty `game`, `view`, `cam`, `db`, `map`, `hud`, `portrait` a `frame(dt)`.

## 3. Architektura

```
 Ruined Temple TD v.1.04.w3x
        │  tools/extract.ts  (mdx-m3-viewer: MPQ + parsery w3e/w3i/doo/w3r/w3s/w3u/w3a/…; vlastní JASS parser)
        ▼
 public/map/map.json, minimap.png, preview.png, war3map.j          data/raw/* (surové soubory z MPQ)
        │
 Instalace WC3 ──► tools/assets.ts (SLK + metadata + profile TXT, MDX, BLP, WAV) ──► public/war3/** + catalog.json   (volitelné)
        │
        ▼  prohlížeč
 src/main.ts
   ├─ data/objects.ts   ObjectDB: modifikace z mapy ⊕ catalog.json (SLK hry) ⊕ výchozí hodnoty (předpoklady)
   ├─ game/game.ts      simulace + port triggerů (TriggerSleepAction → `yield` v generátorech, synchronní deterministický plánovač v herním čase)
   │   ├─ game/pathing.ts  mřížka war3map.wpm (32×32), obsazenost budovami/blockery, A*
   │   └─ game/combat.ts   tabulka útok × brnění (patch 1.21), redukce brněním, kostky
   ├─ render/terrain.ts terén: výšky, blending textur (port mdx-m3-viewer shaderu), útesy, stíny
   ├─ render/textures.ts procedurální textury ve stejném layoutu jako originální tileset BLP
   ├─ render/world.ts   synchronizace stavu hry se scénou (jednotky, doodady, projektily, efekty, HP bary, hover štítek, ghost stavby)
   ├─ render/mdx.ts     loader originálních MDX/BLP → three.js (skeletální animace, emitory částic, kamera portrétu)
   ├─ render/particles.ts ParticleEmitter2 – simulace na CPU, dávkové billboardy podle textury a blend módu
   ├─ render/portrait.ts 3D portrét (`*_portrait.mdx`, sekvence „Portrait“, kamera z modelu) do otvoru konzole
   ├─ render/placeholders.ts zástupné tvary
   ├─ render/camera.ts  WC3 kamera (AoA 304°, vzdálenost 1650, FOV 70°, hranice z w3i)
   ├─ ui/hud.ts         Human konzole (textury + FDF souřadnice), command card, info panel, multiboard, minimapa, dialogy
   ├─ style.css         rozložení konzole v UI jednotkách obrazovky 0,8 × 0,6 (`--sx`, `--sy` = px na jednotku)
   └─ sound.ts          přehrávání originálních zvuků (pokud jsou dodány)
```

Souřadnice: vše uvnitř `WorldView.world` je ve světových jednotkách WC3 (X východ, Y sever, Z nahoru);
skupina je otočená o −90° kolem X, takže data se nikde nepřepočítávají.

## 4. Co se z mapy vytěžilo

| Soubor v .w3x | Obsah | Kde se používá |
|---|---|---|
| `war3map.w3e` | 97×65 rohů: výška, vrstva útesu, textura, variace, rampy, příznaky | `render/terrain.ts`, výšky jednotek |
| `war3map.w3i` | název, popis, hráči, síly, kamera, hratelná plocha, tileset `Z` | kamera, HUD, minimapa, hranice |
| `war3map.wpm` | pathing 384×256 (walk/fly/build) | stavění, A* buildera, overlay F3 |
| `war3map.shd` | zapečené stíny doodadů | shader terénu |
| `war3map.doo` | 1221 doodadů/destructables (ID, variace, pozice, rotace, měřítko) | `render/world.ts`, pathing blockery |
| `war3mapUnits.doo` | start lokace, 3× Spawning Grounds, 3× builder, Hightower | `game.start()` |
| `war3map.w3r` | 14 regionů (Spawn, Path1–10, Gate, Goal, Final Path) – ověřeno proti `Rect()` v JASS | trasa creepů, triggery |
| `war3map.w3s` | 33 zvuků (cesty, hlasitost, pitch) | `sound.ts` |
| `war3map.w3u/w3a/w3h/w3q/w3d/w3b` | 81 jednotek, 42 schopností, 7 buffů, 3 výzkumy, 23 doodadů, brána 2000 HP | `data/objects.ts` |
| `war3map.wts` | 488 textů (názvy, tooltipy, questy, zprávy) | všude (TRIGSTR_* rozbaleny) |
| `war3map.j` | **herní logika** – vlny, obtížnost, odměny, triggery | `tools/lib/jass.ts` → `map.game`, `game/game.ts` |
| `war3mapMap.blp`, `war3mapPreview.tga` | minimapa, náhled | HUD, favicon |
| `war3mapMisc.txt`, `war3mapExtra.txt` | MinUnitSpeed=100, MaxUnitLevel, obloha 4, denní doba | min. rychlost creepů |

Podrobný přehled vln, věží, výzkumů a schopností: [DATA.md](./DATA.md).

### Port triggerů

| Trigger (war3map.j) | Implementace |
|---|---|
| Intialization, Gold System, Dialog Button, Set Difficulty, Slow Selector, Starting Game | `trigIntialization`, `trigDialogButton`, `chooseDifficulty/setDifficulty`, `trigSlowSelector`, `trigStartingGame` (včetně časování a bílého fade) |
| SetPathPoints, Path0 Spawn, Path1–Path10, Gate | `onEnterRect` – události „unit enters region“ jako v enginu (i po vytvoření/teleportu jednotky) |
| Wave Spawn, Next Wave Set, Wave Clear, Timer Update, Clear Path | `trigWaveSpawn`, `trigNextWaveSet`, `trigWaveClear` (bonus `wave*10 + wave²/hráči`, otevření mříží, 15 s odpočet), `trigClearPath` |
| Gate Dies, Gate Repaired, Life Lost, Life Bought, Victory | `gateDies`, `gateRepaired`, `lifeLost` (teleport na spawn, porážka až při 0 životech + další průchod), `buy`, `trigVictory` |
| Sell Tower, Coin Basher | `sell` (75 % z `upoi`), `coinBash` (cena = číslo vlny, omráčení) |
| Multiplayer Bounty / nativní bounty | `kill` – 1 hráč: bounty jednotky, více hráčů: tabulka z JASS (včetně původní chyby, kde se přepisuje `Dice[20]`) |
| Multiboard Set/Kills/Gold, Quests | HUD |
| Units Stay In Temple | obránci vstupující do regionu Gate se teleportují zpět ke Spawning Grounds |
| Player Leaves | – (jen 1 lokální hráč) |

## 5. Věrnost – stav

| Oblast | Stav |
|---|---|
| Rozložení mapy, výšky, regiony, trasa, pathing | ✅ z dat |
| Blending textur terénu | ✅ algoritmus hry + HD textury Ruins z modu |
| Útesy | ✅ originální modely (Cliffs / CityCliffs) zvednuté o výšku terénu jako ve hře; rampy zatím jako svah |
| Doodady / jednotky / budovy | ✅ originální MDX (varianta podle `uani`, team color, replaceable textury, animovaná ID textur); doodady staticky v pose „stand“ |
| Ikony | ✅ HD ikony z modu v command card, info panelu (`infocard-*`, cizí jednotky `infocard-neutral-*`), multiboardu a tlačítkách minimapy |
| Rozhraní (konzole) | ✅ podle videa: `HumanUITile01–04` rozložené dle `ConsoleUI.fdf` (horní pruh v 0–0,125, spodní v 0,3125–1), kryt inventáře se znakem, hodiny dne/noci (`HumanUITile-TimeIndicator*`, den = 8 min), tlačítka `human-console-buttonstates2`, zdroje dle `ResourceBar.fdf` („Žádná údržba“), multiboard dle `MultiBoard.fdf` (šířky sloupců a ikony z triggeru), okraje z edge souborů (`editbox-border`, `human-tooltip-border`, `human-options-menu-border`), font `FRIZQT__.TTF`, české popisky jako v CZ klientu (Útok, Zbroj, Nezranitelný, Úroveň, Stav, Dokončeno: …) |
| Náhled jednotek | ✅ 3D portrét s HP (barva podle zdraví; u nezranitelných budov skryto), info panel: jméno, „Úroveň N“ u creepů, útok (skrytý u zbraní jen na „debris“ – vlnoví creepové), zbroj, stav; tooltipy statistik; při výběru více jednotek mřížka ikon s HP; štítek „Creeps“ s HP barem nad jednotkou pod kurzorem; HP bary nad jednotkami jen s `Alt` jako ve hře |
| Potvrzení příkazů | ✅ `Confirmation.mdl` (3 šipky sbíhající se do bodu, zeleně) při pohybu, `Target.mdl` (červeně) při útoku na jednotku – dle `TargetPointConfirm` / `TargetUnitConfirm` v `UI\war3skins.txt`, barvy ověřeny podle videa |
| Animace jednotek | ✅ skeletální animace MDX (kosti z uzlů modelu, matrix groups → skinning, klipy pro každou sekvenci): stand / walk (rychlost dle pohybu) / attack / death / birth (při stavbě natažená na dobu stavby); výběr sekvence podle značek jako ve hře („Stand Upgrade First Ready Attack“), viditelnost geosetů per sekvence |
| Projektily | ✅ originální model zbraně (`ua1m`): sekvence „stand“ za letu natočená po dráze, při dopadu „death“ (výbuch) na místě; vystřelení v bodě poškození útoku (`udp1`, u věží 0,3 s), odpaliště `ulpx/ulpy/ulpz`, výška zásahu `uimz`, rychlost `ua1z`, oblouk `uma1` |
| Částicové efekty | ✅ ParticleEmitter2 (jednotky, projektily – kouř dělových koulí, výbuchy, oheň, mráz…): rychlost, rozptyl, gravitace, šířka/délka, segmenty barvy/alfy/měřítka, head/tail, buňky textury, squirt, animované KP2V/KP2E/KP2S…; ❌ ribbony (stopy šípů), ParticleEmitter (typ 1), animace doodadů |
| Herní logika triggerů | ✅ |
| Statistiky věží a creepů | ✅ z mapy + nezměněná pole z originálních SLK tabulek 1.26a |
| Schopnosti věží | ✅ jed/zpomalení (Aspo), odrazy (`mbounce`: `utc1`/`udl1`/`ua1f`), multishot (Aroc), bash/zmrazení (ACbh), auro útočné rychlosti a poškození (AOae/ACac), detekce neviditelných (Adts + výzkum R001), Searing Arrows bonus |
| Schopnosti creepů | ✅ neviditelnost (Apiv), imunita na magii (Amim), úhyb (ACev), Phase Shift (Apsh); ❌ Bloodlust (AI sesílání), Resistant Skin, Asp3 |
| Obránci chrámu | ✅ trénink, výzkum zbraní, útok; ❌ jejich aktivní kouzla (Share Mana, Mana Drain, Bless Weapons, Skyfury) |
| Zvuky a hudba | ✅ všech 33 zvuků mapy; hudba dle `SetMapMusic("Music")` = Human playlist z `UI\war3skins.txt` (4 skladby, náhodně) |
| Multiplayer (1–3 hráči co-op) | ❌ jen 1 hráč lokálně (logika počítá s počtem hráčů – lze rozšířit) |

## 6. Co z dat mapy získat nejde – odkud se to bere

### 6.1 Assety (vyřešeno)

| Zdroj | Co z něj bereme |
|---|---|
| `Warcraft III - Gold Edition` (patch 1.26a, `war3.mpq`, `War3x.mpq`, `War3xLocal.mpq`, `War3Patch.mpq`) | 436 MDX modelů (jednotky, budovy, doodady, útesy, projektily), SLK/TXT tabulky, 33 WAV zvuků, 4 MP3 skladby, team color |
| `Classic HD for Classic` (mod z Nexusu, jen DDS textury) | HD textury terénu Ruins, útesů (`_tilesets\z.w3mod`), ikony, textury jednotek a doodadů |

`npm run assets -- --game <složka hry> --dir <mod>` čte MPQ přes **StormLib (WebAssembly)** – vestavěný parser
mdx-m3-viewer nezvládal `war3.mpq` a WAVy s kompresí huffman. Pozdější zdroj má přednost, takže HD textura z modu
přebije klasické BLP (bez `--dir` vznikne čistě klasický SD vzhled). DDS se převádí na PNG (max. 1024 px).
Výstup `public/war3/` (~200 MB, 941 souborů) je v `.gitignore` – Blizzard assety se nesmí commitovat;
stejně tak složky hry a modu v projektu.

Pozn.: hra je česká lokalizace, takže názvy základních objektů, které mapa nepřejmenovává (např. Spawning Grounds
`h000` = základ „Kasárna“), se zobrazují česky – stejně jako v této instalaci hry.

### 6.2 Výchozí hodnoty základních objektů (vyřešeno)

Pole, která mapa nemění, se doplňují z originálních tabulek (`catalog.json`) přes metadata (`UnitMetaData`,
`AbilityMetaData`, `UpgradeMetaData`) – např. kostky útoku/bounty, doba tréninku obránců, ceny výzkumů
(Rhac 100 + 200/úroveň dle mapy), Evasion 15 %, Phase Shift 1,5 s. Odhady v `BASE_*_DEFAULTS` se použijí jen bez assetů.

Zjištění z tabulek, která mění hratelnost:
- **Cena upgradu = rozdíl cen** – `goldcost` vylepšovaných budov je v SLK kumulativní (Keep 705 = Town Hall 385 + 320),
  engine účtuje rozdíl. Upgrade Arrow (10) → Improved Arrow (15) tedy stojí 5 zlata.
- Věže bez vlastní ceny (Lightning Tower aj.) stojí jako Guard Tower = 100.
- Moon Glaive (`Amgl`) v 1.26 jen zapíná odrazy; počet cílů/ztráta jsou pole zbraně (`utc1`, `udl1`, poloměr `ua1f`).

### 6.3 Chování enginu (není v žádných datech – aproximováno)

- **Pohyb creepů**: mapa jim nastavuje typ pohybu „none“ (`umvt=""`) → jdou přímo mezi středy regionů bez kolizí
  (koridory jsou nestavitelné, takže to odpovídá). Builder a obránci používají A* po `war3map.wpm`.
- **Výběr cíle věží**: drží cíl, dokud je v dosahu, jinak nejbližší; pravým tlačítkem lze cíl vynutit.
- **Tabulka poškození**: verze 1.21+ (shodná s 1.26a) – Divine brnění bere 5 %.
- **Dosah aur** se měří k okraji cíle (+72), aby „must be touching“ aura zasáhla 8 sousedů.
- **Obchod Hightower**: nákup bez požadavku na blízkost jednotky (ve hře `Ane2` vyžaduje jednotku poblíž).
- **Stavba**: budova se staví sama, builder k ní jen dojde (u Human builderu ve hře stavba čeká na buildera).
- Obránci nechodí za cílem (drží pozici), AI kouzel creepů/obránců není.

### 6.4 Otevřené body

1. **Video z hraní** – ✅ porovnáno (HUD, střely, výbuchy, náhled nepřátel, zprávy). Zbývá: krvavé skvrny po smrti creepů, ribbony.
2. Multiplayer není cílem (rozhodnuto), hraje 1 lokální hráč.

## 7. Další fáze (návrh)

1. **Prostředí** – rampy (modely přechodů), skybox a DNC osvětlení Ruins (`Environment\DNC\DNCRuins`), animovaná voda ve Spawning Grounds.
2. **Animace** – doplnit hermite/bezier interpolaci (teď lineární), globální sekvence, náhodné varianty stand podle rarity, animaci upgradu věží a animované doodady (palmy, vlajky).
3. **Efekty** – Ribbon emittery (stopy šípů), splaty/ubersplaty (krev, stopy výbuchů), lightning efekty (`CLSB`, `CLPB`).
4. **Zbývající schopnosti** – Bloodlust u Shamanů, aktivní kouzla obránců, Resistant Skin, Asp3.
5. Testy simulace (např. vitest) nad `Game` bez renderu – průchod vlny, bonusy, porážka/vítězství. Simulace běží synchronně, takže jde spouštět headless (ověřeno: 18 vln zrychleně bez chyb).

## 8. Známé drobnosti

- Kamera se nenatáčí (yaw), stejně jako ve hře.
- HP bary jsou sprity (zobrazí je `Alt`); vstupní dialog obtížnosti je pod bílým fade jako v originále.
- Info karty mají v textuře prázdný rámeček úrovně vylepšení; hra ho nezobrazuje, proto se při načtení nahrazuje zrcadlenou levou dolní čtvrtinou ikony.
- Portrét se kreslí druhým průchodem do téhož canvasu (scissor) pod DOM konzolí; bez `*_portrait.mdx` se použije model jednotky a jeho kamera, jinak záběr celé jednotky.
- Data `public/map/` lze kdykoli přegenerovat `npm run extract`; parser JASS při nečekané struktuře skriptu skončí chybou, aby jiná verze mapy tiše nedivergovala.
