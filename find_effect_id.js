const fs = require('fs');
const { parseCSV } = require('./parse_csv.js');
const BASE = __dirname + '/magicsurvival/export/textassets';
const targetId = parseInt(process.argv[2], 10);

function stripColor(s) { return (s || '').replace(/<color=[^>]*>/g, '').replace(/<\/color>/g, '').trim(); }

for (const file of ['eng_Dictionary_Ability.txt', 'eng_Dictionary_Class.txt', 'eng_Dictionary_MagicCom.txt', 'eng_Dictionary_Synergy.txt']) {
  const text = fs.readFileSync(BASE + '/' + file, 'utf8');
  const rows = parseCSV(text);
  const header = rows[0];
  const data = rows.slice(2);
  const nameCol = header.indexOf('이름');
  const maxPairs = file.includes('Synergy') ? 3 : 9;
  for (const row of data) {
    for (let k = 1; k <= maxPairs; k++) {
      const idc = header.indexOf(`효과ID_0${k}`);
      const valc = header.indexOf(`효과ID_0${k}값`);
      if (idc === -1) continue;
      const id = parseInt(row[idc], 10);
      if (id === targetId) {
        const val = row[valc];
        const descs = [];
        for (let d = 1; d <= 6; d++) {
          const c = header.indexOf(`효과 설명줄0${d}`);
          if (c === -1) continue;
          const v = stripColor(row[c]);
          if (v && v !== '`') descs.push(v);
        }
        console.log(file, '| row=', row[nameCol], '| val=', val, '| descs=', JSON.stringify(descs));
      }
    }
  }
}
