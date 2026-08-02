const fs = require('fs');
const { parseCSV } = require('./parse_csv.js');
const BASE = __dirname + '/magicsurvival/export/textassets';
const text = fs.readFileSync(BASE + '/eng_Dictionary_MagicCom.txt', 'utf8');
const rows = parseCSV(text);
const header = rows[0];
const data = rows.slice(2);
const nameCol = header.indexOf('이름');
const ultNameCol = header.indexOf('궁극기 이름');
const ultCondCol = header.indexOf('궁극기 조건');
const ultDescCol = header.indexOf('궁극기 설명줄01');

for (const row of data) {
  const name = row[nameCol];
  if (!name || name === '`') continue;
  console.log(name, '| ultName=', row[ultNameCol], '| ultCond=', row[ultCondCol], '| ultDesc=', row[ultDescCol]);
}
