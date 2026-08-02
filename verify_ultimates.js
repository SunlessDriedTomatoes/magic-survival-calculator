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
// Finds a fusion's own "Increase X Damage (Multiplier) by N%" contribution (as opposed to the flat
// "NX" pattern findFusionDamageMult looks for) — Hyperion's own effect is worded "Damage
// Multiplier by N%", which app.js's classifyEffect now also matches (see its own regex fix).
function findFusionDamagePct(fusion, spellName) {
  if (!fusion) return null;
  for (const eff of fusion.effects) {
    if (!eff.text) continue;
    const m = eff.text.match(new RegExp('^Increase ' + spellName + ' Damage(?: Multiplier)? by ([\\d.]+)%', 'i'));
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// Two fusions whose real damage formula isn't "base x flat fusion X-mult x flat ultimate X-mult" —
// each has its own dynamic shape, confirmed via dedicated app.js tests (see test_new_mechanics.js).
// Kept as one-off special cases here rather than generalizing the main loop below, since every
// other entry genuinely does fit the simple formula.
const SPECIAL_CASES = {
  // Quantum Laser: "Damage = Arcane Ray base x (active rays)^2" — confirmed exactly against both
  // reported values (4 rays -> 144, 7 rays -> 441); only the first is checked here, matching how
  // Telekinetic Sword's own array-valued reportedBase is already only checked against its first
  // element elsewhere in this script.
  'Plasma Ray': (r) => {
    const base = findBaseDamage(r.spell);
    return base != null ? base * 4 * 4 : null;
  },
  // Abaddon: base x [Nuclear Fusion's own "+1 per Satellite" count, hardcoded to the reported
  // build's 8 satellites since that's not derivable from this script's own static data] x
  // [Hyperion's own %-based Damage Multiplier bonus, read dynamically rather than hardcoded] x
  // ultMult. Confirmed exactly (198) — see the dedicated Nuclear Fusion/Hyperion tests in
  // test_new_mechanics.js for the full reasoning (count directly, not 1+count).
  'Hyperion': (r, fusion) => {
    const base = findBaseDamage(r.spell);
    const pct = findFusionDamagePct(fusion, r.spell);
    const ultMult = Array.isArray(r.ultMult) ? r.ultMult[0] : r.ultMult;
    if (base == null || pct == null || ultMult == null) return null;
    const satelliteCount = 8; // per this entry's own real-report context (not stored elsewhere)
    return base * satelliteCount * (1 + pct / 100) * ultMult;
  },
};

for (const r of reported) {
  const fusion = gamedata.fusions.find(f => f.name === r.fusion);
  const base = r.spell ? findBaseDamage(r.spell) : null;
  const fusionMult = fusion && r.spell ? findFusionDamageMult(fusion, r.spell) : null;
  const ultMult = Array.isArray(r.ultMult) ? r.ultMult[0] : r.ultMult;
  let computed = null;
  if (SPECIAL_CASES[r.fusion]) computed = SPECIAL_CASES[r.fusion](r, fusion);
  else if (base != null && fusionMult != null && ultMult != null) computed = base * fusionMult * ultMult;
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
