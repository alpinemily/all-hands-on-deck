import './style.css'

// ── Config ──────────────────────────────────────────────────────────────────
// Tab 1: content data. Tab 2: layout mapping.
// For each URL: File → Share → Publish to web → select the tab → CSV → Publish → copy link.
// To find a tab's gid: click the tab in Google Sheets and look at the URL: #gid=XXXXXXX
const DATA_URL    = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=0';
const MAPPING_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pub?output=csv&gid=1825057245';
const SHEET_LINK  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQa2dOfKbHmAWG7_6KSNFdtsXFlwB4YnyAsi4FaUsEH365UAgzeeXadZnjCSv7uSB9hHAVc6y4iRi2/pubhtml';

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
let isFlipped      = false;
let sessionDone    = [];
let studyingEarly  = false;
let useTraditional = localStorage.getItem('use_traditional') === 'true';
let selectedClass  = localStorage.getItem('class_filter') || 'all';
// mapping: { front_primary, front_secondary, front_tertiary, back_primary, back_secondary, back_tertiary }
// each value is a column name from the data sheet (or empty string)
let mapping     = {};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const cardEl        = document.getElementById('card');
const frontPrimary     = document.getElementById('front-primary');
const frontSecond      = document.getElementById('front-secondary');
const frontTertiary    = document.getElementById('front-tertiary');
const frontBottomLeft  = document.getElementById('front-bottom-left');
const frontStat        = document.getElementById('front-stat');
const starFront     = document.getElementById('star-front');
const starBack      = document.getElementById('star-back');
const removeFront   = document.getElementById('remove-front');
const removeBack    = document.getElementById('remove-back');
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

  frontPrimary.textContent    = slot(card, 'front_primary');
  frontSecond.textContent     = slot(card, 'front_secondary');
  frontTertiary.textContent   = slot(card, 'front_tertiary');
  const bottomLeft = slot(card, 'front_bottom_left');
  frontBottomLeft.textContent = bottomLeft ? `class ${bottomLeft}` : '';

  const entry = getSRSEntry(srs, card._id);
  const { totalReviews = 0, totalCorrect = 0, starred = false } = entry;
  frontStat.textContent = totalReviews ? `${totalCorrect}/${totalReviews} correct` : 'New';
  frontStat.className = `card__stat ${statColor(totalReviews, totalCorrect)}`;
  setStarUI(starred);

  backPrimary.textContent  = slot(card, useTraditional && mapping.back_primary_traditional ? 'back_primary_traditional' : 'back_primary');
  backSecond.textContent   = slot(card, 'back_secondary');
  backTertiary.textContent = slot(card, 'back_tertiary');

  const done  = sessionDone.length;
  const total = queue.length + done;
  progressFill.style.width = `${(done / total) * 100}%`;
  progressText.textContent = `${done} / ${total} cards`;
  deckInfo.textContent     = studyingEarly
    ? `Card ${current + 1} of ${queue.length} — all caught up, reviewing early`
    : `Card ${current + 1} of ${queue.length} remaining`;
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
  const backPri = slot(card, 'back_primary');
  const backSec = slot(card, 'back_secondary');
  item.innerHTML = `
    <span class="done-item__status ${gotIt ? 'got' : 'forgot'}"></span>
    <span class="done-item__primary">${slot(card, 'front_primary')}</span>
    <span class="done-item__back">
      <span class="done-item__back-primary">${backPri}</span>
      ${backSec ? `<span class="done-item__back-secondary">${backSec}</span>` : ''}
    </span>
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

function removeCard() {
  if (queue.length === 0) return;
  const card  = allCards[queue[current]];
  const entry = getSRSEntry(srs, card._id);
  entry.removed = true;
  srs[card._id] = entry;
  saveSRS(srs);

  queue.splice(current, 1);
  if (current >= queue.length && current > 0) current--;
  renderCard();
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

function toggleStarById(id) {
  const entry = getSRSEntry(srs, id);
  entry.starred = !entry.starred;
  srs[id] = entry;
  saveSRS(srs);
  if (queue.length > 0 && allCards[queue[current]]?._id === id) setStarUI(entry.starred);
}

function toggleRemovedById(id) {
  const entry = getSRSEntry(srs, id);
  entry.removed = !entry.removed;
  srs[id] = entry;
  saveSRS(srs);
  if (entry.removed) {
    const pos = queue.indexOf(id);
    if (pos !== -1) {
      queue.splice(pos, 1);
      if (current >= queue.length && current > 0) current--;
      renderCard();
    }
  }
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

function buildQueue() {
  const candidates = allCards.filter(c => {
    if (getSRSEntry(srs, c._id).removed) return false;
    if (selectedClass !== 'all' && slot(c, 'front_bottom_left') !== selectedClass) return false;
    return true;
  });
  const due  = candidates.filter(c => getSRSEntry(srs, c._id).repetitions > 0 && isDue(srs, c._id));
  const newC = candidates.filter(c => getSRSEntry(srs, c._id).repetitions === 0);
  if (due.length === 0 && newC.length === 0) {
    shuffle(candidates);
    queue = candidates.map(c => c._id);
    studyingEarly = true;
  } else {
    shuffle(due); shuffle(newC);
    queue = [...due, ...newC].map(c => c._id);
    studyingEarly = false;
  }
  current = 0;
}

function startSession() {
  sessionDone = [];
  isFlipped = false;
  completeScreen.classList.remove('visible');
  cardArea.querySelector('.scene').style.display = '';
  deckInfo.style.display = '';
  buildQueue();
  renderCard();
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

    buildQueue();

    // Class filter dropdown
    const classValues = [...new Set(allCards.map(c => slot(c, 'front_bottom_left')).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    if (classValues.length > 0) {
      const classWrap   = document.getElementById('menu-class-wrap');
      const classSelect = document.getElementById('menu-class-select');
      classValues.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = `Class ${v}`;
        classSelect.appendChild(opt);
      });
      classSelect.value = selectedClass !== 'all' && classValues.includes(selectedClass) ? selectedClass : 'all';
      classWrap.style.display = '';
      classSelect.addEventListener('change', () => {
        selectedClass = classSelect.value;
        localStorage.setItem('class_filter', selectedClass);
        startSession();
        closeMenu();
      });
    }

    const derivedTraditionalCol = mapping.back_primary?.replace('simplified', 'traditional');
    if (derivedTraditionalCol && derivedTraditionalCol !== mapping.back_primary && allCards[0]?.[derivedTraditionalCol] !== undefined) {
      mapping.back_primary_traditional = derivedTraditionalCol;
      const scriptWrap = document.getElementById('menu-script');
      scriptWrap.style.display = 'flex';
      const scriptOpts = scriptWrap.querySelectorAll('.script-opt');
      const updateScriptUI = () => scriptOpts.forEach(btn =>
        btn.classList.toggle('active', (btn.dataset.script === 'traditional') === useTraditional)
      );
      updateScriptUI();
      scriptOpts.forEach(btn => {
        btn.addEventListener('click', () => {
          useTraditional = btn.dataset.script === 'traditional';
          localStorage.setItem('use_traditional', useTraditional);
          updateScriptUI();
          renderCard();
        });
      });
    }

    loadingEl.style.display = 'none';
    cardArea.style.display  = 'flex';
    renderCard();
  } catch (err) {
    showError(err.message);
  }
}

// ── Vocab table ──────────────────────────────────────────────────────────────
let vocabSortCol = 'pct';
let vocabSortDir = 'asc';

// Interpolate red→yellow→green across 0–1
function spectrumColor(pct) {
  const r = pct < 0.5 ? 220 : Math.round(220 - (pct - 0.5) * 2 * 180);
  const g = pct < 0.5 ? Math.round(pct * 2 * 200) : 200;
  return `rgb(${r},${g},60)`;
}

function vocabCols() {
  return [
    { key: 'starred',       label: '★' },
    { key: 'front_primary', label: mapping.front_primary  || 'Word' },
    mapping.front_secondary   ? { key: 'front_secondary',   label: mapping.front_secondary   } : null,
    mapping.front_tertiary    ? { key: 'front_tertiary',    label: mapping.front_tertiary    } : null,
    mapping.front_bottom_left ? { key: 'front_bottom_left', label: mapping.front_bottom_left } : null,
    { key: 'back_primary',  label: mapping.back_primary   || 'Answer' },
    mapping.back_secondary  ? { key: 'back_secondary',  label: mapping.back_secondary  } : null,
    mapping.back_tertiary   ? { key: 'back_tertiary',   label: mapping.back_tertiary   } : null,
    { key: 'reviews', label: 'Reviews' },
    { key: 'pct',     label: '% Correct' },
  ].filter(Boolean);
}

function buildVocabTable() {
  const cols = vocabCols();

  // Header
  const headRow = document.querySelector('#vocab-table thead tr');
  headRow.innerHTML = cols.map(c => {
    const active = vocabSortCol === c.key;
    const arrow  = active ? (vocabSortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';
    return `<th data-col="${c.key}" class="${active ? 'th-active' : ''}">${c.label}<span class="sort-arrow">${arrow}</span></th>`;
  }).join('') + '<th>Remove</th>';
  headRow.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      if (vocabSortCol === th.dataset.col) vocabSortDir = vocabSortDir === 'asc' ? 'desc' : 'asc';
      else { vocabSortCol = th.dataset.col; vocabSortDir = 'asc'; }
      buildVocabTable();
    });
  });

  // Rows
  const rows = allCards.map(card => {
    const e = getSRSEntry(srs, card._id);
    const totalReviews = e.totalReviews || 0;
    const totalCorrect = e.totalCorrect || 0;
    const pct          = totalReviews ? totalCorrect / totalReviews : null;
    return { card, totalReviews, totalCorrect, pct, removed: !!e.removed, starred: !!e.starred };
  });

  rows.sort((a, b) => {
    const dir = vocabSortDir === 'asc' ? 1 : -1;
    if (vocabSortCol === 'pct') {
      // unseen (null) always below seen words regardless of direction
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return (a.pct - b.pct) * dir;
    }
    if (vocabSortCol === 'reviews') return (a.totalReviews - b.totalReviews) * dir;
    if (vocabSortCol === 'starred') return ((b.starred ? 1 : 0) - (a.starred ? 1 : 0)) * dir;
    const av = slot(a.card, vocabSortCol) || '';
    const bv = slot(b.card, vocabSortCol) || '';
    return av.localeCompare(bv, undefined, { sensitivity: 'base' }) * dir;
  });

  document.getElementById('vocab-count').textContent = `(${rows.length})`;

  document.getElementById('vocab-body').innerHTML = rows.map(({ card, totalReviews, totalCorrect, pct, removed, starred }) => {
    const rowBg = '';

    const pctCell    = pct === null
      ? `<td><span class="pct-badge-new">New</span></td>`
      : `<td><span class="pct-badge" style="background:${spectrumColor(pct)}">${Math.round(pct * 100)}%</span></td>`;
    const reviewCell = `<td class="cell-muted">${totalReviews ? `${totalCorrect}/${totalReviews}` : '—'}</td>`;
    const starCell   = `<td class="cell-star" data-action="star" data-id="${card._id}">${starred ? '★' : '☆'}</td>`;
    const removeCell = `<td class="cell-remove" data-action="remove" data-id="${card._id}" title="${removed ? 'Restore word' : 'Remove word'}">${removed ? '↩' : '✕'}</td>`;

    const dataCells = cols
      .filter(c => c.key !== 'pct' && c.key !== 'reviews' && c.key !== 'starred')
      .map(c => `<td class="${removed ? 'cell-removed' : ''}">${slot(card, c.key)}</td>`)
      .join('');

    return `<tr class="${removed ? 'row-removed' : ''}" style="${rowBg}">${starCell}${dataCells}${reviewCell}${pctCell}${removeCell}</tr>`;
  }).join('');
}

function openVocabModal() {
  buildVocabTable();
  document.getElementById('vocab-overlay').classList.add('open');
}

function closeVocabModal() {
  document.getElementById('vocab-overlay').classList.remove('open');
}

document.getElementById('vocab-close').addEventListener('click', closeVocabModal);
document.getElementById('vocab-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('vocab-overlay')) closeVocabModal();
});

document.getElementById('vocab-body').addEventListener('click', e => {
  const td = e.target.closest('td[data-action]');
  if (!td) return;
  const id = parseInt(td.dataset.id, 10);
  if (td.dataset.action === 'star')   toggleStarById(id);
  if (td.dataset.action === 'remove') toggleRemovedById(id);
  buildVocabTable();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeVocabModal();
});

// ── Menu sidebar ─────────────────────────────────────────────────────────────
const menuBtn      = document.getElementById('menu-btn');
const menuSidebar  = document.getElementById('menu-sidebar');
const menuBackdrop = document.getElementById('menu-backdrop');

function openMenu()  { menuSidebar.classList.add('open');  menuBackdrop.classList.add('open');  }
function closeMenu() { menuSidebar.classList.remove('open'); menuBackdrop.classList.remove('open'); }

menuBtn.addEventListener('click', openMenu);
menuBackdrop.addEventListener('click', closeMenu);
document.getElementById('menu-sidebar-close').addEventListener('click', closeMenu);

document.getElementById('menu-sheet-link').href = SHEET_LINK;

document.getElementById('menu-vocab').addEventListener('click', () => {
  closeMenu();
  openVocabModal();
});

document.getElementById('menu-reset').addEventListener('click', () => {
  if (confirm('Reset all progress? This clears got it / forgot it history, stars, and removed words.')) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
});

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('card-scene').addEventListener('click', flipCard);
btnGot.addEventListener('click',    () => answer(true));
btnForgot.addEventListener('click', () => answer(false));
starFront.addEventListener('click',   e => { e.stopPropagation(); toggleStar(); });
starBack.addEventListener('click',    e => { e.stopPropagation(); toggleStar(); });
removeFront.addEventListener('click', e => { e.stopPropagation(); removeCard(); });
removeBack.addEventListener('click',  e => { e.stopPropagation(); removeCard(); });
document.getElementById('btn-restart').addEventListener('click', () => location.reload());

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && completeScreen.classList.contains('visible')) {
    location.reload();
    return;
  }
  if (e.key === ' ')                               { e.preventDefault(); flipCard(); }
  if (e.key === 'g' || e.key === 'G')              answer(true);
  if (e.key === 'f' || e.key === 'F')              answer(false);
  if (e.key === 's' || e.key === 'S')              toggleStar();
  if (e.key === 'Delete' || e.key === 'Backspace') removeCard();
});

// ── Dark mode ─────────────────────────────────────────────────────────────────
const DARK_KEY = 'dark_mode';
const darkOpts = document.querySelectorAll('#menu-dark-mode .script-opt');

function applyDark(on) {
  document.documentElement.classList.toggle('dark', on);
  darkOpts.forEach(btn => btn.classList.toggle('active', (btn.dataset.mode === 'dark') === on));
}

darkOpts.forEach(btn => {
  btn.addEventListener('click', () => {
    const isDark = btn.dataset.mode === 'dark';
    localStorage.setItem(DARK_KEY, isDark);
    applyDark(isDark);
  });
});

applyDark(localStorage.getItem(DARK_KEY) === 'true');

// ── Start ─────────────────────────────────────────────────────────────────────
init();
