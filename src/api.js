// ── FlashcardAPI ─────────────────────────────────────────────────────────────
// Self-contained data + SRS layer. No DOM dependencies.
//
// Usage:
//   const api = new FlashcardAPI({ dataUrl, mappingUrl, storageKey });
//   await api.load();
//   const card = api.nextCard();   // { id, front, back, srs }
//   api.recordAnswer(true);        // "got it"
//   api.toggleStar(card.id);
//   api.getAllCards();              // full list with SRS data

// ── CSV ───────────────────────────────────────────────────────────────────────
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

// ── SM-2 ──────────────────────────────────────────────────────────────────────
function defaultEntry() {
  return { interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: 0, totalReviews: 0, totalCorrect: 0, starred: false, removed: false };
}

function applyAnswer(entry, gotIt) {
  const e = { ...entry };
  e.totalReviews++;
  if (gotIt) {
    e.totalCorrect++;
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
  return e;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── FlashcardAPI class ────────────────────────────────────────────────────────
export class FlashcardAPI {
  /**
   * @param {object} config
   * @param {string} config.dataUrl     - Published CSV URL for the data sheet (Tab 1)
   * @param {string} config.mappingUrl  - Published CSV URL for the mapping sheet (Tab 2)
   * @param {string} config.storageKey  - localStorage key for persisting SRS data
   */
  constructor({ dataUrl, mappingUrl, storageKey }) {
    this._dataUrl    = dataUrl;
    this._mappingUrl = mappingUrl;
    this._storageKey = storageKey;

    this._cards      = [];   // raw card rows from Tab 1
    this._srs        = {};   // { [id]: SRSEntry }
    this._queue      = [];   // ordered list of card ids for this session
    this._cursor     = 0;    // position in queue
    this._done       = [];   // { card, gotIt } answered this session

    /** Mapping from slot name → Tab 1 column name */
    this.mapping      = {};
    /** True when no cards were due and we fell back to all cards */
    this.studyingEarly = false;
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  /** Fetch both sheets, parse mapping, build session queue. */
  async load() {
    this._srs = this._loadSRS();

    const [dataText, mappingText] = await Promise.all([
      this._fetch(this._dataUrl,    'data sheet (Tab 1)'),
      this._fetch(this._mappingUrl, 'mapping sheet (Tab 2)'),
    ]);

    const mappingRows = parseCSV(mappingText);
    if (mappingRows.length === 0)
      throw new Error('Mapping sheet (Tab 2) is empty or missing column headers.');
    this.mapping = mappingRows[0];
    if (!this.mapping.front_primary)
      throw new Error('Mapping sheet must have a front_primary column with a value.');

    this._cards = parseCSV(dataText);
    if (this._cards.length === 0)
      throw new Error('No cards found in data sheet (Tab 1).');

    this._buildQueue();
  }

  // ── Session queue ──────────────────────────────────────────────────────────
  _buildQueue() {
    const active = this._cards.filter(c => !this._entry(c._id).removed);
    const due    = active.filter(c => this._entry(c._id).repetitions > 0 && Date.now() >= this._entry(c._id).nextReview);
    const fresh  = active.filter(c => this._entry(c._id).repetitions === 0);

    if (due.length === 0 && fresh.length === 0) {
      this._queue = shuffle(active).map(c => c._id);
      this.studyingEarly = true;
    } else {
      this._queue = [...shuffle(due), ...shuffle(fresh)].map(c => c._id);
      this.studyingEarly = false;
    }
    this._cursor = 0;
    this._done   = [];
  }

  // ── Card access ────────────────────────────────────────────────────────────
  /**
   * Returns the current card without advancing, or null if the queue is empty.
   * @returns {CardResult|null}
   */
  currentCard() {
    if (this._cursor >= this._queue.length) return null;
    return this._formatCard(this._cards[this._queue[this._cursor]]);
  }

  /**
   * Records an answer for the current card and advances to the next.
   * @param {boolean} gotIt
   * @returns {CardResult|null} the next card, or null when the session is done
   */
  recordAnswer(gotIt) {
    if (this._cursor >= this._queue.length) return null;
    const card = this._cards[this._queue[this._cursor]];
    const updated = applyAnswer(this._entry(card._id), gotIt);
    this._srs[card._id] = updated;
    this._saveSRS();
    this._done.push({ card, gotIt });

    this._queue.splice(this._cursor, 1);
    if (this._cursor >= this._queue.length && this._cursor > 0) this._cursor--;
    return this.currentCard();
  }

  // ── Card mutations ─────────────────────────────────────────────────────────
  /**
   * Toggles the starred flag on a card.
   * @param {number} id
   * @returns {boolean} new starred state
   */
  toggleStar(id) {
    const e = this._entry(id);
    e.starred = !e.starred;
    this._srs[id] = e;
    this._saveSRS();
    return e.starred;
  }

  /**
   * Marks a card as removed and removes it from the current session queue.
   * @param {number} id
   */
  removeCard(id) {
    const e = this._entry(id);
    e.removed = true;
    this._srs[id] = e;
    this._saveSRS();
    const pos = this._queue.indexOf(id);
    if (pos !== -1) {
      this._queue.splice(pos, 1);
      if (this._cursor >= this._queue.length && this._cursor > 0) this._cursor--;
    }
  }

  // ── Data queries ───────────────────────────────────────────────────────────
  /**
   * Returns all cards with their current SRS data.
   * @returns {CardResult[]}
   */
  getAllCards() {
    return this._cards.map(c => this._formatCard(c));
  }

  /**
   * Returns a single card by id.
   * @param {number} id
   * @returns {CardResult|undefined}
   */
  getCard(id) {
    const c = this._cards.find(c => c._id === id);
    return c ? this._formatCard(c) : undefined;
  }

  /**
   * Returns session and deck statistics.
   * @returns {Stats}
   */
  getStats() {
    const active  = this._cards.filter(c => !this._entry(c._id).removed);
    const due     = active.filter(c => this._entry(c._id).repetitions > 0 && Date.now() >= this._entry(c._id).nextReview);
    const fresh   = active.filter(c => this._entry(c._id).repetitions === 0);
    const starred = this._cards.filter(c => this._entry(c._id).starred);
    const removed = this._cards.filter(c => this._entry(c._id).removed);
    return {
      total:          this._cards.length,
      active:         active.length,
      due:            due.length,
      new:            fresh.length,
      starred:        starred.length,
      removed:        removed.length,
      queueRemaining: this._queue.length,
      sessionAnswered: this._done.length,
      sessionCorrect:  this._done.filter(d => d.gotIt).length,
    };
  }

  /** Clears all SRS progress from localStorage. */
  resetProgress() {
    localStorage.removeItem(this._storageKey);
    this._srs = {};
  }

  // ── Internals ──────────────────────────────────────────────────────────────
  _entry(id) {
    if (!this._srs[id]) this._srs[id] = defaultEntry();
    return this._srs[id];
  }

  _slot(card, key) {
    const col = this.mapping[key];
    return col ? (card[col] || '') : '';
  }

  /** @returns {CardResult} */
  _formatCard(card) {
    const e = this._entry(card._id);
    const totalReviews = e.totalReviews || 0;
    const totalCorrect = e.totalCorrect || 0;
    return {
      id: card._id,
      front: {
        primary:   this._slot(card, 'front_primary'),
        secondary: this._slot(card, 'front_secondary'),
        tertiary:  this._slot(card, 'front_tertiary'),
      },
      back: {
        primary:   this._slot(card, 'back_primary'),
        secondary: this._slot(card, 'back_secondary'),
        tertiary:  this._slot(card, 'back_tertiary'),
      },
      raw: card,
      srs: {
        totalReviews,
        totalCorrect,
        pct:           totalReviews ? totalCorrect / totalReviews : null,
        interval:      e.interval,
        easeFactor:    e.easeFactor,
        repetitions:   e.repetitions,
        nextReview:    e.nextReview,
        nextReviewDate: new Date(e.nextReview),
        isDue:         Date.now() >= e.nextReview,
        starred:       !!e.starred,
        removed:       !!e.removed,
      },
    };
  }

  _loadSRS() {
    try { return JSON.parse(localStorage.getItem(this._storageKey)) || {}; }
    catch { return {}; }
  }

  _saveSRS() {
    localStorage.setItem(this._storageKey, JSON.stringify(this._srs));
  }

  async _fetch(url, label) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${label} — is the sheet published publicly?`);
    return resp.text();
  }
}

/**
 * @typedef {object} CardResult
 * @property {number} id
 * @property {{ primary: string, secondary: string, tertiary: string }} front
 * @property {{ primary: string, secondary: string, tertiary: string }} back
 * @property {object} raw   - All raw columns from Tab 1
 * @property {SRSData} srs
 *
 * @typedef {object} SRSData
 * @property {number}      totalReviews
 * @property {number}      totalCorrect
 * @property {number|null} pct            - null if never reviewed
 * @property {number}      interval       - days until next review
 * @property {number}      easeFactor
 * @property {number}      repetitions
 * @property {number}      nextReview     - Unix timestamp
 * @property {Date}        nextReviewDate
 * @property {boolean}     isDue
 * @property {boolean}     starred
 * @property {boolean}     removed
 *
 * @typedef {object} Stats
 * @property {number} total
 * @property {number} active
 * @property {number} due
 * @property {number} new
 * @property {number} starred
 * @property {number} removed
 * @property {number} queueRemaining
 * @property {number} sessionAnswered
 * @property {number} sessionCorrect
 */
