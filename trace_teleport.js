const fs = require('fs');
const files = [
  'magicsurvival/decoded/entries.json',
  'magicsurvival/decoded/spells_full.json',
  'magicsurvival/decoded/ultimates.json',
  'magicsurvival/decoded/gamedata.json',
  'magicsurvival/decoded/effect_id_map.json',
  'magicsurvival/decoded/base_spell_stats.json',
];
const terms = ['Space Warp', 'Teleport', 'Hallucination', 'Cloaking', '453', '358'];
for (const f of files) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { console.log(f, 'MISSING'); continue; }
  const hits = terms.map(term => {
    let count = 0, idx = 0;
    while (true) {
      const found = txt.indexOf(term, idx);
      if (found === -1) break;
      count++;
      idx = found + term.length;
    }
    return term + ':' + count;
  });
  console.log(f, '|', hits.join(' | '));
}
