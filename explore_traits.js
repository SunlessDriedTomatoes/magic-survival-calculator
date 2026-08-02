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
console.log('Column indices:', IDX);

// Print all rows where traitId references 1 (Magic Bolt) or name mentions Magic Bolt-ish, plus first 40 trait-type rows raw
console.log('\n--- First 15 rows where 유형=특성 (Trait) ---');
let count = 0;
for (const row of data) {
  if (row[IDX.type] === '특성') {
    console.log(row[IDX.id], '|name=', row[IDX.name], '| traitId=', row[IDX.traitId], '| reqLevel=', row[IDX.reqLevel], '| traitA/B/C=', row[IDX.traitA], row[IDX.traitB], row[IDX.traitC], '| maxLevel=', row[IDX.maxLevel], '| derivedId=', row[IDX.derivedId]);
    count++;
    if (count >= 15) break;
  }
}

console.log('\n--- Rows where traitId == 1 (any type) ---');
for (const row of data) {
  if (row[IDX.traitId] && row[IDX.traitId].trim() === '1') {
    console.log(row[IDX.id], '|name=', row[IDX.name], '|type=', row[IDX.type], '| traitId=', row[IDX.traitId]);
  }
}
