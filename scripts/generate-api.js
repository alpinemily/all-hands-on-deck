import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DATA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=0';

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// Row 1: column headers  Row 2: slot names (front_primary, back_primary, …)  Row 3+: data
function parseDataSheet(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 3) throw new Error('Sheet must have column headers (row 1), slot names (row 2), and at least one data row (row 3+).');
  const headers = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const slots   = splitCSVLine(lines[1]).map(s => s.trim().toLowerCase());
  const mapping = {};
  slots.forEach((slot, i) => { if (slot && headers[i]) mapping[slot] = headers[i]; });
  if (!mapping.front_primary) throw new Error('Row 2 must assign a column to the front_primary slot.');
  const cards = lines.slice(2).map((line, i) => {
    const vals = splitCSVLine(line);
    const obj  = { _id: i };
    headers.forEach((h, j) => { obj[h] = (vals[j] || '').trim(); });
    return obj;
  }).filter(r => Object.entries(r).some(([k, v]) => k !== '_id' && v));
  return { mapping, cards };
}

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
