# Další práce – co chybí a co vylepšit

Stav k 23. 11. 2026: mapa, herní logika, originální modely s animacemi (včetně globálních sekvencí, animovaných
materiálů a doodadů), Human konzole podle videa, projektily s výbuchy, částicemi a ribbony, blesky, zvuky,
splaty, stíny, výběrové kruhy, kurzor, skupiny jednotek, stavba s dělníkem a ghostem, den/noc, fronta výroby,
cooldowny, menu s možnostmi, nahrávací a koncová obrazovka, ParticleEmitter typ 1, tlačítka minimapy (signál,
terén, barvy spojenců, příšery, formace), chat, předvýběrový kruh, zesvětlení jednotky pod kurzorem, grafika aur, útok na místo (attack-move), oprava a Power Build, podskupiny (Tab), obchod jen s jednotkou poblíž, kolize jednotek,
hermite/bezier interpolace a varianty postoje podle rarity, animace upgradu věže, rozkládající se mrtvoly, 3 stavy
barev spojenců, nastavení grafiky, okolní zvuky (MIDI + DLS) a smyčkové zvuky, rampy, prostorový zvuk s prioritami,
přesnější Bloodlust šamanů, CustomKeys.txt a mřížka QWER, skóre se záložkami a grafem, ukládání hry, animační LOD, kouzla creepů i obránců, mana, pronásledování
a headless testy jsou hotové (viz [docs/IMPLEMENTACE.md](docs/IMPLEMENTACE.md)). Níže je, co oproti originálu
(a videu `screen-capture.mp4`) ještě chybí, seřazené podle toho, jak moc je to při hraní vidět.

Priorita: **A** = vidět/slyšet pořád, **B** = občas znát, **C** = detail / mimo běžné hraní.

## 1. Zvuk

| P | Co | Poznámka |
|---|---|---|
| C | Prostorový zvuk – EAX | Útlum, panorama, priority hlasů, kanály odpovědí, oddálení kamery a průběžné smyčky jsou hotové; chybí EAX efekty (`EAXFlags` – dozvuk podle prostředí) a směrové kužele (`InsideConeAngle` …). |

## 2. Vizuální efekty a scéna

| P | Co | Poznámka |
|---|---|---|
| C | Dotažení splatů | Splaty se nekreslí na vodě (sloupec `Water` v `SplatData.slk`) – mapa ale terénní vodu nemá. Létající jednotky mrtvolu nenechávají (jako ve hře), mrtvoly se nedají oživit / sežrat (mapa to nepoužívá). |

Poznámky: mapa nemá terénní vodu (žádný roh s příznakem vody) – voda je jen animovaná textura v modelech
Spawning Grounds / Hightower a ta už běží. Mlhu má mapa vypnutou (`useTerrainFog = 0`) a oblohu (`SkyModel 4`)
při kameře hry (sklon 56°) vidět nelze, proto nejsou implementované.

## 3. Rozhraní a ovládání

| P | Co | Poznámka |
|---|---|---|
| C | Vzorce skóre | Záložky a graf jsou hotové; přesné vzorce skóre hry nejsou známé (teď bodové hodnoty `upoi` a desetina zlata). |

## 4. Herní logika (rozdíly proti enginu)

| P | Co | Poznámka |
|---|---|---|
| C | AI kouzel creepů | Bloodlust má bod seslání a animaci; výběr cíle (bojující bez buffu, přednost útočícím) je odhad – pravidla autocastu enginu nejsou zdokumentovaná. |

## 5. Technické

| P | Co | Poznámka |
|---|---|---|
| C | GPU instancování jednotek | Animační LOD mimo záběr je hotový; v záběru má každá jednotka vlastní skinned meshe (~2–3 draw cally). Zapečené matice kostí + `InstancedMesh` by ušetřily CPU při desítkách creepů na obrazovce, ale vyžadují přepsat materiály MDX a připojené efekty (viz IMPLEMENTACE kap. 8). |
| C | Ověření rychlostí podle videa | Měření rychlostí střel a creepů snímek po snímku ve videu (zatím porovnáno jen vizuálně, hodnoty jsou z dat mapy). |

## 6. Mimo rozsah (rozhodnuto)

- Multiplayer (1–3 hráči co-op) – hraje 1 lokální hráč, logika počet hráčů zohledňuje.
- Širokoúhlé monitory – konzole se roztahuje na šířku (rozhodnuto ponechat, hra 1.26 drží 4:3).
- Commit Blizzard assetů – `public/war3/` vzniká lokálně přes `npm run assets`.
