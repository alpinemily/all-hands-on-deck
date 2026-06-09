import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DATA_URL    = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=0';
const MAPPING_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=1825057245';

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

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map((line, i) => {
    const vals = splitCSVLine(line);
    const obj = { _id: i };
    headers.forEach((h, j) => { obj[h] = (vals[j] || '').trim(); });
    return obj;
  }).filter(r => Object.entries(r).some(([k, v]) => k !== '_id' && v));
}

async function main() {
  console.log('Fetching sheets...');
  const [dataText, mappingText] = await Promise.all([
    fetch(DATA_URL).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} fetching data sheet`); return r.text(); }),
    fetch(MAPPING_URL).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} fetching mapping sheet`); return r.text(); }),
  ]);

  const mapping = parseCSV(mappingText)[0];
  if (!mapping?.front_primary) throw new Error('Mapping sheet missing front_primary column');

  const rawCards = parseCSV(dataText);
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
