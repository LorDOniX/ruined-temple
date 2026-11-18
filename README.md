# Ruined Temple TD – WebGL replika

Replika Warcraft III mapy **Ruined Temple TD v1.04** (Antsu, 2007) v three.js + TypeScript + Vite.
Data (terén, doodady, regiony, jednotky, object data, texty a herní logika z `war3map.j`) jsou vytěžena přímo
ze souboru `Ruined Temple TD v.1.04.w3x`.

```bash
npm install
npm run assets -- --game "Warcraft III - Gold Edition" --dir "Classic HD for Classic-15-1-0-1734261393"
npm run dev        # http://127.0.0.1:5199
```

| Příkaz | Co dělá |
|---|---|
| `npm run extract` | `.w3x` → `public/map/` (map.json, minimapa, náhled, war3map.j) a `data/raw/` |
| `npm run assets -- --game … / --mpq … / --dir …` | originální modely, textury (DDS → PNG), ikony, zvuky a hudba z instalace WC3 a HD modu → `public/war3/` |
| `npm run report` | přehled vytěžených dat → `docs/DATA.md` |
| `npm run build` | typecheck + produkční build |

- Návrh implementace, co je hotové a **co je potřeba dodat**: [docs/IMPLEMENTACE.md](docs/IMPLEMENTACE.md)
- Vytěžená data (vlny, věže, výzkumy, schopnosti, regiony): [docs/DATA.md](docs/DATA.md)
