const fs = require('fs');
const vm = require('vm');
const gamedataPath = 'C:/Users/Kyle/AppData/Local/Temp/claude/C--Users-Kyle/6a4c237c-8aa3-4c62-b075-1614b0354937/scratchpad/magicsurvival/decoded/gamedata.json';
const appJsPath = 'C:/Users/Kyle/AppData/Local/Temp/claude/C--Users-Kyle/6a4c237c-8aa3-4c62-b075-1614b0354937/scratchpad/app.js';
const GAMEDATA = JSON.parse(fs.readFileSync(gamedataPath, 'utf8'));
const ICON_MAP = JSON.parse(fs.readFileSync(__dirname + '/icon_map.json', 'utf8'));
const ICON_DATA = new Proxy({}, { get: () => 'data:image/png;base64,STUB' });
function makeEl() { const el = { textContent: '', innerHTML: '', style: {}, appendChild(){return el;}, addEventListener(){}, setAttribute(){}, getAttribute(){return null;} }; return el; }
const documentStub = { getElementById: () => makeEl(), createElement: () => makeEl(), createTextNode: (t) => ({ nodeType: 3, text: t }) };
const store = {};
const localStorageStub = { getItem: k => (k in store ? store[k] : null), setItem: (k,v) => { store[k]=String(v); }, removeItem: k => { delete store[k]; } };
const sandbox = { GAMEDATA, ICON_MAP, ICON_DATA, document: documentStub, localStorage: localStorageStub, console, window: {} };
vm.createContext(sandbox);
const code = fs.readFileSync(appJsPath, 'utf8');
vm.runInContext(code + '\nthis.__expose = { state, compute, bonusKey, spellState };', sandbox, { filename: 'app.js' });
const { state, compute, bonusKey, spellState } = sandbox.__expose;

// Isolate this test from Class/Test Subject defaults (covered by their own dedicated test) so the
// numbers below are purely about ATK/Titan/Nexus. unlockedTestSubjectIds also needs clearing —
// Test Subject passives apply whenever unlocked, independent of the active testSubjectId.
state.classId = null;
state.testSubjectId = null;
state.unlockedTestSubjectIds = [];
state.selectedSpellId = 1; // Magic Bolt, base=5
spellState(1).level = GAMEDATA.spells[1].maxLevel; // spell level is now player-selected, not assumed max

// Magic Bolt's own generic (max-level) upgrades apply unconditionally now: +100% Damage among
// them (confirmed against a wiki's Level Bonus table and a real in-game Flash Shock damage
// reading — the raw data's slots 8-9 are a duplicate preview line, not a real third grant; see
// build_gamedata.js's spell-extraction comment), since target spell === the one being viewed ->
// mdmgPct=100, MDMG=2.0.
let r = compute();
console.log('baseline nonCrit:', r.nonCrit.toFixed(2), '| expect 1000.00 (base 5 x ATK 100 x MDMG 2.0)');

// ASI: +30% ATK, so pre-Titan ATK = 100*1.3 = 130 -> a base above 100 for Titan to act on.
const asi = GAMEDATA.artifacts.find(a => a.name === 'ASI');
state.bonusSelections[bonusKey({ ...asi, category: 'Artifact' })] = 1;
r = compute();
console.log('with ASI (+30% ATK): nonCrit=', r.nonCrit.toFixed(2), '| expect 1300.00 (base 5 x ATK 130 x MDMG 2.0)');

// Titan's Power: ATK = 100 + (130-100)*1.5 = 145, not a flat x1.5 on the whole total.
const titan = GAMEDATA.artifacts.find(a => a.name === "Titan's Power");
state.bonusSelections[bonusKey({ ...titan, category: 'Artifact' })] = 1;
r = compute();
console.log('with Titan: ATKPreTitan=', r.ATKPreTitan, '(expect 130), ATK=', r.ATK, '(expect 145)');
console.log('  nonCrit=', r.nonCrit.toFixed(2), '| expect 1450.00 (base 5 x ATK 145 x MDMG 2.0)');
console.log('  titanDelta:', r.titanDelta.toFixed(2), '| expect 150.00 (5 x 2.0 x (145-130))');

// Add Nexus, apply to Magic Bolt — per the community damage-formula guide ("every source of MDMG"
// explicitly lists nexus alongside class mastery/combination damage/etc.), Nexus's +240% is
// additive with the rest of the Magic Damage pool, not a separate late multiplier. mdmgPct was 100
// (Magic Bolt's own max-level bonus) -> 340 with Nexus -> MDMG 4.4 (was 2.0).
const nexus = GAMEDATA.artifacts.find(a => a.name === 'Nexus');
state.bonusSelections[bonusKey({ ...nexus, category: 'Artifact' })] = 1;
state.nexusSpellId = 1;
r = compute();
console.log('with Nexus targeting Magic Bolt: mdmgPct=', r.mdmgPct, '(expect 340 = 100 + 240), MDMG=', r.MDMG, '(expect 4.4)');
console.log('  nonCrit now:', r.nonCrit.toFixed(2), '| expect 3190.00 (5 x ATK145 x MDMG4.4)');

// Switch to a different spell -> Nexus should not apply
state.selectedSpellId = 2; // Fireball
r = compute();
console.log('viewing Fireball (Nexus targets Magic Bolt): nexusAppliesHere=', r.nexusAppliesHere, '(expect false), mdmgPct=', r.mdmgPct, '(expect 0, Fireball has no max-level bonus applied at Lv1)');
