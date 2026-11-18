# Ruined Temple TD v1.04 – vytěžená data

> Vygenerováno skriptem `npm run report` z `public/map/map.json` (zdroj: `Ruined Temple TD v.1.04.w3x`).
> Nezměněná pole objektů jsou doplněna z originálních SLK tabulek hry (public/war3/catalog.json).

## Mapa

- Název: /CFF6DCFF6Ruined Temple TD v.1.04, autor: Antsu, hráči: /CFF6DCFF61-3
- Tileset: `Z` (Sunken Ruins), velikost 96×64 dlaždic, hratelná plocha 74×48
- Pozemní textury: Zdrt, Zdtr, Zdrg, Zbks, Zsan, Zbkl, Ztil, Zgrs, Zvin; útesy: CZdi, CZlb
- 1221 doodadů/destructables, 11 předem umístěných jednotek, 14 regionů, 33 zvuků
- Životy: 10 × počet hráčů, startovní zlato 30, 20 jednotek na vlnu, pauza mezi vlnami 15 s, vítězství po vlně 25
- Trasa creepů: Spawn Region → Path1 → Path2 → Path3 → Path4 → Path5 → Path6 → Path7 → Path8 → Path9 → Path10 → Gate → Goal
- Obtížnost (handicap creepů × počet hráčů): Easy 85 %, Normal 100 %, Hard 120 % (výchozí po 10 s: Normal)
- Odměna za vlnu: `wave*10 + wave²/hráči`; prodej věže: 75 % z point value (`upoi`)

## Vlny

| # | Jednotka | Název vlny | HP (100 %) | Brnění | Rychlost | Pohyb | Bounty (1 hráč) | Bounty MP (base–dice) | Spawn cooldown | Schopnosti |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `n000` Peon | Peon Invasion | 12 | 2 none | 190 | none | 1+0d0 | 1–1 | 0.28 s |  |
| 2 | `n001` Grunt | Grunts | 17 | 3 large | 192 | none | 1+0d0 | 1–1 | 0.3 s |  |
| 3 | `n005` Headhunter | Troll Headhunters | 32 | 1 normal | 205 | none | 1+0d0 | 1–1 | 0.35 s |  |
| 4 | `n002` Wolf | Savage Wolves | 50 | 5 small | 260 | none | 0+1d2 | 1–2 | 0.37 s |  |
| 5 | `n003` Wolfraider | Wolfraiders | 62 | 4 medium | 260 | none | 2+0d0 | 2–2 | 0.35 s |  |
| 6 | `n006` Kodobeast | Kodo Caravan | 143 | 7 large | 130 | none | 0+1d3 | 1–3 | 0.45 s |  |
| 7 | `n007` Shaman | Wolfhowl Shamans | 188 | 3 small | 190 | none | 1+1d2 | 2–3 | 0.35 s | Ablo |
| 8 | `n008` Wind Rider | Wind Riders | 220 | 5 none | 312 | fly (220) | 3+0d0 | 3–3 | 0.55 s |  |
| 9 | `n009` Minotaur | Minotaurs | 285 | 8 large | 200 | none | 3+0d1 | 3–4 | 0.5 s |  |
| 10 | `n00A` Tauren Mage | Tauren Mages | 125 | 3 divine | 180 | none | 3+1d2 | 4–5 | 0.8 s | Apsh |
| 11 | `n00D` Mur'gul Assassin | Mur'gul Assassin | 637 | 3 small | 240 | none | 4+1d1 | 5–5 | 0.3 s |  |
| 12 | `n00E` Kitin Crab | Kitin Crabs | 650 | 5 medium | 180 | none | 4+1d2 | 5–6 | 0.38 s | ACev |
| 13 | `n00F` Giant Kitin Crab | Angry Kitin Crab fathers | 820 | 5 medium | 200 | none | 5+1d2 | 6–7 | 0.5 s | ACev |
| 14 | `n00G` Shade Siren | Shade Sirens | 1300 | 3 none | 210 | none | 6+1d3 | 7–9 | 0.42 s | Apiv, Ahid |
| 15 | `n00H` Sea Wolf | Sea Wolves | 1550 | 4 small | 285 | none | 7+1d2 | 8–9 | 0.6 s | ACrk |
| 16 | `n00I` Overgrown Seaturtle | Overgrown Seaturtles | 2300 | 10 fort | 130 | none | 9+1d1 | 10–10 | 2 s | Amim |
| 17 | `n00J` Winged Serpent | Winged Serpents | 2155 | 2 normal | 317 | fly (170) | 10+1d2 | 11–12 | 0.5 s |  |
| 18 | `n00K` Myrmidon | Myrmidons | 3400 | 5 medium | 230 | none | 12+1d3 | 13–15 | 0.7 s | ACrk |
| 19 | `n00L` Water Spirit | Water Sprites | 3950 | 5 medium | 180 | none | 14+1d4 | 15–18 | 0.5 s | Asp3 |
| 20 | `n00M` Poseidon | Clones of Poseidon | 5000 | 5 large | 146 | none | 19+1d1 | 20–27 | 0.85 s |  |
| 21 | `n00N` Shadow Spirit | Spirits from the Pit | 6000 | 2 none | 230 | none | 20+1d3 | 21–23 | 0.4 s | Apiv, Ahid |
| 22 | `n00O` Skeletal Soldier | The Lost Legion | 7500 | 3 small | 245 | none | 21+1d3 | 22–24 | 0.38 s | Amim |
| 23 | `n00P` Rapid Zombie | Graveyard Strikeforce | 9500 | 2 medium | 300 | none | 22+1d3 | 23–25 | 0.45 s |  |
| 24 | `n00Q` Gargoyles | Living Stone Gargoyles | 12000 | 4 fort | 300 | fly (200) | 23+1d3 | 24–26 | 0.65 s |  |
| 25 | `n00R` War Wraith | War Wraiths | 3200 | 2 divine | 270 | none (50) | 24+1d3 | 25–0 | 0.55 s | Apiv, Ahid |

## Věže a jednotky hráče

| ID | Název | Cena | Point value | Poškození | Cooldown | Dosah | Typ útoku | Splash / odrazy | Upgrade na | Požadavky | Schopnosti |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `h001` | Arrow Tower | 10 | 10 | 2–3 | 1.10 | 600 | pierce |  | h003 |  |  |
| `h003` | Improved Arrow Tower | 15 | 25 | 5–8 | 0.85 | 650 | pierce |  | h008 | h004 |  |
| `h004` | Cannon Tower | 20 | 20 | 3–7 | 1.80 | 600 | siege | 75/125/0 | h005 | h001 |  |
| `h005` | Improved Cannon Tower | 25 | 45 | 6–12 | 1.50 | 700 | siege | 100/150/0 | h009 |  |  |
| `h006` | Spear Tower | 25 | 25 | 9–13 | 1.00 | 400 | normal |  | h007 | h008 |  |
| `h007` | Fast Spear Tower | 30 | 55 | 12–16 | 0.60 | 400 | normal |  | h00M, h00L | R000 |  |
| `h008` | Advanced Arrow Tower | 20 | 45 | 9–12 | 0.65 | 700 | pierce |  | h00T, h00F, h00C |  |  |
| `h009` | Advanced Cannon Tower | 35 | 80 | 10–16 | 1.20 | 750 | siege | 125/175/0 | h00H, h00K, h00B | R000 |  |
| `h00B` | Boulder Tower | 50 | 130 | 16–22 | 0.55 | 800 | siege | 80/140/0 | h00J | h00F, R000 |  |
| `h00C` | Multishot Tower | 50 | 95 | 10–10 | 0.65 | 700 | pierce |  | h00D | R000 | A001 Multishot |
| `h00D` | Elite Multishot Tower | 100 | 175 | 10–10 | 0.65 | 700 | pierce |  |  | R000 | A002 Multishot |
| `h00E` | Aura Tower | 50 | 50 | – | – | – | – |  | h00U, h00V | R000 | A00O Mage Watcher; A004 Speed Aura |
| `n004` | Temple Archer | 35 | 100 | 10–16 | 1.50 | 900 | pierce |  |  |  | A00B Flaming Arrows |
| `h00F` | Ballista Tower | 30 | 75 | 18–22 | 0.85 | 800 | pierce |  | h00I | R000 | A006 Steel Graphics |
| `h00G` | Fire Tower | 50 | 50 | 10–15 | 1.00 | 550 | chaos |  | h01A, h00R | h009 |  |
| `h00I` | Heavy Ballista Tower | 55 | 130 | 25–28 | 0.85 | 800 | pierce |  | h01G | R000 | A006 Steel Graphics |
| `h00J` | Rock Tower | 100 | 210 | 20–28 | 0.45 | 800 | siege | 100/150/0 | h016 | R000 |  |
| `h00K` | Mortar Tower | 40 | 120 | 18–35 | 1.35 | 1200 | siege | 150/185/0 | h014 | R000 |  |
| `h00L` | Poison Tower | 50 | 105 | 12–16 | 0.80 | 500 | normal |  | h00N | R000 | A008 Poison Damage |
| `h00M` | Shredder Spear Tower | 40 | 95 | 12–16 | 0.55 | 400 | normal | 3 cíle, −40 %/odraz, 400 | h00P | R000 | A00E Spike Graphics; A009 Shredder Spear |
| `h00N` | Spider Poison Tower | 70 | 175 | 20–25 | 0.80 | 500 | normal |  | h00O | R000 | A00A Spider Poison |
| `h00O` | Venom Tower | 100 | 275 | 30–35 | 0.80 | 500 | normal |  | h01B | R000 | A00C Venom Attack |
| `h00P` | Shuriken Tower | 60 | 155 | 15–18 | 0.45 | 400 | normal | 4 cíle, −40 %/odraz, 400 |  | R000 | A00E Spike Graphics; A00D Shuriken Attack |
| `o000` | Catapult | 70 | 100 | 50–60 | 2.50 | 1100 | siege | 100/175/0 |  |  |  |
| `h00Q` | Lightning Tower | 100 | 80 | 20–35 | 1.80 | 1000 | magic |  | h012, h00Y | h00S, h00G, R000 | A005 Útok bleskem |
| `h00R` | Fireball Tower | 70 | 120 | 25–32 | 0.85 | 550 | chaos |  | h00Z |  |  |
| `h00S` | Cold Tower | 60 | 60 | 10–12 | 0.90 | 600 | spells |  | h019, h00W | h00G, R000 | A00I Cold Attack |
| `h00T` | Fire Arrow Tower | 55 | 100 | 22–26 | 0.65 | 700 | pierce |  |  | h00R | A00H Fire Arrow Graphics |
| `h00U` | Commander Aura Tower | 0 | 100 | – | – | – | – |  | h00V | R000 | A00O Mage Watcher; A00K Damage Aura |
| `h00V` | Royal Aura Tower | 60 | 160 | – | – | – | – |  |  | R000 | A00O Mage Watcher; A00L Royal Aura; A00K Damage Aura |
| `h00W` | Ice Tower | 60 | 120 | 10–12 | 0.90 | 600 | spells |  | h011 |  | A00M Ice Attack |
| `n00B` | Temple Priest | 60 | 100 | 8–10 | 1.50 | 900 | pierce |  |  |  | A00S Share Mana; A00Q Mana Drain |
| `n00C` | Witchmaster | 100 | 100 | 10–15 | 1.50 | 900 | chaos |  |  |  | A00P Bless Weapons; ACmo Skyfury |
| `h00Y` | High Voltage Lightning Tower | 100 | 180 | 50–85 | 1.80 | 1000 | magic |  | h010 | R000 | A005 Útok bleskem |
| `h00Z` | Firespray Tower | 110 | 230 | 4–6 | 0.10 | 550 | chaos | 40/90/0 |  | R000 |  |
| `h010` | Superior Lightning Tower | 120 | 300 | 80–105 | 1.80 | 1000 | magic |  | h013 | h011 | A00R Lightning Attack Advanced |
| `h011` | Frost Tower | 90 | 210 | 22–27 | 0.90 | 600 | spells |  |  | R000 | A00T Frost Attack |
| `h012` | Shock Tower | 210 | 250 | 16–20 | 1.80 | 1000 | magic |  |  | h013 | A00J Shocking Strike; A00F Shock Graphics; A006 Steel Graphics |
| `h013` | Thunder Wrath Tower | 200 | 500 | 175–260 | 1.80 | 1000 | magic |  |  | R000 | A00G Thunder Wrath Graphics; A00R Lightning Attack Advanced |
| `h00H` | Rocket Tower | 125 | 205 | 9–12 | 0.25 | 700 | hero | 100/150/0 | h015 | h00R, h00K |  |
| `h014` | Bombard Tower | 100 | 200 | 34–45 | 1.20 | 1200 | siege | 150/185/0 |  | h00H | A006 Steel Graphics |
| `h015` | Fast Rocket Tower | 175 | 380 | 22–26 | 0.20 | 800 | hero | 100/150/0 |  | R000 |  |
| `h016` | Mountain Tower | 200 | 410 | 42–56 | 0.35 | 800 | siege | 120/180/0 |  | R000 |  |
| `h019` | Frozer Tower | 30 | 90 | 18–24 | 0.70 | 500 | spells |  |  | R000 | A000 Ice Graphics; A00W Freezing Strike |
| `h01A` | Napalm Tower | 70 | 120 | 25–30 | 1.60 | 750 | chaos | 200/0/0 | h01E | h00H |  |
| `h01B` | Basilisk Venom Tower | 725 | 1000 | 50–60 | 0.80 | 500 | normal |  |  | h013 | A00X Basilisk Venom Attack |
| `h01D` | Beer Barrel Tower | 20 | 20 | 3–7 | 1.80 | 600 | siege | 75/125/0 | h005 | h001 | A00Y Den Graphics |
| `h01E` | Explosives Thrower Tower | 280 | 400 | 85–120 | 1.50 | 750 | chaos | 200/0/0 |  | R000 |  |
| `h01F` | Alcohol Tower | 120 | 120 | 32–35 | 1.10 | 680 | hero |  |  | h00L | A00Z Alcohol Attack |
| `h01G` | Impaler Ballista Tower | 90 | 220 | 34–48 | 0.65 | 800 | pierce | 50/100/0 |  | R000 | A00E Spike Graphics; A006 Steel Graphics |

## Builder, budovy, obchod

- `h002` **Tower Builder** – staví h001, h004, h006, h00E, h00G, h00S, h00Q, h01F; schopnosti A007, Avul, Ahrp
- `h018` **Tower Builder** – schopnosti A011, A010, Ahrp, A00U, A007, Avul
- `h000` **Kasárna** – trénuje n00B, n00C, o000, n004; výzkumy R002, R001, R000; cena 160; schopnosti Avul
- `h00A` **Hightower** – prodává h017, h00X; schopnosti Ane2, Avul
- `h017` **Buy Life** – cena 50
- `h00X` **Repair Gate** – cena 300

## Výzkumy

- `R000` (základ `Rhac`) **Vylepšené zdivo** – 3 úrovní, cena 100/300/500, čas 30/40/50 s – Allows you to build better towers.
- `R001` (základ `Rhse`) **Mage Watcher** – 1 úrovní, cena 80, čas 12 s – Gives Aura Towers the ability to detect invisible units.
- `R002` (základ `Rhra`) **Improved Weapons** – 3 úrovní, cena 100/175/250, čas 20/20/20 s – Increases the attack damage of wall defenders; Temple Archer, Temple Priest, Witchmaster and Catapult

## Schopnosti (w3a)

| ID | Základ | Název | Upravená pole |
|---|---|---|---|
| `Ablo` | `Ablo` |  |  |
| `ACrn` | `ACrn` |  | Ore1@1=5, acdn@1=150 |
| `ACmo` | `ACmo` | Skyfury | aare@1=250, aran@1=1000, adur@1=20, Esf1@1=50, Esf2@1=2, Esf3@1=0 |
| `Ahid` | `Ahid` |  | Shm2@1=5, Shm3@1=5, Shm1@1=5 |
| `Apsh` | `Apsh` |  | acdn@1=7 |
| `A001` | `Aroc` | Multishot | aare@1=700, Efk2@1=1000, Efk3@1=1, Efk1@1=10, acdn@1=0.6499999761581421, adur@1=0.6499999761581421 |
| `A002` | `Aroc` | Multishot | aare@1=700, Efk2@1=1000, Efk3@1=4, Efk1@1=10, acdn@1=0.6499999761581421, adur@1=0.6499999761581421 |
| `A003` | `AHtc` | Sell | adur@1=0, acdn@1=0, aare@1=0, Htc1@1=0, Htc4@1=0, Htc3@1=0 |
| `A004` | `AOae` | Speed Aura | aare@1=120, Oae1@1=0, Oae2@1=0.33000001311302185 |
| `A006` | `AId1` | Steel Graphics |  |
| `A005` | `Alit` |  |  |
| `A008` | `Aspo` | Poison Damage | adur@1=12, Spo3@1=0, Spo1@1=7, Spo2@1=0, Spo4@1=9 |
| `A009` | `Amgl` | Shredder Spear |  |
| `A00A` | `Aspo` | Spider Poison | adur@1=18, Spo3@1=0, Spo2@1=0.699999988079071, Spo4@1=11, Spo1@1=15 |
| `A00B` | `AHfa` | Flaming Arrows | aran@1=900 |
| `A00C` | `Aspo` | Venom Attack | adur@1=30, Spo3@1=0, Spo2@1=0.6000000238418579, Spo4@1=11, Spo1@1=35 |
| `A00D` | `Amgl` | Shuriken Attack |  |
| `A00E` | `AId1` | Spike Graphics |  |
| `A00F` | `AId1` | Shock Graphics |  |
| `A00G` | `AId1` | Thunder Wrath Graphics |  |
| `A00I` | `Aspo` | Cold Attack | Spo1@1=0, Spo4@1=6, adur@1=8, Spo3@1=0.5 |
| `A00H` | `AId1` | Fire Arrow Graphics |  |
| `A00K` | `ACac` | Damage Aura | Cac1@1=0.33000001311302185, aare@1=120 |
| `A00L` | `AOae` | Royal Aura | aare@1=120, Oae1@1=0, Oae2@1=0.5 |
| `A00M` | `Aspo` | Ice Attack | Spo1@1=0, Spo4@1=6, adur@1=12, Spo3@1=0.4000000059604645, Spo2@1=0.4000000059604645 |
| `A00N` | `Aroa` | Repair Gate | Roa1@1=0, aare@1=0, adur@1=0 |
| `A00O` | `Adts` | Mage Watcher | aran@1=1000 |
| `A00P` | `ACro` | Bless Weapons | Roa1@1=0.5, aare@1=600, acdn@1=10 |
| `A00Q` | `AHdr` | Mana Drain | aare@1=1000, aran@1=900, acdn@1=5, Ndr5@1=1, Ndr2@1=10, adur@1=10 |
| `A00S` | `Arpm` | Share Mana | Rpb6@1=10, Rej2@1=1, aare@1=500, Rpb5@1=1, acdn@1=1.2000000476837158 |
| `A00R` | `Alit` | Lightning Attack Advanced |  |
| `A00T` | `Aspo` | Frost Attack | Spo1@1=0, Spo4@1=6, adur@1=18, Spo2@1=0.25 |
| `A00J` | `ACbh` | Shocking Strike | Hbh1@1=50, Hbh3@1=50, adur@1=3, aran@1=1000 |
| `A007` | `Arav` | Fly | adur@1=0, Eme1@1=h002, Eme3@1=1.5, Eme2@1=6, Eme4@1=0 |
| `A00U` | `AId1` | Flier Graphics |  |
| `A00V` | `AEar` | High Terrain | Ear1@1=0 |
| `A00W` | `ACbh` | Freezing Strike | Hbh1@1=50, Hbh3@1=0, adur@1=1.2000000476837158, aran@1=1000 |
| `A000` | `AId1` | Ice Graphics |  |
| `A00X` | `Aspo` | Basilisk Venom Attack | adur@1=0, Spo3@1=0, Spo4@1=11, Spo1@1=120 |
| `A00Y` | `AId1` | Den Graphics |  |
| `A00Z` | `Aspo` | Alcohol Attack | Spo1@1=10, Spo4@1=5, adur@1=8, Spo3@1=0.30000001192092896 |
| `A010` | `AHtb` | Coin Basher | aran@1=1000, acdn@1=8, Htb1@1=0, adur@1=8 |

## Regiony

| Název | minX | minY | maxX | maxY |
|---|---|---|---|---|
| Spawn Region | -4352 | -640 | -3968 | -256 |
| Path1 | -2240 | -544 | -2144 | -352 |
| Path2 | -2336 | -1312 | -2144 | -1216 |
| Path3 | -704 | -1312 | -608 | -1120 |
| Path4 | -800 | 320 | -608 | 416 |
| Path5 | -1568 | 224 | -1472 | 416 |
| Path6 | -1568 | 1088 | -1376 | 1184 |
| Path7 | 448 | 992 | 544 | 1184 |
| Path8 | 352 | -2080 | 544 | -1984 |
| Path9 | -1568 | -2080 | -1472 | -1888 |
| Path10 | -1568 | -448 | -1344 | -352 |
| Gate | 704 | -864 | 1536 | -32 |
| Goal | 3648 | -768 | 3840 | -128 |
| Final Path | 1472 | -960 | 4000 | 64 |

## Doodady (počty podle ID)

`YTpb`×223, `ZPfw`×146, `ZPms`×119, `ZPtw`×91, `ZPsh`×77, `ZRrk`×77, `ZPvp`×65, `ZOfp`×60, `D000`×56 (Doodads\Ruins\Terrain\RuinsWall90\RuinsWall900.mdl), `ZRbs`×53, `ZRbd`×50, `ZPru`×36, `ZOtr`×22, `ZOrp`×14, `ZRrs`×13, `ZOst`×12, `ZOob`×10, `D002`×10 (Doodads\Ruins\Terrain\RuinsWall90\RuinsWall901.mdl), `ZRsp`×10, `ZOsh`×8, `ZSas`×7, `ZCv1`×7, `ZCv2`×7, `AOsr`×6, `ZObz`×6, `LTs8`×4, `BOct`×4, `ZTnc`×3, `D003`×3 (Doodads\Ruins\Terrain\RuinsWall90\RuinsWall902.mdl), `ZOls`×3, `ZSrb`×3, `ZOsb`×2, `D001`×2 (Doodads\Ruins\Terrain\RuinsWall90\RuinsWall904.mdl), `ZSab`×2, `ZTg1`×2, `ZOba`×2, `BOtt`×2, `ZTsg`×1, `OTsp`×1, `D004`×1 (Abilities\Spells\Human\MassTeleport\MassTeleportTo.mdl), `LOfl`×1
