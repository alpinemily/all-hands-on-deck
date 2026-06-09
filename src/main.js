import './style.css'

// ── Config ──────────────────────────────────────────────────────────────────
// Tab 1: content data. Tab 2: layout mapping.
// For each URL: File → Share → Publish to web → select the tab → CSV → Publish → copy link.
// To find a tab's gid: click the tab in Google Sheets and look at the URL: #gid=XXXXXXX
const DATA_URL    = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=0';
const MAPPING_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=1825057245';

const STORAGE_KEY = 'flashcard_srs_data';

// ── SM-2 spaced repetition ──────────────────────────────────────────────────
function loadSRS() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveSRS(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getSRSEntry(srs, id) {
  return srs[id] || { interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: 0, totalReviews: 0, totalCorrect: 0 };
}

function updateSRS(srs, id, gotIt) {
  const e = getSRSEntry(srs, id);
  e.totalReviews = (e.totalReviews || 0) + 1;
  if (gotIt) {
    e.totalCorrect = (e.totalCorrect || 0) + 1;
    e.repetitions++;
    if (e.repetitions === 1)      e.interval = 1;
    else if (e.repetitions === 2) e.interval = 6;
    else                          e.interval = Math.round(e.interval * e.easeFactor);
    e.easeFactor = Math.max(1.3, e.easeFactor + 0.1);
  } else {
    e.repetitions = 0;
    e.interval = 1;
    e.easeFactor = Math.max(1.3, e.easeFactor - 0.2);
  }
  e.nextReview = Date.now() + e.interval * 86400000;
  srs[id] = e;
  return srs;
}

function statColor(totalReviews, totalCorrect) {
  if (!totalReviews) return 'stat--new';
  const pct = totalCorrect / totalReviews;
  if (pct >= 0.8) return 'stat--green';
  if (pct >= 0.6) return 'stat--yellow';
  if (pct >= 0.4) return 'stat--orange';
  return 'stat--red';
}

function isDue(srs, id) {
  return Date.now() >= getSRSEntry(srs, id).nextReview;
}

// ── CSV parsing ──────────────────────────────────────────────────────────────
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

// ── App state ────────────────────────────────────────────────────────────────
let allCards    = [];
let queue       = [];
let current     = 0;
let srs         = {};
let isFlipped   = false;
let sessionDone = [];
// mapping: { front_primary, front_secondary, front_tertiary, back_primary, back_secondary, back_tertiary }
// each value is a column name from the data sheet (or empty string)
let mapping     = {};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const cardEl        = document.getElementById('card');
const frontPrimary  = document.getElementById('front-primary');
const frontSecond   = document.getElementById('front-secondary');
const frontTertiary = document.getElementById('front-tertiary');
const frontStat     = document.getElementById('front-stat');
const starFront     = document.getElementById('star-front');
const starBack      = document.getElementById('star-back');
const backPrimary   = document.getElementById('back-primary');
const backSecond    = document.getElementById('back-secondary');
const backTertiary  = document.getElementById('back-tertiary');
const actionBtns    = document.getElementById('action-btns');
const btnGot        = document.getElementById('btn-got');
const btnForgot     = document.getElementById('btn-forgot');
const progressFill  = document.getElementById('progress-fill');
const progressText  = document.getElementById('progress-text');
const doneList      = document.getElementById('done-list');
const deckInfo      = document.getElementById('deck-info');
const loadingEl     = document.getElementById('loading');
const cardArea      = document.getElementById('card-area');
const completeScreen = document.getElementById('complete-screen');

// ── Render ───────────────────────────────────────────────────────────────────
function slot(card, key) {
  const col = mapping[key];
  return col ? (card[col] || '') : '';
}

function renderCard() {
  if (queue.length === 0) { showComplete(); return; }

  const card = allCards[queue[current]];
  isFlipped = false;
  cardEl.classList.remove('flipped');
  actionBtns.classList.remove('visible');

  frontPrimary.textContent  = slot(card, 'front_primary');
  frontSecond.textContent   = slot(card, 'front_secondary');
  frontTertiary.textContent = slot(card, 'front_tertiary');

  const entry = getSRSEntry(srs, card._id);
  const { totalReviews = 0, totalCorrect = 0, starred = false } = entry;
  frontStat.textContent = totalReviews ? `${totalCorrect}/${totalReviews} correct` : 'New';
  frontStat.className = `card__stat ${statColor(totalReviews, totalCorrect)}`;
  setStarUI(starred);

  backPrimary.textContent  = slot(card, 'back_primary');
  backSecond.textContent   = slot(card, 'back_secondary');
  backTertiary.textContent = slot(card, 'back_tertiary');

  const done  = sessionDone.length;
  const total = queue.length + done;
  progressFill.style.width = `${(done / total) * 100}%`;
  progressText.textContent = `${done} / ${total} cards`;
  deckInfo.textContent     = `Card ${current + 1} of ${queue.length} remaining`;
}

function flipCard() {
  if (queue.length === 0) return;
  isFlipped = !isFlipped;
  cardEl.classList.toggle('flipped', isFlipped);
  actionBtns.classList.toggle('visible', isFlipped);
}

function addToDoneList(card, gotIt) {
  const item = document.createElement('div');
  item.className = 'done-item';
  item.innerHTML = `
    <span class="done-item__status ${gotIt ? 'got' : 'forgot'}"></span>
    <span class="done-item__primary">${slot(card, 'front_primary')}</span>
    <span class="done-item__secondary">${slot(card, 'back_primary')}</span>
  `;
  doneList.prepend(item);
}

function answer(gotIt) {
  if (!isFlipped || queue.length === 0) return;
  const card = allCards[queue[current]];
  srs = updateSRS(srs, card._id, gotIt);
  saveSRS(srs);
  sessionDone.push({ card, gotIt });
  addToDoneList(card, gotIt);

  queue.splice(current, 1);
  if (current >= queue.length && current > 0) current--;
  renderCard();
}

function showComplete() {
  cardArea.querySelector('.scene').style.display = 'none';
  actionBtns.style.display = 'none';
  deckInfo.style.display = 'none';
  completeScreen.classList.add('visible');

  const got = sessionDone.filter(d => d.gotIt).length;
  document.getElementById('complete-got').textContent    = got;
  document.getElementById('complete-forgot').textContent = sessionDone.length - got;
}

function setStarUI(starred) {
  const symbol = starred ? '★' : '☆';
  starFront.textContent = symbol;
  starBack.textContent  = symbol;
  starFront.classList.toggle('starred', starred);
  starBack.classList.toggle('starred', starred);
}

function toggleStar() {
  if (queue.length === 0) return;
  const card  = allCards[queue[current]];
  const entry = getSRSEntry(srs, card._id);
  entry.starred = !entry.starred;
  srs[card._id] = entry;
  saveSRS(srs);
  setStarUI(entry.starred);
}

function showError(msg) {
  loadingEl.innerHTML = `
    <p style="color:#ef4444;font-weight:600;margin-bottom:0.5rem">Failed to load flashcards</p>
    <p style="color:#6b7280;font-size:0.85rem;max-width:360px;text-align:center">${msg}</p>
  `;
}

// ── Data loading ──────────────────────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function fetchCSV(url, label) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${label} — is the sheet published publicly?`);
  return resp.text();
}

async function init() {
  srs = loadSRS();
  try {
    const [dataText, mappingText] = await Promise.all([
      fetchCSV(DATA_URL,    'data sheet (Tab 1)'),
      fetchCSV(MAPPING_URL, 'mapping sheet (Tab 2)'),
    ]);

    const mappingRows = parseCSV(mappingText);
    if (mappingRows.length === 0) throw new Error('Mapping sheet (Tab 2) is empty or missing headers: front_primary, front_secondary, front_tertiary, back_primary, back_secondary, back_tertiary');
    mapping = mappingRows[0];

    if (!mapping.front_primary) throw new Error('Mapping sheet must have a front_primary column with a value.');

    allCards = parseCSV(dataText);
    if (allCards.length === 0) throw new Error('No cards found in data sheet (Tab 1).');

    const due  = allCards.filter(c => getSRSEntry(srs, c._id).repetitions > 0 && isDue(srs, c._id));
    const newC = allCards.filter(c => getSRSEntry(srs, c._id).repetitions === 0);
    shuffle(due); shuffle(newC);
    queue = [...due, ...newC].map(c => c._id);

    loadingEl.style.display = 'none';
    cardArea.style.display  = 'flex';
    current = 0;
    renderCard();
  } catch (err) {
    showError(err.message);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('card-scene').addEventListener('click', flipCard);
btnGot.addEventListener('click',    () => answer(true));
btnForgot.addEventListener('click', () => answer(false));
starFront.addEventListener('click', e => { e.stopPropagation(); toggleStar(); });
starBack.addEventListener('click',  e => { e.stopPropagation(); toggleStar(); });
document.getElementById('btn-restart').addEventListener('click', () => location.reload());

document.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
  if (e.key === 'ArrowRight' || e.key === 'l') answer(true);
  if (e.key === 'ArrowLeft'  || e.key === 'h') answer(false);
  if (e.key === 's' || e.key === 'S') toggleStar();
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();
