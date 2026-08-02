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
vm.runInContext(code + '\nthis.__expose = { state, compute, bonusKey, spellState, allSelectedEvolutionIds, setSpellLevel, selectMagicCircleFusion, isUltimateUnlocked, classGatesAnyUltimate, testSubjectGatesAnyUltimate };', sandbox, { filename: 'app.js' });
const { state, compute, bonusKey, spellState, allSelectedEvolutionIds, setSpellLevel, selectMagicCircleFusion, isUltimateUnlocked, classGatesAnyUltimate, testSubjectGatesAnyUltimate } = sandbox.__expose;

function own(name) {
  const art = GAMEDATA.artifacts.find(a => a.name === name);
  if (!art) throw new Error('artifact not found: ' + name);
  state.bonusSelections[bonusKey({ ...art, category: 'Artifact' })] = 1;
}
function ownPassive(name, count) {
  const p = GAMEDATA.passives.find(x => x.name === name);
  if (!p) throw new Error('passive not found: ' + name);
  state.bonusSelections[bonusKey({ ...p, category: 'Passive' })] = count;
}
function reset() {
  state.classId = null; state.testSubjectId = null; state.unlockedTestSubjectIds = []; state.maxedClassIds = [];
  state.bonusSelections = {}; state.fusionIds = []; state.nexusSpellId = null;
  state.selectedSpellId = 1; // Magic Bolt
  // Spell level is now player-selected (like Class Level), not assumed max — clear all spell state
  // between tests and max out Magic Bolt specifically, since most checks below predate per-level
  // selection and were written assuming a fully-built Magic Bolt as the baseline.
  state.spellState = {};
  spellState(1).level = GAMEDATA.spells[1].maxLevel;
}

let fails = 0;
function check(label, actual, expected, tol = 0.01) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) <= tol : actual === expected;
  console.log((ok ? 'OK  ' : 'FAIL') + '  ' + label + ': got ' + actual + ', expect ' + expected);
  if (!ok) fails++;
}

// --- Arbiter: x1.25 total damage multiplier ---
reset();
let r0 = compute();
console.log('baseline nonCrit (no Arbiter):', r0.nonCrit.toFixed(2));
own('Transcendence'); own('Fairy'); own('Starlight'); own('Mana Flame');
let r = compute();
check('Arbiter active', r.arbiterActive, true);
// The 4 requirement artifacts carry their own real bonuses too (Starlight: +7% ATK/AMP/AMD, Mana
// Flame: +15% AMD) on top of Arbiter's own x1.25 — verify the x1.25 factor itself is present and
// correctly folded into xMultTotal, rather than assuming nonCrit == baseline*1.25 outright.
const arbiterLine = r.xMults.find(x => x.source.startsWith('Arbiter'));
check('Arbiter xMult entry amount = 1.25', arbiterLine ? arbiterLine.amount : NaN, 1.25);
// atkPct/ampPct = 7 (Starlight only); mdmgPct = 100 (Magic Bolt's own max-level upgrade) + 7
// (Starlight) + 15 (Mana Flame) + 15 (Transcendence, now implemented — Magic Bolt is the one spell
// at max level in this reset() baseline, so 1 x 15%) = 137.
const nonCritWithoutArbiter = r.nonCrit / 1.25;
const expectedWithoutArbiter = 5 * (100 * 1.07) * 1.07 * (1 + 137 / 100);
check('Arbiter: nonCrit/1.25 matches ATK/AMP/AMD from the 4 owned artifacts alone', nonCritWithoutArbiter, expectedWithoutArbiter, 1);

// --- Heartbreaker: x1.25 crit multiplier ---
reset();
const preHB = compute();
['Widowmaker','Assassination','Carnival','Masked Ball','Shadow Cape'].forEach(own);
r = compute();
check('Heartbreaker active', r.heartbreakerActive, true);
// Assassination (one of the 5 requirement artifacts) independently grants +25% Critical Strike
// Multiplier, so the pre-Heartbreaker baseline here is 225%, not the plain 200% base — Heartbreaker
// then applies its own x1.25 on top of that.
check('critMultiPreHeartbreaker = 225 (200 base + Assassination +25%)', r.critMultiPreHeartbreaker, 225);
check('Heartbreaker: critMulti = critMultiPreHeartbreaker x1.25', r.critMulti, r.critMultiPreHeartbreaker * 1.25);
check('Heartbreaker: crit damage scaled, nonCrit unchanged', r.nonCrit, preHB.nonCrit, 0.01);

// --- Monarch + Crown (Crown is one of Monarch's requirements) ---
reset();
['Crown','Diamond','Sapphire','Ruby'].forEach(own); // Sapphire+Ruby=Common(2), Diamond=Epic(1), Crown=Legendary
r = compute();
check('Monarch active', r.monarchActive, true);
check('Crown owned', r.crownOwned, true);
// Monarch: 1%*2 Common + 3%*0 Rare = 2%. Crown: 1%*1 Epic + 5%*0 Special = 1%. Total atkPct contribution = 2, ampPct = 1.
const monarchLine = r.ledger.atk.find(x => x.source === 'Monarch (Synergy)');
const crownLine = r.ledger.amp.find(x => x.source === 'Crown (Relic)');
check('Monarch ATK% = 2', monarchLine ? monarchLine.amount : NaN, 2);
check('Crown AMP% = 1', crownLine ? crownLine.amount : NaN, 1);

// --- Pyramid: Amplify ATK 3% per active Synergy ---
reset();
own('Pyramid');
['Crown','Diamond','Sapphire','Ruby'].forEach(own); // activates Monarch too -> 2 synergies active (Monarch + none else, Pyramid itself isn't a synergy)
r = compute();
const activeSynCount = r.active ? null : null; // just recompute via getActiveSynergies indirectly through ledger
const pyramidLine = r.ledger.amp.find(x => x.source && x.source.startsWith('Pyramid'));
console.log('Pyramid line:', pyramidLine);
check('Pyramid owned', r.pyramidOwned, true);

// --- Combination Magic Damage: Advanced Magic + Dragontongue + Dominus, applied only while a real
// Fusion X-multiplier targets the spell being viewed — but per the community damage-formula guide
// ("every source of MDMG" explicitly lists combination damage alongside nexus/class mastery/etc.),
// additive with the rest of the Magic Damage pool once it applies, not a multiplier on the Fusion
// share specifically (same category of fix as Nexus). ---
reset();
state.selectedSpellId = 7; // Thunderstorm
ownPassive('Advanced Magic', 3); // +45%
own('Dragontongue'); // +40% (also required by Dominus)
['Domain of Power','Dragontongue','Mana Ore','Spell Cape'].forEach(own); // activates Dominus
state.fusionIds = [1]; // Empyrean Wrath -> Thunderstorm 5X (Fusion), 3X count (Fusion, not xmult)
r = compute();
check('Dominus active', r.dominusActive, true);
// comboDamagePct = 45 (Advanced Magic) + 40 (Dragontongue) + 25*1 (Dominus, 1 active fusion) = 110
check('comboDamagePct = 110', r.comboDamagePct, 110);
check('comboDamageApplies (fusion xmult present for Thunderstorm)', r.comboDamageApplies, true);
// Thunderstorm is at level 0 here (never leveled in this test), so mdmgPct is purely the combo
// contribution: 110. xMultTotal is just Empyrean Wrath's own flat 5X, no combo folded into it.
check('mdmgPct = 110 (combo damage added directly, not multiplied into xMultTotal)', r.mdmgPct, 110);
check('xMultTotal = 5 (just the Fusion\'s own flat 5X, unaffected by combo damage now)', r.xMultTotal, 5);

// Sanity: viewing a spell the fusion does NOT target -> combo bonus should not apply (no fusion xmult present)
state.selectedSpellId = 1; // Magic Bolt
r = compute();
check('comboDamageApplies=false when no fusion xmult targets current spell', r.comboDamageApplies, false);

// --- Matrix: 20% of (Size% + Duration% + CDR%) added to AMD ---
reset();
own('Matrix'); own('Gunpowder'); own('Harmony'); own('Diamond');
// sizePct=10 (Gunpowder), durationPct=12 (Harmony). CDR is multiplicative-per-unique-source, not
// additive: Harmony -3% and Diamond -3% are two distinct sources, so the combined multiplier is
// 0.97 x 0.97 = 0.9409 (-5.91%), not a flat -6% -> matrixCDR = +5.91, sum = 10+12+5.91 = 27.91,
// matrixRate=20% -> matrixContribution = 5.58 (rounded).
r = compute();
check('sizePct = 10', r.sizePct, 10);
check('durationPct = 12', r.durationPct, 12);
check('allMagicCooldownPct = -5.91 (Harmony -3% x Diamond -3%, multiplicative)', r.allMagicCooldownPct, -5.91);
check('matrixOwned', r.matrixOwned, true);
check('matrixContribution = 5.58', r.matrixContribution, 5.58);
// mdmgPct also carries Magic Bolt's own +150% max-level generic upgrade (the same baseline every
// other test in this file that leaves selectedSpellId at its reset() default of Magic Bolt sees).
check('mdmgPct = 105.58 (Magic Bolt baseline 100 + matrixContribution 5.58)', r.mdmgPct, 105.58);
check('agiActive = false (AGI requirements not owned)', r.agiActive, false);
check('ampPct = 0 (AGI not active, nothing else grants AMP here)', r.ampPct, 0);

// --- AGI: extends Matrix's same computed value to ATK and AMP too ---
reset();
own('Matrix'); own('Singularity'); own('ASI'); own('Oculus'); // AGI's 4 requirements
own('Gunpowder'); own('Harmony'); own('Diamond');
r = compute();
check('agiActive = true', r.agiActive, true);
check('matrixContribution = 5.58 (unchanged by AGI)', r.matrixContribution, 5.58);
check('mdmgPct = 105.58 (Magic Bolt baseline 100 + Matrix 5.58; AGI does not touch AMD)', r.mdmgPct, 105.58);
// atkPct: Diamond +10, ASI +30, AGI extends Matrix +5.58 = 45.58
check('atkPct = 45.58 (Diamond 10 + ASI 30 + AGI-extended Matrix 5.58)', r.atkPct, 45.58);
// ampPct: only AGI's extension of Matrix's 5.58 (Oculus gives no AMP)
check('ampPct = 5.58 (AGI extends Matrix to AMP too)', r.ampPct, 5.58);

// --- Fusion base-damage overrides: Shield/Cloaking have no damage stat of their own, but Photon
// Explosion/Teleport give them one (user-provided, not in the mined data) ---
reset();
spellState(6).level = 5; spellState(6).evolutions.add(409); // Shield -> Destruction Field (unlocks at Lv5)
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Photon Explosion').id];
state.selectedSpellId = 6;
r = compute();
check('Photon Explosion: base = 30', r.base, 30);
// Destruction Field grants no Shield-count bonus of its own, so shieldCount = base.number (1) ->
// mdmgPct += 33 x 1 = 33, MDMG = 1.33. No All Magic Size source active -> photonExplosionSizeMult = 1.
check('Photon Explosion: nonCrit = 3990 (30 x ATK100 x AMP1 x MDMG1.33 from +33%/Shield, no Size source active)', r.nonCrit, 3990);

// --- Photon Explosion: per-Shield count scaling with a real extra Shield, plus the Size-based term ---
reset();
spellState(6).level = 5; spellState(6).evolutions.add(407); // Shield -> Barrier (unlocks at Lv5, "+2 Shields")
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Photon Explosion').id];
own('Gunpowder'); // +10% All Magic Size (also grants its own ATK/AMP%, held constant via the formula check below)
state.selectedSpellId = 6;
r = compute();
const photonMdmgLine = r.ledger.mdmg.find(x => x.source.startsWith('Photon Explosion'));
check('Photon Explosion + Barrier: mdmg ledger amount = 99 (33% x 3 Shields: base 1 + Barrier +2)', photonMdmgLine ? photonMdmgLine.amount : NaN, 99);
check("Photon Explosion: photonExplosionSizeMult = 1.1 (1 + Gunpowder's 10% All Magic Size)", r.photonExplosionSizeMult, 1.1);
check('Photon Explosion + Barrier: nonCrit matches base x ATK x AMP x MDMG x Size mult', r.nonCrit, r.base * r.ATK * r.AMP * r.MDMG * r.photonExplosionSizeMult, 1);

// --- Bishop: per-active-Shield ATK amp ---
reset();
spellState(6).level = 5; spellState(6).evolutions.add(407); // Shield -> Barrier (unlocks at Lv5, "+2 Shields")
state.classId = GAMEDATA.classes.school.find(c => c.name === 'Bishop').id;
state.classLevel = 1;
state.selectedSpellId = 6;
r = compute();
const bishopAmpLine = r.ledger.amp.find(x => x.source.startsWith('Bishop'));
check('Bishop: ampPct ledger amount = 30 (10% x 3 Shields: base 1 + Barrier +2)', bishopAmpLine ? bishopAmpLine.amount : NaN, 30);

// --- Plasma Ray: ray count is derived from Arcane Ray's own total Cooldown Reduction, not a
// player-set slider — "for each 1-second reduction from 4 seconds cooldown, 1 Ray is added" ---
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Plasma Ray').id];
state.selectedSpellId = 18; // Arcane Ray
r = compute();
check('Plasma Ray: 0% CDR -> rayCount = 4 (the fixed baseline)', r.plasmaRayRayCount, 4);
check('Plasma Ray: plasmaRayMult = 5 (1 + 4 rays)', r.plasmaRayMult, 5);

reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Plasma Ray').id];
state.selectedSpellId = 18; // Arcane Ray
['Ouroboros', 'Black Cat', 'AI Magic', 'Magic Grimoire', 'Hourglass'].forEach(own); // stacked All Magic CDR
r = compute();
// Combined multiplicative CDR: 0.85 x 0.91 x 0.95 x 0.95 x 0.94 = 0.656199 -> cooldown 4 x 0.656199 =
// 2.6248s -> 1.3752s reduced -> floor(1.3752) = 1 extra Ray -> 5 total.
check('Plasma Ray: with stacked All Magic CDR, cooldownMult crosses a 1-second breakpoint -> rayCount = 5', r.plasmaRayRayCount, 5);
check('Plasma Ray: plasmaRayMult = 6 (1 + 5 rays)', r.plasmaRayMult, 6);

// --- Telekinetic Sword: Damage Multiplier stacks are derived from Spirit's own real base cooldown
// (0.9s, no fusion override) x its own total CDR, not a guessed baseline ---
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Telekinetic Sword').id];
state.selectedSpellId = 3; // Spirit
r = compute();
check('Telekinetic Sword: 0% CDR -> stacks = 0', r.telekineticSwordStacks, 0);
check('Telekinetic Sword: telekineticSwordMult = 1 (no CDR yet)', r.telekineticSwordMult, 1);

reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Telekinetic Sword').id];
state.selectedSpellId = 3; // Spirit
own('Ether Arrow'); // -20% Spirit-specific Cooldown
r = compute();
// 0.9s base x 0.8 = 0.72s actual -> 0.18s reduced -> floor(0.18/0.15) = 1 stack.
check('Telekinetic Sword: Ether Arrow alone (-20% Spirit CDR) -> 1 stack', r.telekineticSwordStacks, 1);
check('Telekinetic Sword: telekineticSwordMult = 2 (1 + 1 stack)', r.telekineticSwordMult, 2);

reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Telekinetic Sword').id];
state.selectedSpellId = 3; // Spirit
own('Ether Arrow'); ['Diamond', 'Black Cat', 'Ouroboros'].forEach(own); // stacked spell-specific + All Magic CDR
r = compute();
// Combined multiplicative CDR: 0.8 x 0.97 x 0.91 x 0.85 = 0.600236 -> 0.9 x 0.600236 = 0.540212s
// actual -> 0.359788s reduced -> floor(0.359788/0.15) = 2 stacks.
check('Telekinetic Sword: stacked spell-specific + All Magic CDR -> 2 stacks', r.telekineticSwordStacks, 2);
check('Telekinetic Sword: telekineticSwordMult = 3 (1 + 2 stacks)', r.telekineticSwordMult, 3);

// --- Super Cyclone: no damage math (rate isn't in the extracted data) — just confirm the UI-note
// flag is scoped correctly to "viewing Cyclone with the fusion active", nothing else. ---
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Super Cyclone').id];
state.selectedSpellId = 12; // Cyclone
r = compute();
check('Super Cyclone: superCycloneActive = true while viewing Cyclone with the fusion on', r.superCycloneActive, true);
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Super Cyclone').id];
state.selectedSpellId = 1; // Magic Bolt — different spell selected
r = compute();
check('Super Cyclone: superCycloneActive = false while viewing a different spell', r.superCycloneActive, false);

// --- Furnace: Lava Zone's own Duration% (All-Magic-wide + Lava-Zone-specific) scales Damage 1:1,
// same pattern as Space Warp. Furnace's own fusion effect grants "+30% Lava Zone Duration". ---
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Furnace').id];
state.selectedSpellId = 20; // Lava Zone
r = compute();
check("Furnace: lavaZoneDurationBonusPct = 30 (Furnace's own +30% Lava Zone Duration)", r.durationPct + r.durationSpellPct, 30);
check('Furnace: furnaceDurationMult = 1.3', r.furnaceDurationMult, 1.3);

reset();
spellState(11).level = 5; spellState(11).evolutions.add(453); // Cloaking -> Space Warp (unlocks at Lv5)
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Teleport').id];
state.selectedSpellId = 11;
r = compute();
check('Teleport: base = 500', r.base, 500);
// Cloaking's own "+30% Cloaking Duration" grant applies at EACH of Lv2, Lv3, and Lv4 (confirmed via
// the spell's own raw tier-list text — not just once at Lv2), so at Lv5 the total is 90%, which also
// feeds Space Warp's confirmed 1:1 Duration-damage scaling (see the dedicated Space Warp tests
// below): 500 x ATK100 x 3X fusion x 1.90 Duration mult = 285,000.
check('Teleport: nonCrit = 285000 (500 x ATK100 x AMP1 x MDMG1 x 3X fusion mult x 1.9 Space Warp Duration mult)', r.nonCrit, 285000);

reset();
state.selectedSpellId = 6; // Shield, no fusion active
r = compute();
// Shield's base (30) is now a permanent encyclopedia value per the confirmed formula, not
// conditional on Photon Explosion being fused — matches every other spell's convention.
check('Shield base stays 30 even with no fusion active (Photon Explosion adds no damage bonus of its own beyond base)', r.base, 30);
check('Shield with no fusion active: nonCrit = base only (30 x ATK100 x AMP1 x MDMG1)', r.nonCrit, 3000);

// --- Fusion-eligibility bug: fusions pairing a spell evolution with a maxed Passive (Overmind,
// Perpetual Engine, Gate of Creation, Photon Explosion, Teleport) never showed as available,
// because eligibility only ever checked picked spell evolutions, never maxed Passives. ---
reset();
const intelligence = GAMEDATA.passives.find(p => p.name === 'Intelligence');
check('Overmind requires a Passive component (sanity check on the data itself)', GAMEDATA.fusions.find(f => f.name === 'Overmind').requiresEvolutionIds.includes(intelligence.id), true);
let owned = allSelectedEvolutionIds();
check('Overmind not eligible before Intelligence is maxed', GAMEDATA.fusions.find(f => f.name === 'Overmind').requiresEvolutionIds.every(id => owned.has(id)), false);
state.bonusSelections[bonusKey({ ...intelligence, category: 'Passive' })] = intelligence.maxLevel;
spellState(19).level = 5; spellState(19).evolutions.add(526); // Magic Circle -> Great Magic Circle (unlocks at Lv5)
owned = allSelectedEvolutionIds();
check('Overmind eligible once Intelligence is maxed + Great Magic Circle picked', GAMEDATA.fusions.find(f => f.name === 'Overmind').requiresEvolutionIds.every(id => owned.has(id)), true);

// --- Leveled bonus-pool ledger aggregation: a Passive picked at level N should show as ONE ledger
// row with the combined total, not N separate identical rows (one per level) ---
reset();
const intelligencePassive = GAMEDATA.passives.find(p => p.name === 'Intelligence');
state.bonusSelections[bonusKey({ ...intelligencePassive, category: 'Passive' })] = 5;
r = compute();
check('leveled Passive collapses to 1 ledger row, not 1-per-level', r.ledger.atk.length, 1);
const intelLine = r.ledger.atk.find(x => x.source.startsWith('Intelligence'));
check('leveled Passive source label includes level count', intelLine ? intelLine.source : null, 'Intelligence (Passive x5)');
check('leveled Passive combined amount = per-level x count', intelLine ? intelLine.amount : NaN, 50);

// --- Per-level spell selection: bonuses only apply up to the selected level, evolutions are
// locked until their tier's unlock level is reached, and totalActiveMagicLevels sums the selected
// level rather than always assuming max. ---
reset();
state.selectedSpellId = 21; // Flash Shock
spellState(21).level = 1;
r = compute();
check('Flash Shock at Lv1: only "acquire", mdmgPct = 0', r.mdmgPct, 0);
spellState(21).level = 3;
r = compute();
// Lv2 Size+15% (not damage) + Lv3 Damage+50% -> mdmgPct = 50 only, not the full 100 from Lv3+Lv6 both
check('Flash Shock at Lv3: only Lv2-3 bonuses counted, mdmgPct = 50 (Lv3 Damage+50%, Lv6 not yet reached)', r.mdmgPct, 50);
spellState(21).level = 7;
r = compute();
check('Flash Shock at Lv7 (max): full mdmgPct = 100 (Lv3 + Lv6 Damage grants)', r.mdmgPct, 100);

// Evolution gating: Flash Shock's evolution tier unlocks at Lv7 — picking one below that level
// should not apply its effects at all.
reset();
state.selectedSpellId = 21;
spellState(21).level = 5; // below the Lv7 evolution unlock
spellState(21).evolutions.add(544); // Satan's Nails
r = compute();
// mdmgPct at Lv5 = 50 from Lv3's own Damage grant alone (Lv2/4 are Size, Lv5 is Cooldown, neither
// counts toward mdmgPct) — Satan's Nails' +33% must NOT be included, since its Lv7 tier isn't reached.
check('Evolution picked below its unlock level contributes nothing (Satan\'s Nails +33% absent)', r.mdmgPct, 50);
spellState(21).level = 7;
r = compute();
check('Same evolution applies once level reaches the unlock level', r.mdmgPct, 133); // 100 (Lv3+Lv6) + 33 (Satan's Nails)

// totalActiveMagicLevels sums the selected level, not always maxLevel. reset() itself maxes out
// Magic Bolt as a convenience baseline for every other check in this file, so clear spellState
// again here to isolate this check to just Flash Shock.
reset();
state.spellState = {};
state.selectedSpellId = 21;
spellState(21).level = 4;
spellState(21).evolutions.add(544); // pick makes the spell "active" even below its unlock level
const preOvermindTotal = compute().totalLevels;
check('totalActiveMagicLevels sums selected level (4), not maxLevel (7)', preOvermindTotal, 4);

// --- setSpellLevel clears a picked evolution once its tier is no longer reachable (bug: lowering
// level left a stale pick in ss.evolutions, rendering as a confusing "active but locked" card even
// though its effects were already correctly excluded from the damage math) ---
reset();
state.spellState = {};
state.selectedSpellId = 21; // Flash Shock
const fsSpell = GAMEDATA.spells[21];
const fsSs = spellState(21);
setSpellLevel(fsSpell, fsSs, 7);
fsSs.evolutions.add(544); // Satan's Nails, tier 1, unlocks at Lv7
check('evolution picked while its tier is reachable stays picked', fsSs.evolutions.has(544), true);
setSpellLevel(fsSpell, fsSs, 3); // drop below the Lv7 unlock
check('lowering level below the tier unlock clears the stale pick', fsSs.evolutions.has(544), false);
check('level itself is set correctly on the way down', fsSs.level, 3);
setSpellLevel(fsSpell, fsSs, 1); // level 1 ("acquire") is now clickable too
check('level 1 (acquire) is reachable via setSpellLevel', fsSs.level, 1);

// --- Level 0 ("not chosen this run") is a real, distinct state below Lv1, toggled via the
// Acquire card — not every magic is picked up in a given run. ---
reset();
state.spellState = {};
state.selectedSpellId = 21;
const fsSpell2 = GAMEDATA.spells[21];
const fsSs2 = spellState(21);
// Merely viewing a spell (what spellState() is called for on every render) must not silently
// "acquire" it — defaults to 0 (not chosen), not 1, precisely so clicking a spell chip to look at
// it doesn't commit you to having it in your run.
check('spell defaults to level 0 (not chosen) until explicitly acquired', fsSs2.level, 0);
setSpellLevel(fsSpell2, fsSs2, 1);
check('level can be explicitly set to 1 (acquired)', fsSs2.level, 1);
setSpellLevel(fsSpell2, fsSs2, 0);
check('level can be toggled back down to 0', fsSs2.level, 0);
check('totalActiveMagicLevels excludes a not-chosen spell', compute().totalLevels, 0);
setSpellLevel(fsSpell2, fsSs2, 1);
check('level toggles back to 1', fsSs2.level, 1);
// A spell chosen at Lv1 with no further upgrades still counts as 1 active level toward
// Overmind/DEM ("per active magic obtained") — only Lv0 (not chosen) is excluded.
check('totalActiveMagicLevels counts a Lv1-only spell as 1, not 0', compute().totalLevels, 1);

// --- Overmind/DEM must sum levels across ALL active magics simultaneously, not just the one
// currently being viewed, and each at its own real (possibly partial) level ---
reset();
state.spellState = {};
setSpellLevel(GAMEDATA.spells[1], spellState(1), 7);   // Magic Bolt: max level
setSpellLevel(GAMEDATA.spells[2], spellState(2), 3);   // Fireball: partial level
setSpellLevel(GAMEDATA.spells[21], spellState(21), 1); // Flash Shock: just acquired, Lv1
setSpellLevel(GAMEDATA.spells[10], spellState(10), 5); // Meteor: partial level
spellState(9); // Tsunami: merely viewed (spellState() touches it), never leveled -> must stay excluded
state.selectedSpellId = 1;
r = compute();
check('totalLevels sums every active spell (7+3+1+5=16), excluding a merely-viewed one', r.totalLevels, 16);
state.fusionIds = [26]; // Overmind
r = compute();
check('Overmind active with multiple spells invested', r.overmindActive, true);
check('Overmind AMP = 1.5 x totalLevels (1.5x16=24) across the whole multi-spell build', r.ampPct, 24);
state.fusionIds = [26, 60, 5]; // Overmind + DEM + a filler 3rd fusion (DEM needs Overmind + one other)
r = compute();
check('DEM active alongside Overmind', r.demActive, true);
// Raw text: "All Magic Damage Multiplier increases by 0.01" (no % sign, unlike the adjacent "Decrease
// All Magic Cooldown by 0.1%" which has one) — confirmed a flat +0.01 (=+1%) multiplier delta per
// level, not +0.01%.
check('DEM multiplier = 1 + totalLevels x 0.01 (16 levels -> 1.16)', r.demMult, 1.16);

// --- Transcendence: +15% All Magic Damage per currently-active spell at its own max level ---
reset();
state.spellState = {};
own('Transcendence');
setSpellLevel(GAMEDATA.spells[1], spellState(1), 7);   // Magic Bolt: max level (7/7)
setSpellLevel(GAMEDATA.spells[2], spellState(2), 5);   // Fireball: NOT max (5/7)
setSpellLevel(GAMEDATA.spells[10], spellState(10), 7); // Meteor: max level (7/7)
spellState(21); // Flash Shock: merely viewed, level 0 -> must not count
state.selectedSpellId = 1;
r = compute();
check('transcendenceOwned', r.transcendenceOwned, true);
check('maxedSpellCount = 2 (Magic Bolt + Meteor; Fireball not maxed, Flash Shock not chosen)', r.maxedSpellCount, 2);
const transcendenceLine = r.ledger.mdmg.find(x => x.source.startsWith('Transcendence'));
check('Transcendence contributes 30% mdmg (15% x 2 maxed spells)', transcendenceLine ? transcendenceLine.amount : NaN, 30);
check('mdmgPct includes it (100 Magic Bolt baseline + 30 Transcendence)', r.mdmgPct, 130);

// --- Wizard's Hat: +1% ATK per 2% All-Magic Cooldown Reduction Rate ---
reset();
own('Wizard’s Hat');
own('Diamond'); // ATK +10%, All Magic Cooldown -3%
r = compute();
check('wizardsHatOwned', r.wizardsHatOwned, true);
check('allMagicCooldownPct = -3 (Diamond)', r.allMagicCooldownPct, -3);
check('atkPct = 11.5 (Diamond +10, Wizard\'s Hat +1.5 = 1 x (3/2))', r.atkPct, 11.5);

// --- Damage Reduction pool (multiplicative-per-source) + Aegis: ATK Amp +3% per 10% reduction ---
reset();
own('Aegis'); own('Dragonscale'); // Aegis's own -10% + Dragonscale's pure -30%, two unique sources
r = compute();
// mult = 0.9 x 0.7 = 0.63 -> 37% net reduction
check('damageReductionPct = 37 (Aegis -10% x Dragonscale -30%, multiplicative)', r.damageReductionPct, 37);
check('aegisOwned', r.aegisOwned, true);
const aegisLine = r.ledger.amp.find(x => x.source.startsWith('Aegis'));
check('Aegis AMP = 11.1 (3% x 37/10)', aegisLine ? aegisLine.amount : NaN, 11.1);

// --- Max HP pool (additive bonus, then Undead's reduction multiplies the total) + Gaia conversion ---
reset();
own('Undead'); own('Gaia'); // Undead: -25% Max HP; Gaia: +50% Max HP, ATK +3% per 20 Max HP
r = compute();
// maxHpBeforeReduction = 200 x 1.5 = 300; maxHpTotal = 300 x 0.75 = 225
check('maxHpTotal = 225 (200 base x 1.5 Gaia bonus x 0.75 Undead reduction)', r.maxHpTotal, 225);
check('gaiaOwned', r.gaiaOwned, true);
const gaiaLine = r.ledger.atk.find(x => x.source.startsWith('Gaia'));
check('Gaia ATK = 33.75 (3% x 225/20)', gaiaLine ? gaiaLine.amount : NaN, 33.75);

// --- Oculus: Crit Rate +1% per 30% Item Pickup Range (reads pool, doesn't deplete it) ---
reset();
own('Oculus'); own('Spell Bag'); // Oculus's own +30% + Spell Bag's pure +50% = 80% pool
r = compute();
check('pickupRangePct = 80 (Oculus 30 + Spell Bag 50)', r.pickupRangePct, 80);
check('oculusOwned', r.oculusOwned, true);
const oculusLine = r.ledger.crit.find(x => x.source.startsWith('Oculus'));
check('Oculus Crit Rate = 2.67 (1% x 80/30)', oculusLine ? oculusLine.amount : NaN, 2.67);

// --- Carnival: Crit Rate +1% per 3% Evasion (reads pool, doesn't deplete it) ---
reset();
own('Carnival'); own('Shadow Cape'); // Carnival's own +5% + Shadow Cape's pure +10% = 15% pool
r = compute();
check('evasionPct = 15 (Carnival 5 + Shadow Cape 10)', r.evasionPct, 15);
check('carnivalOwned', r.carnivalOwned, true);
const carnivalLine = r.ledger.crit.find(x => x.source.startsWith('Carnival'));
check('Carnival Crit Rate = 5 (1% x 15/3)', carnivalLine ? carnivalLine.amount : NaN, 5);

// --- Abyss: ATK += half of general Mana Acquisition Rate% (a true conversion) ---
reset();
own('Abyss'); own('Aurora'); // Aurora's pure +15% Mana Acquisition
r = compute();
check('manaAcquisitionPct = 15 (Aurora)', r.manaAcquisitionPct, 15);
check('abyssOwned', r.abyssOwned, true);
const abyssLine = r.ledger.atk.find(x => x.source.startsWith('Abyss'));
check('Abyss ATK = 7.5 (half of 15)', abyssLine ? abyssLine.amount : NaN, 7.5);

// --- Accelerator: CDR -1% per 3% Movement Speed Increase, feeding the All-Magic CDR pool ---
reset();
own('Accelerator'); own('Broom'); // Broom's pure +10% Movement Speed
r = compute();
check('moveSpeedPct = 10 (Broom)', r.moveSpeedPct, 10);
check('acceleratorOwned', r.acceleratorOwned, true);
// Single source in the pool -> multiplicativePoolMult reduces to identity: -1 x (10/3) = -3.33
check('allMagicCooldownPct = -3.33 (Accelerator, -1% per 3% of 10% Move Speed)', r.allMagicCooldownPct, -3.33, 0.01);

// --- Akashic Record: AMP% += 1 x player's current character level ---
reset();
own('Akashic Record');
state.playerLevel = 20;
r = compute();
check('akashicRecordOwned', r.akashicRecordOwned, true);
const akashicLine = r.ledger.amp.find(x => x.source.startsWith('Akashic Record'));
check('Akashic Record AMP = 20 (1% x character Lv20)', akashicLine ? akashicLine.amount : NaN, 20);

// --- Magic Wand: +10% Damage per Spirit's own total computed projectile count, only while viewing
// Spirit itself (same scoping as Robot's Electric-Zone-only Additional Damage) ---
reset();
own('Magic Wand');
const spiritSpell = GAMEDATA.spells[3];
setSpellLevel(spiritSpell, spellState(3), 3); // Spirit's own Lv2 AND Lv3 each grant "+1 Spirit"
state.selectedSpellId = 3;
r = compute();
check('magicWandOwned', r.magicWandOwned, true);
// spiritCount = base 1 + Spirit's own Lv2+Lv3 self-grants (1 each) + Magic Wand's own +2 = 5
const magicWandLine = r.ledger.mdmg.find(x => x.source.startsWith('Magic Wand'));
check('Magic Wand Damage = 50 (10% x 5 total Spirits)', magicWandLine ? magicWandLine.amount : NaN, 50);
state.selectedSpellId = 1; // Magic Bolt — Magic Wand's bonus must NOT apply while viewing a different spell
r = compute();
check('Magic Wand bonus absent while viewing a different spell', r.ledger.mdmg.some(x => x.source.startsWith('Magic Wand')), false);

// --- Otherworldly Tentacle: +8% Damage per Arcane Ray's own total computed projectile count, only
// while viewing Arcane Ray itself ---
reset();
own('Otherworldly Tentacle');
const arcaneRaySpell = GAMEDATA.spells[18];
setSpellLevel(arcaneRaySpell, spellState(18), 3); // Arcane Ray's own Lv2 AND Lv3 each grant "+1 Arcane Ray"
state.selectedSpellId = 18;
r = compute();
check('otherworldlyTentacleOwned', r.otherworldlyTentacleOwned, true);
// arcaneRayCount = base 1 + Arcane Ray's own Lv2+Lv3 self-grants (1 each) = 3 (Otherworldly Tentacle grants no count itself)
const tentacleLine = r.ledger.mdmg.find(x => x.source.startsWith('Otherworldly Tentacle'));
check('Otherworldly Tentacle Damage = 24 (8% x 3 total Arcane Rays)', tentacleLine ? tentacleLine.amount : NaN, 24);
state.selectedSpellId = 1; // Magic Bolt — bonus must NOT apply while viewing a different spell
r = compute();
check('Otherworldly Tentacle bonus absent while viewing a different spell', r.ledger.mdmg.some(x => x.source.startsWith('Otherworldly Tentacle')), false);

// --- Space Warp: explosion damage scales 1:1 with Cloaking's own total Duration multiplier —
// confirmed via real in-game data (511,200 dmg, 142 ATK, Teleport's 3X, 239% Cloaking Duration:
// 500 x 142 x 3 x 2.4 = 511,200 exactly, without Hallucination). Test uses clean synthetic numbers
// (Harmony's +12% All Magic Duration + Cloaking's own "+30% Cloaking Duration" grant at EACH of
// Lv2/Lv3/Lv4 = 90% combined = 102% total with Harmony).
reset();
state.fusionIds = [40]; // Teleport
own('Harmony'); // +12% All Magic Duration (also -3% All Magic Cooldown, irrelevant here)
const cloakingSpell = GAMEDATA.spells[11];
setSpellLevel(cloakingSpell, spellState(11), 5); // max level, unlocks the evolution tier
spellState(11).evolutions.add(453); // Space Warp
state.selectedSpellId = 11;
r = compute();
check('spaceWarpEvoActive', r.spaceWarpEvoActive, true);
check('durationPct = 12 (Harmony, All Magic)', r.durationPct, 12);
check('durationSpellPct = 90 (Cloaking\'s own Lv2+Lv3+Lv4 Duration upgrades, 30% each)', r.durationSpellPct, 90);
check('cloakingDurationBonusPct = 102 (12 + 90)', r.cloakingDurationBonusPct, 102);
check('spaceWarpDurationMult = 2.02', r.spaceWarpDurationMult, 2.02);
// base 500 x ATK 100 x fusion 3X x Duration 2.02 = 303,000
check('nonCrit = 303000 (500 x 100 x 3 x 2.02, no Hallucination)', r.nonCrit, 303000, 1);
state.selectedSpellId = 1; // Magic Bolt — must not apply while viewing a different spell
r = compute();
check('spaceWarpEvoActive is false while viewing a different spell', r.spaceWarpEvoActive, false);
state.selectedSpellId = 11;
spellState(11).evolutions.clear();
spellState(11).evolutions.add(452); // Mirage instead of Space Warp
r = compute();
check('spaceWarpEvoActive is false when Mirage is picked instead of Space Warp', r.spaceWarpEvoActive, false);

// --- Hallucination (Teleport's Ultimate): included at user's request, x1.25, NOT independently
// confirmed (see ultimates.json note) — also verifies the isUltimateUnlocked fix, since Cloaking has
// no linked Class/Test Subject anywhere in the data (unlike every attack spell), so the normal
// class-gate can never be satisfied for it and must unlock unconditionally instead. ---
reset();
state.fusionIds = [40]; // Teleport
own('Harmony');
setSpellLevel(cloakingSpell, spellState(11), 5);
spellState(11).evolutions.add(453); // Space Warp
state.selectedSpellId = 11;
r = compute();
state.ultimatesOn[40] = true;
r = compute();
check('Hallucination active in activeUltimates', r.activeUltimates.some(u => u.ult.ultimateName === 'Hallucination'), true);
// Same setup as the earlier spaceWarpEvoActive test (Harmony + Cloaking Lv5 Space Warp): nonCrit was
// 303,000 without the ultimate; x1.25 on top = 378,750.
check('nonCrit = 378750 (303000 base chain x 1.25 Hallucination)', r.nonCrit, 378750, 1);

// --- Magic Circle grouping: Overmind+DEM stack (DEM's prerequisite IS Overmind); Perpetual Engine
// and Gate of Creation are each their own separate, mutually exclusive path from Overmind+DEM and
// from each other. ---
reset();
selectMagicCircleFusion(26, true); // Overmind
check('Overmind picked', state.fusionIds.includes(26), true);
selectMagicCircleFusion(60, true); // DEM
check('Overmind + DEM stack together', state.fusionIds.includes(26) && state.fusionIds.includes(60), true);
selectMagicCircleFusion(27, true); // Perpetual Engine
check('Perpetual Engine clears Overmind', state.fusionIds.includes(26), false);
check('Perpetual Engine clears DEM', state.fusionIds.includes(60), false);
check('Perpetual Engine itself is picked', state.fusionIds.includes(27), true);
selectMagicCircleFusion(26, true); // Overmind again
check('Picking Overmind clears Perpetual Engine', state.fusionIds.includes(27), false);
selectMagicCircleFusion(60, true); // DEM again
check('Overmind + DEM stack together again', state.fusionIds.includes(26) && state.fusionIds.includes(60), true);
selectMagicCircleFusion(28, true); // Gate of Creation
check('Gate of Creation clears Overmind', state.fusionIds.includes(26), false);
check('Gate of Creation clears DEM', state.fusionIds.includes(60), false);
check('Gate of Creation itself is picked', state.fusionIds.includes(28), true);

// --- Cube and Taoist: each AUTOMATICALLY adds 1 level (current + max) to every Normal Passive
// once at least 1 level is manually invested — not a manually-clickable extra level. Stored
// investment never exceeds the passive's own base maxLevel; the bonus applies transparently on
// top for both display and stat purposes, and stacks when both sources are owned. Intelligence:
// +10% ATK/level, base maxLevel 5. ---
reset();
ownPassive('Intelligence', 5); // manually maxed at the base cap
r = compute();
check('Intelligence at normal max (5), no bonus sources = 50% ATK', r.atkPct, 50);
own('Cube');
r = compute();
check('Cube alone: Intelligence still stored at 5, auto-bonus makes it 60% ATK', r.atkPct, 60);
const taoist = GAMEDATA.specialPassives.find(p => p.name === 'Taoist');
state.bonusSelections[bonusKey({ ...taoist, category: 'Special Passive' })] = 1;
r = compute();
check('Cube + Taoist stacked: still stored at 5, auto-bonus makes it 70% ATK', r.atkPct, 70);
// Fusion eligibility only cares whether the player's own manual investment hit the base cap —
// the auto-bonus applies on top of that regardless, so this check is unaffected by Cube/Taoist.
check('Intelligence manually maxed (5) counts as maxed for fusion eligibility, bonus sources active or not', allSelectedEvolutionIds().has(31), true);
ownPassive('Intelligence', 4);
check('Intelligence NOT manually maxed (4) does not count as maxed, even with both bonus sources active', allSelectedEvolutionIds().has(31), false);

// --- Ultimate unlock: Magic Bolt is linked to 5 Classes (Wizard/Arcanist/Archaeologist/Magician/
// Black Mage), but Avatar's real ultimate (Equilibrium) requires Wizard specifically — confirmed
// via the game's own "Ultimate Condition" data (fusion.ultimateRequiredClassId), not any Class
// sharing the spell. Regression-guards the fix in isUltimateUnlocked. ---
reset();
const avatar = GAMEDATA.fusions.find(f => f.name === 'Avatar');
const wizC = GAMEDATA.classes.school.find(c => c.name === 'Wizard'), wizT = GAMEDATA.classes.testSubject.find(c => c.name === 'Wizard');
const arcC = GAMEDATA.classes.school.find(c => c.name === 'Arcanist'), arcT = GAMEDATA.classes.testSubject.find(c => c.name === 'Arcanist');
const magT = GAMEDATA.classes.testSubject.find(c => c.name === 'Magician');
state.classId = wizC.id; state.testSubjectId = wizT.id;
check('Avatar unlocks with Wizard Class + Wizard Test Subject', isUltimateUnlocked(avatar), true);
state.classId = arcC.id; state.testSubjectId = arcT.id;
check('Avatar stays locked with Arcanist+Arcanist (same name, same spell, but not the required Class)', isUltimateUnlocked(avatar), false);
state.classId = arcC.id; state.testSubjectId = magT.id;
check('Avatar stays locked with Arcanist Class + Magician Test Subject (mismatched names)', isUltimateUnlocked(avatar), false);

// --- Class/Test Subject dropdown gating: only Classes/Test Subjects that are the actual required
// pick for at least one real ultimate should get flagged, not merely "linked to a spell some fusion
// uses" — this excludes 4 of the 5 Magic-Bolt Classes/Test Subjects (only Wizard gates one). ---
check('classGatesAnyUltimate: Wizard gates Avatar', classGatesAnyUltimate(wizC), true);
check('classGatesAnyUltimate: Arcanist gates nothing', classGatesAnyUltimate(arcC), false);
check('testSubjectGatesAnyUltimate: Wizard gates Avatar', testSubjectGatesAnyUltimate(wizT), true);
check('testSubjectGatesAnyUltimate: Magician gates nothing', testSubjectGatesAnyUltimate(magT), false);

// --- Nexus can only target a real Attack Spell — Shield/Cloaking/Armageddon/Magic Circle all have
// a `base` object (Shield/Cloaking even have base.damage, for Photon Explosion/Teleport), so a
// plain `s.base` check isn't enough; must use the same "has a linked Class" test as
// isUltimateUnlocked. Regression-guards both the dropdown's own filter and nexusAppliesHere's
// re-validation against a stale/invalid saved nexusSpellId. ---
reset();
const nexusArtifact = GAMEDATA.artifacts.find(a => a.name === 'Nexus');
own('Nexus');
const shieldSpell = Object.values(GAMEDATA.spells).find(s => s.name === 'Shield');
state.nexusSpellId = shieldSpell.id;
state.selectedSpellId = shieldSpell.id;
r = compute();
check('Nexus does not apply when nexusSpellId points at Shield (not a real Attack Spell)', r.nexusAppliesHere, false);
check('Nexus dropdown-eligible spells exclude Shield/Cloaking/Armageddon/Magic Circle', Object.values(GAMEDATA.spells).filter(s => GAMEDATA.classes.school.some(c => c.linkedSpellId === s.id)).some(s => s.name === 'Shield'), false);
const magicBoltSpell = Object.values(GAMEDATA.spells).find(s => s.name === 'Magic Bolt');
state.nexusSpellId = magicBoltSpell.id;
state.selectedSpellId = magicBoltSpell.id;
r = compute();
check('Nexus still applies normally for a real Attack Spell (Magic Bolt)', r.nexusAppliesHere, true);

// --- Nexus's +240% is additive with the rest of the Magic Damage pool (per the community
// damage-formula guide's own "every source of MDMG" list, which names nexus explicitly), not a
// separate late multiplier — verify it stacks correctly with another real MDMG source rather than
// compounding multiplicatively with it. ---
reset();
own('Nexus');
own('Mana Flame'); // +15% All Magic Damage, a plain MDMG-pool source
state.nexusSpellId = magicBoltSpell.id;
state.selectedSpellId = magicBoltSpell.id;
spellState(magicBoltSpell.id).level = 0; // isolate to just Nexus + Mana Flame, no max-level bonus
r = compute();
const nexusMdmgLine = r.ledger.mdmg.find(x => x.source.startsWith('Nexus'));
check('Nexus ledger contribution = 240%', nexusMdmgLine ? nexusMdmgLine.amount : NaN, 240);
check('Nexus + Mana Flame: mdmgPct = 255 (240 + 15, additive, not compounding)', r.mdmgPct, 255);

// --- Enchant: one dropdown per owned level (max 3), each independently granting +50% Damage plus
// a spell-specific secondary effect — data recovered from raw effect slots 8-9 of each spell's own
// encyclopedia row (previously mislabeled "a duplicate preview" and never read; see
// build_gamedata.js). Fairy doubles both terms. ---
const enchantItem = GAMEDATA.enchants.find(e => e.name === 'Enchant');
function ownEnchant(level) { state.bonusSelections[bonusKey({ ...enchantItem, category: 'Passive' })] = level; }

check('Shield/Cloaking/Armageddon/Magic Circle have no enchant data (the 4 Nexus-excluded spells)',
  ['Shield', 'Cloaking', 'Armageddon', 'Magic Circle'].every(n => Object.values(GAMEDATA.spells).find(s => s.name === n).enchant == null), true);

reset();
ownEnchant(1);
state.enchantSpellIds = [magicBoltSpell.id, null, null];
state.selectedSpellId = magicBoltSpell.id;
spellState(magicBoltSpell.id).level = 0; // isolate from Magic Bolt's own +100% max-level bonus
r = compute();
check('Enchant Lv1 on Magic Bolt: mdmgPct = 50', r.mdmgPct, 50);
check('Enchant Lv1 on Magic Bolt: cooldownPct = -5 (its own secondary effect)', r.cooldownPct, -5);

const fairyArtifact = GAMEDATA.artifacts.find(a => a.name === 'Fairy');
state.bonusSelections[bonusKey({ ...fairyArtifact, category: 'Artifact' })] = 1;
r = compute();
check('Enchant + Fairy: mdmgPct = 100 (50 x 2)', r.mdmgPct, 100);
check('Enchant + Fairy: cooldownPct = -10 (-5 x 2)', r.cooldownPct, -10);

reset();
ownEnchant(2);
const fireballSpell = Object.values(GAMEDATA.spells).find(s => s.name === 'Fireball');
state.enchantSpellIds = [magicBoltSpell.id, fireballSpell.id, null];
spellState(magicBoltSpell.id).level = 0; // isolate from Magic Bolt's own +100% max-level bonus
state.selectedSpellId = fireballSpell.id;
r = compute();
// Fireball's own secondary is a Size effect, not tracked anywhere damage-relevant, so mdmgPct
// should be exactly the +50% Damage term with nothing extra leaking in from Magic Bolt's own slot.
check('Enchant Lv2, slot 2 = Fireball: mdmgPct = 50 (Fireball\'s own +50%, Magic Bolt\'s slot has no effect while viewing Fireball)', r.mdmgPct, 50);
state.selectedSpellId = magicBoltSpell.id;
r = compute();
check('Enchant Lv2, viewing Magic Bolt (slot 1): mdmgPct = 50 (Fireball\'s slot has no effect here)', r.mdmgPct, 50);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
