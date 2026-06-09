export function splitCSVLine(line) {
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

// Row 1: column headers  Row 2: field names (front_primary, back_primary, …)  Row 3+: data
export function parseDataSheet(text) {
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
