const fs = require('fs');
const { parseCSV } = require('./parse_csv.js');
const BASE = __dirname + '/magicsurvival/export/textassets';
const text = fs.readFileSync(BASE + '/eng_Dictionary_Ability.txt', 'utf8');
const rows = parseCSV(text);
const header = rows[0];
const data = rows.slice(2);

function col(name) { return header.indexOf(name); }
const IDX = {
  id: 0, name: col('이름'), type: col('유형'), reqLevel: col('요구레벨'),
  traitId: col('특성ID'), traitA: col('특성A레벨'), traitB: col('특성B레벨'), traitC: col('특성C레벨'),
  maxLevel: col('최대레벨'), derivedId: col('파생기술ID'),
};

function stripColor(s) { return (s || '').replace(/<color=[^>]*>/g, '').replace(/<\/color>/g, '').trim(); }

function printRow(row) {
  console.log('====', row[IDX.id], row[IDX.name], '| type=', row[IDX.type], '| traitId=', row[IDX.traitId].trim(),
    '| reqLevel=', row[IDX.reqLevel].trim(), '| traitA/B/C=', row[IDX.traitA].trim(), row[IDX.traitB].trim(), row[IDX.traitC].trim(),
    '| maxLevel=', row[IDX.maxLevel].trim(), '| derivedId=', row[IDX.derivedId].trim());
  for (let k = 1; k <= 6; k++) {
    const c = col(`효과 설명줄0${k}`);
    const v = stripColor(row[c]);
    if (v && v !== '`') console.log('   descLine' + k + ':', v);
  }
  for (let k = 1; k <= 9; k++) {
    const idc = col(`효과ID_0${k}`);
    const valc = header.indexOf(`효과ID_0${k}값`);
    const id = row[idc].trim(), val = row[valc].trim();
    if (id !== '1' && id !== '0') console.log('   effect', k, ': id=', id, 'val=', val);
  }
}

// Magic Bolt itself
for (const row of data) {
  if (row[IDX.id].trim() === '1' && row[IDX.type] === '마법') { printRow(row); }
}
console.log('\n--- Branches (derivedId == 1) ---');
for (const row of data) {
  if (row[IDX.derivedId] && row[IDX.derivedId].trim() === '1' && row[IDX.type] === '특성') {
    printRow(row);
  }
}
