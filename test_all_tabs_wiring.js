// Loads the REAL app.js (not a reimplementation) in a minimal DOM stub, then drives `state` and
// `compute()` directly to verify every tab's selections actually reach the damage calculation.
const fs = require('fs');
const vm = require('vm');

const gamedataPath = 'C:/Users/Kyle/AppData/Local/Temp/claude/C--Users-Kyle/6a4c237c-8aa3-4c62-b075-1614b0354937/scratchpad/magicsurvival/decoded/gamedata.json';
const appJsPath = 'C:/Users/Kyle/AppData/Local/Temp/claude/C--Users-Kyle/6a4c237c-8aa3-4c62-b075-1614b0354937/scratchpad/app.js';

const GAMEDATA = JSON.parse(fs.readFileSync(gamedataPath, 'utf8'));
const ICON_MAP = JSON.parse(fs.readFileSync(__dirname + '/icon_map.json', 'utf8'));
const ICON_DATA = new Proxy({}, { get: () => 'data:image/png;base64,STUB' }); // avoid loading 3MB+ of base64 into the test

function makeEl() {
  const el = {
    textContent: '', innerHTML: '', style: {}, children: [],
    appendChild() { return el; }, addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  };
  return el;
}
const documentStub = {
  getElementById: () => makeEl(),
  createElement: () => makeEl(),
  createTextNode: (t) => ({ nodeType: 3, text: t }),
};
const localStorageStub = (() => {
  const store = {};
  return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
})();

const sandbox = { GAMEDATA, ICON_MAP, ICON_DATA, document: documentStub, localStorage: localStorageStub, console, window: {} };
vm.createContext(sandbox);
const code = fs.readFileSync(appJsPath, 'utf8');
// Top-level const/let inside vm-executed code aren't exposed as own properties of the sandbox
// object automatically — explicitly re-attach the ones this test needs.
vm.runInContext(code + '\nthis.__expose = { state, compute, bonusKey, PASSIVES_POST_MAX };', sandbox, { filename: 'app.js' });

const { state, compute, bonusKey, PASSIVES_POST_MAX } = sandbox.__expose;
sandbox.PASSIVES_POST_MAX = PASSIVES_POST_MAX;

function pick(category, name, level) {
  const pools = { Artifact: GAMEDATA.artifacts, Passive: GAMEDATA.passives, Research: GAMEDATA.research, 'Special Passive': GAMEDATA.specialPassives };
  let item;
  if (category === 'Passive (Post-Max)') item = sandbox.PASSIVES_POST_MAX.find(x => x.name === name);
  else item = pools[category].find(x => x.name === name);
  if (!item) { console.log('NOT FOUND:', category, name); return; }
  state.bonusSelections[bonusKey({ ...item, category })] = level;
}

// Baseline: nothing selected.
state.selectedSpellId = 1; // Magic Bolt
let r = compute();
console.log('baseline ATK:', r.ATK.toFixed(2), '(expect 100, base ATK with 0% bonus)');

// One item from each of the 5 categories, verify atkPct accumulates correctly.
pick('Artifact', 'ASI', 1);            // id=4 val=30 ATK%
pick('Research', 'Intelligence', 1);    // id=4 val=5 ATK% (per point; 1 point here)
pick('Passive', 'Intelligence', 2);     // id=4 val=10 ATK% per level x2 = 20
pick('Passive (Post-Max)', 'Intelligence', 1); // id=4 val=3 ATK% per level x1 = 3
r = compute();
const expectedAtkPct = 30 + 5 + 10 * 2 + 3 * 1;
console.log('atkPct after picks:', r.atkPct, '(expect ' + expectedAtkPct + ')');
console.log('ATK after picks:', r.ATK.toFixed(2), '(expect ' + (100 * (1 + expectedAtkPct / 100)).toFixed(2) + ')');

// Special Passive: find one with a clean, checkable numeric effect.
const doctor = GAMEDATA.specialPassives.find(s => s.name === 'Doctor');
console.log('\nDoctor (special passive) effects:', JSON.stringify(doctor.effects));

// Special Passive check
pick('Special Passive', 'Arcana', 1); // id=4 val=15 ATK%
r = compute();
console.log('\natkPct after adding Arcana (special passive, +15%):', r.atkPct, '(expect ' + (expectedAtkPct + 15) + ')');

// Rarity/Artifact tabs — verify a Legendary and a Common both work identically (same category, just filtered by rarity for display)
pick('Artifact', 'Crown', 1); // Legendary, has a conditional/dynamic effect (0 base contribution expected, since it's count-based via description not a flat stat)
r = compute();
console.log('atkPct after adding Crown (Legendary, dynamic text-only effect):', r.atkPct, '(no crash = pass)');
