# All 汉字 Hànzì On Deck

Spaced repetition Mandarin flashcard app, hosted on GitHub Pages. Cards and layout are driven by a Google Sheet — no code changes needed to update vocabulary.

**Live site:** https://alpinemily.github.io/all-hands-on-deck/

---

## Features

- SM-2 spaced repetition — cards you know come back later; cards you forget come back next session
- Flip animation, keyboard shortcuts, star/remove individual cards
- Reviewed cards sidebar, session completion screen
- Full vocabulary table with sortable columns and per-word stats
- Dark mode (persisted across sessions)
- Static JSON API — any site can fetch card data without touching the Google Sheet

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Flip card |
| `C` | Got it |
| `X` | Forgot it |
| `S` | Star / unstar |
| `Delete` | Remove word |
| `Enter` | Study again (on completion screen) |

---

## Static JSON API

The API is generated at build time from the Google Sheet and served as static JSON from GitHub Pages. All endpoints support cross-origin requests (CORS open).

**Base URL:** `https://alpinemily.github.io/all-hands-on-deck`

### `GET /api/count.json`

Returns the total number of flashcards.

```json
{ "count": 142 }
```

### `GET /api/cards.json`

Returns all cards as an array.

```json
[
  {
    "id": 0,
    "front": { "primary": "你好", "secondary": "nǐ hǎo", "tertiary": "" },
    "back":  { "primary": "hello", "secondary": "", "tertiary": "" }
  },
  ...
]
```

### `GET /api/cards/{id}.json`

Returns a single card by its numeric id (0-indexed).

```
GET /api/cards/0.json
```

```json
{
  "id": 0,
  "front": { "primary": "你好", "secondary": "nǐ hǎo", "tertiary": "" },
  "back":  { "primary": "hello", "secondary": "", "tertiary": "" }
}
```

`primary`, `secondary`, and `tertiary` map to the six slot columns defined in the mapping sheet (Tab 2). Empty slots are empty strings.

The API is regenerated on every deploy (push to `main`), so it stays in sync with the spreadsheet automatically.

---

## Google Sheet setup

The app reads from two tabs in one published Google Sheet:

**Tab 1 — vocabulary data**  
One row per card. Column names are up to you — you map them in Tab 2.

**Tab 2 — layout mapping**  
One row (plus header) with these columns:

| Column | Description |
|--------|-------------|
| `front_primary` | Column name from Tab 1 to show as the main front-of-card text |
| `front_secondary` | Optional — shown smaller below primary |
| `front_tertiary` | Optional — shown even smaller |
| `back_primary` | Main back-of-card text |
| `back_secondary` | Optional |
| `back_tertiary` | Optional |

Leave a mapping cell blank to hide that slot.

To publish: **File → Share → Publish to web**, select the tab, choose CSV, publish. Copy the link. Update `DATA_URL` and `MAPPING_URL` in `src/main.js` (and `scripts/generate-api.js`) with your sheet's URLs.

---

## Development

```bash
npm install
npm run dev        # start dev server
npm run generate   # regenerate public/api/ from the live sheet
npm run build      # generate + vite build → dist/
```

Deploys automatically to GitHub Pages on push to `main`. Also runs daily at 6am PST to pick up any Google Sheet changes — the full build (including `generate`) re-runs on schedule, so the API JSON stays in sync without any manual intervention. Note: GitHub Actions cron runs in UTC, so this shifts to 7am during PDT (daylight saving).

---

## JS API module

`src/api.js` exports a `FlashcardAPI` class that wraps the CSV fetching, SM-2 logic, and localStorage persistence. Import it directly if you want to embed flashcard functionality in another page without the full UI:

```js
import { FlashcardAPI } from './src/api.js';

const api = new FlashcardAPI({ dataUrl, mappingUrl, storageKey: 'my_srs' });
await api.load();

const card = api.currentCard();  // { id, front, back, srs }
api.recordAnswer(true);          // advance + update SRS
api.getAllCards();                // full list with per-card SRS data
api.getStats();                  // session + deck statistics
```
