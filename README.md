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

## Nasazení

- `npm run upload` – build a nahrání `dist/` na FTP do `/www/subdom/app/ruined-temple/` = https://app.makuderovi.cz/ruined-temple/
- balíček [`wedos-upload`](https://github.com/LorDOniX/wedos-upload), cíl v `package.json` pod klíčem `wedosUpload`, přístup na FTP v proměnných prostředí `WEDOS_FTP_HOST`, `WEDOS_FTP_USER`, `WEDOS_FTP_PASSWORD`
- nahrávají se jen změněné soubory (stav serveru v `build-data/upload.json`, patří do gitu); `npx wedos-upload --dry-run` vypíše změny, `--full` nahraje vše
- pozor: volitelná originální data `public/war3/` (Warcraft III) by se s buildem nahrála veřejně
