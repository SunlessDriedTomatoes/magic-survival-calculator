// Minimal RFC4180-ish CSV parser (handles quoted fields with embedded commas/quotes).
const fs = require('fs');

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      } else { field += c; i++; continue; }
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++; continue;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

module.exports = { parseCSV };

if (require.main === module) {
  const path = process.argv[2];
  const text = fs.readFileSync(path, 'utf8');
  const rows = parseCSV(text);
  console.log('Rows:', rows.length, 'Cols in row0:', rows[0].length, 'Cols in row3:', rows[3] ? rows[3].length : 'N/A');
}
