# Další práce – co chybí a co vylepšit

Stav k 19. 11. 2026: mapa, herní logika, originální modely s animacemi (včetně globálních sekvencí, animovaných
materiálů a doodadů), Human konzole podle videa, projektily s výbuchy, částicemi a ribbony, blesky, zvuky,
splaty, stíny, výběrové kruhy, kurzor, skupiny jednotek, stavba s dělníkem a ghostem, den/noc, fronta výroby,
cooldowny, menu s možnostmi, nahrávací a koncová obrazovka, kouzla creepů i obránců, mana, pronásledování
a headless testy jsou hotové (viz [docs/IMPLEMENTACE.md](docs/IMPLEMENTACE.md)). Níže je, co oproti originálu
(a videu `screen-capture.mp4`) ještě chybí, seřazené podle toho, jak moc je to při hraní vidět.

Priorita: **A** = vidět/slyšet pořád, **B** = občas znát, **C** = detail / mimo běžné hraní.

## 1. Zvuk

| P | Co | Poznámka |
|---|---|---|
| C | Prostorový zvuk – zpřesnit | Útlum (MinDistance → DistanceCutoff), stereo panorama a limit 3 stejných / 32 celkem jsou hotové; chybí kanály a priority z SLK (`Channel`, `Priority`), EAX efekty, útlum podle výšky kamery a smyčkové zvuky (`MonsoonLoop`, `SiphonManaLoop` hrají jednou). |
| C | Ambientní zvuky prostředí Ruins | Ptáci, hmyz (`EnvironmentSounds`). |

## 2. Vizuální efekty a scéna

| P | Co | Poznámka |
|---|---|---|
| B | ParticleEmitter typ 1 | Starší emitory (model jako částice), např. `LightningBoltMissile` (Shock Tower), Wind Rider, Gargoyle. |
| C | Grafika aur | Aury věží (Speed / Damage / Royal Aura) fungují, ale cílová grafika buffu (`ftat`, např. `GeneralAuraTarget`) se na jednotkách nezobrazuje – systém buffů na to je připravený. |
| C | Dotažení splatů | Splaty se nekreslí na vodě (sloupec `Water` v `SplatData.slk`), mrtvoly mizí po 1,5 s, takže pozdější krvavé skvrny z konce animace smrti (např. rolník po 1,8 s) nevzniknou; ve hře zůstává mrtvola (`Decay Flesh`). |
| C | Předvýběrový kruh | Kruh pod jednotkou pod kurzorem (`UI\Feedback\TargetPreSelected`). |
| C | Interpolace animací | Hermite / bezier křivky (teď lineární), náhodné varianty „stand“ podle `rarity`, animace upgradu věže („Upgrade First/Second“). |
| C | Rampy | Přechody útesů se kreslí jako svah místo modelů ramp. |
| C | Team glow / zvýraznění | Zvýraznění jednotky pod kurzorem (lehké zesvětlení modelu jako ve hře). |
| C | Mřížka umisťování | Buňky ghostu jsou barevné čtverce; hra kreslí obrys podle pathing textury budovy (`upat`). |

Poznámky: mapa nemá terénní vodu (žádný roh s příznakem vody) – voda je jen animovaná textura v modelech
Spawning Grounds / Hightower a ta už běží. Mlhu má mapa vypnutou (`useTerrainFog = 0`) a oblohu (`SkyModel 4`)
při kameře hry (sklon 56°) vidět nelze, proto nejsou implementované.

## 3. Rozhraní a ovládání

| P | Co | Poznámka |
|---|---|---|
| B | Tlačítka minimapy a Chat | Jsou jen vizuální: signál (ping na minimapě), terén on/off, barvy spojenců, zobrazení příšer, formace. |
| C | Podskupiny (Tab) | Při výběru různých typů přepínání aktivní podskupiny v command card. |
| C | Více rozlišení konzole | Ultrawide: konzole se teď roztahuje na šířku; hra 1.26 drží poměr 4:3 s černými okraji / roztažením – rozhodnout. |
| C | Hotkeye podle CustomKeys | Podpora `CustomKeys.txt` (grid layout). |
| C | Více dělníků na jedné stavbě | Human ve hře zrychluje stavbu dalšími dělníky (Power Build); teď počítá jen to, že na stavbě někdo pracuje. Příkaz Oprava (Repair) je dál jen vizuální. |
| C | Útok na zem (attack-move) | Příkaz Útok na místo je obyčejný pohyb; ve hře jednotka cestou útočí na nepřátele. |
| C | Skóre jako ve hře | Koncová obrazovka ukazuje souhrn (vlna, zabití, budovy, zlato, životy, čas); originál má záložky Jednotky / Budovy / Suroviny s grafy. |

## 4. Herní logika (rozdíly proti enginu)

| P | Co | Poznámka |
|---|---|---|
| C | Obchod Hightower | Nákup bez nutnosti mít jednotku poblíž (`Ane2`). |
| C | Kolize jednotek | Builder a obránci se navzájem nepřekrývají jen díky rozestupům skupinového pohybu. |
| C | AI kouzel creepů | Bloodlust Shamanů se sesílá na creepy útočící na bránu nebo pod palbou (autocast počítače); přesná pravidla AI enginu nejsou známa. |

## 5. Technické

| P | Co | Poznámka |
|---|---|---|
| C | Instancování stejných jednotek | Stovky creepů jsou samostatné skinned meshe (culling a omezení částic podle FPS už běží); sdílená póza + instancing by ušetřily draw cally. |
| C | Uložení hry | Serializace stavu `Game` (generátory triggerů – nutno ukládat jako stav plánovače). Tlačítka Uložit / Nahrát jsou v menu zatím neaktivní. |
| C | Nastavení grafiky | Kvalita (HD/SD textury, počet částic) v Možnostech; hlasitost a rychlost posunu už se ukládají do `localStorage`. |
| C | Ověření rychlostí podle videa | Měření rychlostí střel a creepů snímek po snímku ve videu (zatím porovnáno jen vizuálně, hodnoty jsou z dat mapy). |

## 6. Mimo rozsah (rozhodnuto)

- Multiplayer (1–3 hráči co-op) – hraje 1 lokální hráč, logika počet hráčů zohledňuje.
- Commit Blizzard assetů – `public/war3/` vzniká lokálně přes `npm run assets`.
