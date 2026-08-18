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
vm.runInContext(code + '\nthis.__expose = { state, compute, bonusKey, spellState, allSelectedEvolutionIds, setSpellLevel, selectMagicCircleFusion, isUltimateUnlocked, classGatesAnyUltimate, testSubjectGatesAnyUltimate, PASSIVES_POST_MAX, computeSpellTotalCount, getActiveSynergies };', sandbox, { filename: 'app.js' });
const { state, compute, bonusKey, spellState, allSelectedEvolutionIds, setSpellLevel, selectMagicCircleFusion, isUltimateUnlocked, classGatesAnyUltimate, testSubjectGatesAnyUltimate, PASSIVES_POST_MAX, computeSpellTotalCount, getActiveSynergies } = sandbox.__expose;

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
function ownResearch(name, count) {
  const r = GAMEDATA.research.find(x => x.name === name);
  if (!r) throw new Error('research not found: ' + name);
  state.bonusSelections[bonusKey({ ...r, category: 'Research' })] = count;
}
function ownPostMax(name, count) {
  const p = PASSIVES_POST_MAX.find(x => x.name === name);
  if (!p) throw new Error('post-max passive not found: ' + name);
  state.bonusSelections[bonusKey({ ...p, category: 'Passive (Post-Max)' })] = count;
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
// Multiplier, and Widowmaker (another requirement) grants its own dynamic Crit Multiplier bonus
// equal to the player's fully-resolved crit chance — so the pre-Heartbreaker baseline is
// 200 + 25 + critChance, not just 225. Heartbreaker then applies its own x1.25 on top of that.
check('critMultiPreHeartbreaker = 200 + Assassination 25 + Widowmaker (= critChance)', r.critMultiPreHeartbreaker, 200 + 25 + r.critChance, 0.001);
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

// --- Inferno: same treatment as Super Cyclone — ramp rate isn't in the extracted data (confirmed
// by comparison against Lava Zone's own "Melt" evolution, which has the identical "Max Multiplier"
// mechanic and does state its rate directly in text; Incineration/Inferno's own text never does),
// so just confirm the UI-note flag is scoped correctly. ---
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Inferno').id];
state.selectedSpellId = Object.values(GAMEDATA.spells).find(s => s.name === 'Incineration').id;
r = compute();
check('Inferno: infernoActive = true while viewing Incineration with the fusion on', r.infernoActive, true);
reset();
state.fusionIds = [GAMEDATA.fusions.find(f => f.name === 'Inferno').id];
state.selectedSpellId = 1; // Magic Bolt — different spell selected
r = compute();
check('Inferno: infernoActive = false while viewing a different spell', r.infernoActive, false);

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
// DEM needs Overmind + one other fusion — neither alone is sufficient. Migrated from the removed
// test_multifusion.js (which checked this via its own reimplementation of the availability logic,
// not the real function); these two use the real isDeusExMachinaAvailable via r.demActive instead.
state.fusionIds = [26, 60]; // Overmind + DEM, no 3rd fusion
r = compute();
check('DEM not active with just Overmind + DEM selected (no 3rd fusion)', r.demActive, false);
state.fusionIds = [60, 5]; // DEM + War Climate, no Overmind
r = compute();
check('DEM not active without Overmind, regardless of other fusions', r.demActive, false);
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
// Mirage's own "+80% Cloaking Duration" had no text template (null-text scan finding) and never
// fed durationSpellPct before this fix — confirmed it now does, on top of Cloaking's own Lv2-4
// upgrades (90) already counted above.
// Mirage's own "+80% Cloaking Duration" already has its own separate, properly-texted effect
// (distinct from the null-text "evolution chosen" marker it shares the same id/value pattern with
// Space Warp's own marker) — already correctly classified via the normal durationSpell regex, no
// fix needed. Regression-testing this explicitly since an earlier attempt to "fix" it as if it were
// missing caused a real double-count (170 expected, 250 got) before this was caught and reverted.
check('Mirage: durationSpellPct = 170 (90 own Cloaking upgrades + 80 Mirage, already correctly classified)', r.durationSpellPct, 170);
check('Mirage: spaceWarpDurationMult stays 1 (mutual exclusion — Mirage never affects Space Warp\'s own mult)', r.spaceWarpDurationMult, 1);

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

// --- Titan's Power: not a flat x1.5 on the total — per community-reported testing, it transforms
// ATK itself ("take the amount of ATK in your stat screen before Titan, subtract 100, x1.5, add
// the 100 back"), so 100 ATK is an untouched baseline and only the portion above it is amplified.
// Migrated from the old test_titan_nexus.js (removed — this was its only coverage not already
// duplicated elsewhere; Nexus's own behavior is covered by the additive-pool tests above). ---
reset();
spellState(magicBoltSpell.id).level = magicBoltSpell.maxLevel; // mdmgPct=100, MDMG=2.0
own('ASI'); // +30% ATK -> ATKPreTitan = 100 x 1.3 = 130
r = compute();
check('Titan baseline: ATKPreTitan = 130 (ASI alone, no Titan yet)', r.ATKPreTitan, 130);
own("Titan's Power");
r = compute();
check('Titan: ATKPreTitan stays 130 (unaffected by Titan itself)', r.ATKPreTitan, 130);
check('Titan: ATK = 145 (100 + (130-100) x 1.5, not a flat x1.5 on the whole 130)', r.ATK, 145);
check('Titan: nonCrit = 1450 (base 5 x ATK 145 x MDMG 2.0)', r.nonCrit, 1450);
check('Titan: titanDelta = 150 (5 x MDMG 2.0 x (145-130))', r.titanDelta, 150);

// --- Research and Passive (Post-Max) categories actually wire into the damage calc — the one
// thing test_all_tabs_wiring.js covered that nothing else here touched. Migrated from that file
// (removed) rather than left as its own separate console.log-only script. ---
reset();
own('ASI'); // +30% ATK
ownResearch('Intelligence', 1); // +5% ATK per point, 1 point
ownPassive('Intelligence', 2); // +10% ATK per level, x2 levels = 20
ownPostMax('Intelligence', 1); // +3% ATK per level (post-max tier), x1 level
r = compute();
check('Research + Passive + Passive (Post-Max) all wire into atkPct: 30 (ASI) + 5 (Research) + 20 (Passive x2) + 3 (Post-Max x1) = 58', r.atkPct, 58);
check('ATK reflects the combined atkPct', r.ATK, 100 * 1.58);

// --- Hyperion / Nuclear Fusion: two real bugs found via wiki cross-referencing.
// (1) classifyEffect's mdmg regex required "Damage by N%" exactly, but Hyperion's own fusion
// effect is worded "Increase Satellite Damage MULTIPLIER by 50%" — silently fell through to
// 'other' and was completely dropped. (2) Nuclear Fusion (Satellite's own evolution, a Hyperion
// prerequisite) grants "Increase Damage Multiplier by 1 for each Satellite" — unlike Telekinetic
// Sword/Plasma Ray's "+1 per X" terms (1+stacks, since their own count can legitimately be 0), this
// reads as the count directly (Satellite's own count is never 0 while viewing its damage). Both
// confirmed together against a real reported value: Hyperion/Abaddon, 8 Satellites: 5 base x 8 x
// 1.5 (Hyperion's 50%) x 3.3 (Abaddon ult) = 198, matching exactly — 1+8=9 does NOT reproduce it. ---
reset();
const satelliteSpell = Object.values(GAMEDATA.spells).find(s => s.name === 'Satellite');
const nuclearFusionEvo = satelliteSpell.evolutions.find(e => e.name === 'Nuclear Fusion');
spellState(satelliteSpell.id).level = satelliteSpell.maxLevel;
spellState(satelliteSpell.id).evolutions.add(nuclearFusionEvo.id);
state.selectedSpellId = satelliteSpell.id;
r = compute();
check('Nuclear Fusion active once picked+unlocked (no fusion required)', r.nuclearFusionActive, true);
check('Nuclear Fusion mult = 6 (Satellite\'s own total count: base 1 + 5 level-up grants), not 7 (1+count)', r.nuclearFusionMult, 6);
const hyperionFusion = GAMEDATA.fusions.find(f => f.name === 'Hyperion');
state.fusionIds = [hyperionFusion.id];
r = compute();
const hyperionMdmgLine = r.ledger.mdmg.find(x => x.source.startsWith('Hyperion'));
check('Hyperion\'s own "Damage Multiplier by 50%" now reaches mdmgPct (previously silently dropped)', hyperionMdmgLine ? hyperionMdmgLine.amount : NaN, 50);
check('nonCrit assembles correctly: base x ATK x MDMG x xMultTotal', r.nonCrit, r.base * r.ATK * r.MDMG * r.xMultTotal, 0.01);

// --- Mana Acquisition% only tracks the general stat that feeds Abyss's conversion — Lantern/
// Mercury's "[Mana Orb] Acquisition" (currency drop rate) and Exorcism's "from killing enemies"
// variant are both genuinely different, narrower stats, correctly excluded (not a bug — an earlier
// pass here briefly included Lantern/Mercury on the wrong assumption they were the same stat;
// reverted). ---
reset();
own('Lantern'); // "Increase [Mana Orb] Acquisition by 10%" — currency only, not the general stat
r = compute();
check('Lantern\'s "[Mana Orb] Acquisition" does NOT feed manaAcquisitionPct (different stat)', r.manaAcquisitionPct, 0);
reset();
own('Exorcism'); // "Increase Mana Acquisition FROM KILLING ENEMIES by 20%" — must stay excluded
r = compute();
check('Exorcism\'s narrower "from killing enemies" phrasing still correctly excluded', r.manaAcquisitionPct, 0);

// --- Excalibur: unconditional +25% Additional Damage (confirmed via real gameplay — no HP%/crit/
// timing gate, unlike most other Additional Damage effects in the dataset), applies to any spell
// (unlike Robot, which is scoped to Electric Zone only). ---
reset();
own('Excalibur');
state.selectedSpellId = 12; // Cyclone — arbitrary spell, confirming no scoping
r = compute();
check('Excalibur: additionalDamageMult = 1.25, unconditional across any spell', r.additionalDamageMult, 1.25);

// --- "Following Magic" group relics (Cauldron/Lightning/Weather Controller/Mana Scepter/Mirror,
// and their Special Passive counterparts): not a player-chosen dropdown — the raw effect data only
// ever resolved 3 of the 4 named spells to real text (the 4th's own id has no template anywhere in
// the dataset), so this was an extraction gap, not a design question. All 4 listed spells apply
// simultaneously and unconditionally once owned, flowing through the normal classifyEffect pipeline
// with zero special-casing needed in app.js — build_gamedata.js now expands the generic line using
// the comma-separated spell list on the next description line. Verified across all 4 of Cauldron's
// spells (Fireball/Meteor/Incineration/Lava Zone), not just one, since the fix has to work
// uniformly across the whole list, not just the previously-broken 4th slot. ---
reset();
own('Cauldron');
for (const [spellId, spellName] of [[2, 'Fireball'], [10, 'Meteor'], [15, 'Incineration'], [20, 'Lava Zone']]) {
  state.selectedSpellId = spellId;
  spellState(spellId).level = 0; // isolate from each spell's own max-level bonus
  r = compute();
  check('Cauldron: ' + spellName + ' gets +35% mdmgPct', r.mdmgPct, 35);
}
const energyBoltSpell = GAMEDATA.spells[16];
const baseEnergyBoltCount = energyBoltSpell.base.number;
reset();
own('Mirror');
const energyBoltCountWithMirror = computeSpellTotalCount(energyBoltSpell);
check('Mirror: Energy Bolt (the previously-unresolved 4th slot) gets +1 count', energyBoltCountWithMirror, baseEnergyBoltCount + 1);

// --- Avatar/Equilibrium: was marked verified:'unusable' in ultimates.json, which skips applying
// the ultimate's multiplier entirely (see the `ult.verified === 'unusable'` check that filters
// activeUltimates) — stale leftover from before Avatar's own spell/base-damage bug was fixed
// (Cloaking has no base damage, but Avatar's real primary spell is Magic Bolt). Fixed; now applies
// its confirmed 3.3x like any other verified ultimate. ---
reset();
state.classId = wizC.id; state.testSubjectId = wizT.id; state.classLevel = 4;
const avatarFusion = GAMEDATA.fusions.find(f => f.name === 'Avatar');
state.fusionIds = [avatarFusion.id];
state.ultimatesOn[avatarFusion.id] = true;
state.selectedSpellId = magicBoltSpell.id;
spellState(magicBoltSpell.id).level = 0;
r = compute();
check('Avatar/Equilibrium now actually applies (was silently skipped via verified:"unusable")', r.activeUltimates.length, 1);
check('Avatar/Equilibrium: xMultTotal = 32.967 (Avatar\'s own 9.99X fusion x 3.3 ult)', r.xMultTotal, 32.967, 0.01);

// --- Shuriken: per-spell Critical Rate ("Increase Magic Bolt Critical Rate by 15%" / "Increase
// Spirit Critical Rate by 15%") — a new stat scope, since the general critChancePct pool had no
// concept of "only while viewing spell X" before this. Confirmed dataset-wide to be the only item
// using this phrasing. Feeds the same critChancePct pool as the general form, additive on top of
// it, not a separate pool. ---
reset();
own('Shuriken');
state.selectedSpellId = magicBoltSpell.id;
r = compute();
check('Shuriken: Magic Bolt gets +15% critChancePct', r.critChancePct, 15);
state.selectedSpellId = 3; // Spirit
r = compute();
check('Shuriken: Spirit gets +15% critChancePct', r.critChancePct, 15);
state.selectedSpellId = 2; // Fireball — not one of Shuriken's two targeted spells
r = compute();
check('Shuriken: Fireball (untargeted) gets +0% critChancePct', r.critChancePct, 0);

// --- Enemy Max HP reduction (general/Elite/Large pools) + Venom's rate multiplier + Occult's
// derived Max HP bonus + Magic Sword's Execute threshold. The general pool's own combination
// method (additive vs. multiplicative) was corrected after the original additive/Venom-compounding
// formula was found to produce >100% reduction with a realistic set of owned sources — replaced
// with a multiplicative-remaining-fraction model (1-∏(1-r_i/100), same shape as CDR/Damage Taken
// elsewhere in this file) after the user directly confirmed it against their own in-game character
// sheet (Reaper's Scythe 13% + Curse 6%, no Venom -> 18.2% shown in-game, matching this formula to
// the decimal; plain addition gives 19%). Venom multiplies that already-resolved rate by 1.15,
// also confirmed the same way (18.22% x1.15 = 20.953%, matching the user's own stated math). See
// app.js's own comment on enemyMaxHpReductionGeneralFraction for the full account, including why
// the earlier community-report-based formula (which this replaces) was never actually confirmed. ---
reset();
own('Basilisk'); // general -10%
own('Sample'); // general -3%
r = compute();
check('Basilisk + Sample (no Venom): additive sum still tracked = 13%', r.enemyMaxHpReductionGeneralPct, 13);
check('No Venom: general reduction fraction = 1-(1-0.10)(1-0.03) = 0.127, NOT the additive 0.13', r.enemyMaxHpReductionGeneralFraction, 0.127, 0.0001);
check('Venom not active without its full requirement set', r.venomOwned, false);

// Genome Map (20%) + Basilisk (10%) + Sample (3%) + Venom's own 4th required artifact (Virus,
// Elite-only, doesn't touch the general pool) -> base = 1-(1-0.20)(1-0.10)(1-0.03) = 0.3016,
// Venom-boosted = 0.3016 x 1.15 = 0.34684, effective multiplier = 1/(1-0.34684) = 1.531018.
reset();
own('Basilisk'); own('Sample'); own('Genome Map'); own('Virus'); // Venom's 4 required artifacts
r = compute();
check('Venom active once all 4 required artifacts are owned', r.venomOwned, true);
check('Venom: general reduction fraction = 0.34684 (multiplicative base x1.15)', r.enemyMaxHpReductionGeneralFraction, 0.34684, 0.0001);
check('Venom: vs-Normal Effective Damage multiplier = 1.531018', r.effectiveDamageMultVsNormal, 1.531018, 0.0001);
// Virus (-10% Elite-only, single source here) is unaffected by the general pool or Venom (confirmed
// scope: general pool only) — Venom's own text is specifically "all enemies", not Elite-scoped.
check('Venom does not touch the Elite-only pool', r.enemyMaxHpReductionElitePct, 10);
// vs-Elite layers the general (Venom-boosted) pool multiplicatively on top of Virus's own 10%:
// 1 - (1 - 0.34684) * (1 - 0.10) = 1 - 0.65316*0.9 = 0.412156
check('Venom: vs-Elite combines general (Venom-boosted) with Elite-only multiplicatively', r.enemyMaxHpReductionVsElite, 0.412156, 0.0001);

// Elite pool with 2 real sources (Virus 10% + Toy Castle 15%) — the general/Venom question above is
// confirmed via a direct in-game reading, but Elite/Large/Boss-Wave/Normal-Wave can't be read off the
// stat sheet at all (confirmed by the user), so applying the same multiplicative-within-pool model to
// them is an explicit assumption per the user's own direction ("assume it works the same way as CDR
// does... enemy-specific multiply afterward"), not independently confirmed the same way.
reset();
own('Virus'); own('Toy Castle');
r = compute();
check('Virus + Toy Castle: additive sum still tracked = 25% (10 + 15)', r.enemyMaxHpReductionElitePct, 25);
check('Virus + Toy Castle: Elite fraction = 0.235 (multiplicative, 1-(1-0.10)(1-0.15)), NOT the additive 0.25', r.enemyMaxHpReductionEliteFraction, 0.235, 0.0001);

// Wonderland (Synergy): a real data duplicate, not a genuine double-stack — its raw effects array
// carries "Decrease Max HP of all enemies by 9%" TWICE (different ids, identical text), but its own
// description only ever names two distinct effects (Size -9%, Max HP -9%). Confirmed via a real
// in-game build (general pool matched 71.24% only when Wonderland's Max HP line was double-counted;
// the correct single-count value is 66.92%) — deduped by resolved text within gatherActiveEffects'
// own synergy loop, scoped only to Wonderland by name so Wizard's genuinely-separate double Magic
// Bolt Lv+1 grant elsewhere is untouched.
reset();
own('Toy Castle'); own('Fairy'); own('Unicorn'); own('Storybook'); // Wonderland's 4 required artifacts
r = compute();
check('Wonderland active once all 4 required artifacts are owned', getActiveSynergies().some(s => s.name === 'Wonderland'), true);
check('Wonderland: general pool = 9% (its own Max HP line counted ONCE, not twice)', r.enemyMaxHpReductionGeneralPct, 9);
check('Wonderland: general reduction fraction = 0.09 (single source, additive and multiplicative agree)', r.enemyMaxHpReductionGeneralFraction, 0.09, 0.0001);

// Occult: derived Max HP bonus equal to the general pool's own resolved fraction, additive on top
// of the normal maxHpBonusPct pool (not a conversion — the enemy-side reduction stays fully intact
// too). Basilisk(10)+Sample(3)+Occult(5), no Venom: 1-(1-0.10)(1-0.03)(1-0.05) = 0.17065.
reset();
own('Basilisk'); own('Sample'); // general pool, no Venom
own('Occult'); // contributes its own -5% to the SAME general pool, then reads the total back
r = compute();
check('Occult: additive sum still tracked = 18% (13 + 5)', r.enemyMaxHpReductionGeneralPct, 18);
check('Occult: general reduction fraction = 0.17065 (multiplicative, not the additive 0.18)', r.enemyMaxHpReductionGeneralFraction, 0.17065, 0.0001);
check('Occult: player Max HP bonus = 17.065% (matches the resolved general pool fraction exactly)', r.maxHpBonusPct, 17.065, 0.001);
check('Occult: enemy-side reduction is NOT consumed by granting the player HP (both apply)', r.enemyMaxHpReductionGeneralFraction, 0.17065, 0.001);

// Mutagen (-15% Large-only) stays additive and independent of the general pool when no general
// pool sources are owned at all.
reset();
own('Mutagen');
r = compute();
check('Mutagen: Large-only pool = 15%, general pool untouched', r.enemyMaxHpReductionLargePct, 15);
check('Mutagen: vs-Large reduction fraction = 0.15 with an empty general pool', r.enemyMaxHpReductionVsLarge, 0.15, 0.001);
check('Mutagen: vs-Normal unaffected (0%, Large-only doesn\'t leak into the general pool)', r.enemyMaxHpReductionVsNormal, 0, 0.001);

// Magic Sword's Execute threshold, reproducing the user's own worked example exactly: 1000 HP
// enemy, 25%-equivalent reduction (Magic Sword's real threshold is 20%, verified independently
// below against the exact 1/((1-reduction)*(1-threshold)) formula) combined with a 50% Max HP
// reduction -> requiredDamageFraction = (1 - reduction) * (1 - threshold).
reset();
own('Magic Sword');
r = compute();
check('Magic Sword: Execute threshold = 20% (its own raw effect value)', r.executeThresholdPct, 20);
check('Magic Sword alone (no Max HP reduction): vs-Normal multiplier = 1 / (1 - 0.20) = 1.25', r.effectiveDamageMultVsNormal, 1.25, 0.001);
check('Effective Damage panel is active once Magic Sword is owned', r.effectiveDamageActive, true);
// Effective Damage section previously showed only the multiplier with no resulting damage figure —
// confirm the actual expected-damage number is exposed too, matching Conditional Modifiers' rows.
check('Magic Sword: expectedEffectiveVsNormal = expected x 1.25', r.expectedEffectiveVsNormal, r.expected * 1.25, 0.01);

reset();
own('Magic Sword'); own('Basilisk'); own('Sample'); // general pool (multiplicative) = 0.127, Execute 20%, no Venom
r = compute();
// requiredDamageFraction = (1 - 0.127) * (1 - 0.20) = 0.873 * 0.80 = 0.6984 -> multiplier = 1/0.6984
check('Magic Sword + Max HP reduction compound (not independent): vs-Normal multiplier = 1/0.6984', r.effectiveDamageMultVsNormal, 1 / 0.6984, 0.001);

// Ego Sword (Synergy): raises Magic Sword's Execute threshold from 20% to 25% (a replacement, not
// an addition — "increases TO 25%" per its own raw text, not "increases BY").
reset();
own('Magic Sword'); own('Imp'); own('Watcher’s Eye'); own('Mana Ore'); // Ego Sword's 4 required artifacts
r = compute();
check('Ego Sword active once its 4 required artifacts are owned', r.egoSwordActive, true);
check('Ego Sword: threshold replaced to 25% (not 20+25=45%)', r.executeThresholdPct, 25);
check('Ego Sword: vs-Normal multiplier = 1 / (1 - 0.25) = 1.3333', r.effectiveDamageMultVsNormal, 1 / 0.75, 0.001);

// --- Conditional Modifiers: HP%-gated (Guillotine/Rose/Ballista/Sniper) and time-gated (Brand)
// Additional Damage — multiplicative-per-source like Robot/Excalibur, but shown as a separate
// scenario multiplier on top of expected damage rather than folded in unconditionally, since the
// condition itself can't be known live. ---
reset();
own('Guillotine');
r = compute();
check('Guillotine: hpGatedAdditionalDamageMult = 1.15', r.hpGatedAdditionalDamageMult, 1.15, 0.0001);
check('Guillotine: expectedVsHighHp = expected * 1.15', r.expectedVsHighHp, r.expected * 1.15, 0.01);

reset();
own('Ballista'); own('Guillotine'); own('Rose'); own('Radar'); // Sniper's 4 required artifacts
r = compute();
check('Sniper active once its 4 required artifacts are owned', r.sniperActive, true);
// Sniper stacks ON TOP of its own required artifacts' bonuses, not restated flavor text:
// 1.5 (Ballista) * 1.15 (Guillotine) * 1.10 (Rose) * 1.25 (Sniper) = 2.371875
check('Sniper: hpGatedAdditionalDamageMult = 2.371875 (compounds with its own required artifacts)', r.hpGatedAdditionalDamageMult, 2.371875, 0.0001);

reset();
own('Brand');
r = compute();
check('Brand: timeGatedAdditionalDamageMult = 1.15', r.timeGatedAdditionalDamageMult, 1.15, 0.0001);
check('Brand: expectedVsSurvived = expected * 1.15', r.expectedVsSurvived, r.expected * 1.15, 0.01);

// --- Jet Engine / War Flag: AMP-pool contributions (not Additional Damage), gated on "while
// moving" / "standing still, max stack" — shown as "assume full uptime" scenario rows per the
// user's own direction, same shape as the HP%/time-gated group above. AMP is additive-then-
// multiplied (AMP = 1 + ampPct/100), so the scenario multiplier must be (new AMP)/(current AMP),
// not a naive flat (1 + bonus/100) — the Overmind-combined cases below specifically catch a
// regression to that naive (and wrong) shortcut. ---
reset();
own('Jet Engine');
r = compute();
check('Jet Engine: jetEnginePct = 15 (its own raw effect value)', r.jetEnginePct, 15);
check('Jet Engine alone (ampPct=0): jetEngineMult = 1.15', r.jetEngineMult, 1.15, 0.0001);
check('Jet Engine: expectedVsMoving = expected * 1.15', r.expectedVsMoving, r.expected * 1.15, 0.01);

reset();
state.spellState = {};
setSpellLevel(GAMEDATA.spells[1], spellState(1), 7);
setSpellLevel(GAMEDATA.spells[2], spellState(2), 3);
setSpellLevel(GAMEDATA.spells[21], spellState(21), 1);
setSpellLevel(GAMEDATA.spells[10], spellState(10), 5);
state.selectedSpellId = 1;
state.fusionIds = [26]; // Overmind
own('Jet Engine');
r = compute();
check('Jet Engine + Overmind: ampPct = 24 (Overmind\'s own contribution, unaffected by the scenario)', r.ampPct, 24);
check('Jet Engine + Overmind: jetEngineMult = 1.39/1.24, NOT a naive flat 1.15 (additive-then-multiplied AMP)', r.jetEngineMult, 1.39 / 1.24, 0.0001);

reset();
own('War Flag');
r = compute();
check('War Flag: warFlagMaxPct = 20 (Max Stack value, not the per-second 2%)', r.warFlagMaxPct, 20);
check('War Flag alone (ampPct=0): warFlagMult = 1.20', r.warFlagMult, 1.20, 0.0001);
check('War Flag: expectedVsStandingStill = expected * 1.20', r.expectedVsStandingStill, r.expected * 1.20, 0.01);

// --- Merlin's Cape / Magic Fountain: same bounded "assume max" AMP shape as Jet Engine/War Flag,
// just Mana-based (100% Mana / Magic Fountain's own stated Max Stack) instead of movement-based. ---
reset();
own('Merlin\'s Cape');
r = compute();
check('Merlin\'s Cape: merlinsCapeMaxPct = 25 (its own coefficient IS its max, at 100% Mana)', r.merlinsCapeMaxPct, 25);
check('Merlin\'s Cape alone (ampPct=0): merlinsCapeMult = 1.25', r.merlinsCapeMult, 1.25, 0.0001);
check('Merlin\'s Cape: expectedVsFullManaCape = expected * 1.25', r.expectedVsFullManaCape, r.expected * 1.25, 0.01);

reset();
state.spellState = {};
setSpellLevel(GAMEDATA.spells[1], spellState(1), 7);
setSpellLevel(GAMEDATA.spells[2], spellState(2), 3);
setSpellLevel(GAMEDATA.spells[21], spellState(21), 1);
setSpellLevel(GAMEDATA.spells[10], spellState(10), 5);
state.selectedSpellId = 1;
state.fusionIds = [26]; // Overmind
own('Merlin\'s Cape');
r = compute();
// Naive (wrong) shortcut would give 1.25 regardless of ampPct; real math: (1+(24+25)/100)/(1+24/100) = 1.49/1.24
check('Merlin\'s Cape + Overmind: merlinsCapeMult = 1.49/1.24, NOT a naive flat 1.25', r.merlinsCapeMult, 1.49 / 1.24, 0.0001);

reset();
own('Magic Fountain');
r = compute();
check('Magic Fountain: magicFountainMaxPct = 20 (Max Stack value, not the per-200-orb 1%)', r.magicFountainMaxPct, 20);
check('Magic Fountain alone (ampPct=0): magicFountainMult = 1.20', r.magicFountainMult, 1.20, 0.0001);
check('Magic Fountain: expectedVsMaxManaOrbs = expected * 1.20', r.expectedVsMaxManaOrbs, r.expected * 1.20, 0.01);

// --- Mana Shield: no AMP contribution of its own — only damage-relevant through Aegis re-reading
// a higher scenario Damage Taken Reduction total. Without Aegis owned, must be a true no-op (1x). ---
reset();
own('Mana Shield');
r = compute();
check('Mana Shield: manaShieldMaxPct = 50 (its own raw coefficient, at 100% Mana)', r.manaShieldMaxPct, 50);
check('Mana Shield WITHOUT Aegis: manaShieldMult = 1 (true no-op, no damage-relevant reader owned)', r.manaShieldMult, 1, 0.0001);
check('Mana Shield WITHOUT Aegis: expectedVsFullManaShield stays null (nothing to show)', r.expectedVsFullManaShield, null);

reset();
own('Aegis'); own('Dragonscale'); // real damageReductionPct = 37 (Aegis -10% x Dragonscale -30%)
own('Mana Shield');
r = compute();
check('Mana Shield + Aegis + Dragonscale: real damageReductionPct stays 37 (Mana Shield never joins the REAL pool, scenario-only)', r.damageReductionPct, 37);
// Scenario pool: 0.63 (real) x (1-0.50) = 0.315 -> 68.5% scenario reduction -> scenario Aegis = 3x6.85 = 20.55
// Real Aegis (already in ampPct) = 3x3.7 = 11.1, so ampPct=11.1, AMP=1.111
// manaShieldMult = (1 + (11.1 - 11.1 + 20.55)/100) / 1.111 = 1.2055/1.111
check('Mana Shield + Aegis + Dragonscale: manaShieldMult = 1.2055/1.111 (Aegis re-read with the scenario pool)', r.manaShieldMult, 1.2055 / 1.111, 0.0001);
check('Mana Shield + Aegis + Dragonscale: expectedVsFullManaShield = expected * manaShieldMult', r.expectedVsFullManaShield, r.expected * (1.2055 / 1.111), 0.01);

// --- Siege Hammer: +20% Additional Damage on non-crit hits only, folded into the expected-damage
// weighting (the non-crit probability is already a tracked stat), plus its own separate +20%
// Critical Strike Multiplier line (already reaching the general critMult regex on its own). ---
reset();
own('Siege Hammer');
r = compute();
check('Siege Hammer: siegeHammerPct = 20 (its own raw effect value)', r.siegeHammerPct, 20);
check('Siege Hammer: nonCritWithSiegeHammer = nonCrit * 1.20', r.nonCritWithSiegeHammer, r.nonCrit * 1.20, 0.01);
check('Siege Hammer: its own Crit Multiplier line already reaches critMultPct unaided', r.critMultPct, 20);

// --- Joker: unverified against decompiled game logic (only a bare state field exists, no method
// body) — modeled per the user's own community-sourced description: chance = min(50%, critChance/2)
// per crit to double the BONUS portion of the crit multiplier only, not the flat 200% base. ---
reset();
own('Assassination'); own('Widowmaker'); own('Carnival'); own('Masked Ball'); own('Shadow Cape');
r = compute();
const critChanceForJokerTest = r.critChance, critMultiForJokerTest = r.critMulti; // pre-Joker baseline
own('Joker');
r = compute();
check('Joker: does not change critChance or critMulti themselves (only critMultFactor)', r.critChance, critChanceForJokerTest, 0.001);
const expectedProcChance = Math.min(50, critChanceForJokerTest / 2) / 100;
const expectedCritMultiWithJoker = critMultiForJokerTest + expectedProcChance * (critMultiForJokerTest - 200);
check('Joker: jokerProcChance = min(50%, critChance/2) as a fraction', r.jokerProcChance, expectedProcChance, 0.0001);
check('Joker: critMultiWithJoker = critMulti + procChance x (critMulti - 200), base 200 untouched', r.critMultiWithJoker, expectedCritMultiWithJoker, 0.001);

// --- Widowmaker: "Increase [Critical Multiplier] by [Critical Rate]" — a dynamic, self-referential
// effect (raw text is null, same dead-end pattern as Occult's Max HP effect) that grants a Crit
// Multiplier bonus equal to the player's own fully-resolved crit chance, on top of its own separate
// flat +10% Critical Strike Rate. ---
reset();
own('Widowmaker');
r = compute();
check('Widowmaker: its own +10% Critical Strike Rate still works', r.critChancePct, 10);
check('Widowmaker active', r.widowmakerOwned, true);
// critChance = base 3% + Widowmaker's own +10% = 13%; critMultPct should include +13 from this
check('Widowmaker: critChance = 13 (base 3 + its own +10)', r.critChance, 13, 0.001);
check('Widowmaker: critMultPct = 13 (equal to fully-resolved critChance)', r.critMultPct, 13, 0.001);
check('Widowmaker: critMulti = 213 (200 base + 13 from Widowmaker)', r.critMulti, 213, 0.001);

// --- Occult's derived Max HP bonus flows through to Gaia's ATK-from-Max-HP conversion, not just
// into the raw maxHpBonusPct number — confirmed end-to-end, not just at the source. ---
reset();
own('Basilisk'); own('Occult'); own('Gaia');
r = compute();
check('Occult + Basilisk: additive sum still tracked = 15% (10 + 5)', r.enemyMaxHpReductionGeneralPct, 15);
// General pool is multiplicative: 1-(1-0.10)(1-0.05) = 0.145, not the additive 0.15.
check('Occult + Basilisk: general reduction fraction = 0.145 (multiplicative, not additive 0.15)', r.enemyMaxHpReductionGeneralFraction, 0.145, 0.0001);
// maxHpBonusPct = Gaia's own +50% Max HP + Occult's derived +14.5% (equal to the resolved fraction)
check('Occult + Gaia: maxHpBonusPct = 64.5 (Gaia 50 + Occult 14.5)', r.maxHpBonusPct, 64.5, 0.01);
check('Occult + Gaia: maxHpTotal = 329 (200 base x 1.645)', r.maxHpTotal, 329, 0.01);
// Gaia: +3% ATK per 20 Max HP -> 329/20 x 3 = 49.35%
check('Occult -> Gaia: ATK bonus reflects the Occult-inflated Max HP (49.35%, not just Gaia\'s own 37.5%)', r.atkPct, 49.35, 0.01);

// --- Regression: Oculus/Carnival's crit-chance contributions used to run AFTER critChance was
// already computed and clamped, so their own bonus reached critChancePct's displayed total but
// never actually fed critChance itself (silently corrupting Widowmaker/Joker/Siege Hammer, which
// all read critChance, plus the left sidebar's own "Final Crit Chance (+N%)" display going out of
// sync with its own parenthetical). Locking in that critChance = clamp(base + critChancePct)
// always holds exactly, regardless of which crit-chance sources are owned. ---
reset();
own('Oculus'); own('Carnival');
r = compute();
check('Oculus + Carnival: critChance stays consistent with critChancePct (base 3% + pct, clamped)', r.critChance, Math.min(100, Math.max(0, 3 + r.critChancePct)), 0.001);

// --- Imp: "Increase Normal Wave Monsters' Max HP by 10%" / "Reduce Boss Wave Monsters' Max HP by
// 10%" — a phrasing classifyEffect never matched (different pattern than the general/Elite/Large
// regexes), so it silently did nothing. First Max-HP modifier that's an INCREASE, not a reduction;
// tracked in the same signed convention (positive = reduction, negative = a real increase) as the
// existing pools so it composes through the identical formula with no special-casing. ---
reset();
own('Imp');
r = compute();
check('Imp: Boss Wave pool = 10 (a real reduction)', r.enemyMaxHpModBossWavePct, 10);
check('Imp: Normal Wave pool = -10 (a real increase, negative in the reduction convention)', r.enemyMaxHpModNormalWavePct, -10);
check('Imp: vs-Boss-Wave required fraction = 0.90 (10% reduction alone)', r.requiredDamageFractionVsBossWave, 0.90, 0.001);
// Normal Wave: reductionFraction = -0.10 (an increase) -> required = 1 - (-0.10) = 1.10 (need MORE
// than the original 100% Max HP in real damage, since the enemy now has more HP than base).
check('Imp: vs-Normal-Wave required fraction = 1.10 (a real 10% Max HP increase, not a reduction)', r.requiredDamageFractionVsNormalWave, 1.10, 0.001);
check('Imp: vs-Boss-Wave Effective Damage multiplier = 1 / 0.90', r.effectiveDamageMultVsBossWave, 1 / 0.90, 0.001);
check('Imp: vs-Normal-Wave Effective Damage multiplier = 1 / 1.10 (less than 1x, a real penalty)', r.effectiveDamageMultVsNormalWave, 1 / 1.10, 0.001);

// Order-independence check: layering Boss Wave on top of an existing general-pool reduction gives
// the identical result regardless of which pool is "applied first" — pure multiplication commutes.
reset();
own('Imp'); own('Basilisk'); // general pool -10%, Boss Wave -10% (its own separate pool)
r = compute();
const generalRemaining = 1 - r.enemyMaxHpReductionGeneralFraction; // 0.90
const bossWaveOwnRemaining = 1 - (r.enemyMaxHpModBossWavePct / 100); // 0.90
const expectedCombined = 1 - generalRemaining * bossWaveOwnRemaining;
check('Imp + Basilisk: vs-Boss-Wave combines both pools multiplicatively, order-independent', r.enemyMaxHpReductionVsBossWave, expectedCombined, 0.0001);
check('Imp + Basilisk: vs-Boss-Wave combined = 0.19 (1 - 0.9x0.9)', r.enemyMaxHpReductionVsBossWave, 0.19, 0.0001);

// --- Adrenaline (Special Passive): "Increase ATK, Critical Strike Rate, Movement Speed by 5%" —
// a combined summary line naming all three stats at once. Crit Rate/Movement Speed also exist as
// their own separate, individually-formatted effect entries and were already correctly classified;
// only the ATK share (which has no such separate entry) was silently dropped, since the combined
// line never matched the ATK-alone pattern. ---
reset();
const adrenaline = GAMEDATA.specialPassives.find(p => p.name === 'Adrenaline');
state.bonusSelections[bonusKey({ ...adrenaline, category: 'Special Passive' })] = 1;
r = compute();
check('Adrenaline: ATK +5% (previously silently dropped)', r.atkPct, 5);
check('Adrenaline: Critical Strike Rate +5% (already worked via its own separate entry)', r.critChancePct, 5);

// --- "Increase/Decrease the number of X by N%/NX" — previously only matched "Increase" (Phoenix/
// Reaction/Winter Storm's "Decrease...by N%" fusions silently did nothing), and treated the raw
// number as a flat integer add regardless of suffix, wildly inflating percentage-based grants
// (Machine Arm's "+35%" turned Energy Bolt's count 5 -> 40 instead of ~7). Confirmed with the user:
// %/X suffixes scale off the spell's own base count, consistent with every other additive "by N%"
// pool in this dataset. ---
reset();
own('Machine Arm');
check('Machine Arm: Energy Bolt count = 7 (base 5 + round(5 x 0.35) = 5+2)', computeSpellTotalCount(GAMEDATA.spells[16]), 7);

reset();
const phoenixFusionCountTest = GAMEDATA.fusions.find(f => f.name === 'Phoenix');
state.fusionIds = [phoenixFusionCountTest.id];
const tsunamiSpellCountTest = Object.values(GAMEDATA.spells).find(s => s.name === 'Tsunami');
check('Phoenix: Tsunami count = 4 (base 8 - round(8 x 0.50) = 8-4, "Decrease" now works at all)', computeSpellTotalCount(GAMEDATA.spells[tsunamiSpellCountTest.id]), 4);

reset();
const demonEqFusionCountTest = GAMEDATA.fusions.find(f => f.name === 'Demon Equation');
state.fusionIds = [demonEqFusionCountTest.id];
const fireballSpellCountTest = Object.values(GAMEDATA.spells).find(s => s.name === 'Fireball');
// Demon Equation: "Increase the number of Fireballs by 4X" -> base + round(base x 4)
const fireballBaseCountTest = GAMEDATA.spells[fireballSpellCountTest.id].base.number;
check('Demon Equation: Fireball count includes base + round(base x 4) from its own "4X" grant', computeSpellTotalCount(GAMEDATA.spells[fireballSpellCountTest.id]) >= fireballBaseCountTest + Math.round(fireballBaseCountTest * 4), true);

// --- Soul Harvest (Cloaking's third Tier-1 evolution): "Recover 0.1% HP per enemy killed while in
// Cloaking, and increase Mana Acquisition by 33%" — one combined effect with no text template
// (null-text scan finding), same shape as Adrenaline's earlier bug. The HP-recovery half is a
// non-damage defensive stat, correctly out of scope; the Mana Acquisition half feeds Abyss and was
// being lost entirely. Unlike Mirage, this must apply regardless of which spell is currently being
// viewed (Mana Acquisition is a global stat, not per-spell), so it's checked while viewing Magic
// Bolt specifically to prove it isn't gated on viewing Cloaking. ---
reset();
own('Abyss'); // reads manaAcquisitionPct, converts half to ATK
const cloakingSpellForSoulHarvest = GAMEDATA.spells[11];
setSpellLevel(cloakingSpellForSoulHarvest, spellState(11), 5);
spellState(11).evolutions.add(454); // Soul Harvest
state.selectedSpellId = 1; // Magic Bolt — NOT Cloaking, proving this isn't per-spell-gated
r = compute();
check('Soul Harvest: manaAcquisitionPct = 33 (previously 0, silently dropped)', r.manaAcquisitionPct, 33);
check('Soul Harvest -> Abyss: ATK bonus reflects it (33/2 = 16.5%) even while viewing Magic Bolt, not Cloaking', r.atkPct, 16.5, 0.01);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
