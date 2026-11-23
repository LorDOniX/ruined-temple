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
npm test             # headless testy simulace (vitest, tests/simulation.test.ts)
```

Ovládání: levé tlačítko výběr / potvrzení stavby (Shift = další stavba do fronty dělníka), tažením výběr více jednotek (Shift přidává), dvojklik / Ctrl+klik = všechny
jednotky stejného typu na obrazovce, pravé pohyb / vynucený cíl věže / pokračování rozestavěné věže dělníkem, `Ctrl+0–9` uloží skupinu, `Shift+0–9` přidá, `0–9` vybere
(dvakrát rychle = kamera na skupinu; fyzické klávesy, takže funguje i česká řada `+ěščř…`), šipky + okraj obrazovky + prostřední
tlačítko posun kamery, kolečko zoom, hotkeye jako ve hře (zvýrazněné písmeno v tooltipu), `Tab` = další podskupina při výběru více typů jednotek (mřížka drží pořadí, aktivní podskupina je zlatě orámovaná), jinak builder; tlačítko nečinného dělníka = builder,
`Alt` ukazatele zdraví, `Esc` zpět, `F9` úkoly, `F10` nabídka jako ve hře (pauza, Možnosti: rychlost hry, rychlost posunu myší a klávesnicí, zvuk a hudba
s hlasitostí – ukládá se do `localStorage`, ladění regionů a pathingu; Ukončit hru: restart / vzdát; v singleplayeru pauzuje hru),
`F11` spojenci, `F2` regiony + trasa creepů, `F3` pathing mapa. Obránci: Držet pozici (H) vypne pronásledování, kouzla na tlačítkách (Share Mana – autocast
pravým tlačítkem, Mana Drain a Skyfury s cílem, Bless Weapons). Klik na ikonu ve frontě výroby ji zruší. `Enter` / `F12` chat (zpráva „[Všem] hráč: text“),
tlačítka minimapy: `Alt+G` signál (klik na minimapu nebo do světa – kruh a sbíhající se šipky `Minimap-Ping.mdl` + zvuk `MapPing`), `Alt+T` terén,
`Alt+A` barvy spojenců (vy modře, spojenci tyrkysově, nepřátelé červeně – na minimapě i na jednotkách), `Alt+C` zobrazení příšer na minimapě
(mapa nemá neutrální tábory, přepíná tedy tečky hráče Creeps), `Alt+F` pohyb ve formaci (skupina si drží tvar). Útok (A) na místo = útok na místo (attack-move): obránce jde k cíli, cestou bojuje
s nepřáteli v dosahu získání cíle a pak pokračuje; obyčejný pohyb nepřátele ignoruje. Oprava (O) na rozestavěnou budovu = pomoc se stavbou, na poškozenou vlastní budovu / mechanickou jednotku =
oprava za zlato; pravé tlačítko zapne / vypne automatické opravování. Patrol je jen vizuální (= pohyb).
V konzoli prohlížeče jsou k dispozici objekty `game`, `view`, `cam`, `db`, `map`, `hud`, `portrait`, `sound`, `assets`, `grid`, `renderer`, `scene` a `frame(dt)`.
`F10` → Uložit / Nahrát hru; Možnosti → Klávesové zkratky (výchozí / mřížka QWER / CustomKeys.txt) a Načíst CustomKeys.txt.

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
   ├─ game/game.ts      simulace + port triggerů (TriggerSleepAction → `yield` v generátorech se stavem `ThreadState`, synchronní deterministický plánovač v herním čase), save()/load()
   │   ├─ game/pathing.ts  mřížka war3map.wpm (32×32), obsazenost budovami/blockery, A*
   │   └─ game/combat.ts   tabulka útok × brnění (patch 1.21), redukce brněním, kostky
   ├─ render/terrain.ts terén: výšky, blending textur (port mdx-m3-viewer shaderu), útesy, stíny
   ├─ render/textures.ts procedurální textury ve stejném layoutu jako originální tileset BLP
   ├─ render/world.ts   synchronizace stavu hry se scénou (jednotky, doodady, projektily, efekty, HP bary, hover štítek, ghost stavby)
   ├─ render/mdx.ts     loader originálních MDX/BLP → three.js (skeletální animace, emitory částic, kamera portrétu)
   ├─ render/particles.ts ParticleEmitter2 + typ 1 (modely jako částice) + ribbony – simulace na CPU, dávkové billboardy podle textury a blend módu; event objekty modelů (SND/SPL/UBR/SPN)
   ├─ render/decals.ts  textury na terénu: splaty (krev, stopy), ubersplaty (krátery, dlaždice pod budovami), stíny, výběrové kruhy
   ├─ render/portrait.ts 3D portrét (`*_portrait.mdx`, sekvence „Portrait“, kamera z modelu) do otvoru konzole
   ├─ render/placeholders.ts zástupné tvary
   ├─ render/camera.ts  WC3 kamera (AoA 304°, vzdálenost 1650, FOV 70°, hranice z w3i)
   ├─ render/daynight.ts den/noc z Environment\DNC\DNCLordaeron (barvy světla podle denní doby)
   ├─ ui/cursor.ts      kurzor hry z UI\Cursor\HumanCursor.mdl (sprite sheet + animace textury KTAT)
   ├─ ui/menu.ts        herní menu F10 (hlavní panel, Uložit / Nahrát hru, Možnosti, Ukončit hru)
   ├─ ui/saves.ts       pozice uložených her v localStorage, nahrání přes nové načtení stránky
   ├─ ui/customkeys.ts  CustomKeys.txt (parser, Hotkey/Buttonpos/Tip) a mřížka QWER pro command card
   ├─ audio/dls.ts      přehrávač okolních zvuků: MIDI + DLS banka (WebAudio)
   ├─ ui/hud.ts         Human konzole (textury + FDF souřadnice), command card, info panel, multiboard, minimapa, dialogy
   ├─ style.css         rozložení konzole v UI jednotkách obrazovky 0,8 × 0,6 (`--sx`, `--sy` = px na jednotku)
   └─ sound.ts          originální zvuky: soubory mapy + labely z UI\SoundInfo\*.slk (útlum podle vzdálenosti, panorama, limity)
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
| Útesy a rampy | ✅ originální modely (Cliffs / CityCliffs) zvednuté o výšku terénu jako ve hře; rampy podle HiveWE: přechodové modely `CliffTrans` / `CityCliffTrans` (adresář `rampModelDir` z `CliffTypes.slk`) přes 2 dlaždice, jméno z rohů obdélníku v pořadí BL, TL, TR, BR (`A`+vrstva u běžného rohu, `L` / `H` u nízkého / vysokého rohu rampy – ověřeno na geometrii modelů), dlaždice pod modelem se nekreslí, vnitřek rampy je terén se spodními rohy zvednutými o půl vrstvy; mapa má 6 takových modelů |
| Doodady / jednotky / budovy | ✅ originální MDX (varianta podle `uani`, team color, replaceable textury); statické doodady instancované, animované (ohniště, hrnce, totemy, mouchy, trosky) jako samostatné kopie s vlastní animací a náhodnou fází; destructables (portál, mříže, brána) animované, brána při zničení hraje „death“ |
| Animace materiálů | ✅ flipbook textur KMTF (voda ve Spawning Grounds / Hightower, 45 snímků), animace UV KTAT/KTAR/KTAS (střely), alfa vrstvy KMTA; stopy kostí na globálních sekvencích běží jako samostatné smyčky (portál, vlajky) |
| Osvětlení | ✅ den/noc podle `DNCLordaeron{Terrain,Unit}.mdl` (barvy ambientu a difúzního světla, BGR) relativně k poledni, stejné hodiny jako konzole (den = 8 min, start 8:00); mapa má mlhu vypnutou, obloha při kameře hry není vidět |
| Ikony | ✅ HD ikony z modu v command card, info panelu (`infocard-*`, cizí jednotky `infocard-neutral-*`), multiboardu a tlačítkách minimapy |
| Rozhraní (konzole) | ✅ podle videa: `HumanUITile01–04` rozložené dle `ConsoleUI.fdf` (horní pruh v 0–0,125, spodní v 0,3125–1), kryt inventáře se znakem, hodiny dne/noci (`HumanUITile-TimeIndicator*`, den = 8 min), tlačítka `human-console-buttonstates2`, zdroje dle `ResourceBar.fdf` („Žádná údržba“), multiboard dle `MultiBoard.fdf` (šířky sloupců a ikony z triggeru), okraje z edge souborů (`editbox-border`, `human-tooltip-border`, `human-options-menu-border`), font `FRIZQT__.TTF`, české popisky jako v CZ klientu (Útok, Zbroj, Nezranitelný, Úroveň, Stav, Dokončeno: …) |
| Předvýběr | ✅ jednotka pod kurzorem ukazuje výběrový kruh poloviční průhledností a je zesvětlená (kopie materiálů s emisí z vlastní textury; aditivní efektové vrstvy beze změny) |
| Grafika aur | ✅ jednotky v dosahu aury (AOae / ACac, poloměr + 72) nesou její buff obnovovaný každých 0,25 s, takže se zobrazí cílová grafika buffu (`ftat` z mapy: Speed Aura, Damage Aura, Royal Aura) na bodu `fta0` |
| Náhled jednotek | ✅ 3D portrét s HP (barva podle zdraví; u nezranitelných budov skryto), info panel: jméno, „Úroveň N“ u creepů, útok (skrytý u zbraní jen na „debris“ – vlnoví creepové), zbroj, stav; tooltipy statistik; při výběru více jednotek mřížka ikon s HP; štítek „Creeps“ s HP barem nad jednotkou pod kurzorem; HP bary nad jednotkami jen s `Alt` jako ve hře |
| Potvrzení příkazů | ✅ `Confirmation.mdl` (3 šipky sbíhající se do bodu, zeleně) při pohybu, `Target.mdl` (červeně) při útoku na jednotku – dle `TargetPointConfirm` / `TargetUnitConfirm` v `UI\war3skins.txt`, barvy ověřeny podle videa |
| Animace jednotek | ✅ skeletální animace MDX (kosti z uzlů modelu, matrix groups → skinning, klipy pro každou sekvenci): stand / walk (rychlost dle pohybu) / attack / death / birth (při stavbě natažená na dobu stavby); výběr sekvence podle značek jako ve hře („Stand Upgrade First Ready Attack“), viditelnost geosetů per sekvence; hermite / bezier křivky (tečny klíčů, u rotací squad) zapečené do klíčů ~30/s; varianty postoje a práce („Stand - 2“ …) se po každém přehrání losují s vahou 1 / (1 + rarity) |
| Projektily | ✅ originální model zbraně (`ua1m`): sekvence „stand“ za letu natočená po dráze, při dopadu „death“ (výbuch) na místě; vystřelení v bodě poškození útoku (`udp1`, u věží 0,3 s), odpaliště `ulpx/ulpy/ulpz`, výška zásahu `uimz`, rychlost `ua1z`, oblouk `uma1` |
| Částicové efekty | ✅ ParticleEmitter2 (jednotky, projektily – kouř dělových koulí, výbuchy, oheň, mráz…): rychlost, rozptyl, gravitace, šířka/délka, segmenty barvy/alfy/měřítka, head/tail, buňky textury, squirt, animované KP2V/KP2E/KP2S…; ✅ ribbony (stopy šípů a kopí: KRHA/KRHB/KRAL/KRCO/KRVS, doba života segmentů, filtr vrstvy materiálu); ✅ ParticleEmitter typ 1 (každá částice je model – jiskry `Lightning2` u Shock Tower, kosti a vnitřnosti `Bones1`/`Gutz1` při smrti létajících jednotek: KPEE/KPEL/KPES/KPLT/KPEG/KPEV, první sekvence modelu) |
| Event objekty modelů | ✅ jako ve hře / mdx-m3-viewer: událost se spustí, když animace přejde klíčový snímek (KEVT). `SND` → `AnimLookups.slk` → `AnimSounds.slk` (výstřel v sekvenci „Birth“ střely, zásah v „Death“, výkřik při smrti, údery kladiva v „Stand Work“), `SPL`/`FPT` → `SplatData.slk` (krev zůstává 2 min, stopy 7 s), `UBR` → `UberSplatData.slk` (krátery minometu, spálenina zničené budovy), `SPN` → `SpawnData.slk` (gejzír krve) |
| Stíny, výběr, podklady budov | ✅ blob stín `ushu` (umístění `ushx/ushy/ushw/ushh`, barva `ShadowImageColor`), výběrový kruh `SelectionCircleSmall/Med/Large` podle `ussc × 72` (`UI\MiscData.txt`, barvy spojenec/nepřítel/neutrál), ubersplat `uubs` pod budovou (náběh při stavbě, odeznění po zbourání) – vše jako textury kopírující terén |
| Kurzor | ✅ `UI\Cursor\HumanCursor.mdl`: Normal, Select (animace při najetí na jednotku), Target / TargetSelect (rotující zaměřovač tónovaný červeně / zeleně / žlutě podle cíle), šipky posunu na okraji obrazovky; velikost a hotspot z modelu |
| Herní logika triggerů | ✅ |
| Stavba | ✅ Human: dělník dojde, založí, pracuje (Stand Work), bez něj stavba stojí; ghost = originální model věže nad buňkami (zelená / červená), naplánované stavby ve frontě dělníka namodrale (`PaidStructureColor`) |
| Fronta výroby, cooldowny | ✅ `human-unitqueue-border` (velký slot + 6 malých), progress bar z `BuildProgressBar` textur; cooldown jako tmavá výseč (conic-gradient) |
| Nahrávací a koncová obrazovka | ✅ náhled mapy, název / hráči / popis z `w3i` (rozložení `Loading.fdf`), loading bar z `Loading-Bar*` textur; vítězství / porážka se souhrnem skóre |
| Blesky | ✅ okamžité útoky bleskových věží: textura `CHIM` z `LightningData.slk` (segmenty, šum, posun textury, dohasínání) + „death“ modelu střely v cíli; Mana Drain jako trvalý blesk `DRAM` mezi jednotkami |
| Statistiky věží a creepů | ✅ z mapy + nezměněná pole z originálních SLK tabulek 1.26a |
| Schopnosti věží | ✅ jed/zpomalení (Aspo), odrazy (`mbounce`: `utc1`/`udl1`/`ua1f`), multishot (Aroc), bash/zmrazení (ACbh), auro útočné rychlosti a poškození (AOae/ACac), detekce neviditelných (Adts + výzkum R001), Searing Arrows bonus |
| Schopnosti creepů | ✅ neviditelnost (Apiv), imunita na magii (Amim), úhyb (ACev), Phase Shift (Apsh), Bloodlust (Shamani autocastem na creepy v boji: +25 % pohyb, +40 % útok, +30 % velikost, ohně na rukou), Resistant Skin (negativní kouzla trvají hrdinskou dobu `ahdu`), Asp3 (obíhající koule na bodech „sprite“) |
| Obránci chrámu | ✅ trénink, výzkum zbraní, útok, mana (`umpi/umpm/umpr`, údaj pod portrétem), pronásledování cílů v dosahu získání (`uacq`, vypne Držet pozici), kouzla: Share Mana (Arpm, autocast), Mana Drain (AHdr), Bless Weapons (ACro → buff B002 +50 % poškození), Skyfury (ACmo → údery každé 2 s v okruhu 250) |
| Buffy | ✅ obecný systém buffů s grafikou na připojovacích bodech modelu (`Targetart` + `Targetattach` z profilu hry nebo `ftat`/`fta0` mapy): Bloodlust, Blessed Weapons, odsávání many, jed |
| Lokalizace | ✅ systémové hlášky ve znění CZ klienta (`Units\CommandStrings.txt`: Nedostatek zlata., Zde nelze stavět., Cíl je mimo dostřel., Kouzlo zatím není připraveno., Nedostatek many., …); texty mapy anglicky jako v originále |
| Zvuky a hudba | ✅ všech 33 zvuků mapy; 3D zvuky: oddálení kamery nad výchozí vzdálenost (1650) se přičítá ke 3D vzdálenosti, při plném počtu hlasů (32) nahradí zvuk s vyšší `Priority` z SLK ten nejméně důležitý, odpovědi jednotek (kanály 1–4: výběr, potvrzení, pohyb, připravenost) hrají vždy jen jedna naráz, smyčky (bouře, odsávání many, stavění) průběžně mění hlasitost a panorama podle kamery; hudba dle `SetMapMusic("Music")` = Human playlist z `UI\war3skins.txt` (4 skladby, náhodně); zvuky event objektů modelů (výstřely, zásahy, smrt); odpovědi jednotek z `UnitAckSounds.slk` podle `usnd` (What při výběru – po opakovaném klikání Pissed –, Yes / YesAttack při příkazu, Ready po výcviku; vždy jen jedna naráz); zásah creepa do brány `UnitCombatSounds.slk` (`ucs1` × brnění brány); rozhraní z `UISounds.slk` (klik, chyba, „Not enough gold“, „Can't build there“, umístění stavby, Job's done, Upgrade / Research complete); 3D zvuky slábnou od středu pohledu (MinDistance → DistanceCutoff) a mají stereo panorama |
| Upgrade věže | ✅ během vylepšování se kreslí už cílová věž a hraje její „birth“ (lešení) podle postupu upgradu, po dokončení se přepne na „stand“ |
| Mrtvoly | ✅ podle `UI\MiscData.txt`: po animaci smrti zůstane tělo („Decay Flesh“) do `BoneDecayTime` = 88 s od smrti, pak kosti („Decay Bone“) zapadnou do země za `DecayTime` = 2 s; čas hry (pauza a rychlost platí), max. 120 mrtvol, létající jednotky mrtvolu nenechávají |
| Mřížka umisťování | ✅ ověřeno: všechny věže mají `upat` = `PathTextures\4x4SimpleSolid.tga` (16 plných buněk), takže mřížka 4×4 buněk ghostu odpovídá hře |
| Barvy spojenců | ✅ 3 stavy tlačítka jako v 1.26: vypnuto → jen minimapa → minimapa i jednotky (textury `ally-off/inactive/active`, hlášky v systémových zprávách) |
| Nastavení grafiky | ✅ v Možnostech: částice vysoké / střední / nízké (1 / 0,5 / 0,25 limitu emise), textury vysoké / nízké (poloviční rozlišení textur modelů, projeví se po novém spuštění), rozlišení vykreslování 100 / 75 / 50 %, stíny jednotek; uloženo v `localStorage` |
| Okolní zvuky | ✅ `main()` mapy volá `SetAmbientDaySound / SetAmbientNightSound("SunkenRuins…")` → `MIDISounds.slk`: MIDI skladba hraná vlastním přehrávačem DLS banky (`src/audio/dls.ts` – nástroje, regiony, smyčky vzorků, tempo, hlasitost / panorama / velocity); den 6–18 h / noc s 3 s prolnutím, ráno kohout (`RoosterSound`), večer vlk (`WolfSound`); vypínatelné v Možnostech |
| Smyčkové zvuky | ✅ `MonsoonLoop` po dobu bouře, `SiphonManaLoop` po dobu odsávání many, `BuildingConstructionLoop` (`ubsl`) dokud dělník pracuje na stavbě |
| Klávesové zkratky | ✅ v Možnostech: výchozí (data mapy), mřížka QWER / ASDF / ZXCV podle pozice tlačítka, nebo `CustomKeys.txt` (formát z `CustomKeyInfo.txt` hry: sekce podle id objektu / schopnosti / výzkumu nebo `CmdMove`, `CmdAttack`, `CmdBuildHuman`, `CmdCancel*` …; `Hotkey` / `Unhotkey` (s hodnotami po úrovních), `Buttonpos` / `Unbuttonpos`, `Tip`, kód 512 = Esc). Soubor se načte tlačítkem v Možnostech (UTF-8 nebo Windows-1250, uloží se do `localStorage`), případně ze složky hry přes `npm run assets`; v tooltipu se ukáže nová klávesa |
| Skóre | ✅ obrazovka jako `ScoreScreen.fdf`: záložky Přehled (jednotky / hrdinové / suroviny / celkem), Jednotky (vyrobené, zabité, postavené budovy, zničené budovy, největší armáda), Hrdinové (předměty = nákupy v obchodě), Suroviny (zlato, dřevo, obchod, daň za údržbu) a Graf (skóre v čase po 10 s, přepínač jednotky / suroviny / celkem, čára v barvě hráče). Přesné vzorce hry nejsou známy – skóre jednotek = součet bodových hodnot `upoi` vyrobených a zabitých jednotek, skóre surovin = desetina získaného zlata |
| Ukládání hry | ✅ Nabídka → Uložit hru (pojmenované pozice v `localStorage`, stejný název přepíše, mazání) / Nahrát hru (stránka se znovu načte a čerstvá hra se nahradí uloženým stavem). `Game.save()` uloží celý stav jako JSON (~30 kB): jednotky s odkazy přes uid, střely, bouře, hráče, brány, obsazenost pathingu, stav generátoru náhody a **vlákna triggerů** – generátory si drží postup v objektu `ThreadState` (krok + čítač smyčky), takže se po nahrání vytvoří znovu a pokračují za posledním `TriggerSleepAction`. Test ověřuje, že nahraná hra pokračuje přesně jako originál |
| Kouzla creepů (AI) | ✅ Bloodlust: šaman jako při rozkazu zastaví, natočí se k cíli a hraje „spell“; buff přijde v bodě seslání `ucpt` (0,3 s), jednotka je zaneprázdněná do konce `ucbs` (0,51 s), mana se strhne až v bodě seslání; cíl = vlastní organická jednotka v dosahu `aran`, která bojuje (útočí na bránu nebo byla zasažena v posledních 3 s) a Bloodlust nemá – přednost mají útočící, pak nejbližší. Omráčení seslání přeruší |
| Multiplayer (1–3 hráči co-op) | ❌ jen 1 hráč lokálně (logika počítá s počtem hráčů – lze rozšířit) |

## 6. Co z dat mapy získat nejde – odkud se to bere

### 6.1 Assety (vyřešeno)

| Zdroj | Co z něj bereme |
|---|---|
| `Warcraft III - Gold Edition` (patch 1.26a, `war3.mpq`, `War3x.mpq`, `War3xLocal.mpq`, `War3Patch.mpq`) | 436 MDX modelů (jednotky, budovy, doodady, útesy, projektily), SLK/TXT tabulky, 33 WAV zvuků, 4 MP3 skladby, team color |
| `Classic HD for Classic` (mod z Nexusu, jen DDS textury) | HD textury terénu Ruins, útesů (`_tilesets\z.w3mod`), ikony, textury jednotek a doodadů |

Kromě souborů, které jmenují data mapy, nástroj prochází **event objekty každého kopírovaného modelu** a podle
`UI\SoundInfo\AnimLookups.slk` / `AnimSounds.slk`, `Splats\SplatData.slk`, `UberSplatData.slk` a `SpawnData.slk` přidá do
`catalog.json` jejich zvuky, splaty, ubersplaty a spawn modely (ty se pak zpracují rekurzivně). Dále odpovědi jednotek
(`UnitAckSounds.slk` podle `usnd`), zvuky zásahů (`UnitCombatSounds.slk`), zvuky rozhraní (`UISounds.slk`), stíny (`ushu`),
výběrové kruhy (`UI\MiscData.txt`) a kurzor rasy (`UI\war3skins.txt`).

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
- **Obchod Hightower**: nakupovat lze jen s vlastní pohyblivou jednotkou do vzdálenosti `Neu1` schopnosti `Ane2` (450); jinak jsou tlačítka obchodu neaktivní. Text chyby („Žádná vaše jednotka není poblíž obchodu.“) je vlastní, v CZ klientu ho nenacházím.
- **Stavba (Human)**: zlato se strhne při příkazu, dělník dojde ke staveništi a teprve pak budovu založí; stavba postupuje jen, když u ní dělník pracuje (animace „Stand Work“ s kladivem), po odchodu se zastaví a nedostavěná věž nefunguje. Pravý klik dělníkem na rozestavěnou budovu práci obnoví; příkaz zrušený před založením (jiný příkaz bez Shiftu, Stop, přeměna) zlato vrátí. Fáze stavby (lešení, sekvence „Birth“) odpovídá postupu. Další dělníci (Oprava na staveniště) stavbu zrychlují (Power Build, `Ahrp`: +`Rep4` = 60 % za každého, každý stojí `Rep3` = 15 % ceny budovy za celou stavbu); oprava obnoví celé zdraví za `ubld × Rep2` (1,5) a stojí `Rep1` (35 %) ceny poměrně k opravenému zdraví – zlato se strhává průběžně po celých mincích.
- **Kolize**: vlastní pozemní jednotky (builder, obránci) se odstrkují podle `ucol`; jdoucí / pracující jednotka odsune stojící, jednotka mířící na místo obsazené stojící jednotkou zastaví vedle ní. Creepové a letci kolize nemají.
- Obránci chodí za cíli v dosahu získání cíle; jejich kouzla kromě Share Mana (autocast) sesílá hráč. Bloodlust creepů: výběr cíle (bojující bez buffu, přednost útočícím, pak nejbližší) je odhad – pravidla autocastu enginu nejsou zdokumentovaná; bod seslání a backswing jsou z dat jednotky.

### 6.4 Otevřené body

1. **Video z hraní** – ✅ porovnáno (HUD, střely, výbuchy, náhled nepřátel, zprávy, krvavé skvrny po creepech, stopy šípů).
2. Multiplayer není cílem (rozhodnuto), hraje 1 lokální hráč.

## 7. Další fáze (návrh)

Aktuální seznam je v [dalsi-prace.md](../dalsi-prace.md). Testy (`npm test`) pokrývají start a první vlnu, stavbu
s dělníkem, odměny a bonus za vlnu, vítězství, ztrátu životů a porážku, prodej, střelbu věží a determinismus
(`Game.seed(n)` nahradí `Math.random` deterministickým generátorem), sesílání Bloodlustu, uložení a nahrání hry a CustomKeys.

## 8. Výkon

- Skinned meshe mají frustum culling podle koule z rozsahu modelu (`extent`, min. poloměr 150).
- **Animační LOD** (místo instancování): jednotky mimo záběr (+ rezerva 250) posouvají animaci jen jednou za 0,25 s (nasčítaný čas se aplikuje najednou, fáze sedí; začátky jsou rozložené podle uid), přeskočí přepočet matic kostí (`world` je statický, `matrixAutoUpdate = false`, takže three.js nevynucuje přepočet celého stromu) i emisi svých částic a jejich meshe opustí vrstvu kamery, takže three.js nepřepočítává ani skeleton. Částice jednotek používají matice z posledního renderu (svět se přepočítá jen jednou za snímek), rychlé zdroje (střely, efekty) se aktualizují hned. Decaly (stíny, krev) mimo viditelnou plochu terénu se nepřestavují. Naměřeno se 60 creepy navíc: mimo záběr view 7,2 → 2,8 ms a render 6,2 → 3,7 ms na snímek; v záběru view 7,8 → 5,0 ms.
- Skutečné GPU instancování skinned modelů (zapečené matice kostí v textuře + `InstancedMesh`) zatím není: vyžadovalo by přepsat materiály (vrstvy MDX, team color, animace textur a průhlednosti geosetů, zvýraznění, neviditelnost) a přišlo by se o připojené efekty na kostech (buffy, emitory, event objekty).
- Emise částic se přizpůsobuje snímkové frekvenci (`ParticleSystem.quality` 0,25–1: pod ~30 FPS klesá, nad ~50 FPS roste).
- Build je rozdělený na chunky: aplikace, `three`, parsery MDX/BLP (`vite.config.ts` → `manualChunks`).

## 9. Známé drobnosti

- Kamera se nenatáčí (yaw), stejně jako ve hře.
- HP bary jsou sprity (zobrazí je `Alt`); vstupní dialog obtížnosti je pod bílým fade jako v originále.
- Info karty mají v textuře prázdný rámeček úrovně vylepšení; hra ho nezobrazuje, proto se při načtení nahrazuje zrcadlenou levou dolní čtvrtinou ikony.
- Portrét se kreslí druhým průchodem do téhož canvasu (scissor) pod DOM konzolí; bez `*_portrait.mdx` se použije model jednotky a jeho kamera, jinak záběr celé jednotky.
- Data `public/map/` lze kdykoli přegenerovat `npm run extract`; parser JASS při nečekané struktuře skriptu skončí chybou, aby jiná verze mapy tiše nedivergovala.
