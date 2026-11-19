# Další práce – co chybí a co vylepšit

Stav k 19. 11. 2026: mapa, herní logika, originální modely s animacemi, Human konzole podle videa, projektily
s výbuchy a částicemi jsou hotové (viz [docs/IMPLEMENTACE.md](docs/IMPLEMENTACE.md)). Níže je, co oproti
originálu (a videu `screen-capture.mp4`) ještě chybí, seřazené podle toho, jak moc je to při hraní vidět.

Priorita: **A** = vidět/slyšet pořád, **B** = občas znát, **C** = detail / mimo běžné hraní.

## 1. Zvuk

| P | Co | Poznámka |
|---|---|---|
| A | Zvuky útoků a dopadů střel | Hrají se jen zvuky z triggerů. Modely střel mají zvukové události (`SNDX…` v event objects – např. `SNDXMARR` šíp, `SNDXKCAN` dělo); přeložit přes `UI\SoundInfo\AnimSounds.slk` na WAV a přehrát při vystřelení / dopadu. |
| A | Zvuky smrti a odpovědí jednotek | Výkřiky creepů při smrti, „Yes?“ / „Ready to work“ buildera při výběru a příkazu (`UnitAckSounds.slk`, `unitsounds` v profilu jednotky). |
| B | Zvuky rozhraní | Kliknutí na tlačítka, „Not enough gold“, stavba dokončena, chyba umístění (`UI\SoundInfo\UISounds.slk`). |
| B | Prostorový zvuk | Hlasitost / panorama podle vzdálenosti od kamery (WC3 3D zvuky), limit souběžných stejných zvuků. |
| C | Ambientní zvuky prostředí Ruins | Ptáci, hmyz (`EnvironmentSounds`). |

## 2. Vizuální efekty a scéna

| P | Co | Poznámka |
|---|---|---|
| A | Ribbon emittery | Stopy šípů (`ArrowMissile`, `GuardTowerMissile`), kopí, mrazivé střely – nyní chybí. |
| A | Krvavé skvrny a splaty | Ve videu zůstává krev na zemi po zabitých creepech; ve hře jde o splat/ubersplat emittery (`SPL`/`UBR` event objects, `Splats\SplatData.slk`, `UberSplatData.slk`), stopy výbuchů po dělech. |
| A | Stíny jednotek | WC3 kreslí pod jednotkami blob stín (`ReplaceableTextures\Shadows\Shadow*.blp`, pole `ushu`/`ushx/y/w/h`). |
| A | Textura výběrového kruhu | Místo vlastního prstence použít `ReplaceableTextures\Selection\SelectionCircle*.blp` (velikost dle `ussc`), stejně pro kruh pod budovou. |
| B | Ghost stavby | Při umisťování se ukazuje zástupný tvar – použít model věže (průhledně zelený / červený) a texturu mřížky `UI\Feedback\BuildGrid`. |
| B | Ubersplaty pod budovami | Dlaždice pod věžemi (`uubs`, např. `HSMA`). |
| B | Lightning efekty | Lightning Tower kreslí čáru; ve hře textury `CLPB` / `CLSB` (`Splats\LightningData.slk`) s animací. |
| B | Voda | Spawning Grounds / bazény – data vody (`catalog.water`) jsou načtená, ale voda se nevykresluje (animované textury `Water00–44`, barvy mělké/hluboké). |
| B | Osvětlení a mlha | DNC osvětlení Ruins (`Environment\DNC\DNCRuins`), mlha terénu z `war3map.w3i`, skybox – teď je statické světlo. |
| B | Animované doodady | Palmy, vlajky, ohně, portál – doodady jsou statické (instancované v pose „stand“). |
| B | ParticleEmitter typ 1 | Starší emitory (model jako částice), např. `LightningBoltMissile`. |
| C | Interpolace animací | Hermite / bezier křivky (teď lineární), náhodné varianty „stand“ podle `rarity`, animace upgradu věže („Upgrade First/Second“). |
| C | Rampy | Přechody útesů se kreslí jako svah místo modelů ramp. |
| C | Team glow / zvýraznění | Zvýraznění jednotky pod kurzorem (lehké zesvětlení modelu jako ve hře). |

## 3. Rozhraní a ovládání

| P | Co | Poznámka |
|---|---|---|
| A | Kurzor hry | `UI\Cursor\HumanCursor.mdl` (ruka, při cílení zaměřovač, při najetí na nepřítele červený) – teď systémový kurzor. |
| A | Skupiny jednotek | `Ctrl+1–9` / `1–9`, dvojklik = všechny stejného typu na obrazovce, `Ctrl+klik`. |
| B | Odpočet cooldownu na tlačítku | Coin Basher má jen číslo; ve hře tmavá „hodinová“ výseč (`UI-Cooldown-Indicator.mdl`). |
| B | Fronta výroby / výzkumu | Ve hře 5 ikon fronty v info panelu (`human-unitqueue-border`), teď jen ukazatel postupu. |
| B | Tlačítka minimapy a Chat | Jsou jen vizuální: signál (ping na minimapě), terén on/off, barvy spojenců, zobrazení příšer, formace. |
| B | Herní menu jako ve hře | Nabídka F10 má vlastní obsah; originál: Uložit/Načíst, Možnosti (zvuk, grafika), Konec hry. Možnosti hlasitosti zvuku a hudby. |
| B | Nahrávací obrazovka | Loading screen s náhledem a popisem mapy (`war3mapPreview`, texty z `w3i`) a progress barem místo textu. |
| B | Konec hry | Obrazovka vítězství / porážky a skóre (zabití, zlato) místo modálního okna. |
| B | Lokalizace textů | Texty mapy jsou anglické (jako v originále), ale systémové hlášky hry v CZ klientu – sjednotit zbývající anglické hlášky (`Not enough gold.`, `Unable to build there.`, `Requires:`) podle `UI\WorldEditStrings` / `GlobalStrings.fdf`. |
| C | Podskupiny (Tab) | Při výběru různých typů přepínání aktivní podskupiny v command card. |
| C | Více rozlišení konzole | Ultrawide: konzole se teď roztahuje na šířku; hra 1.26 drží poměr 4:3 s černými okraji / roztažením – rozhodnout. |
| C | Hotkeye podle CustomKeys | Podpora `CustomKeys.txt` (grid layout). |

## 4. Herní logika (rozdíly proti enginu)

| P | Co | Poznámka |
|---|---|---|
| B | Bloodlust u Shamanů | AI creepů kouzla nesesílá. |
| B | Aktivní kouzla obránců chrámu | Share Mana, Mana Drain, Bless Weapons, Skyfury. |
| B | Resistant Skin, Asp3 | Schopnosti creepů bez efektu. |
| B | Stavba čeká na buildera | Human builder ve hře staví, dokud stojí u stavby; teď se staví sám. |
| B | Pronásledování | Obránci drží pozici, ve hře jdou za cílem v dosahu získání cíle. |
| C | Obchod Hightower | Nákup bez nutnosti mít jednotku poblíž (`Ane2`). |
| C | Mana | Mana jednotek a modrý pruh pod portrétem (obránci). |
| C | Kolize jednotek | Builder a obránci se navzájem nepřekrývají jen díky rozestupům skupinového pohybu. |

## 5. Technické

| P | Co | Poznámka |
|---|---|---|
| B | Výkon | Stovky creepů + částice: instancování stejných jednotek, frustum culling skinned meshí, limit částic podle FPS, rozdělit `index.js` (710 kB) na chunky. |
| B | Testy | Headless testy simulace (vitest): průchod vlny, bonusy, prodej, porážka/vítězství, determinismus. |
| C | Uložení hry | Serializace stavu `Game` (generátory triggerů – nutno ukládat jako stav plánovače). |
| C | Nastavení | Kvalita (HD/SD textury, počet částic), hlasitost, rychlost posunu kamery – uložit do `localStorage`. |
| C | Ověření rychlostí podle videa | Měření rychlostí střel a creepů snímek po snímku ve videu (zatím porovnáno jen vizuálně, hodnoty jsou z dat mapy). |

## 6. Mimo rozsah (rozhodnuto)

- Multiplayer (1–3 hráči co-op) – hraje 1 lokální hráč, logika počet hráčů zohledňuje.
- Commit Blizzard assetů – `public/war3/` vzniká lokálně přes `npm run assets`.
