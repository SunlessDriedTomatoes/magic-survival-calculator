const fs = require('fs');
const m = JSON.parse(fs.readFileSync(__dirname + '/magicsurvival/decoded/effect_id_map.json', 'utf8'));
for (const id of ['4','20','6','143','151','153','158']) {
  console.log(id, '=>', JSON.stringify(m[id] && m[id].template), 'count=', m[id] && m[id].count);
}
