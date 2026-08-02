const fs = require('fs');
const GAMEDATA = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const OVERMIND_FUSION = GAMEDATA.fusions.find(f => f.name === 'Overmind');
const DEM_FUSION = GAMEDATA.fusions.find(f => f.name === 'Deus Ex Machina');
console.log('Overmind id:', OVERMIND_FUSION.id, '| Deus Ex Machina id:', DEM_FUSION.id);

function isDeusExMachinaAvailable(fusionIds) {
  if (!fusionIds.includes(OVERMIND_FUSION.id)) return false;
  return fusionIds.some(id => id !== OVERMIND_FUSION.id && id !== DEM_FUSION.id);
}

console.log('DEM available with just Overmind:', isDeusExMachinaAvailable([OVERMIND_FUSION.id]));
console.log('DEM available with Overmind + War Climate:', isDeusExMachinaAvailable([OVERMIND_FUSION.id, 5]));
console.log('DEM available with just War Climate:', isDeusExMachinaAvailable([5]));

// totalActiveMagicLevels simulation
const spellState = { 1: { picks: { 151: 3, 158: 2 } }, 10: { picks: { 321: 5 } } };
let total = 0;
for (const ss of Object.values(spellState)) for (const c of Object.values(ss.picks)) total += c;
console.log('totalActiveMagicLevels (3+2+5):', total, '-> expected 10');

// Ultimate gating simulation: only the fusion's PRIMARY (requiresEvolutionIds[0]) component's class
// should unlock its ultimate — the secondary component's class should NOT, even though it's also
// technically one of the fusion's two required evolutions (this was the actual bug: the old
// fusionParentSpellIds() treated both components as equally valid, when only the primary is).
function fusionPrimarySpellId(fusion) {
  const primaryEvoId = fusion.requiresEvolutionIds[0];
  for (const spell of Object.values(GAMEDATA.spells)) {
    if (spell.evolutions.some(evo => evo.id === primaryEvoId)) return spell.id;
  }
  return null;
}
const blaster = GAMEDATA.fusions.find(f => f.name === 'Blaster');
const wizardClass = GAMEDATA.classes.school.find(c => c.name === 'Wizard');
const wizardTS = GAMEDATA.classes.testSubject.find(c => c.name === 'Wizard');
const battlemageClass = GAMEDATA.classes.school.find(c => c.name === 'Battlemage');
console.log('Blaster primary spell id:', fusionPrimarySpellId(blaster), '(expect 1 = Magic Bolt — its own effects only ever say "Magic Bolt", confirmed against requiresEvolutionIds[0])');
console.log('Wizard class linkedSpellId:', wizardClass.linkedSpellId, '| Wizard test subject linkedSpellId:', wizardTS.linkedSpellId);
console.log('Would unlock Blaster ultimate (Wizard+Wizard, primary match):', fusionPrimarySpellId(blaster) === wizardClass.linkedSpellId && wizardClass.linkedSpellId === wizardTS.linkedSpellId, '(expect true)');
console.log('Would unlock Blaster ultimate via Battlemage (Flash Shock is only the secondary component):', fusionPrimarySpellId(blaster) === battlemageClass.linkedSpellId, '(expect false)');

// mismatched class/testsubject should NOT unlock
const astroClass = GAMEDATA.classes.school.find(c => c.name === 'Astronomer');
console.log('Wizard class + Astronomer... mismatched linkedSpellId check:', wizardClass.linkedSpellId === astroClass.linkedSpellId, '(expect false)');
