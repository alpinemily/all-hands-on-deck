import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_SHEET_BASE } from '../src/config.js';
import { parseDataSheet } from '../src/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DATA_URL = DEFAULT_SHEET_BASE + '?output=csv';

async function main() {
  console.log('Fetching sheet...');
  const dataText = await fetch(DATA_URL).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching data sheet`);
    return r.text();
  });

  const { mapping, cards: rawCards } = parseDataSheet(dataText);
  if (rawCards.length === 0) throw new Error('No cards found in data sheet');

  function slot(card, key) {
    const col = mapping[key];
    return col ? (card[col] || '') : '';
  }

  const cards = rawCards.map(card => ({
    id: card._id,
    front: {
      primary:   slot(card, 'front_primary'),
      secondary: slot(card, 'front_secondary'),
      tertiary:  slot(card, 'front_tertiary'),
    },
    back: {
      primary:   slot(card, 'back_primary'),
      secondary: slot(card, 'back_secondary'),
      tertiary:  slot(card, 'back_tertiary'),
    },
  }));

  const apiDir   = join(ROOT, 'public', 'api');
  const cardsDir = join(apiDir, 'cards');
  mkdirSync(cardsDir, { recursive: true });

  writeFileSync(join(apiDir, 'cards.json'), JSON.stringify(cards, null, 2));
  writeFileSync(join(apiDir, 'count.json'), JSON.stringify({ count: cards.length }));
  for (const card of cards) {
    writeFileSync(join(cardsDir, `${card.id}.json`), JSON.stringify(card, null, 2));
  }

  console.log(`Generated ${cards.length} cards → public/api/`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
