const fs = require('fs');
const gamedata = JSON.parse(fs.readFileSync(__dirname + '/magicsurvival/decoded/gamedata.json', 'utf8'));
const reported = JSON.parse(fs.readFileSync(__dirname + '/ultimates_reported.json', 'utf8'));
const baseStats = JSON.parse(fs.readFileSync(__dirname + '/magicsurvival/decoded/base_spell_stats.json', 'utf8'));

function findBaseDamage(spellName) {
  for (const v of Object.values(baseStats)) if (v.name === spellName) return v.damage;
  return null;
}

function findFusionDamageMult(fusion, spellName) {
  if (!fusion) return null;
  for (const eff of fusion.effects) {
    if (!eff.text) continue;
    const m = eff.text.match(new RegExp('^Increase ' + spellName + ' Damage by ([\\d.]+)X', 'i'));
    if (m) return parseFloat(m[1]);
  }
  return null;
}

for (const r of reported) {
  const fusion = gamedata.fusions.find(f => f.name === r.fusion);
  const base = r.spell ? findBaseDamage(r.spell) : null;
  const fusionMult = fusion && r.spell ? findFusionDamageMult(fusion, r.spell) : null;
  const ultMult = Array.isArray(r.ultMult) ? r.ultMult[0] : r.ultMult;
  let computed = null;
  if (base != null && fusionMult != null && ultMult != null) computed = base * fusionMult * ultMult;
  const reportedVal = Array.isArray(r.reportedBase) ? r.reportedBase[0] : r.reportedBase;
  let status = 'MISSING DATA';
  if (computed != null && reportedVal != null) {
    const diff = Math.abs(computed - reportedVal);
    status = diff < 1.5 ? 'MATCH' : 'MISMATCH (diff ' + diff.toFixed(1) + ')';
  }
  console.log(
    r.fusion.padEnd(20), '|', r.ultimate.padEnd(14), '|',
    'base=' + String(base).padEnd(5), 'fusionX=' + String(fusionMult).padEnd(6), 'ultX=' + String(ultMult).padEnd(6),
    '| computed=' + String(computed ? computed.toFixed(1) : '—').padEnd(9), 'reported=' + String(reportedVal).padEnd(6),
    '|', status
  );
}
