const fs = require('fs');
const entries = JSON.parse(fs.readFileSync(__dirname + '/magicsurvival/decoded/entries.json', 'utf8'));
const idMap = JSON.parse(fs.readFileSync(__dirname + '/magicsurvival/decoded/effect_id_map.json', 'utf8'));

// Count frequency of each effect id across all entries
const freq = {};
for (const e of entries) {
  for (const eff of e.effects) {
    freq[eff.effectId] = (freq[eff.effectId] || 0) + 1;
  }
}
const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
console.log('Top 60 most frequent effect IDs:');
for (const [id, count] of sorted.slice(0, 60)) {
  const tmpl = idMap[id] ? idMap[id].template : '(UNMATCHED)';
  console.log(id.padStart(5), count.toString().padStart(4), tmpl);
}
