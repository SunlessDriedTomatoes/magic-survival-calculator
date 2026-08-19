// ===================== State =====================
// Declared before `state` below since `const` bindings aren't usable until their own line runs
// (unlike hoisted `function` declarations), and defaultState() is called immediately — so these
// must come first.
const DEFAULT_CLASS_ID = 1; // Wizard
const DEFAULT_TEST_SUBJECT_ID = 41; // Wizard
// Not player-editable. Same reference value Titan's Power's own formula anchors to ("subtract 100
// from your stat-screen ATK..."). Everything beyond this comes from the atkPct bonus pool, which
// already aggregates every selected source.
const PLAYER_BASE_ATK = 100;
const PLAYER_BASE_CRIT_CHANCE = 3;
const PLAYER_BASE_CRIT_MULT = 200;
// Absolute point values (not %-relative like ATK/AMP/MDMG). Max HP feeds Gaia's "+3% ATK per 20
// Max HP"; Move Speed feeds Accelerator's "CDR per Movement Speed Increase" conversion.
const PLAYER_BASE_MAX_HP = 200;
const PLAYER_BASE_MOVE_SPEED = 100;

// defaultState() (defined below, hoisted) is the single source of truth for the state shape —
// used here, on reset, and to backfill missing fields when restoring an older saved loadout.
const state = defaultState();

function spellState(id) {
  // Defaults to 0 ("not chosen this run"), not 1 — this is called just to VIEW a spell's panel
  // (every renderMainPane does it for whichever spell is on screen), so defaulting to 1 would
  // silently "acquire" a spell the moment you looked at it, before you ever touched a level card.
  if (!state.spellState[id]) state.spellState[id] = { evolutions: new Set(), level: 0 };
  return state.spellState[id];
}
// A spell's evolution tier (1-indexed, matching evo.tier) only becomes available once the spell's
// own selected level reaches that tier's unlock level (spell.traitUnlockLevels[tier-1] — see
// build_gamedata.js's spell-extraction comment for how these levels were derived). Almost every
// spell has exactly one tier, unlocked at max level; Magic Bolt uniquely has two (levels 4 and 7).
function spellEvolutionTierUnlocked(spell, tier, level) {
  const unlockLevel = spell.traitUnlockLevels[tier - 1];
  return unlockLevel != null && level >= unlockLevel;
}
// The single place that changes a spell's selected level — always prunes any picked evolution
// whose tier is no longer reachable at the new level, so lowering your level (e.g. clicking an
// earlier level's card) actually clears a now-out-of-reach pick instead of leaving it selected but
// inert (which previously rendered as a confusing "green but greyed out" card, since its effects
// were already correctly excluded from the damage math by spellEvolutionTierUnlocked — only the
// selection state itself wasn't being cleared to match).
function setSpellLevel(spell, ss, newLevel) {
  ss.level = newLevel;
  for (const evo of spell.evolutions) {
    if (ss.evolutions.has(evo.id) && !spellEvolutionTierUnlocked(spell, evo.tier, newLevel)) ss.evolutions.delete(evo.id);
  }
}
// Each tier is a mutually-exclusive pick (radio-style) — selecting one clears any sibling already
// picked in that same tier. Clicking a selection again clears it.
function toggleSpellEvolution(spell, ss, evo) {
  const active = ss.evolutions.has(evo.id);
  if (active) {
    ss.evolutions.delete(evo.id);
  } else {
    for (const sibling of spell.evolutions) {
      if (sibling.tier === evo.tier) ss.evolutions.delete(sibling.id);
    }
    ss.evolutions.add(evo.id);
  }
}

// ===================== Persistence (autosave + named loadouts) =====================
// localStorage is per-browser-profile and (for local files) generally scoped by the browser to
// the file itself or to a shared "file://" bucket depending on browser — either way it survives
// closing the tab/app, which is what autosave needs. Nothing here ever leaves the machine.
const LS_AUTOSAVE_KEY = 'msCalc_autosave_v1';
const LS_LOADOUTS_KEY = 'msCalc_loadouts_v1';

function defaultState() {
  return {
    selectedSpellId: 1, spellState: {}, classId: DEFAULT_CLASS_ID, testSubjectId: DEFAULT_TEST_SUBJECT_ID,
    classLevel: 1, playerLevel: 1,
    // Test Subjects don't level — their "(All Classes)" passive is either unlocked or it isn't,
    // and applies regardless of which one you've set as active (that selection only matters for
    // unlocking a matching fusion's Ultimate). Defaults to the same one as the default active pick,
    // since you can't have it active without having unlocked it first.
    unlockedTestSubjectIds: [DEFAULT_TEST_SUBJECT_ID],
    // Each School class's final (max-level) bonus is tagged "(All Classes)" — it applies
    // permanently to every class once that class reaches max level, independent of which class
    // is currently active. Separate from classLevel (which only gates the active class's own,
    // non-universal bonuses).
    maxedClassIds: [],
    bonusSelections: {}, fusionIds: [], ultimatesOn: {},
    activeTab: 'calculator', nexusSpellId: null,
    encyclopediaSubTab: 'spells',
    // One dropdown per owned Enchant level (max 3) — index i is meaningless once level drops below
    // i+1 (that slot's dropdown stops rendering), but the stored id is left as-is rather than
    // pruned, so re-leveling back up restores the previous pick instead of losing it.
    enchantSpellIds: [null, null, null],
  };
}
function serializeState() {
  const spellStateOut = {};
  for (const [id, ss] of Object.entries(state.spellState)) {
    // ss.level is always a real number by the time it's in state (never undefined), and 0 ("not
    // chosen this run") is a legitimate value here — no `|| 1` fallback, since that would silently
    // coerce a deliberate 0 back to 1.
    spellStateOut[id] = { evolutions: [...ss.evolutions], level: ss.level };
  }
  return { ...state, spellState: spellStateOut };
}
function applyState(saved) {
  if (!saved) return;
  const merged = { ...defaultState(), ...saved };
  const spellStateIn = {};
  for (const [id, ss] of Object.entries(merged.spellState || {})) {
    // Older saves (from before per-level selection existed) have no `level` field at all — those
    // were always computed as if fully maxed, so default to the spell's own max level rather than
    // 1, to avoid silently deflating a returning user's existing build. Uses `!= null` rather than
    // `||` specifically so a genuinely-saved 0 ("not chosen this run") survives a reload intact.
    const spell = GAMEDATA.spells[id];
    const fallbackLevel = spell ? spell.maxLevel : 1;
    spellStateIn[id] = { evolutions: new Set(ss.evolutions || []), level: ss.level != null ? ss.level : fallbackLevel };
  }
  merged.spellState = spellStateIn;
  Object.assign(state, merged);
}
function saveAutosave() {
  try { localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(serializeState())); } catch (e) { /* storage unavailable — ignore */ }
}
function loadAutosave() {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE_KEY);
    if (raw) applyState(JSON.parse(raw));
  } catch (e) { /* corrupted or unavailable — start fresh */ }
}
function getLoadouts() {
  try { return JSON.parse(localStorage.getItem(LS_LOADOUTS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveLoadout(name) {
  const loadouts = getLoadouts();
  loadouts[name] = serializeState();
  localStorage.setItem(LS_LOADOUTS_KEY, JSON.stringify(loadouts));
}
function loadLoadout(name) {
  const loadouts = getLoadouts();
  if (!loadouts[name]) return;
  applyState(loadouts[name]);
  saveAutosave();
}
function deleteLoadout(name) {
  const loadouts = getLoadouts();
  delete loadouts[name];
  localStorage.setItem(LS_LOADOUTS_KEY, JSON.stringify(loadouts));
}
function resetAll() {
  Object.assign(state, defaultState());
  saveAutosave();
}

// Evolution picks persist per-spell, so a fusion that combines evolutions from two different
// spells (e.g. Blaster needs a Magic Bolt evolution AND a Flash Shock evolution) can be checked
// properly by looking across every spell's saved state, not just the currently-selected one.
// A fusion's two "requiresEvolutionIds" aren't always both spell evolutions — some (Overmind,
// Perpetual Engine, Gate of Creation, Photon Explosion, Teleport) pair one spell evolution with a
// maxed Passive instead (e.g. Overmind needs Magic Circle's "Great Magic Circle" evolution AND
// Intelligence maxed — id 31, the Passive, not a spell evolution at all). This was a real bug: only
// spell evolutions were ever checked here, so any fusion with a Passive component could never
// appear as available no matter how maxed that Passive was. "Maxed" is checked against the base
// maxLevel only — Cube's/Taoist's +1-each bonus levels apply automatically on top of a maxed
// Passive (see normalPassiveMaxLevelBonus and the Passives tab), so reaching the base max already
// means the true (bonus-inclusive) level is maxed too; there's nothing left to manually invest.
function allSelectedEvolutionIds() {
  const ids = new Set();
  for (const ss of Object.values(state.spellState)) {
    for (const id of ss.evolutions) ids.add(id);
  }
  for (const p of GAMEDATA.passives) {
    const level = state.bonusSelections[bonusKey({ ...p, category: 'Passive' })] || 0;
    if (level >= p.maxLevel) ids.add(p.id);
  }
  return ids;
}

// "Level of acquired Active Magic" (used by Overmind and Deus Ex Machina's per-level scaling) is
// the sum of each invested spell's own selected level (state.spellState[id].level) — not always
// max level, since spell level is now a player-set value like Class Level, not an assumption.
function totalActiveMagicLevels() {
  let total = 0;
  for (const [id, ss] of Object.entries(state.spellState)) {
    // A spell counts as "active" (obtained) once it's chosen at all — level 1 with no further
    // upgrades still counts as 1 active level, matching "per active magic obtained." Only level 0
    // (not chosen this run) is truly excluded. No `|| 1` fallback — 0 is a real, distinct value
    // here now, not an "unset" sentinel that should quietly become 1.
    if (ss.level <= 0 && ss.evolutions.size === 0) continue;
    const spell = GAMEDATA.spells[id];
    if (spell) total += ss.level;
  }
  return total;
}

// A fusion combines exactly two components (requiresEvolutionIds[0] and [1]) but only ONE of them
// is the actual damage-dealing spell in-game — the "main component," shown in green in the game's
// own UI — the other is purely a requirement with no bearing on which spell the fusion's damage
// applies to. requiresEvolutionIds[0] is always the primary: every fusion whose own effect text
// names a spell (e.g. "Increase Flash Shock Damage by 7X") names exactly the spell behind slot
// [0], never [1], with zero exceptions across the dataset (confirmed against Frenzy → Berserk
// specifically: Flash Shock is slot [0] and gets the bonuses, Magic Bolt is slot [1] and gets
// none). A [0] slot can also be a maxed Passive rather than a spell evolution (e.g. Overmind's is
// Intelligence) — those fusions grant no spell-specific damage at all (global buffs only, handled
// separately), so returning null for them is correct: there's no "main spell" to gate an Ultimate on.
function fusionPrimarySpellId(fusion) {
  const primaryEvoId = fusion.requiresEvolutionIds[0];
  for (const spell of Object.values(GAMEDATA.spells)) {
    if (spell.evolutions.some(evo => evo.id === primaryEvoId)) return spell.id;
  }
  return null;
}

// Shield and Cloaking are the two exceptions to "base damage always comes straight from the
// in-game encyclopedia" — the extracted data had no damage figure for either (both showed only a
// "no direct damage stat" utility note), so their real encyclopedia values (30 and 500
// respectively) are baked into base_spell_stats.json directly instead. Both are per-hit, matching
// this calculator's convention everywhere else. Neither spell
// deals damage on its own without a fusion built around it (Photon Explosion, Teleport) — this base
// value is what those fusions' own damage effects (e.g. Teleport's "Increase Cloaking Damage by
// 3X") multiply against — but the base figure itself isn't conditional on a fusion being selected,
// same as any other spell's base. See PHOTON_EXPLOSION_FUSION below for its own count/size scaling.

// The "Magic Circle" fusion family — Overmind, Perpetual Engine, and Gate of Creation all derive
// from the Magic Circle spell's own (mutually-exclusive) evolutions, with Deus Ex Machina as
// Overmind's follow-up. These are stat-boost fusions, not damage fusions, so the UI groups them
// separately — but they still draw from the same shared combination-slot pool as normal fusions.
const OVERMIND_FUSION = GAMEDATA.fusions.find(f => f.name === 'Overmind') || null;
const PERPETUAL_ENGINE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Perpetual Engine') || null;
const GATE_OF_CREATION_FUSION = GAMEDATA.fusions.find(f => f.name === 'Gate of Creation') || null;
const DEM_FUSION = GAMEDATA.fusions.find(f => f.name === 'Deus Ex Machina') || null;
const MAGIC_CIRCLE_FUSIONS = [OVERMIND_FUSION, PERPETUAL_ENGINE_FUSION, GATE_OF_CREATION_FUSION, DEM_FUSION].filter(Boolean);

// Titan's Power is explicitly a "multiply the total, not add to a pool" mechanic — applied as its
// own late multiplicative factor rather than folded into the additive ATK%/MDMG% pools everything
// else uses. Nexus, despite reading similarly at a glance ("Select one Attack Spell and increase
// its Damage by 240%"), is NOT one of these — per the community damage-formula guide's own list of
// "every source of MDMG" (base, magic level up, class mastery, nexus, combination damage, spell
// specific damage, subject bonus), Nexus is explicitly named as an ordinary contributor to the
// same additive Magic Damage pool as everything else, just not reflected in the in-game stat
// screen's own AMD readout. See its own mdmgPct contribution in compute() below.
const TITANS_POWER = GAMEDATA.artifacts.find(a => a.name === "Titan's Power") || null;
const NEXUS_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Nexus') || null;
const CONFLUX_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Conflux') || null;

// Arbiter and Heartbreaker are, like Titan/Nexus above, text-only synergies with no structured
// {id,value} effect behind them at all — their whole benefit is a flat late multiplier read
// straight from their description ("Total Magic Damage Multiplier x1.25" / "Critical Multiplier
// x1.25"), so the x1.25 is hardcoded here rather than parsed.
const ARBITER_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Arbiter') || null;
const HEARTBREAKER_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Heartbreaker') || null;
// Monarch (synergy) and Crown (artifact) both scale ATK dynamically off owned-artifact rarity
// counts, described in plain text with no structured effect — parsed via ARTIFACT_RARITY_SCALING_RE
// below rather than hardcoded, since each names its own rarity/verb/amount combination.
const MONARCH_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Monarch') || null;
const CROWN_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Crown') || null;
// Pyramid has a real structured effect (id 102, "Amplify ATK by 3% per activated Synergy") but the
// "per activated Synergy" scaling isn't captured by that value alone, so it's read here and
// multiplied by the live active-synergy count instead of flowing through classifyEffect.
const PYRAMID_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Pyramid') || null;
// Combination Magic Damage only ever boosts Fusion ("Magic Combination") output — confirmed via
// Dominus/Advanced Magic/Dragontongue/Archmage's shared wording — so it's still gated on a real
// Fusion X-multiplier being present on the spell currently being viewed. But per the community
// damage-formula guide's own list of "every source of MDMG" (base, magic level up, class mastery,
// nexus, combination damage, spell specific damage, subject bonus), it's additive with the rest of
// the Magic Damage pool once it applies, not a separate late multiplier on just the Fusion share
// (same category of mistake Nexus had — see NEXUS_ARTIFACT above).
const ADVANCED_MAGIC_PASSIVE = GAMEDATA.passives.find(p => p.name === 'Advanced Magic') || null;
const DRAGONTONGUE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Dragontongue') || null;
const ARCHMAGE_CLASS = GAMEDATA.classes.school.find(c => c.name === 'Archmage') || null;
const DOMINUS_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Dominus') || null;
// Matrix reads off three global "All Magic" pools — Size%, Duration Increase Rate%, and Cooldown
// Reduction Rate% — none of which classifyEffect tracked before (only per-spell/All-Magic Cooldown
// existed, as a display-only stat with no bearing on the damage total). AGI (Synergy) requires
// owning Matrix (confirmed: artifact id 204 is Matrix, the one AGI's own `『##204##』` self-reference
// resolves to) and extends that exact same computed number to ATK and AMP as well, on top of the
// AMD bonus Matrix already grants on its own — not instead of it.
const MATRIX_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Matrix') || null;
const AGI_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'AGI') || null;
// "Additional Damage" is its own distinct multiplicative tag per the confirmed damage formula —
// "each source of additional damage is a separate damage tag" (multiplied together, not summed) —
// separate from the additive Magic Damage pool. Effects conditional on live combat state this
// calculator has no visibility into (enemy HP%, boss waves, kill counts — e.g. Butcher) still stay
// unclassified/'other'. But two conditional SHAPES turned out to be genuinely computable, not
// requiring a live simulation, and are handled below instead of excluded outright:
// - Enemy-HP%-gated (Guillotine/Rose/Ballista/Sniper) and time-survived-gated (Brand): the
//   condition itself still can't be known live, but the bonus IS a well-defined number once the
//   condition holds, so it's shown as a separate "Conditional Modifiers" scenario multiplier on
//   top of the main expected-damage figure, rather than folded into it unconditionally.
// - Non-crit-gated (Siege Hammer): unlike the above, this condition's PROBABILITY is already a
//   build stat this calculator tracks (crit chance) — real hits are crits or non-crits with known
//   odds — so it's folded directly into the expected-damage weighting below, the same way crit
//   chance/crit multiplier already are, rather than treated as an unknowable live condition.
// Robot and Excalibur are flat, always-on, unconditional bonuses with no combat-state trigger in
// their own text at all (Excalibur's own aura applies to "enemies within its range" with no HP/
// crit/timing gate, confirmed against real gameplay), so those feed the main additionalDamageMult
// directly rather than a conditional one.
const ROBOT_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Robot') || null;
const EXCALIBUR_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Excalibur') || null;
// Guillotine/Rose/Ballista (Artifacts) + Sniper (Synergy): all "Deal N% additional Damage to
// enemies whose HP is 75% or above" (effect id 93), the same Additional Damage bucket Robot/
// Excalibur use, just gated on a condition the calculator can't know live. Sniper is confirmed a
// genuine additional +25% on top of its own required artifacts' bonuses (Ballista/Guillotine/Rose
// are 3 of its 4 requirements, each already granting this effect themselves), not restated flavor
// text — verified by checking each requirement's own raw effects directly.
const GUILLOTINE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Guillotine') || null;
const ROSE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Rose') || null;
const BALLISTA_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Ballista') || null;
const SNIPER_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Sniper') || null;
// Brand (Artifact): "Deal 15% Additional Damage to enemies that have survived for more than 5s" —
// same conditional-Additional-Damage shape as the HP%-gated group above, just time-gated instead.
const BRAND_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Brand') || null;
// Jet Engine ("while moving, Amplify ATK by 15%") and War Flag ("Amplify ATK by 2% per second
// standing still, Max Stack 20%") — same live-combat-state-gated shape as the HP%/time-gated group
// above, but an AMP-pool contribution rather than an Additional Damage one, and the two conditions
// are behaviorally mutually exclusive (can't be moving and standing still at once), so each gets
// its own independent "assume max bonus" scenario row rather than being combined into one shared
// ledger. Per the user's own direction: assume full uptime (always moving / always at max stack)
// rather than trying to model actual movement.
const JET_ENGINE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Jet Engine') || null;
const WAR_FLAG_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'War Flag') || null;
// Merlin's Cape ("Amplify ATK by 25% of the current Mana percentage") and Magic Fountain ("Amplify
// ATK by 1% per 200 Mana Orbs held", also with its own stated "Max Stack: 20%") — same bounded,
// AMP-pool, "assume max" shape as Jet Engine/War Flag above (Mana% is inherently capped at 100%,
// so Merlin's Cape's own max is a flat +25%; Magic Fountain's is capped by its own stated 20%).
// Mana Circuit ("+1% per Mana Orb obtained") and Hunter ("+1% per 100 kills") were the other two
// items in this same "current stat -> AMP" family, but have no stated cap at all — nothing to
// assume a "max" of — so per the user's own direction those stay permanently excluded.
const MERLINS_CAPE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === "Merlin's Cape") || null;
const MAGIC_FOUNTAIN_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Magic Fountain') || null;
// Mana Shield ("Decrease Damage Taken by 50% of the current Mana percentage") — same bounded/
// "assume max" shape again, but it's a defensive stat with no damage effect of its own; it only
// becomes damage-relevant through something else that reads the Damage Taken Reduction total, i.e.
// Aegis ("Amplify ATK by 3% per 10% Damage Reduction", see AEGIS_ARTIFACT above). So Mana Shield's
// own scenario recomputes Aegis's contribution with the extra reduction folded in, rather than
// contributing to AMP directly itself — with no such downstream reader owned, it has no measurable
// effect on damage output at all (a real, correctly-modeled no-op, not a gap).
const MANA_SHIELD_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Mana Shield') || null;
// Siege Hammer (Artifact): "Deal 20% Additional Damage if an attack is NOT a Critical Strike" (plus
// its own separate, always-on "+20% Critical Strike Multiplier" line, which already reaches the
// general critMult regex on its own — no special-casing needed for that half). The non-crit
// condition's own probability is already tracked (1 - critChance), so this folds directly into the
// expected-damage weighting rather than becoming a conditional scenario like the group above.
const SIEGE_HAMMER_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Siege Hammer') || null;
// Joker (Artifact): raw extracted text is vague ("50% chance to stack 1 additional multiplier when
// landing a Critical Strike") and the decompiled IL2CPP dump only has a bare state field
// (JokerTriggerVar, no method body) — no way to independently verify the precise mechanic. Modeled
// per the user's own community-sourced description instead: chance = min(50%, critChance / 2) per
// crit to double the BONUS portion of the crit multiplier (critMulti - 200) an additional time,
// not the flat 200% base itself. UNVERIFIED against the actual game logic — flagged as such
// wherever it's surfaced.
const JOKER_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Joker') || null;
// Widowmaker (Artifact): "Increase [Critical Multiplier] by [Critical Rate]" (effect id 149, text
// is null in the raw data — same dead-end pattern as Occult's dynamic Max HP effect) — grants a
// Critical Multiplier bonus equal to the player's own fully-resolved Critical Rate (e.g. 72% crit
// chance -> +72% crit multiplier), on top of its own separate flat +10% Critical Strike Rate (id
// 14, already correctly implemented via the general critChance regex). A derived-from-a-build-stat
// effect, not a live-combat condition, so it's a normal always-resolvable Active Sources entry —
// same category as Occult's Max HP bonus, not the Conditional Modifiers group.
const WIDOWMAKER_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Widowmaker') || null;
// Enemy Max HP reduction — three independently-tracked pools (general/Elite/Large, confirmed via
// raw effect ids 54/143/83), feeding Effective Damage together with Execute thresholds below. The
// general pool's own sources combine multiplicatively with each other (each source's own remaining-
// HP fraction multiplies together, 1-∏(1-r_i/100)), confirmed against a real in-game reading
// (Reaper's Scythe 13% + Curse 6%, no Venom, character sheet read 18.2%, matching this formula
// exactly — plain addition gives 19%, which is what an earlier version of this used to compute).
// Venom (Synergy) then multiplies that already-resolved rate by 1.15 — confirmed the same way
// (18.22% x1.15 = 20.953%). Elite/Large pools stay their own separate additive-within-themselves
// pools regardless of Venom, confirmed against the user's own answer to this feature's original
// design question — only the general pool's own internal combination method changed here.
const VENOM_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Venom') || null;
// Occult: "Increase [Max HP] by the amount of [All Enemies' Max HP Reduction Rate]" — a dynamic,
// self-referential effect (raw effect id 84 has no text template at all, so classifyEffect can
// never resolve it) that grants the PLAYER's own Max HP a bonus equal to the general enemy pool's
// fully-resolved % (including Venom's transform and Occult's own -5% contribution to that same
// pool). Purely additive/derived, not a conversion — the enemy-side reduction stays fully intact.
const OCCULT_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Occult') || null;
// Magic Sword: "[Instakill] an enemy whose HP is lower than 20%" — the one clean, always-on
// Execute-threshold effect in the dataset (Reaper's Scythe/Roster are proc-chance or kill-count
// gated instakills with no HP threshold, so they don't feed Effective Damage the same way — see
// Kanban card e07). Execute thresholds are a percentage of the enemy's CURRENT max HP, so this
// compounds with the reduction pools above rather than acting independently: requiredDamageFraction
// = (1 - reductionFraction) * (1 - executeThresholdFraction), confirmed against the user's own
// worked example (1000 HP enemy, 25% execute, 50% Max HP reduction -> 375 real HP needed).
const MAGIC_SWORD_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Magic Sword') || null;
// Ego Sword (Synergy, requires Magic Sword/Imp/Watcher's Eye/Mana Ore): "The [Execute] threshold
// of [Magic Sword] increases to 〈25%〉" — a text-only synergy (no structured effects array, same
// category as Titan/Nexus/Arbiter/Heartbreaker above) that REPLACES Magic Sword's own 20% rather
// than adding to it, per its own "increases to" (not "increases by") phrasing.
const EGO_SWORD_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Ego Sword') || null;
// Transcendence: "For each Active Spell that reaches Max Level, All Magic Damage increases by
// 15%" — a real, distinct AMD contribution, not just flavor text for Arbiter (the synergy that
// requires owning Transcendence, among others — already implemented as Arbiter's own x1.25 late
// multiplier on the total, which is mathematically identical to multiplying AMD specifically,
// since multiplication commutes). Its own text doesn't match classifyEffect's "Increase All Magic
// Damage by N%" pattern, so it's counted here directly rather than through the generic pipeline.
// Only became meaningfully computable once spell level stopped being an always-max assumption —
// "how many spells are AT max level" was a moot question before that.
const TRANSCENDENCE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Transcendence') || null;
function countActiveSpellsAtMaxLevel() {
  let count = 0;
  for (const [id, ss] of Object.entries(state.spellState)) {
    const spell = GAMEDATA.spells[id];
    if (spell && ss.level > 0 && ss.level === spell.maxLevel) count++;
  }
  return count;
}

// Wizard's Hat: "Increase ATK by 1% per 2% cooldown reduction rate of all spells" — a real stat
// conversion (CDR% -> ATK%), and the one such conversion in the whole dataset that's directly
// computable with zero new infrastructure, since it reads off the same All-Magic-only CDR pool
// already built for Matrix (see allMagicCooldownPct / matrixCDR in compute()).
const WIZARDS_HAT_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Wizard’s Hat') || null;

// Space Warp (Cloaking's evolution): its end-of-duration explosion damage scales 1:1 with Cloaking's
// own total Duration multiplier — confirmed via a real in-game calculation (511,200 damage, 142 ATK,
// Teleport fusion's own 3X, 239% Cloaking Duration): 500 x 142 x 3 x 2.4 = 511,200 exactly (2.4 vs
// the displayed 239%/2.39 is UI rounding). Hallucination's own x1.25 multiplier stacks on top via the
// normal ultimates pipeline (see ultimates.json).
const SPACE_WARP_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Cloaking') || null;
const SPACE_WARP_EVOLUTION = SPACE_WARP_SPELL ? SPACE_WARP_SPELL.evolutions.find(e => e.name === 'Space Warp') || null : null;
// Mirage (Cloaking's OTHER Tier-1 evolution): checked via the same null-text scan as Soul Harvest
// below — its own list of effects has a null-text entry (id -11, value 1), but ALSO a second,
// separate, properly-texted effect ("Increase Cloaking Duration by 80%", id 352) that already
// classifies correctly via the normal durationSpell regex. The null-text entry turned out to be a
// generic "evolution chosen" marker with no numeric meaning of its own (same id/value pattern
// shared with Space Warp's own null-text marker) — NOT a second, separate stat contribution. An
// earlier version of this fix special-cased Mirage's own +80% on top of the already-working one,
// double-counting it; caught by a regression test expecting 170 and getting 250. Lesson: a
// null-text effect on an evolution doesn't necessarily mean something is missing — always check
// every OTHER effect on the same evolution for one that already covers the same ground.
// Soul Harvest (Cloaking's third Tier-1 evolution): "Recover 0.1% HP per enemy killed while in
// Cloaking, and increase Mana Acquisition by 33%" — a single combined effect with no text template,
// same category of loss as Adrenaline's ATK share (one part of a multi-stat line silently dropped
// entirely). The HP recovery half is a non-damage defensive stat, correctly out of scope; the Mana
// Acquisition half feeds Abyss's conversion and was being lost.
const SOUL_HARVEST_EVOLUTION = SPACE_WARP_SPELL ? SPACE_WARP_SPELL.evolutions.find(e => e.name === 'Soul Harvest') || null : null;

// Nuclear Fusion (Satellite's own evolution, required by Hyperion): "Increase Damage Multiplier by
// 1 for each Satellite" — confirmed against a real reported value (Hyperion/Abaddon, 8 Satellites:
// 5 base x 8 x 1.5 [Hyperion's own +50%, see the Damage-Multiplier-phrasing fix in classifyEffect]
// x 3.3 Abaddon ult = 198, matching exactly). Unlike Telekinetic Sword/Plasma Ray's own "+1 per X"
// terms (which use a 1+stacks baseline since their own count can legitimately be 0 in normal play,
// e.g. zero Cooldown Reduction), Satellite's own count is never 0 while viewing its damage (base
// count is always >= 1), so this reads as the count directly, not 1+count — same reasoning applies
// to why 1+8=9 does NOT reproduce 198 but plain 8 does. Applies whenever the evolution itself is
// picked+unlocked, independent of whether Hyperion specifically is also selected — same pattern as
// Space Warp above (an evolution's own text describing its own behavior, not gated on a fusion).
const SATELLITE_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Satellite') || null;
const NUCLEAR_FUSION_EVOLUTION = SATELLITE_SPELL ? SATELLITE_SPELL.evolutions.find(e => e.name === 'Nuclear Fusion') || null : null;

// Photon Explosion (Shield fusion): "[Damage] and [Size] of Shields increase by 33% per Shield" and
// "[Damage] increases in relation to [All Magic Size Increase]" are both pure description text with
// no structured {id,value} effect behind them — same situation as Space Warp above. The per-Shield
// term follows the same shape as Magic Wand/Otherworldly Tentacle (flat % x total spell count); the
// Size-increase term is assumed 1:1 with Shield's own total Size% by direct analogy to Space Warp's
// confirmed 1:1 Duration scaling — this specific ratio for Photon Explosion has no independent
// real-data confirmation the way Space Warp's does.
const PHOTON_EXPLOSION_FUSION = GAMEDATA.fusions.find(f => f.name === 'Photon Explosion') || null;
const SHIELD_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Shield') || null;

// Bishop (Class): "For each active Shield, ATK is Amplified by 10%" — a real per-Shield-count ATK
// amp with no structured effect (pure description text, parsed directly below since it only ever
// appears on this one class in this one phrasing).
const BISHOP_CLASS = GAMEDATA.classes.school.find(c => c.name === 'Bishop') || null;

// Plasma Ray (Arcane Ray fusion): "Arcane Ray Damage Multiplier increases by 1 per count", where
// "count" is the fusion's own ray count — "Arcane Ray is Fixed at 4 [Rays] ...; for each 1-second
// reduction from 4 seconds cooldown, 1 Ray is added". Both the 4-ray/4-second baseline and the
// 1-second step are explicit numbers in the fusion's own description text, not inferred — and the
// resulting 4-7 range matches Quantum Laser's independently-confirmed rayMin/rayMax exactly (see
// ultimates.json's own note: "4 rays -> 144, 7 rays -> 441"). So the ray count is derived directly
// from Arcane Ray's own total Cooldown Reduction (already-tracked per-spell cooldown pool) rather
// than left as a player-set slider.
const PLASMA_RAY_FUSION = GAMEDATA.fusions.find(f => f.name === 'Plasma Ray') || null;
function computePlasmaRayRayCount() {
  if (!ARCANE_RAY_SPELL) return 4;
  const ledger = [];
  for (const { source, effect } of gatherActiveEffects(ARCANE_RAY_SPELL.id)) {
    const c = classifyEffect(effect, 'Arcane Ray');
    if (c.kind === 'cooldown' || c.kind === 'cooldownAll') ledger.push({ source, amount: c.amount });
  }
  const cooldownMult = multiplicativePoolMult(ledger);
  const baseRays = 4, baseCooldown = 4, stepSeconds = 1;
  const actualCooldown = baseCooldown * cooldownMult;
  const raysAdded = Math.max(0, Math.floor((baseCooldown - actualCooldown) / stepSeconds));
  return Math.max(4, Math.min(7, baseRays + raysAdded));
}

// Telekinetic Sword (Spirit fusion): "For every 0.15 seconds reduction in Spirit cooldown, [Damage
// Multiplier] increases by 1" — a real per-hit multiplier (same "Damage Multiplier" terminology
// Plasma Ray uses, confirmed there against real reported ultimate values). Unlike Plasma Ray, this
// doesn't override Spirit's cooldown baseline — Spirit's own real base cooldown (0.9s, from the
// mined data) is what the 0.15s steps are measured against. The fusion's sibling "[Attack Count]
// increases by 1" on the same line is a cast-frequency effect, not a per-hit one, so it's
// deliberately not modeled here (same reasoning as War Climate/Frenzy/Brandish's cooldown-driven
// cast-count effects — this calculator computes per-hit damage, not DPS).
const TELEKINETIC_SWORD_FUSION = GAMEDATA.fusions.find(f => f.name === 'Telekinetic Sword') || null;
function computeTelekineticSwordStacks() {
  if (!SPIRIT_SPELL || !SPIRIT_SPELL.base || SPIRIT_SPELL.base.cooldown == null) return 0;
  const ledger = [];
  for (const { source, effect } of gatherActiveEffects(SPIRIT_SPELL.id)) {
    const c = classifyEffect(effect, 'Spirit');
    if (c.kind === 'cooldown' || c.kind === 'cooldownAll') ledger.push({ source, amount: c.amount });
  }
  const cooldownMult = multiplicativePoolMult(ledger);
  const baseCooldown = SPIRIT_SPELL.base.cooldown;
  const actualCooldown = baseCooldown * cooldownMult;
  const stepSeconds = 0.15;
  return Math.max(0, Math.floor((baseCooldown - actualCooldown) / stepSeconds));
}

// Furnace (Lava Zone fusion): "[Damage] increases in relation to Lava Zone's duration" — assumed 1:1
// with Lava Zone's own total Duration%, by the same analogy-to-Space-Warp reasoning as Photon
// Explosion's Size term above (not independently confirmed for Furnace specifically).
const FURNACE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Furnace') || null;
const LAVA_ZONE_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Lava Zone') || null;

// Gate (Flash Shock fusion): "Flash Shock Size Increase is converted into Damage" — same shape and
// same 1:1 assumption as Furnace above, just Size instead of Duration. Confirmed a real, previously
// entirely-unimplemented gap (found via a direct user question, not the earlier systematic audits):
// this fusion had zero special-casing anywhere in this file despite the mechanic being real text in
// the raw data, and — unlike Photon Explosion's Shield case — Flash Shock has real, always-present
// spell-specific Size sources feeding it (its own level-up grants alone are +30% by max level,
// before any Wipeout/Exidium/Satan's Nails picks), so this wasn't a dormant, never-triggered gap.
const GATE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Gate') || null;

// UNVERIFIED, HELD PENDING REVIEW — the six fusions/evolutions below (Ghastly Rampage, Prism Spray,
// Great Rift, Black Death, Genocide, High Output) plus Hyperion's own additional Size term were all
// found via the same "[stat] is converted into/increases proportionally to Damage" text search that
// caught Gate, going well beyond the 4 fusions (Space Warp/Furnace/Photon Explosion/Gate) already
// implemented. Every one of them: (1) has zero special-casing anywhere in this file today, confirmed
// by grep; (2) assumes the same unconfirmed 1:1 ratio Gate/Furnace/Photon Explosion already carry;
// and (3) — per explicit user direction — is being implemented as its own separate multiplicative
// xMultTotal factor (matching Space Warp's real-value-confirmed precedent for this whole mechanic
// family), NOT folded into the additive Magic Damage pool, but that bucketing choice is ALSO still
// pending outside confirmation (the user is asking the community directly whether these convert into
// AMD or their own bucket) — do not treat either the ratio or the bucket as settled. Not yet
// committed/pushed for the same reason. Three other candidates from the same search (Origin
// Explosion, Black Hole, Age of the Sun) were deliberately NOT implemented here — see their own
// notes near GATE_FUSION's compute() block for why each is structurally more uncertain than a
// simple single-stat 1:1 conversion.
const GHASTLY_RAMPAGE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Ghastly Rampage') || null;
const PRISM_SPRAY_FUSION = GAMEDATA.fusions.find(f => f.name === 'Prism Spray') || null;
const GREAT_RIFT_FUSION = GAMEDATA.fusions.find(f => f.name === 'Great Rift') || null;
const BLACK_DEATH_FUSION = GAMEDATA.fusions.find(f => f.name === 'Black Death') || null;
const GENOCIDE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Genocide') || null;
const HYPERION_FUSION = GAMEDATA.fusions.find(f => f.name === 'Hyperion') || null;
const ELECTRIC_SHOCK_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Electric Shock') || null;
const HIGH_OUTPUT_EVOLUTION = ELECTRIC_SHOCK_SPELL ? ELECTRIC_SHOCK_SPELL.evolutions.find(e => e.name === 'High Output') || null : null;
// Black Hole: unlike the items above, its own text states an explicit 3X conversion ratio ("Cyclone
// [Duration Increase] is {converted} into [Damage] 〈3X〉") rather than leaving it to be assumed —
// more trustworthy than the 1:1-by-analogy items, not less. Its own separate "Count increases Damage
// Multiplier by 3" line is a different, count-based mechanic, deliberately not implemented here (same
// treatment as Black Death/Genocide's own excluded second lines).
const BLACK_HOLE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Black Hole') || null;

// Super Cyclone (Cyclone fusion): "[Damage Multiplier] increases in relation to how long Cyclones
// persist" — unlike every other fusion in the dataset, it has no flat "Increase X Damage by NX"
// effect of its own at all; this elapsed-time scaling is its entire damage bonus. Its two other
// structured effects (ids 407, 1112) have no text template anywhere in the extracted string
// tables — not just unresolved here, genuinely absent from the mined data — so the actual rate
// can't be determined. The number this calculator shows is therefore just the spawn/initial
// damage (no fabricated multiplier); see the UI note wired to SUPER_CYCLONE_FUSION for the
// player-facing caveat.
const SUPER_CYCLONE_FUSION = GAMEDATA.fusions.find(f => f.name === 'Super Cyclone') || null;

// Inferno (Incineration fusion): "increases Max Multiplier" up to "Damage X30, Size X2" — same
// situation as Super Cyclone above, a stacking-over-time mechanic with a known cap but no stated
// ramp rate anywhere in the mined data. Checked further than Super Cyclone was: Lava Zone's own
// "Melt" evolution has the identical "Max Multiplier" mechanic and states its ramp rate directly in
// text ("5% per hit... Max Multiplier: 30%"), confirming this game does sometimes give the rate in
// the extracted text when it has one — Incineration's own "Flamestrike" evolution and Inferno's own
// fusion text never do, and neither the decompiled code nor the internal function-name mappings
// available in this project contain the actual per-spell cast/tick logic that would reveal it. So
// this is a genuine data gap, not an unread column — the number shown is the initial/unstacked
// damage (no fabricated ramp), same treatment as Super Cyclone.
const INFERNO_FUSION = GAMEDATA.fusions.find(f => f.name === 'Inferno') || null;

// ===================== Stat-conversion relics (Oculus/Carnival/Gaia/Abyss/Accelerator/Aegis/
// Akashic Record/Magic Wand/Otherworldly Tentacle) =====================
// Each of these reads from one of the additive/multiplicative stat pools built in compute() below
// (Item Pickup Range%, Evasion%, Max HP, Mana Acquisition%, Movement Speed%, Damage Reduction%) and
// converts it into a damage-relevant stat. Per the confirmed aggregation rules: "bonus from a stat"
// conversions (Oculus/Carnival/Gaia/Aegis) read the pool without depleting it; Abyss is a true
// conversion that removes half of Mana Acquisition Rate% and grants the equivalent as ATK% (though
// since nothing else downstream of manaAcquisitionPct exists in this damage calculator, "depleting"
// has no other observable effect here beyond the ATK% it grants).
const OCULUS_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Oculus') || null;
const CARNIVAL_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Carnival') || null;
const GAIA_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Gaia') || null;
const ABYSS_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Abyss') || null;
const ACCELERATOR_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Accelerator') || null;
const AEGIS_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Aegis') || null;
const AKASHIC_RECORD_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Akashic Record') || null;
// Magic Wand / Otherworldly Tentacle: "+10%/+8% Damage per Spirit/Arcane Ray" — read as a spell-
// specific Magic Damage% bonus (only applies while viewing that exact spell, same scoping as
// Robot's Electric-Zone-only Additional Damage), scaled by that spell's own total computed
// projectile count (base `number` from base_spell_stats.json + every active "Increase the number
// of [Spell]s by N" bonus, including the relic's own contribution — e.g. Magic Wand's own "+2
// Spirits"), not the live on-screen count.
const MAGIC_WAND_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Magic Wand') || null;
const OTHERWORLDLY_TENTACLE_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Otherworldly Tentacle') || null;
const SPIRIT_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Spirit') || null;
const ARCANE_RAY_SPELL = Object.values(GAMEDATA.spells).find(s => s.name === 'Arcane Ray') || null;
// Total computed projectile count for a spell: its own base `number` plus every active count/countx
// bonus that targets it by name — including that spell's OWN level-up/evolution grants (e.g.
// Spirit's own Lv3 "+1 Spirit" and its Magic Missile evolution's "+1 Spirit"), which only surface
// by re-running gatherActiveEffects() scoped to THAT spell's id, independent of whichever spell is
// currently being viewed in the UI (gatherActiveEffects defaults to the selected spell otherwise).
function computeSpellTotalCount(spell) {
  if (!spell || !spell.base || spell.base.number == null) return 0;
  let count = spell.base.number;
  for (const { effect } of gatherActiveEffects(spell.id)) {
    const c = classifyEffect(effect, spell.name);
    if (c.kind === 'count') count += c.amount;
    // countPct/countx scale off the spell's own base count (confirmed: percentage-of-base, not a
    // literal flat add — see classifyEffect's numMatch comment). Rounded per-source so it combines
    // cleanly with flat integer sources via simple addition, same as a real in-game projectile count.
    else if (c.kind === 'countPct') count += Math.round(spell.base.number * c.amount / 100);
    else if (c.kind === 'countx') count += Math.round(spell.base.number * c.amount);
  }
  return count;
}

// Deus Ex Machina has no evolution requirements of its own — in-game it instead needs Overmind
// plus any one other fusion already active, becoming your 3rd combination slot.
function isDeusExMachinaAvailable() {
  if (!OVERMIND_FUSION || !DEM_FUSION) return false;
  if (!state.fusionIds.includes(OVERMIND_FUSION.id)) return false;
  return state.fusionIds.some(id => id !== OVERMIND_FUSION.id && id !== DEM_FUSION.id);
}

// Three mutually exclusive Magic Circle paths: {Overmind, DEM} (DEM's own prerequisite is Overmind,
// so they stack with each other), Perpetual Engine alone, and Gate of Creation alone. Picking from
// one path clears whichever fusions belong to the other two paths, but never clears a fusion within
// the same path.
function selectMagicCircleFusion(fusionId, checked) {
  if (!checked) { state.fusionIds = state.fusionIds.filter(id => id !== fusionId); return; }
  const sameFusionPath = fusionId === OVERMIND_FUSION?.id || fusionId === DEM_FUSION?.id
    ? [OVERMIND_FUSION?.id, DEM_FUSION?.id]
    : [fusionId];
  state.fusionIds = state.fusionIds.filter(id => !MAGIC_CIRCLE_FUSIONS.some(f => f.id === id) || sameFusionPath.includes(id));
  state.fusionIds.push(fusionId);
}

// ===================== Bonus pool (artifacts + passives + special passives + research) =====================
// Normal Passives unlock a *second*, separate progression tier after hitting their normal Max
// Level — a reduced per-level value on the same stat (e.g. Intelligence: +10%/level ATK normally,
// then +3%/level after max). These are built as their own selectable pool here, distinct from the
// normal-tier version of the same passive. Unlike the normal tier (non-uniform, 2-5 per passive),
// the post-max cap is uniform across all of them at 7 (a "Genius" synergy extends it by +10).
const POST_MAX_LEVEL_CAP = 7;
const PASSIVES_POST_MAX = GAMEDATA.passives.filter(p => p.postMaxEffect).map(p => ({
  id: p.id, name: p.name, maxLevel: POST_MAX_LEVEL_CAP,
  description: [p.postMaxEffect.text || (p.name + ' (post-max tier)')],
  effects: [p.postMaxEffect],
}));

// Enchant (Passive, max level 3): each owned level is one dropdown letting the player pick a Spell
// to receive Enchant's own +50% Damage plus that Spell's own unique secondary effect (Cooldown or
// Size, varies per spell — see each spell's own `enchant` field in gamedata.json, sourced from raw
// slots 8-9 of its own encyclopedia row, previously undiscovered/unused — see build_gamedata.js).
// Its own raw effects array is empty (all real behavior is spell-specific and hand-applied in
// gatherActiveEffects below, gated on state.enchantSpellIds), so it's inert via the normal
// classifyEffect flow-through — only present in BONUS_POOL so it appears in the normal Passives
// picker UI, per request, with leveling working exactly like any other Passive.
const ENCHANT_ITEM = GAMEDATA.enchants.find(e => e.name === 'Enchant') || null;
// Fairy (Artifact): "{Enchant} effect becomes 2X" — doubles both Enchant's own +50% Damage and
// each spell's unique secondary effect value, for every enchanted spell.
const FAIRY_ARTIFACT = GAMEDATA.artifacts.find(a => a.name === 'Fairy') || null;

const BONUS_POOL = [
  ...GAMEDATA.artifacts.map(x => ({ ...x, category: 'Artifact' })),
  ...GAMEDATA.passives.map(x => ({ ...x, category: 'Passive' })),
  ...(ENCHANT_ITEM ? [{ ...ENCHANT_ITEM, category: 'Passive' }] : []),
  ...PASSIVES_POST_MAX.map(x => ({ ...x, category: 'Passive (Post-Max)' })),
  ...GAMEDATA.specialPassives.map(x => ({ ...x, category: 'Special Passive' })),
  ...GAMEDATA.research.map(x => ({ ...x, category: 'Research' })),
];
function bonusKey(item) { return item.category + ':' + item.id; }
// The internal category string stays 'Artifact' (it's baked into bonusKey, which is persisted in
// saved builds — renaming it would silently drop everyone's already-picked Relics) but the game's
// own text uses "Artifact" to mean something else entirely (a cooldown-bearing effect gained from a
// relic, e.g. Cogwheel's "Decrease All Artifact Cooldown"), so the calculator's own UI now calls
// this category "Relic" everywhere it's shown to the user, via this display-only mapping.
function categoryLabel(category) { return category === 'Artifact' ? 'Relic' : category; }

// ===================== Fusion slot cap =====================
// Base 3 combination slots. Domain of Power (artifact) grants +1. Gate of Creation counts as one
// of your active fusions (already true just by being in fusionIds) but nets the cap +1 overall.
function ownsArtifactByName(name) {
  const art = GAMEDATA.artifacts.find(a => a.name === name);
  if (!art) return false;
  return !!state.bonusSelections[bonusKey({ ...art, category: 'Artifact' })];
}
function ownsSpecialPassiveByName(name) {
  const sp = GAMEDATA.specialPassives.find(p => p.name === name);
  if (!sp) return false;
  return !!state.bonusSelections[bonusKey({ ...sp, category: 'Special Passive' })];
}
// Two separate sources each extend every Normal Passive's max level (and current level) by 1, and
// stack with each other: Cube (Artifact, "[Normal Passive Magic]" Level and Max Level +1") and
// Taoist (Special Passive, "[Additional Passive] spell levels +1" — same target pool, just the
// game's own alternate phrasing for the regular/Normal Passive tier, not Special Passives or the
// Post-Max continuation tier, neither of which any other text ever calls "Additional Passive").
function normalPassiveMaxLevelBonus() {
  let bonus = 0;
  if (ownsArtifactByName('Cube')) bonus += 1;
  if (ownsSpecialPassiveByName('Taoist')) bonus += 1;
  return bonus;
}
function fusionSlotCap() {
  let cap = 3;
  if (ownsArtifactByName('Domain of Power')) cap += 1;
  if (GATE_OF_CREATION_FUSION && state.fusionIds.includes(GATE_OF_CREATION_FUSION.id)) cap += 1;
  return cap;
}

// How many copies of Artifacts of a given rarity are currently owned (selected) — feeds Monarch and
// Crown's per-rarity ATK scaling below.
function ownedArtifactRarityCount(rarity) {
  let n = 0;
  for (const [key, count] of Object.entries(state.bonusSelections)) {
    if (!count || !key.startsWith('Artifact:')) continue;
    const id = parseInt(key.slice('Artifact:'.length), 10);
    const art = GAMEDATA.artifacts.find(a => a.id === id);
    if (art && art.rarity === rarity) n += count;
  }
  return n;
}
// Matches Monarch's "Increase [ATK] by 〈1%〉 per owned [Common] Artifact" and Crown's "{Amplify}
// [ATK] by 〈1%〉 for each [Epic] Artifact owned" — both are plain-text, per-rarity ATK scaling with
// no structured effect carrying the full formula, so this parses directly from description text.
// "Increase ATK" and "Amplify ATK" are genuinely different buckets elsewhere in this file (see
// classifyEffect), so the matched verb routes the result to atk vs amp accordingly.
const ARTIFACT_RARITY_SCALING_RE = /\{?(Amplify|Increase)\}? \[ATK\] by 〈([\d.]+)%〉 (?:per owned|for each) \[(\w+)\] Artifact(?: owned)?/g;
function artifactRarityScalingContribution(item) {
  const text = item.description.join(' ');
  let atk = 0, amp = 0;
  for (const m of text.matchAll(ARTIFACT_RARITY_SCALING_RE)) {
    const verb = m[1], perPct = parseFloat(m[2]), rarity = m[3];
    const total = perPct * ownedArtifactRarityCount(rarity);
    if (verb === 'Amplify') amp += total; else atk += total;
  }
  return { atk, amp };
}

// ===================== Damage-effect classification =====================
const ATK_PERCENT_ID = 4;
const AMP_PERCENT_ID = 16;
const ALL_MAGIC_DMG_ID = 17;
const CRIT_RATE_ID = 14;
const CRIT_MULT_ID = 15;

// The raw mined text wraps words in CJK-style emphasis brackets (〔〕『』《》〈〉【】{}) that read as
// garbled placeholder noise in an English UI — the stat colors now carry that emphasis instead, so
// they're stripped here. The one bracket pair that's an actual unresolved placeholder rather than
// decoration is 『##id##』, the game's self-reference syntax for interpolating a required artifact's
// own name into a synergy's tooltip (e.g. Ego Sword: "The Execute threshold of 『##74##』
// increases..." — 74 being Magic Sword's artifact id) — resolved to the real name first.
function resolveDisplayText(text) {
  if (!text) return text;
  text = text.replace(/『##(\d+)##』/g, (_, id) => {
    const art = GAMEDATA.artifacts.find(a => a.id === parseInt(id, 10));
    return art ? art.name : '';
  });
  // Confirmed dataset-wide (165 unique bracket-wrapped terms) that plain [] is used exactly like
  // {} and 〈〉 already stripped here — a pure "highlight this term" wrapper around stat/keyword
  // names, never literal syntax — so it gets the same treatment, not left in as stray punctuation.
  text = text.replace(/[〔〕『』《》〈〉【】{}\[\]]/g, '');
  // "@" is the raw data's own separator between two originally-distinct clauses bundled into one
  // field (seen in class descriptions and ultimate descriptions alike) — reads as a stray
  // punctuation artifact otherwise. A comma already immediately before it means the two clauses
  // were meant to continue as one sentence; anything else means they were two separate sentences.
  text = text.replace(/,\s*@\s*/g, ', ').replace(/\s*@\s*/g, '. ');
  return text;
}

// Classes/Test Subjects level up independently in-game (currency-purchased) and unlock their
// listed bonus lines progressively — description line 1 (always a compound "X Lv+1 @ ...per
// character-level" flavor line) and line 2 both unlock at level 1, then each subsequent line
// unlocks one level later (School classes have 4 levels total).
// The source data doesn't label which description line a given structured effect belongs to, so
// this finds it by checking which line's resolved text contains the effect's own resolved text —
// same matching approach already used for evolutions (describeLineNode).
function classMaxLevel(cls) {
  return Math.max(1, cls.description.length - 1);
}
function classEffectUnlockLevel(cls, effect) {
  const resolvedEffect = resolveDisplayText(effect.text || '');
  if (!resolvedEffect) return 1;
  for (let i = 0; i < cls.description.length; i++) {
    if (resolveDisplayText(cls.description[i]).includes(resolvedEffect)) return Math.max(1, i);
  }
  return 1; // no matching line found — default to available from level 1 rather than over-restrict
}
// A few classes' decoded effects include what look like duplicate/near-duplicate entries (the same
// underlying bonus captured twice under different effect ids, or multiple tiered-text variants) —
// a pre-existing data-extraction quirk, not something level-gating should compound. Deduping by
// resolved text keeps this from double-applying the same line twice.
// No text-based deduping here — that was tried and reverted. It looked reasonable for Bishop's
// literal duplicate ("Increase the maximum number of Shields by 1" appearing under two different
// effect ids), but it also silently collapsed Wizard's two textually-identical-after-cleanup but
// genuinely separate "Magic Bolt Lv+1" grants down to one, hiding a real bonus that's actually two
// active lines at level 1. Since neither case maps to a tracked damage/stat bucket anyway (both
// fall through classifyEffect to 'other'), the safer default is to show everything the data
// actually contains rather than guess which same-text pairs are "real" duplicates.
function unlockedClassEffects(cls, level) {
  return cls.effects.filter(eff => classEffectUnlockLevel(cls, eff) <= level);
}

// Every School class's final (max-level) bonus is tagged "(All Classes)" — confirmed unique, one
// per class, always at that class's own max level, across all 24. It applies permanently once
// that class is maxed, regardless of whether it's your currently active class, so it's tracked
// separately (state.maxedClassIds) rather than through the active class's own level-gated list —
// which must exclude it to avoid double-counting when the active class also happens to be maxed.
function isAllClassesEffect(eff) {
  return /\(All Classes\)/.test(eff.text || '');
}
function classAllClassesEffect(cls) {
  return cls.effects.find(isAllClassesEffect) || null;
}

// A per-character-level scaling bonus (e.g. Wizard: "Every time the character gains 5 levels,
// Magic Bolt Damage 3% is added") has no structured {id,value} effect behind it anywhere in the
// extracted data — it's pure description text — so it's parsed directly from the class's own
// description line 1, which always carries this sentence (joined with the "X Lv+1" marker via
// "@") when the class has it at all. Confirmed present, in this same phrasing, on 19 of 24 School
// classes; the exceptions are ones with a different mechanic entirely (Bishop's per-Shield ATK
// amp, Archaeologist's treasure chests, Magician/Black Mage's proc-chance effects, Archmage's flat
// Combination Magic bonus) — those simply don't match and correctly get no scaling bonus here.
// No School class has this on a line other than description[0], so unlock-level gating doesn't
// apply — it's available as soon as the class itself is selected, same as the rest of line 1.
const CLASS_LEVEL_SCALING_RE = /Every time the character gains \[(\d+)\] levels?, (.+?) Damage.*?〈([\d.]+)%〉/;
function classLevelScalingEffect(cls, playerLevel) {
  const m = (cls.description[0] || '').match(CLASS_LEVEL_SCALING_RE);
  if (!m) return null;
  const perLevels = parseInt(m[1], 10);
  const target = m[2].trim();
  const pctPerStep = parseFloat(m[3]);
  const steps = Math.floor(Math.max(0, playerLevel) / perLevels);
  if (steps <= 0) return null;
  const amount = Math.round(steps * pctPerStep * 100) / 100;
  return { id: null, value: amount, target, text: 'Increase ' + target + ' Damage by ' + amount + '%' };
}

// Maps an effect to the stat-color class it should render in, matching the in-game character
// stat screen's color-coding (see --stat-* custom properties). Delegates entirely to
// classifyEffect() itself (called without a spellName, since card descriptions aren't tied to any
// one currently-viewed spell) so the color always agrees with how the effect actually gets bucketed
// in the real damage math — no separate, potentially-drifting classification logic.
function effectStatColorClass(effect) {
  if (!effect || !effect.text) return null;
  // Combination Magic Damage (Advanced Magic, Dragontongue, Archmage, Dominus — see their dedicated
  // handling in compute()) IS counted, conditionally: it's folded straight into the same additive
  // mdmgPct pool every other Magic Damage source uses, once a Fusion's own multiplier is active to
  // apply it to. Active Sources deliberately shows these with the standard AMD tag/color instead of
  // a separate one for exactly that reason ("the underlying math was already correctly bucketed" —
  // see its own comment in compute()) — this used to disagree by still special-casing a separate
  // purple color here, which read as two different UI locations disagreeing about the same fact.
  if (/Combination Magic Damage/i.test(effect.text)) return 'stat-amd';
  // Called without a specific spell name, so any "X spell's Damage" match (whether or not it
  // happens to be "the current spell") falls into other_spell_dmg(_x) rather than mdmg/xmult —
  // still a damage boost, so it still gets the AMD color.
  const c = classifyEffect(effect, null);
  if (c.kind === 'atk') return 'stat-atk';
  if (c.kind === 'amp') return 'stat-amp';
  // mdmg/other_spell_dmg are both "+N% Damage" — additive with every other source in the same pool,
  // one multiply at the end (stat-amd). xmult/other_spell_dmg_x are literal "NX" effects — each its
  // own separate multiplicative factor, not summed with the additive pool at all (stat-xmult).
  // Conflating these two under one color was itself the thing the user caught with Deus Ex Machina.
  if (['mdmg', 'other_spell_dmg'].includes(c.kind)) return 'stat-amd';
  if (['xmult', 'other_spell_dmg_x'].includes(c.kind)) return 'stat-xmult';
  if (c.kind === 'critChance' || c.kind === 'critMult') return 'stat-crit';
  return null;
}

// For description text with no structured {id,value} effect behind it at all (synergies like
// Arbiter, AGI, Heartbreaker, Monarch) — the sentence still names a stat bucket explicitly by
// word, so those specific words/phrases get colored even though there's nothing to run through
// classifyEffect(). Display-only, same as the Combination Magic Damage check above — none of
// these are being counted in the damage total. Order matters: longer/more specific phrases are
// checked first so they aren't partially swallowed by a shorter, broader pattern later in the list.
const TEXT_STAT_KEYWORDS = [
  // "ATK"+"Amplif*" co-occurring is a compound idiom meaning the AMP bucket alone (see
  // classifyEffect's own `/^Amplify ATK by [\d.]+%/` -> kind 'amp' rule) — checked first, ahead of
  // the standalone Amplif.../ATK patterns below, so the whole phrase resolves as ONE amp-colored
  // match instead of two independently-colored words implying two separate contributions (AMP and
  // ATK) when it's mechanically one (AMP only) — confirmed misleading by the user, twice: first for
  // "Amplify ATK" (Overmind), then again for the reversed "ATK is Amplified" (Jet Engine, Akashic
  // Record) and bare "ATK Amplify" (Dragon's Heart) — real phrasings a single fixed word order
  // missed entirely. Two patterns cover all three confirmed real orderings dataset-wide (checked
  // directly): "Amplify ATK..." and "ATK (is) Amplif...". Doesn't fire on AGI's own "ATK is
  // Increased & Amplified..." (a real compound of TWO separate effects, not one idiom) since
  // "Amplif" isn't immediately adjacent to "ATK is" there — correctly left to color as two words.
  [/Amplify ATK/gi, 'stat-amp'],
  [/\bATK\s+(?:is\s+)?Amplif\w*/gi, 'stat-amp'],
  // Was narrowed to the literal phrase "Total Magic Damage Multiplier" (Arbiter's own wording),
  // and colored the same as the additive Magic Damage pool (stat-amd) — missed every other real
  // phrasing of this concept ("All Magic Damage Multiplier" on Deus Ex Machina, bare "Damage
  // Multiplier" on Telekinetic Sword/Plasma Ray/Genocide/etc.), and conflated a mechanically
  // different bucket: every one of these (Arbiter included) is a genuinely separate multiplicative
  // factor, not additive with the Magic Damage pool at all — same distinction effectStatColorClass
  // draws between mdmg and xmult — so this now gets its own color (stat-xmult) instead of sharing
  // AMD's. "Damage Multiplier" alone is a strict text superset of the old narrower phrase.
  [/Damage Multiplier/gi, 'stat-xmult'],
  // Matches effectStatColorClass's own change — Combination Magic Damage is a conditional
  // contributor to the same additive pool as regular Magic Damage, not a separate bucket, so it
  // gets stat-amd rather than a dedicated purple that no longer means anything real.
  [/Combination Magic Damage/gi, 'stat-amd'],
  // Bare "(All) Magic Damage" (Transcendence, Matrix, several class per-level bonuses) had no
  // pattern at all — only the Combination/Multiplier variants above did. Negative lookahead so it
  // yields to "Damage Multiplier" above rather than fighting it for the shared word "Damage" (e.g.
  // Deus Ex Machina's "All Magic Damage Multiplier" must stay xmult-colored as one phrase, not
  // partially reclaimed as amd via an earlier-starting "Magic Damage" match).
  [/Magic Damage(?!\s+Multiplier)/gi, 'stat-amd'],
  [/Critical (?:Strike )?(?:Rate|Multiplier)/gi, 'stat-crit'],
  [/Amplif(?:y|ied|ication)/gi, 'stat-amp'],
  [/\bATK\b/gi, 'stat-atk'],
];
function highlightStatKeywords(text) {
  const matches = [];
  for (const [re, cls] of TEXT_STAT_KEYWORDS) {
    for (const m of text.matchAll(re)) matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], cls });
  }
  matches.sort((a, b) => a.start - b.start);
  const kept = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) { kept.push(m); lastEnd = m.end; }
  }
  if (!kept.length) return [text];
  const nodes = [];
  let pos = 0;
  for (const m of kept) {
    if (m.start > pos) nodes.push(text.slice(pos, m.start));
    nodes.push(el('span', { class: m.cls }, m.text));
    pos = m.end;
  }
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}
// Builds a single effect's display text as a DOM node (or plain string, which el() accepts as a
// text-node child directly), colored by effectStatColorClass and with placeholders resolved.
function effectNode(effect) {
  const resolved = resolveDisplayText(effect.text);
  const cls = effectStatColorClass(effect);
  if (cls) return el('span', { class: cls }, resolved);
  // effectStatColorClass only colors what classifyEffect can fully parse for MATH purposes — a real
  // trailing qualifier (Aegis: "Amplify ATK by 3% for every 10% Damage Reduction", Jet Engine:
  // "...for every second the character stays in place") breaks that strict regex even though the
  // text clearly names a colorable stat. Same keyword fallback describeLineNode already gives
  // text-only synergies with no effects array at all — effectNode just never had it for structured
  // effects whose own classification came up empty. May return an array (see cardDescriptionNodes'
  // own caller, which spreads it) rather than a single node/string.
  return highlightStatKeywords(resolved);
}
// For text that's just a raw description line (no single effect object behind it, e.g. an
// evolution's flavor-text line) — colors it if its resolved text exactly matches one of the
// item's own structured effects, otherwise renders it plain.
function describeLineNode(line, effects) {
  const resolved = resolveDisplayText(line);
  const match = (effects || []).find(e => e.text && resolveDisplayText(e.text) === resolved);
  const cls = match ? effectStatColorClass(match) : null;
  if (cls) return el('span', { class: cls }, resolved);
  // No exact structured-effect match — text-only synergies (Titan, Nexus, Arbiter, Heartbreaker,
  // Monarch, AGI) have no `effects` array at all, so this is the only path that ever colors their
  // descriptions. Falls back to per-keyword highlighting instead of leaving the whole line plain.
  return highlightStatKeywords(resolved);
}
// Joins a description array into display nodes, coloring each line via describeLineNode. Each line
// can come back as either a single node/string (exact effect match) or an array of nodes/strings
// (keyword-highlighted fallback) — spread rather than pushed, so el()'s children list stays flat.
function descriptionNodes(description, effects) {
  const nodes = [];
  description.forEach((line, i) => {
    if (i > 0) nodes.push(' — ');
    const lineNodes = describeLineNode(line, effects);
    if (Array.isArray(lineNodes)) nodes.push(...lineNodes);
    else nodes.push(lineNodes);
  });
  return nodes;
}

// Some stat pools (Cooldown Reduction, Damage Reduction) combine multiplicatively across unique
// SOURCES, not additively — a -20% source and a -5% source multiply the base by 0.8 x 0.95, not
// -25% flat. Multiple levels of the SAME source still sum together first (e.g. four +5% levels of
// one passive = one +20% source, not four separate 0.95 factors) — already guaranteed here because
// every source only ever contributes one ledger entry per item (see the leveled-Passive ledger
// aggregation fix), so grouping by the existing `source` label is sufficient with no extra dedup.
// Entries carry a signed `amount` (a "-20" entry is a real reduction, a "+10" a real increase, e.g.
// Overmind's own cooldown penalty) — each becomes its own (1 + amount/100) factor, multiplied
// together; the returned value is a plain multiplier (0.76 = a net 24% reduction), not a percent.
function multiplicativePoolMult(entries) {
  const bySource = new Map();
  for (const { source, amount } of entries) bySource.set(source, (bySource.get(source) || 0) + amount);
  let mult = 1;
  for (const total of bySource.values()) mult *= (1 + total / 100);
  return mult;
}

function classifyEffect(effect, spellName) {
  if (!effect || !effect.text) return { kind: 'other' };
  const text = effect.text;

  // Text is checked before the numeric effect id — this game's data reuses the same id across
  // genuinely different stat meanings depending on the item (id 4, for example, shows up on
  // effects whose actual text is "Increase ATK", "Amplify ATK", AND "Increase All Magic Damage" in
  // different places), so the id alone isn't a reliable classifier. These three phrasings are
  // textually unambiguous, so they're matched explicitly first, ahead of the id-based fallback.
  if (/^Amplify ATK by [\d.]+%/.test(text)) return { kind: 'amp', amount: effect.value };
  if (/^(Increase|Decrease) All Magic Damage by [\d.]+%/.test(text)) {
    return { kind: 'mdmg', amount: /^Decrease/.test(text) ? -Math.abs(effect.value) : Math.abs(effect.value) };
  }
  if (/^Increase ATK by [\d.]+%/.test(text)) return { kind: 'atk', amount: effect.value };
  // Adrenaline's own combined summary line ("Increase ATK, Critical Strike Rate, Movement Speed by
  // 5%") names all three stats at once with one shared value, but only Crit Rate/Movement Speed
  // also exist as their own separate, individually-formatted effect entries — this combined text
  // never matches the ATK-alone pattern above, so its ATK share was silently dropped entirely.
  // Extracting just the ATK portion here doesn't double-count Crit Rate/Movement Speed, since those
  // are still classified normally via their own separate entries.
  if (/^Increase ATK,.*by [\d.]+%/.test(text)) return { kind: 'atk', amount: effect.value };
  // Crit is matched by text only, never by id — id 15 (which "Critical Strike Multiplier" usually
  // carries) is also reused for an unrelated execute-threshold effect and a non-crit-damage bonus
  // on other items, so id alone isn't trustworthy here at all (unlike ATK/AMP/AMD, which have an
  // id fallback for edge cases).
  if (/^Increase Critical Strike Rate by [\d.]+%/.test(text)) return { kind: 'critChance', amount: effect.value };
  if (/^Increase Critical Strike Multiplier by [\d.]+%/.test(text)) return { kind: 'critMult', amount: effect.value };
  // Spell-specific Critical Rate — e.g. Shuriken's "Increase Magic Bolt Critical Rate by 15%" /
  // "Increase Spirit Critical Rate by 15%". Confirmed dataset-wide to be the only item using this
  // phrasing (every other Critical Rate source is the general, spell-agnostic form above). Same
  // dual-tracking shape as 'cooldown'/'cooldownAll' and per-spell mdmg — only counts while viewing
  // the exact spell named, on top of the general critChance pool, not instead of it.
  const critRateSpellMatch = text.match(/^Increase (.+?) Critical Rate by ([\d.]+)%/);
  if (critRateSpellMatch) {
    const [, target, amt] = critRateSpellMatch;
    if (target === spellName) return { kind: 'critChance', amount: parseFloat(amt), target };
    return { kind: 'other', label: text };
  }
  // Fallback to id for effects whose text doesn't match one of the phrasings above — e.g. a
  // combined "Increase ATK, Critical Strike Rate, Movement Speed by N%" buff (only captured here
  // as an ATK contribution; the crit-rate and movement-speed portions of that one effect aren't
  // modeled, same limitation as movement speed generally not being tracked).
  if (effect.id === ATK_PERCENT_ID) return { kind: 'atk', amount: effect.value };
  if (effect.id === AMP_PERCENT_ID) return { kind: 'amp', amount: effect.value };

  // e.g. "Increase Magic Bolt Damage by 50%" / "Decrease Magic Bolt Damage by 25%" — the optional
  // " Multiplier" handles Hyperion's own oddly-worded "Increase Satellite Damage Multiplier by
  // 50%" (confirmed dataset-wide to be the only place this exact phrasing occurs), which otherwise
  // silently fell through to 'other' and got dropped entirely.
  const pctMatch = text.match(/^(Increase|Decrease) (.+?) Damage(?: Multiplier)? by ([\d.]+)%/);
  if (pctMatch) {
    const [, dir, target, amt] = pctMatch;
    const sign = dir === 'Increase' ? 1 : -1;
    if (effect.id === ALL_MAGIC_DMG_ID || target === spellName || target === 'All Magic') {
      return { kind: 'mdmg', amount: sign * parseFloat(amt), target };
    }
    return { kind: 'other_spell_dmg', amount: sign * parseFloat(amt), target };
  }
  // e.g. "Increase Thunderstorm Damage by 5X"
  const xMatch = text.match(/^(Increase|Decrease) (.+?) Damage by ([\d.]+)X/i);
  if (xMatch) {
    const [, dir, target, amt] = xMatch;
    if (target === spellName) {
      return { kind: 'xmult', amount: parseFloat(amt), dir, target };
    }
    return { kind: 'other_spell_dmg_x', amount: parseFloat(amt), target };
  }
  // Cooldown % — target === 'All Magic' gets its own kind ('cooldownAll') on top of the existing
  // 'cooldown' one, purely so Matrix (below) can read a pool scoped to All-Magic-only Cooldown
  // Reduction, without changing what the pre-existing cooldownPct display total includes.
  const cdMatch = text.match(/^(Increase|Decrease) (.+?) Cooldown by ([\d.]+)%/);
  if (cdMatch) {
    const [, dir, target, amt] = cdMatch;
    const sign = dir === 'Decrease' ? -1 : 1;
    if (target === 'All Magic') return { kind: 'cooldownAll', amount: sign * parseFloat(amt), target };
    if (target === spellName) return { kind: 'cooldown', amount: sign * parseFloat(amt), target };
    return { kind: 'other' };
  }
  // All Magic Size% / Duration% — the All-Magic-wide form feeds Matrix's global pool; spell-specific
  // Size (e.g. "Increase Flash Shock Size by 15%") is tracked separately as 'sizeSpell', same
  // dual-tracking shape as Duration/durationSpell below — needed for Gate's own "Flash Shock Size
  // Increase is converted into Damage" mechanic (see GATE_FUSION in compute()), which reads Flash
  // Shock's own TOTAL Size% (spell-specific sources + the All-Magic-wide pool combined), not just
  // the All-Magic share alone.
  const sizeMatch = text.match(/^(Increase|Decrease) (.+?) Size by ([\d.]+)%/);
  if (sizeMatch) {
    const [, dir, target, amt] = sizeMatch;
    const sign = dir === 'Decrease' ? -1 : 1;
    if (target === 'All Magic') return { kind: 'size', amount: sign * parseFloat(amt), target };
    if (target === spellName) return { kind: 'sizeSpell', amount: sign * parseFloat(amt), target };
    return { kind: 'other' };
  }
  const durationMatch = text.match(/^(Increase|Decrease) (.+?) Duration by ([\d.]+)%/);
  if (durationMatch) {
    const [, dir, target, amt] = durationMatch;
    const sign = dir === 'Decrease' ? -1 : 1;
    if (target === 'All Magic') return { kind: 'duration', amount: sign * parseFloat(amt), target };
    // Spell-specific Duration (e.g. "Increase Cloaking Duration by 30%") — same dual-tracking idea
    // as 'cooldown'/'cooldownAll': tracked separately from the All-Magic-only pool above, since
    // Space Warp's own damage scaling (see spaceWarpDurationMult in compute()) needs Cloaking's own
    // TOTAL Duration% specifically (spell-specific sources + the All-Magic-wide pool combined), not
    // just the All-Magic share.
    if (target === spellName) return { kind: 'durationSpell', amount: sign * parseFloat(amt), target };
    return { kind: 'other' };
  }
  // Evasion% / Item Pickup Range% / Movement Speed% — all additive-with-itself pools, each feeding
  // exactly one conversion mechanic (Carnival/Oculus crit, Accelerator CDR) plus their own direct
  // contribution to that same pool (e.g. Carnival's own "+5% Evasion").
  if (/^(Increase|Decrease) Evasion by [\d.]+%/.test(text)) {
    return { kind: 'evasion', amount: (/^Decrease/.test(text) ? -1 : 1) * effect.value };
  }
  if (/^(Increase|Decrease) Item Pickup Range by [\d.]+%/.test(text)) {
    return { kind: 'pickupRange', amount: (/^Decrease/.test(text) ? -1 : 1) * effect.value };
  }
  if (/^(Increase|Decrease) Movement Speed by [\d.]+%/.test(text)) {
    return { kind: 'moveSpeed', amount: (/^Decrease/.test(text) ? -1 : 1) * effect.value };
  }
  // Max HP% — additive bonus sources (id 20 in the raw data, "Increase Max HP by N%") feed one
  // pool; a handful of relics (only Undead, "Reduce Max HP by 25%", id 21) instead MULTIPLY the
  // total on top of that additive sum, so they're tracked as a separate signed reduction kind
  // rather than folded into the same additive pool.
  if (/^Increase Max HP by [\d.]+%/.test(text)) return { kind: 'maxHp', amount: effect.value };
  if (/^(Reduce|Decrease) Max HP by [\d.]+%/.test(text)) return { kind: 'maxHpReduction', amount: effect.value };
  // Enemy-side Max HP reduction (ids 54/143/83) — a different stat from the player's own Max HP
  // above, distinguished by always naming a "[Max HP]" bracketed term and a target (all enemies /
  // Elite Monsters / Large Monsters), which the player's own "Reduce Max HP by N%" text never has.
  // effect.value is already stored negative for these three (unlike Undead's positive 25 above), so
  // amount is normalized to a positive magnitude to match the existing maxHpReduction convention.
  // Unlike every other regex in this function, these three raw texts keep the un-stripped 〈N%〉
  // template markup around the number (confirmed against the raw data directly) rather than a bare
  // "N%" — so the number itself is matched loosely rather than anchored at the string's own end.
  if (/^(Decrease|Reduce) the \[Max HP\] of all enemies by /.test(text)) {
    return { kind: 'enemyMaxHpReductionGeneral', amount: Math.abs(effect.value) };
  }
  if (/^(Decrease|Reduce) the \[Max HP\] of Elite Monsters by /.test(text)) {
    return { kind: 'enemyMaxHpReductionElite', amount: Math.abs(effect.value) };
  }
  if (/^(Decrease|Reduce) \[Max HP\] of \[Large Monsters\] by /.test(text)) {
    return { kind: 'enemyMaxHpReductionLarge', amount: Math.abs(effect.value) };
  }
  // Boss Wave / Normal Wave Monsters' Max HP (Imp) — a different phrasing entirely (possessive
  // apostrophe-s, no "[Max HP]"/"of" bracket form) than the three above, and the first Max-HP
  // modifier that's an INCREASE rather than a reduction. Tracked in the same signed "reduction%"
  // convention as the pools above (positive = reduction, negative = a real increase) so it composes
  // through the identical 1 - (1-a)*(1-b) formula without any special-casing downstream.
  if (/^Reduce Boss Wave Monsters' Max HP by [\d.]+%/.test(text)) {
    return { kind: 'enemyMaxHpModBossWave', amount: Math.abs(effect.value) };
  }
  if (/^Increase Normal Wave Monsters' Max HP by [\d.]+%/.test(text)) {
    return { kind: 'enemyMaxHpModNormalWave', amount: -Math.abs(effect.value) };
  }
  // Mana Acquisition% — general only, the stat that actually feeds Abyss's conversion. "Increase
  // Mana Acquisition FROM KILLING ENEMIES by N%" (Exorcism) is a narrower, separate bonus excluded
  // by construction (the literal "by" here never immediately follows "Acquisition" for that
  // phrasing). Lantern/Mercury's "[Mana Orb] Acquisition" is a genuinely different, narrower stat
  // too — it only affects how much Mana Orb *currency* drops, not the general Mana Acquisition
  // Rate% that feeds Abyss/leveling — so it's correctly excluded here as well, not a bug (an
  // earlier pass here briefly widened this regex to match it, on the wrong assumption that it was
  // just a different wording of the same stat; reverted).
  if (/^Increase Mana Acquisition by [\d.]+%/.test(text)) return { kind: 'manaAcquisition', amount: effect.value };
  // Damage Taken% — multiplicative-per-source like Cooldown %. Same sign convention as cdMatch above
  // (Decrease = negative amount, Increase = positive): multiplicativePoolMult turns a negative total
  // into a sub-1 factor directly via (1 + amount/100), so "Decrease Damage Taken by 12%" must be -12,
  // not +12, or the pool would multiply damage taken UP instead of down.
  if (/^(Increase|Decrease) Damage Taken by [\d.]+%/.test(text)) {
    return { kind: 'damageTaken', amount: (/^Decrease/.test(text) ? -1 : 1) * effect.value };
  }
  // number of casts/projectiles — "the number of X" (most spells) and "the maximum number of X"
  // (Shield specifically, e.g. Barrier/Reconstruct/Bishop's own "+1 Shield") are the same kind of
  // grant under two different phrasings in the raw text. Previously "Increase"-only (a handful of
  // fusions use "Decrease the number of X by N%" — Phoenix/Reaction/Winter Storm — and silently did
  // nothing) and treated every suffix as a flat integer add regardless of whether the raw text said
  // "by 1" (a real flat grant), "by 35%" (35% OF THE SPELL'S BASE COUNT), or "by 3X" (3x the base) —
  // confirmed via the "increase...BY" phrasing (consistently additive-to-base everywhere else in
  // this dataset) that %/X suffixes must scale off the spell's own base count, not be added as a
  // literal raw number (Machine Arm's "+35%" was inflating Energy Bolt's count 5 -> 40 before this
  // fix). The actual base-count multiplication happens where this kind is consumed (countPct/countx
  // need the spell's own base.number, which classifyEffect itself doesn't have access to).
  const numMatch = text.match(/^(Increase|Decrease) the (?:maximum )?number of (.+?) by ([\d.]+)(%|X)?/i);
  if (numMatch) {
    const [, verb, target, amtStr, suffix] = numMatch;
    // target is pluralized spell name loosely; match by spell name prefix
    if (spellName && (target.toLowerCase().includes(spellName.toLowerCase()) )) {
      const sign = /^Decrease$/i.test(verb) ? -1 : 1;
      const amt = sign * parseFloat(amtStr);
      if (suffix === '%') return { kind: 'countPct', amount: amt };
      if (suffix && suffix.toUpperCase() === 'X') return { kind: 'countx', amount: amt };
      return { kind: 'count', amount: amt };
    }
  }
  return { kind: 'other', label: text };
}

// ===================== Gather all active effects =====================
function selectedArtifactIds() {
  const ids = [];
  for (const [key, count] of Object.entries(state.bonusSelections)) {
    if (!count) continue;
    if (!key.startsWith('Artifact:')) continue;
    ids.push(parseInt(key.slice('Artifact:'.length), 10));
  }
  return ids;
}

// Magnum Opus's tooltip is a mistranslation ("{All} [Synergy] 〈Requirements〉 are 《1》 『Met.』") —
// what it actually does is waive 1 missing artifact from every synergy's requirement, so e.g. a
// 3/4 synergy counts as fully met. It does NOT grant the missing artifact's own effect, so a
// synergy whose entire benefit is *modifying that specific missing artifact* (identified by the
// `『##<id>##』` self-reference markers in its own description text, e.g. Ego Sword's "The Execute
// threshold of Magic Sword increases..." with no other structured effect) still yields nothing
// even while counted as active — see synergyNoopViaLeniency() below.
const MAGNUM_OPUS_SYNERGY = GAMEDATA.synergies.find(s => s.name === 'Magnum Opus') || null;
function magnumOpusActive() {
  if (!MAGNUM_OPUS_SYNERGY) return false;
  const owned = new Set(selectedArtifactIds());
  return MAGNUM_OPUS_SYNERGY.requiresArtifactIds.every(id => owned.has(id));
}
function synergyMissingIds(syn, owned) {
  return syn.requiresArtifactIds.filter(id => !owned.has(id));
}
// Every artifact a synergy's own description names via a `『##id##』` self-reference — the game's
// way of interpolating a required artifact's name into the tooltip. A synergy can reference more
// than one (e.g. Requiem: "enemies executed by Roster's effect fill Brand's stacks").
function synergyTargetArtifactIds(syn) {
  const text = syn.description.join(' ');
  return [...text.matchAll(/『##(\d+)##』/g)].map(m => parseInt(m[1], 10));
}
function getActiveSynergies() {
  const owned = new Set(selectedArtifactIds());
  const leniency = magnumOpusActive() ? 1 : 0;
  return GAMEDATA.synergies.filter(s => s.requiresArtifactIds.length > 0 && synergyMissingIds(s, owned).length <= leniency);
}
// A handful of synergies (Conflux, Arbiter, Heartbreaker, Monarch, Dominus, AGI) are consumed by
// compute() directly via id match rather than through the generic classifyEffect pipeline — some
// (Arbiter, Heartbreaker) are text-only with no structured effects at all, so they'd otherwise look
// "irrelevant" by the check below. Magnum Opus grants no stat of its own but enables every other
// synergy's leniency, so it's always relevant too. Everything else counts as damage-related only if
// classifyEffect finds at least one of its own effects maps to a tracked stat/damage kind — a purely
// utility/QoL synergy (e.g. Elixir's Life Orb HP Recovery) has nothing that ever classifies as
// anything but 'other', so it's excluded from the Active Synergies list.
const ALWAYS_DAMAGE_RELEVANT_SYNERGY_NAMES = new Set(['Conflux', 'Arbiter', 'Heartbreaker', 'Monarch', 'Dominus', 'AGI', 'Magnum Opus']);
function synergyAffectsDamage(syn) {
  if (ALWAYS_DAMAGE_RELEVANT_SYNERGY_NAMES.has(syn.name)) return true;
  return syn.effects.some(eff => classifyEffect(eff, null).kind !== 'other');
}
// True only when a synergy counts as active purely because Magnum Opus waived its one missing
// requirement, that missing artifact is one this synergy's own text names as what it modifies, and
// it has no other structured effect of its own to fall back on — i.e. it truly has nothing to give.
function synergyNoopViaLeniency(syn) {
  const owned = new Set(selectedArtifactIds());
  const missing = synergyMissingIds(syn, owned);
  if (missing.length === 0 || syn.effects.length > 0) return false;
  const targetIds = synergyTargetArtifactIds(syn);
  return targetIds.length > 0 && missing.some(id => targetIds.includes(id));
}

// Oracle (synergy) reads "Effects of Normal Passive Magic increase by X%" as pure text with no
// structured effect ID behind it, so its multiplier is parsed straight from that sentence rather
// than hardcoded — same value as long as the source data doesn't change.
function oracleMultiplier() {
  const oracle = getActiveSynergies().find(s => s.name === 'Oracle');
  if (!oracle) return 1;
  const m = oracle.description.join(' ').match(/Normal Passive Magic\D*?([\d.]+)%/);
  return m ? 1 + parseFloat(m[1]) / 100 : 1;
}

// Scales an Enchant effect's value (Fairy's own 2X) while keeping .text in sync — classifyEffect
// reads the number back out of .text for several effect kinds (cooldown%, size%), not just .value,
// same reasoning as the leveled-Passive scaling elsewhere in gatherActiveEffects.
function scaleEnchantEffectText(effect, mult) {
  if (mult === 1) return effect;
  const scaledValue = effect.value * mult;
  return { id: effect.id, value: scaledValue, text: effect.text.replace(/([\d.]+)%$/, scaledValue + '%') };
}

function gatherActiveEffects(spellId) {
  if (spellId == null) spellId = state.selectedSpellId;
  const list = []; // { source, effect }
  const spell = GAMEDATA.spells[spellId];
  const ss = spellState(spellId);

  // Generic (per-level) upgrades — only the ones unlocked so far at this spell's own selected
  // level actually apply (levels level up progressively, same idea as Class Level), not the
  // spell's full eventual bundle.
  for (const lu of spell.levelUpgrades) {
    if (lu.kind === 'stat' && lu.level <= ss.level) list.push({ source: spell.name + ' (Lv' + lu.level + ')', effect: lu });
  }
  // evolutions — only pickable/active once this spell's selected level has reached that tier's
  // unlock level (see spellEvolutionTierUnlocked below); a stale pick from before leveling down
  // (or loading an older save) is harmless here since it's simply never reached.
  for (const evo of spell.evolutions) {
    if (ss.evolutions.has(evo.id) && spellEvolutionTierUnlocked(spell, evo.tier, ss.level)) {
      for (const eff of evo.effects) list.push({ source: evo.name, effect: eff });
    }
  }
  // class — only the bonuses unlocked so far at your chosen Class level actually apply, not the
  // class's full eventual bundle (classes level up progressively via in-game currency).
  if (state.classId != null) {
    const cls = GAMEDATA.classes.school.find(c => c.id === state.classId);
    if (cls) {
      // Excludes the (All Classes) bonus here — that comes exclusively from the maxedClassIds
      // loop below, even if this active class happens to also be in that list, so it's never
      // counted twice.
      for (const eff of unlockedClassEffects(cls, state.classLevel)) {
        if (isAllClassesEffect(eff)) continue;
        list.push({ source: cls.name + ' (Class Lv' + state.classLevel + ')', effect: eff });
      }
      // The class's own per-level scaling ("every 5 character levels, +3% Spell Damage") is NOT
      // pushed into this list — per the confirmed damage formula, Class is its own separate
      // multiplicative tag ("Class multiplier... only includes itself"), not part of the additive
      // Magic Damage pool. Applied directly in compute() instead — see classMult.
    }
  }
  // Every maxed School class's (All Classes) bonus applies permanently, independent of which
  // class (if any) is currently active.
  for (const maxedId of state.maxedClassIds) {
    const maxedCls = GAMEDATA.classes.school.find(c => c.id === maxedId);
    const allClassesEff = maxedCls && classAllClassesEffect(maxedCls);
    if (allClassesEff) list.push({ source: maxedCls.name + ' (Class, maxed)', effect: allClassesEff });
  }
  // Test Subjects don't level and their "(All Classes)" bonus isn't tied to being your active
  // pick — every Test Subject you've unlocked contributes its passive permanently, regardless of
  // which one (if any) is currently active. The active dropdown only matters separately, for
  // unlocking a matching fusion's Ultimate.
  for (const tsId of state.unlockedTestSubjectIds) {
    const ts = GAMEDATA.classes.testSubject.find(c => c.id === tsId);
    if (ts) for (const eff of ts.effects) list.push({ source: ts.name + ' (Test Subject, unlocked)', effect: eff });
  }
  // bonus pool (artifacts/passives/etc)
  const oracleMult = oracleMultiplier();
  const passiveMaxBonus = normalPassiveMaxLevelBonus();
  for (const [key, storedCount] of Object.entries(state.bonusSelections)) {
    if (!storedCount) continue;
    const item = BONUS_POOL.find(b => bonusKey(b) === key);
    if (!item) continue;
    // Cube/Taoist each add 1 level to every Normal Passive automatically (once at least 1 level is
    // manually invested — see normalPassiveMaxLevelBonus) — folded into the effective count here so
    // the stat math matches what the Passives tab now displays, same as Oracle's scale below.
    const count = item.category === 'Passive' ? storedCount + passiveMaxBonus : storedCount;
    // Oracle (synergy) scales the *magnitude* of Normal Passive effects specifically — distinct
    // from Cube/Taoist, which add whole extra levels rather than scaling the per-level value itself.
    const scale = (oracleMult !== 1 && item.category === 'Passive') ? oracleMult : 1;
    // A leveled item's `count` levels are folded into ONE combined effect per level-up grant here
    // (total = per-level value × count × Oracle scale) rather than pushed once per level — matching
    // how Advanced Magic's own "(Passive x3)" combo-damage line already displays, and avoiding e.g.
    // Intelligence at level 5 showing as five separate identical "ATK +10.00%" ledger rows instead
    // of one "ATK +50.00%" row. Purely a display grouping — classifyEffect() sums additively either
    // way, so the actual damage totals were never affected by this.
    const totalScale = scale * count;
    for (const eff of item.effects) {
      let scaledEff = eff;
      if (totalScale !== 1 && eff.text) {
        // classifyEffect() reads the number back out of .text for some effect kinds (e.g.
        // cooldown%), not just .value — both have to reflect the combined scale or it's silently
        // dropped for those paths.
        const newValue = Math.round(Math.abs(eff.value) * totalScale * 100) / 100;
        const newText = eff.text.replace(String(Math.abs(eff.value)), String(newValue));
        scaledEff = { id: eff.id, value: eff.value < 0 ? -newValue : newValue, text: newText };
      }
      const countSuffix = count > 1 ? ' x' + count : '';
      list.push({ source: item.name + ' (' + categoryLabel(item.category) + countSuffix + ')' + (scale !== 1 ? ' × Oracle' : ''), effect: scaledEff });
    }
  }
  // Enchant (Passive): one dropdown per owned level (max 3), each independently picking a Spell to
  // receive +50% Damage (2X with Fairy) plus that Spell's own unique secondary effect. Pushed as
  // real {id,value,text} effects — same shape as anything else here — so classifyEffect's own
  // target-matching naturally routes the damage term into mdmgPct and the secondary term wherever
  // its own text classifies (e.g. cooldownLedger for a Cooldown-type secondary), with no bespoke
  // per-kind dispatch needed. Multiplying value alone (not the text) would silently break
  // classifyEffect's own cooldown/size regexes, which read the number back out of .text — see
  // scaleEnchantEffectText below.
  const enchantOwned = ENCHANT_ITEM && state.bonusSelections[bonusKey({ ...ENCHANT_ITEM, category: 'Passive' })];
  if (enchantOwned) {
    const fairyOwned = FAIRY_ARTIFACT && ownsArtifactByName('Fairy');
    const fairyMult = fairyOwned ? 2 : 1;
    for (let i = 0; i < enchantOwned; i++) {
      const enchantSpell = state.enchantSpellIds[i] != null ? GAMEDATA.spells[state.enchantSpellIds[i]] : null;
      if (!enchantSpell || !enchantSpell.enchant) continue;
      const source = 'Enchant (Passive, ' + enchantSpell.name + ')' + (fairyOwned ? ' × Fairy' : '');
      list.push({ source, effect: scaleEnchantEffectText(enchantSpell.enchant.damage, fairyMult) });
      list.push({ source, effect: scaleEnchantEffectText(enchantSpell.enchant.secondary, fairyMult) });
    }
  }
  // fusions — multiple can be active simultaneously (the game supports several combination slots)
  for (const fusionId of state.fusionIds) {
    const fusion = GAMEDATA.fusions.find(f => f.id === fusionId);
    if (fusion) for (const eff of fusion.effects) list.push({ source: fusion.name + ' (Fusion)', effect: eff });
  }
  // Synergies — auto-activate once every required artifact is owned, or with exactly one missing
  // if Magnum Opus is active. No extra filtering needed here for the "noop via leniency" case
  // (synergyNoopViaLeniency) — those synergies have an empty .effects array by construction, since
  // their entire modeled benefit was the target-artifact text this calculator can't apply anyway.
  for (const syn of getActiveSynergies()) {
    // Wonderland (id 26): a real data duplicate, not a genuine double-stack — its raw effects array
    // has THREE entries (Size -9%, Max HP -9%, Max HP -9% again under a different id) but its own
    // description only ever names TWO distinct effects, and no other synergy/item in the dataset
    // repeats the same "Decrease Max HP of all enemies" line twice within one item's own effects.
    // Confirmed via a real in-game build: the general reduction pool matched 71.24% (Max HP counted
    // twice) rather than 66.92% (counted once) before this fix — deliberately un-deduped elsewhere
    // in this file (Wizard's own two genuinely-separate Magic Bolt Lv+1 grants, Archmage's two
    // Combination Magic Damage lines) only because those cases were confirmed-or-unconfirmed real
    // double grants, not confirmed duplicates like this one.
    const effects = syn.name === 'Wonderland'
      ? syn.effects.filter((eff, i) => syn.effects.findIndex(e => e.text === eff.text) === i)
      : syn.effects;
    for (const eff of effects) list.push({ source: syn.name + ' (Synergy)', effect: eff });
  }
  return list;
}

function getUltimateInfo(fusion) {
  if (!fusion) return null;
  const info = GAMEDATA.ultimates.byFusionName[fusion.name];
  return info ? { fusion, ...info } : null;
}

// An Ultimate can only be unlocked with the specific matching Class + Test Subject selected (same
// name, both tied to the fusion's MAIN/primary spell only — see fusionPrimarySpellId). For almost
// every spell exactly one Class is linked to it at all, so "any Class linked to the primary spell"
// and "the one specific required Class" are the same check — but Magic Bolt is linked to FIVE
// Classes (Wizard/Arcanist/Archaeologist/Magician/Black Mage), and its one real ultimate (Avatar ->
// Equilibrium) requires Wizard specifically, not any of the other four. fusion.ultimateRequiredClassId
// (see build_gamedata.js) is the exact Class id the game's own ultimate card states, extracted
// directly rather than inferred — used whenever it resolves to a real Class, falling back to the
// old "any Class linked to the primary spell" check only for the handful of fusions where it
// doesn't resolve (Shield/Cloaking/Armageddon/Magic Circle-rooted fusions have no Class linked to
// their primary spell at all, e.g. Teleport -> Hallucination, rooted in Cloaking — those unlock
// unconditionally rather than being permanently and incorrectly stuck "locked").
function isUltimateUnlocked(fusion) {
  const primarySpellId = fusionPrimarySpellId(fusion);
  const primarySpell = primarySpellId != null ? GAMEDATA.spells[primarySpellId] : null;
  const primaryHasNoLinkedClass = primarySpell && !GAMEDATA.classes.school.some(c => c.linkedSpellId === primarySpellId);
  if (primaryHasNoLinkedClass) return true;
  if (state.classId == null || state.testSubjectId == null) return false;
  const cls = GAMEDATA.classes.school.find(c => c.id === state.classId);
  const ts = GAMEDATA.classes.testSubject.find(c => c.id === state.testSubjectId);
  if (!cls || !ts || cls.linkedSpellId == null || cls.linkedSpellId !== ts.linkedSpellId) return false;
  const requiredClass = fusion.ultimateRequiredClassId != null
    ? GAMEDATA.classes.school.find(c => c.id === fusion.ultimateRequiredClassId)
    : null;
  if (requiredClass) return cls.id === requiredClass.id && ts.name === requiredClass.name;
  return primarySpellId === cls.linkedSpellId;
}

// A Class/Test Subject is worth flagging with its modified spell (see the dropdown UI) only if it's
// the actual required pick for at least one real, curated Ultimate (getUltimateInfo returns
// non-null only for the 24 with confirmed data) — not merely "linked to a spell some fusion uses",
// which for Magic Bolt would wrongly include 4 Classes that don't gate anything (see
// isUltimateUnlocked above).
function classGatesAnyUltimate(cls) {
  return GAMEDATA.fusions.some(f => getUltimateInfo(f) && f.ultimateRequiredClassId === cls.id);
}
function testSubjectGatesAnyUltimate(ts) {
  return GAMEDATA.fusions.some((f) => {
    const ult = getUltimateInfo(f);
    if (!ult || f.ultimateRequiredClassId == null) return false;
    const reqClass = GAMEDATA.classes.school.find(c => c.id === f.ultimateRequiredClassId);
    return reqClass && reqClass.name === ts.name;
  });
}

// ===================== Compute =====================
function compute() {
  const spell = GAMEDATA.spells[state.selectedSpellId];
  const active = gatherActiveEffects();

  let atkPct = 0, ampPct = 0, mdmgPct = 0, countFlat = 0, critChancePct = 0, critMultPct = 0;
  // sizePct/durationPct are two of Matrix's three dynamic-AMD inputs — scoped to All-Magic-wide
  // effects only (see classifyEffect's 'size'/'duration'). Cooldown's own two pools (per-spell and
  // All-Magic-only) are built as ledgers instead of running sums (see cooldownLedger below), since
  // Cooldown Reduction combines multiplicatively-per-unique-source, not additively.
  let sizePct = 0, durationPct = 0, durationSpellPct = 0, sizeSpellPct = 0;
  // New additive-with-itself pools (Evasion/Item Pickup Range/Mana Acquisition/Movement Speed), plus
  // the two multiplicative-per-source ledgers (Cooldown %, Damage Taken %) that feed the various
  // stat-conversion relics below (Oculus/Carnival/Gaia/Abyss/Accelerator/Aegis).
  let evasionPct = 0, pickupRangePct = 0, manaAcquisitionPct = 0, moveSpeedPct = 0;
  let maxHpBonusPct = 0, maxHpReductionPct = 0;
  // Per-source ledgers for the pools above, purely for display (Player Stats section below) — the
  // running sums (evasionPct etc.) stay the source of truth every stat-conversion relic already
  // reads from, these just mirror the same additions so their breakdown is visible somewhere.
  const evasionLedger = [], pickupRangeLedger = [], manaAcquisitionLedger = [], moveSpeedLedger = [];
  const maxHpBonusLedger = [], maxHpReductionLedgerPlayer = [];
  // Enemy-side Max HP reduction — all four pools tracked as ledgers (not just running sums), since
  // each one's own sources combine multiplicatively with each other (see enemyMaxHpReductionGeneral-
  // Fraction's own comment below for why), not additively — needs each individual source's own %
  // to build that product, a running sum alone can't reconstruct it.
  const enemyMaxHpReductionEliteLedger = [];
  const enemyMaxHpReductionLargeLedger = [];
  const enemyMaxHpModBossWaveLedger = [];
  const enemyMaxHpModNormalWaveLedger = [];
  const enemyMaxHpReductionGeneralLedger = [];
  const cooldownLedger = [];
  const allMagicCooldownLedger = [];
  const damageTakenLedger = [];
  const xMults = [];
  const ledger = { atk: [], amp: [], mdmg: [], crit: [], other: [] };

  for (const { source, effect } of active) {
    const c = classifyEffect(effect, spell.name);
    if (c.kind === 'atk') { atkPct += c.amount; ledger.atk.push({ source, text: effect.text, amount: c.amount }); }
    else if (c.kind === 'amp') { ampPct += c.amount; ledger.amp.push({ source, text: effect.text, amount: c.amount }); }
    else if (c.kind === 'mdmg') { mdmgPct += c.amount; ledger.mdmg.push({ source, text: effect.text, amount: c.amount }); }
    else if (c.kind === 'critChance') { critChancePct += c.amount; ledger.crit.push({ source, text: effect.text, amount: c.amount, tag: 'Chance' }); }
    else if (c.kind === 'critMult') { critMultPct += c.amount; ledger.crit.push({ source, text: effect.text, amount: c.amount, tag: 'Multi' }); }
    else if (c.kind === 'xmult') { xMults.push({ source, amount: c.amount, dir: c.dir }); }
    else if (c.kind === 'cooldown') { cooldownLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'cooldownAll') { cooldownLedger.push({ source, amount: c.amount }); allMagicCooldownLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'size') { sizePct += c.amount; }
    else if (c.kind === 'sizeSpell') { sizeSpellPct += c.amount; }
    else if (c.kind === 'duration') { durationPct += c.amount; }
    else if (c.kind === 'durationSpell') { durationSpellPct += c.amount; }
    else if (c.kind === 'count') { countFlat += c.amount; }
    else if (c.kind === 'countPct') { countFlat += Math.round((spell.base ? spell.base.number : 0) * c.amount / 100); }
    else if (c.kind === 'countx') { countFlat += Math.round((spell.base ? spell.base.number : 0) * c.amount); }
    else if (c.kind === 'evasion') { evasionPct += c.amount; evasionLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'pickupRange') { pickupRangePct += c.amount; pickupRangeLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'manaAcquisition') { manaAcquisitionPct += c.amount; manaAcquisitionLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'moveSpeed') { moveSpeedPct += c.amount; moveSpeedLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'damageTaken') { damageTakenLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'maxHp') { maxHpBonusPct += c.amount; maxHpBonusLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'maxHpReduction') { maxHpReductionPct += c.amount; maxHpReductionLedgerPlayer.push({ source, amount: c.amount }); }
    else if (c.kind === 'enemyMaxHpReductionGeneral') { enemyMaxHpReductionGeneralLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'enemyMaxHpReductionElite') { enemyMaxHpReductionEliteLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'enemyMaxHpReductionLarge') { enemyMaxHpReductionLargeLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'enemyMaxHpModBossWave') { enemyMaxHpModBossWaveLedger.push({ source, amount: c.amount }); }
    else if (c.kind === 'enemyMaxHpModNormalWave') { enemyMaxHpModNormalWaveLedger.push({ source, amount: c.amount }); }
  }

  // Soul Harvest (Cloaking's third Tier-1 evolution): "Recover 0.1% HP per enemy killed while in
  // Cloaking, and increase Mana Acquisition by 33%" — one combined effect with no text template
  // (found via the same null-text scan as Mirage below), same shape as Adrenaline's earlier bug.
  // The HP-recovery half is a non-damage defensive stat, correctly out of scope; the Mana
  // Acquisition half feeds Abyss's conversion and was being lost entirely. Mana Acquisition is a
  // global (not per-spell) stat, so this reads Cloaking's OWN spellState directly rather than
  // gating on the currently-viewed spell — must run before Abyss reads manaAcquisitionPct below
  // (same ordering bug class as the earlier Oculus/Carnival-vs-critChance fix).
  if (SOUL_HARVEST_EVOLUTION && SPACE_WARP_SPELL &&
      spellState(SPACE_WARP_SPELL.id).evolutions.has(SOUL_HARVEST_EVOLUTION.id) &&
      spellEvolutionTierUnlocked(SPACE_WARP_SPELL, SOUL_HARVEST_EVOLUTION.tier, spellState(SPACE_WARP_SPELL.id).level)) {
    manaAcquisitionPct += 33;
    manaAcquisitionLedger.push({ source: 'Soul Harvest (Cloaking Evolution)', amount: 33 });
  }

  // Every one of the four pools below combines its OWN sources multiplicatively with each other
  // (each source's own remaining-HP fraction multiplies together — same shape as
  // multiplicativePoolMult, already used for Cooldown/Damage Taken elsewhere in this file), not
  // additively. Confirmed for the general pool directly against a real in-game reading (Reaper's
  // Scythe 13% + Curse 6%, no Venom, character sheet showed 18.2% — matches
  // 1-(1-0.13)*(1-0.06)=18.22% exactly; plain addition would have given 19%, which is what this used
  // to compute). Venom (Synergy) then multiplies the general pool's already-resolved rate by 1.15 —
  // confirmed by the same in-game check (18.22% x 1.15 = 20.953%, matching the user's own stated
  // math) — never the Elite/Large/Boss-Wave/Normal-Wave pools, whose own text is always scoped to a
  // specific enemy type, not "all enemies" the way Venom's own text is.
  //
  // Elite/Large/Boss-Wave/Normal-Wave can't be read directly off the in-game stat sheet the way the
  // general pool could (confirmed by the user — no visible stat for these), so applying the same
  // multiplicative treatment to them is an explicit assumption, not independently confirmed the same
  // way — per the user's own direction: "assume it works the same way as CDR does, where the general
  // pool is multiplicative, then spell-specific/enemy-specific multiply afterward." Elite/Large are
  // moot in practice until a build owns 2+ sources within the same one of those two pools (currently
  // only Elite has more than one real source in the dataset — Virus/Toy Castle/Eldritch), but tracked
  // as ledgers now for when that matters, rather than repeating the same additive bug there too.
  //
  // An earlier version of the general pool's own formula (product(1+r/100), Venom's 1.15 folded into
  // the same product, minus 1) was built against a single forwarded Discord report claiming 2.29x
  // effective damage for Genome Map+Basilisk+Sample+Venom, and reproduced that number exactly — but
  // neither the report's own math nor our interpretation of it was ever independently confirmed, and
  // that formula had no ceiling: it silently exceeded 100% reduction (verified up to 150%+) once more
  // than a few general-pool sources were combined, which is what the user actually ran into. The real
  // in-game reading above contradicts that old formula and is a direct, verifiable observation rather
  // than a secondhand, self-uncertain claim, so it now takes priority.
  const venomOwned = VENOM_SYNERGY && getActiveSynergies().some(s => s.id === VENOM_SYNERGY.id);
  function multiplicativeReductionFraction(ledgerArr) {
    return 1 - ledgerArr.reduce((acc, e) => acc * (1 - e.amount / 100), 1);
  }
  const enemyMaxHpReductionGeneralPct = enemyMaxHpReductionGeneralLedger.reduce((sum, e) => sum + e.amount, 0);
  const enemyMaxHpReductionGeneralBaseFraction = multiplicativeReductionFraction(enemyMaxHpReductionGeneralLedger);
  const enemyMaxHpReductionGeneralFraction = venomOwned
    ? enemyMaxHpReductionGeneralBaseFraction * 1.15
    : enemyMaxHpReductionGeneralBaseFraction;
  const enemyMaxHpReductionElitePct = enemyMaxHpReductionEliteLedger.reduce((sum, e) => sum + e.amount, 0);
  const enemyMaxHpReductionLargePct = enemyMaxHpReductionLargeLedger.reduce((sum, e) => sum + e.amount, 0);
  const enemyMaxHpReductionEliteFraction = multiplicativeReductionFraction(enemyMaxHpReductionEliteLedger);
  const enemyMaxHpReductionLargeFraction = multiplicativeReductionFraction(enemyMaxHpReductionLargeLedger);
  // Type-scoped pools layer multiplicatively on top of the (already-Venom-resolved) general pool —
  // an Elite/Large enemy is affected by both the general sources AND its own type-specific sources
  // simultaneously, not just whichever is larger.
  const enemyMaxHpReductionVsNormal = enemyMaxHpReductionGeneralFraction;
  const enemyMaxHpReductionVsElite = 1 - (1 - enemyMaxHpReductionGeneralFraction) * (1 - enemyMaxHpReductionEliteFraction);
  const enemyMaxHpReductionVsLarge = 1 - (1 - enemyMaxHpReductionGeneralFraction) * (1 - enemyMaxHpReductionLargeFraction);
  // Boss Wave / Normal Wave (Imp) — same layering as Elite/Large above, its own independent
  // multiplicative factor on top of the general pool. Negative fractions (Imp's own Normal Wave
  // side is a real +10% Max HP INCREASE) fall out of the identical formula correctly: 1 - (-0.10) =
  // 1.10, a 110% remaining-HP factor, with no special-casing needed anywhere downstream.
  const enemyMaxHpModBossWavePct = enemyMaxHpModBossWaveLedger.reduce((sum, e) => sum + e.amount, 0);
  const enemyMaxHpModNormalWavePct = enemyMaxHpModNormalWaveLedger.reduce((sum, e) => sum + e.amount, 0);
  const enemyMaxHpModBossWaveFraction = multiplicativeReductionFraction(enemyMaxHpModBossWaveLedger);
  const enemyMaxHpModNormalWaveFraction = multiplicativeReductionFraction(enemyMaxHpModNormalWaveLedger);
  const enemyMaxHpReductionVsBossWave = 1 - (1 - enemyMaxHpReductionGeneralFraction) * (1 - enemyMaxHpModBossWaveFraction);
  const enemyMaxHpReductionVsNormalWave = 1 - (1 - enemyMaxHpReductionGeneralFraction) * (1 - enemyMaxHpModNormalWaveFraction);

  // Occult: dynamic self-referential effect (see OCCULT_ARTIFACT comment above) — grants the player
  // a Max HP bonus equal to the general pool's fully-resolved % (including Venom's transform and
  // Occult's own -5% contribution to that same pool, both already folded into the fraction above).
  const occultOwned = OCCULT_ARTIFACT && ownsArtifactByName('Occult');
  if (occultOwned) {
    const occultAmt = enemyMaxHpReductionGeneralFraction * 100;
    maxHpBonusPct += occultAmt;
    maxHpBonusLedger.push({ source: 'Occult (Relic, = Max HP Reduction Rate)', amount: occultAmt });
  }

  // Execute (Magic Sword): threshold is a % of the enemy's CURRENT (already-reduced) max HP, so it
  // compounds with the reduction fractions above rather than acting independently (see
  // MAGIC_SWORD_ARTIFACT comment above for the confirmed compounding formula).
  const magicSwordOwned = MAGIC_SWORD_ARTIFACT && ownsArtifactByName('Magic Sword');
  const egoSwordActive = magicSwordOwned && EGO_SWORD_SYNERGY && getActiveSynergies().some(s => s.id === EGO_SWORD_SYNERGY.id);
  const executeThresholdPct = magicSwordOwned
    ? (egoSwordActive ? 25 : ((MAGIC_SWORD_ARTIFACT.effects[0] && MAGIC_SWORD_ARTIFACT.effects[0].value) || 20))
    : 0;
  const executeThresholdFraction = executeThresholdPct / 100;
  // requiredDamageFraction is the more intuitive number for display ("you only need to land N% of
  // the enemy's ORIGINAL Max HP in real damage to kill them") — the multiplier is just its
  // reciprocal, kept for the actual damage-scaling math.
  function requiredDamageFraction(reductionFraction) {
    return Math.max(0.0001, (1 - reductionFraction) * (1 - executeThresholdFraction));
  }
  const requiredDamageFractionVsNormal = requiredDamageFraction(enemyMaxHpReductionVsNormal);
  const requiredDamageFractionVsElite = requiredDamageFraction(enemyMaxHpReductionVsElite);
  const requiredDamageFractionVsLarge = requiredDamageFraction(enemyMaxHpReductionVsLarge);
  const requiredDamageFractionVsBossWave = requiredDamageFraction(enemyMaxHpReductionVsBossWave);
  const requiredDamageFractionVsNormalWave = requiredDamageFraction(enemyMaxHpReductionVsNormalWave);
  const effectiveDamageMultVsNormal = 1 / requiredDamageFractionVsNormal;
  const effectiveDamageMultVsElite = 1 / requiredDamageFractionVsElite;
  const effectiveDamageMultVsLarge = 1 / requiredDamageFractionVsLarge;
  const effectiveDamageMultVsBossWave = 1 / requiredDamageFractionVsBossWave;
  const effectiveDamageMultVsNormalWave = 1 / requiredDamageFractionVsNormalWave;
  const effectiveDamageActive = magicSwordOwned || enemyMaxHpReductionGeneralLedger.length > 0 || enemyMaxHpReductionElitePct !== 0 || enemyMaxHpReductionLargePct !== 0 || enemyMaxHpModBossWavePct !== 0 || enemyMaxHpModNormalWavePct !== 0;

  // Oculus (Artifact): Crit Rate +1% per 30% Item Pickup Range — reads the pool without depleting
  // it. Must run BEFORE critChance is finalized below (a real bug this used to have: it ran after,
  // so its own contribution reached critChancePct's displayed total but never actually fed the
  // critChance value the damage formula, Widowmaker, Joker, and Siege Hammer all read — the
  // displayed "Final Crit Chance (+N%)" parenthetical and the main number silently went out of
  // sync whenever Oculus/Carnival were owned).
  const oculusOwned = OCULUS_ARTIFACT && ownsArtifactByName('Oculus');
  if (oculusOwned && pickupRangePct) {
    const perUnit = (OCULUS_ARTIFACT.effects[0] && OCULUS_ARTIFACT.effects[0].value) || 1;
    const amt = Math.round(perUnit * (pickupRangePct / 30) * 100) / 100;
    if (amt) { critChancePct += amt; ledger.crit.push({ source: 'Oculus (Relic, Item Pickup Range ' + fmtSigned(pickupRangePct) + '%)', text: 'Increase Critical Rate by ' + amt + '%', amount: amt, tag: 'Chance' }); }
  }
  // Carnival (Artifact): Crit Rate +1% per 3% Evasion — reads the pool without depleting it. Same
  // ordering fix as Oculus above.
  const carnivalOwned = CARNIVAL_ARTIFACT && ownsArtifactByName('Carnival');
  if (carnivalOwned && evasionPct) {
    const perUnit = (CARNIVAL_ARTIFACT.effects[0] && CARNIVAL_ARTIFACT.effects[0].value) || 1;
    const amt = Math.round(perUnit * (evasionPct / 3) * 100) / 100;
    if (amt) { critChancePct += amt; ledger.crit.push({ source: 'Carnival (Relic, Evasion ' + fmtSigned(evasionPct) + '%)', text: 'Increase Critical Rate by ' + amt + '%', amount: amt, tag: 'Chance' }); }
  }

  // Everything found above (Critical Strike Rate/Multiplier effects) stacks additively on top of
  // the base values, matching how every other %-based pool in this calculator works.
  const critChance = Math.min(100, Math.max(0, PLAYER_BASE_CRIT_CHANCE + critChancePct));
  // Widowmaker: Critical Multiplier bonus equal to the player's own fully-resolved Critical Rate
  // (see WIDOWMAKER_ARTIFACT above) — reads critChance now that it's finalized, feeds the same
  // additive critMultPct pool every other "+N% Critical Strike Multiplier" source uses.
  const widowmakerOwned = WIDOWMAKER_ARTIFACT && ownsArtifactByName('Widowmaker');
  if (widowmakerOwned && critChance) {
    critMultPct += critChance;
    ledger.crit.push({ source: 'Widowmaker (Relic, = Critical Rate)', text: 'Increase Critical Multiplier by Critical Rate', amount: critChance, tag: 'Multi' });
  }
  const critMultiPreHeartbreaker = PLAYER_BASE_CRIT_MULT + critMultPct;
  // Heartbreaker (Synergy): flat x1.25 "Critical Multiplier" — same late-multiplier treatment as
  // Titan's Power on ATK, just applied to the crit multiplier stat instead.
  const heartbreakerActive = HEARTBREAKER_SYNERGY && getActiveSynergies().some(s => s.id === HEARTBREAKER_SYNERGY.id);
  const critMulti = heartbreakerActive ? critMultiPreHeartbreaker * 1.25 : critMultiPreHeartbreaker;

  // Overmind scales Amplification (its own bucket, additive with itself per the confirmed formula)
  // per total invested spell level, so it's handled separately from the per-spell fusion effect
  // loop above. Deus Ex Machina, by contrast, is its own separate multiplicative tag entirely — its
  // own raw in-game text reads "All Magic Damage Multiplier increases by 0.01" per level, with NO
  // percent sign, right next to "Decrease All Magic Cooldown by 0.1%" (which DOES have one) in the
  // same description block — confirmed via the raw extracted text that this is a flat +0.01
  // multiplier delta (i.e. +1 percentage point) per level, not +0.01%. So DEM adds +1% damage per
  // active magic level, not +0.01% — not part of the additive Magic Damage pool, so demMult is
  // applied directly in the final formula below rather than added to mdmgPct.
  const totalLevels = totalActiveMagicLevels();
  const overmindActive = OVERMIND_FUSION && state.fusionIds.includes(OVERMIND_FUSION.id);
  const demActive = DEM_FUSION && state.fusionIds.includes(DEM_FUSION.id) && isDeusExMachinaAvailable();
  if (overmindActive) {
    ampPct += totalLevels * 1.5;
    const overmindCdPenalty = totalLevels * 0.3;
    cooldownLedger.push({ source: 'Overmind (' + totalLevels + ' levels)', amount: overmindCdPenalty });
    allMagicCooldownLedger.push({ source: 'Overmind (' + totalLevels + ' levels)', amount: overmindCdPenalty });
    ledger.amp.push({ source: 'Overmind (' + totalLevels + ' levels)', text: 'Amplify ATK by ' + (totalLevels * 1.5).toFixed(1) + '%', amount: totalLevels * 1.5 });
  }
  const demMult = demActive ? 1 + totalLevels * 0.01 : 1;
  if (demActive) {
    const demCdPenalty = totalLevels * 0.1;
    cooldownLedger.push({ source: 'Deus Ex Machina (' + totalLevels + ' levels)', amount: demCdPenalty });
    allMagicCooldownLedger.push({ source: 'Deus Ex Machina (' + totalLevels + ' levels)', amount: demCdPenalty });
  }

  // Class multiplier: the active class's own "every N character levels, +X% [Spell] Damage" is its
  // own separate multiplicative tag per the confirmed formula ("Class multiplier... only includes
  // itself"), not part of the additive Magic Damage pool — only applies when its target (a specific
  // spell, or "All Magic") matches whichever spell is currently being viewed.
  let classMult = 1;
  let classScaling = null;
  if (state.classId != null) {
    const activeCls = GAMEDATA.classes.school.find(c => c.id === state.classId);
    if (activeCls) {
      classScaling = classLevelScalingEffect(activeCls, state.playerLevel);
      if (classScaling && (classScaling.target === spell.name || classScaling.target === 'All Magic')) {
        classMult = 1 + classScaling.value / 100;
      }
    }
  }

  // Additional Damage — multiplicative with itself, each source its own separate factor (see
  // ROBOT_ARTIFACT above for why only Robot is wired up here).
  const additionalDamageLedger = [];
  if (ROBOT_ARTIFACT && ownsArtifactByName('Robot') && spell.name === 'Electric Zone') {
    const pct = 0.5 * state.playerLevel;
    if (pct) additionalDamageLedger.push({ source: 'Robot (Relic, ' + state.playerLevel + ' character levels)', pct });
  }
  // Excalibur's own aura applies to every spell (no spell-name scoping, unlike Robot) — confirmed
  // unconditional, not gated on any live combat state.
  if (EXCALIBUR_ARTIFACT && ownsArtifactByName('Excalibur')) {
    const pct = (EXCALIBUR_ARTIFACT.effects[0] && EXCALIBUR_ARTIFACT.effects[0].value) || 25;
    additionalDamageLedger.push({ source: 'Excalibur (Relic, Aura)', pct });
  }
  let additionalDamageMult = 1;
  for (const a of additionalDamageLedger) additionalDamageMult *= (1 + a.pct / 100);

  // Conditional Additional Damage — same multiplicative-per-source combination as the always-on
  // ledger above, but kept separate since these only apply when their own condition holds (not
  // baked into the main expected-damage figure). Two independent conditions, each its own ledger.
  const hpGatedAdditionalDamageLedger = [];
  if (GUILLOTINE_ARTIFACT && ownsArtifactByName('Guillotine')) {
    const pct = (GUILLOTINE_ARTIFACT.effects[0] && GUILLOTINE_ARTIFACT.effects[0].value) || 15;
    hpGatedAdditionalDamageLedger.push({ source: 'Guillotine (Relic)', pct });
  }
  if (ROSE_ARTIFACT && ownsArtifactByName('Rose')) {
    const pct = (ROSE_ARTIFACT.effects[0] && ROSE_ARTIFACT.effects[0].value) || 10;
    hpGatedAdditionalDamageLedger.push({ source: 'Rose (Relic)', pct });
  }
  if (BALLISTA_ARTIFACT && ownsArtifactByName('Ballista')) {
    const eff = BALLISTA_ARTIFACT.effects.find(e => /additional Damage/i.test(e.text || ''));
    const pct = (eff && eff.value) || 50;
    hpGatedAdditionalDamageLedger.push({ source: 'Ballista (Relic)', pct });
  }
  const sniperActive = SNIPER_SYNERGY && getActiveSynergies().some(s => s.id === SNIPER_SYNERGY.id);
  if (sniperActive) {
    const pct = (SNIPER_SYNERGY.effects[0] && SNIPER_SYNERGY.effects[0].value) || 25;
    hpGatedAdditionalDamageLedger.push({ source: 'Sniper (Synergy)', pct });
  }
  let hpGatedAdditionalDamageMult = 1;
  for (const a of hpGatedAdditionalDamageLedger) hpGatedAdditionalDamageMult *= (1 + a.pct / 100);

  const timeGatedAdditionalDamageLedger = [];
  if (BRAND_ARTIFACT && ownsArtifactByName('Brand')) {
    const pct = (BRAND_ARTIFACT.effects[0] && BRAND_ARTIFACT.effects[0].value) || 15;
    timeGatedAdditionalDamageLedger.push({ source: 'Brand (Relic, survived >5s)', pct });
  }
  let timeGatedAdditionalDamageMult = 1;
  for (const a of timeGatedAdditionalDamageLedger) timeGatedAdditionalDamageMult *= (1 + a.pct / 100);

  // Transcendence (Artifact): +15% All Magic Damage per currently-active spell that's at its own
  // max level — additive into the same mdmgPct pool as any other "Increase All Magic Damage"
  // source, since its own text uses that exact framing ("All Magic Damage increases by 15%").
  const transcendenceOwned = TRANSCENDENCE_ARTIFACT && ownsArtifactByName('Transcendence');
  const maxedSpellCount = transcendenceOwned ? countActiveSpellsAtMaxLevel() : 0;
  if (transcendenceOwned && maxedSpellCount) {
    const amt = 15 * maxedSpellCount;
    mdmgPct += amt;
    ledger.mdmg.push({ source: 'Transcendence (Relic, ' + maxedSpellCount + ' spells at max level)', text: 'Increase All Magic Damage by ' + amt + '%', amount: amt });
  }

  // Monarch (Synergy) and Crown (Artifact): +ATK% per owned Common/Rare/Epic/Special Artifact —
  // see artifactRarityScalingContribution above for the shared parsing.
  const monarchActive = MONARCH_SYNERGY && getActiveSynergies().some(s => s.id === MONARCH_SYNERGY.id);
  if (monarchActive) {
    const { atk, amp } = artifactRarityScalingContribution(MONARCH_SYNERGY);
    if (atk) { atkPct += atk; ledger.atk.push({ source: 'Monarch (Synergy)', text: 'Increase ATK by ' + atk + '%', amount: atk }); }
    if (amp) { ampPct += amp; ledger.amp.push({ source: 'Monarch (Synergy)', text: 'Amplify ATK by ' + amp + '%', amount: amp }); }
  }
  const crownOwned = CROWN_ARTIFACT && ownsArtifactByName('Crown');
  if (crownOwned) {
    const { atk, amp } = artifactRarityScalingContribution(CROWN_ARTIFACT);
    if (atk) { atkPct += atk; ledger.atk.push({ source: 'Crown (Relic)', text: 'Increase ATK by ' + atk + '%', amount: atk }); }
    if (amp) { ampPct += amp; ledger.amp.push({ source: 'Crown (Relic)', text: 'Amplify ATK by ' + amp + '%', amount: amp }); }
  }
  // Pyramid (Artifact): Amplify ATK by 3% per currently-active Synergy (reads the 3% off its own
  // structured effect rather than hardcoding it, unlike Monarch/Crown above).
  const pyramidOwned = PYRAMID_ARTIFACT && ownsArtifactByName('Pyramid');
  if (pyramidOwned) {
    const perSynergy = (PYRAMID_ARTIFACT.effects[0] && PYRAMID_ARTIFACT.effects[0].value) || 3;
    const synergyCount = getActiveSynergies().length;
    const amt = perSynergy * synergyCount;
    if (amt) { ampPct += amt; ledger.amp.push({ source: 'Pyramid (Relic, ' + synergyCount + ' active Synergies)', text: 'Amplify ATK by ' + amt + '%', amount: amt }); }
  }

  // Combination Magic Damage — Advanced Magic (Passive, +15%/stack up to 3), Dragontongue
  // (Artifact, flat +40%), Archmage (Class, flat +50% once unlocked), Dominus (Synergy, +25% per
  // currently-active Fusion). Kept out of classifyEffect/mdmgPct entirely (their raw text — e.g.
  // "Increase [Combination Magic] Damage by 〈15%〉." — would otherwise just fall through to 'other'
  // and silently do nothing, which is what happens today) since this bucket only multiplies the
  // Fusion-sourced share of xMultTotal below, not All Magic Damage broadly.
  let comboDamagePct = 0;
  const comboLedger = [];
  if (ADVANCED_MAGIC_PASSIVE) {
    const n = state.bonusSelections[bonusKey({ ...ADVANCED_MAGIC_PASSIVE, category: 'Passive' })] || 0;
    if (n) { const amt = 15 * n; comboDamagePct += amt; comboLedger.push({ source: 'Advanced Magic (Passive x' + n + ')', amount: amt }); }
  }
  if (DRAGONTONGUE_ARTIFACT && ownsArtifactByName('Dragontongue')) {
    comboDamagePct += 40; comboLedger.push({ source: 'Dragontongue (Relic)', amount: 40 });
  }
  if (ARCHMAGE_CLASS && state.classId === ARCHMAGE_CLASS.id) {
    // NOTE: the extracted data carries this class's Combination Magic Damage bonus as two
    // near-identical +50% text entries (one from description line 1, one from line 4) that both
    // survive classEffectUnlockLevel's text-matching and both get summed here — unconfirmed whether
    // that's a real double grant (like Wizard's two genuine Magic Bolt Lv+1 lines) or a single bonus
    // restated, so this may currently double-count Archmage specifically.
    for (const eff of unlockedClassEffects(ARCHMAGE_CLASS, state.classLevel)) {
      if (/Combination Magic\]? Damage/.test(eff.text || '')) {
        comboDamagePct += eff.value;
        comboLedger.push({ source: 'Archmage (Class Lv' + state.classLevel + ')', amount: eff.value });
      }
    }
  }
  const dominusActive = DOMINUS_SYNERGY && getActiveSynergies().some(s => s.id === DOMINUS_SYNERGY.id);
  if (dominusActive) {
    const perFusion = (DOMINUS_SYNERGY.effects[0] && DOMINUS_SYNERGY.effects[0].value) || 25;
    const activeFusionCount = state.fusionIds.length;
    const amt = perFusion * activeFusionCount;
    if (amt) { comboDamagePct += amt; comboLedger.push({ source: 'Dominus (Synergy, ' + activeFusionCount + ' active Combination Magic)', amount: amt }); }
  }
  // xMults is already fully populated by this point (the main effects loop above runs first) except
  // for Arbiter's own manual push later, which never carries the ' (Fusion)' tag anyway — so this
  // check is safe to run here, before mdmgPct/MDMG are finalized below.
  const comboDamageApplies = comboDamagePct !== 0 && xMults.some(x => x.source.endsWith(' (Fusion)'));
  if (comboDamageApplies) {
    mdmgPct += comboDamagePct;
    // Pushed into the same ledger.mdmg every other Magic Damage source uses, rather than a
    // separately-styled block — Active Sources previously showed this with its own purple
    // "stat-combo" color/format instead of the standard AMD tag every other contributor gets,
    // which read as inconsistent even though the underlying math was already correctly bucketed.
    for (const c of comboLedger) ledger.mdmg.push({ source: c.source, text: c.source, amount: c.amount });
  }

  // Accelerator (Artifact): "Decrease All Magic Cooldown by 1% for every 3% of Movement Speed
  // Increase" — a computed CDR contribution (like Overmind/DEM's penalty above), so it's pushed
  // into both cooldown ledgers directly rather than matched via classifyEffect's own text patterns.
  const acceleratorOwned = ACCELERATOR_ARTIFACT && ownsArtifactByName('Accelerator');
  if (acceleratorOwned && moveSpeedPct) {
    const ratio = (ACCELERATOR_ARTIFACT.effects[0] && ACCELERATOR_ARTIFACT.effects[0].value) || -1;
    const amt = ratio * (moveSpeedPct / 3);
    if (amt) {
      cooldownLedger.push({ source: 'Accelerator (Relic, Move Speed ' + fmtSigned(moveSpeedPct) + '%)', amount: amt });
      allMagicCooldownLedger.push({ source: 'Accelerator (Relic, Move Speed ' + fmtSigned(moveSpeedPct) + '%)', amount: amt });
    }
  }

  // Cooldown Reduction combines multiplicatively across unique sources (see multiplicativePoolMult),
  // not additively. cooldownPct/allMagicCooldownPct below are that multiplier re-expressed as a
  // signed percentage in the SAME convention the rest of the calculator already uses for CDR
  // (negative = a net reduction, positive = a net increase) — e.g. a combined 0.8 multiplier (20%
  // net reduction) becomes -20, matching what a single "-20%" additive entry would have produced.
  const cooldownMult = multiplicativePoolMult(cooldownLedger);
  const cooldownPct = (cooldownMult - 1) * 100;
  const allMagicCooldownMult = multiplicativePoolMult(allMagicCooldownLedger);
  const allMagicCooldownPct = (allMagicCooldownMult - 1) * 100;

  // Damage Reduction: same multiplicative-per-source pattern as CDR, expressed here as a positive
  // "total % reduction" (Aegis's own conversion reads this positive value directly, per the
  // confirmed "Amplify ATK by 3% for every 10% of Damage Taken [Reduction]" wording).
  const damageReductionMult = multiplicativePoolMult(damageTakenLedger);
  const damageReductionPct = (1 - damageReductionMult) * 100;

  // Max HP: additive bonus pool on top of the 200 base, then Undead's own "-25% Max HP" (the only
  // reduction source found dataset-wide) multiplies the total afterward rather than joining the
  // additive sum — confirmed: HP-cap/overheal effects elsewhere don't touch this value at all.
  const maxHpBeforeReduction = PLAYER_BASE_MAX_HP * (1 + maxHpBonusPct / 100);
  const maxHpTotal = maxHpBeforeReduction * Math.max(0, 1 - maxHpReductionPct / 100);

  // Gaia (Artifact): ATK% +3% per 20 (absolute) Max HP — reads the pool without depleting it.
  const gaiaOwned = GAIA_ARTIFACT && ownsArtifactByName('Gaia');
  if (gaiaOwned && maxHpTotal) {
    const perUnit = (GAIA_ARTIFACT.effects[0] && GAIA_ARTIFACT.effects[0].value) || 3;
    const amt = Math.round(perUnit * (maxHpTotal / 20) * 100) / 100;
    if (amt) { atkPct += amt; ledger.atk.push({ source: 'Gaia (Relic, Max HP ' + Math.round(maxHpTotal) + ')', text: 'Increase ATK by ' + amt + '%', amount: amt }); }
  }
  // Abyss (Artifact, Magnum Opus component): ATK% += half of the general Mana Acquisition Rate% —
  // a true conversion (removes half the source), though nothing downstream of manaAcquisitionPct
  // exists in this damage calculator to observe the depletion beyond the ATK% granted here.
  const abyssOwned = ABYSS_ARTIFACT && ownsArtifactByName('Abyss');
  if (abyssOwned && manaAcquisitionPct) {
    const amt = Math.round((manaAcquisitionPct / 2) * 100) / 100;
    if (amt) { atkPct += amt; ledger.atk.push({ source: 'Abyss (Relic, half of Mana Acquisition ' + fmtSigned(manaAcquisitionPct) + '%)', text: 'Increase ATK by ' + amt + '%', amount: amt }); }
  }
  // Aegis (Artifact): ATK Amp +3% per 10% Damage Reduction — reads the pool without depleting it.
  const aegisOwned = AEGIS_ARTIFACT && ownsArtifactByName('Aegis');
  const aegisPerUnit = (AEGIS_ARTIFACT && AEGIS_ARTIFACT.effects[0] && AEGIS_ARTIFACT.effects[0].value) || 3;
  let aegisRealAmt = 0;
  if (aegisOwned && damageReductionPct) {
    aegisRealAmt = Math.round(aegisPerUnit * (damageReductionPct / 10) * 100) / 100;
    if (aegisRealAmt) { ampPct += aegisRealAmt; ledger.amp.push({ source: 'Aegis (Relic, Damage Reduction ' + Math.round(damageReductionPct * 100) / 100 + '%)', text: 'Amplify ATK by ' + aegisRealAmt + '%', amount: aegisRealAmt }); }
  }
  // Mana Shield (Artifact): "Decrease Damage Taken by 50% of the current Mana percentage" — bounded
  // (Mana% caps at 100%), so "assume max" = assume full Mana = its raw effect value taken as a flat
  // Damage Taken Reduction contribution, combined into the SAME multiplicative reduction pool as
  // damageTakenLedger's real sources. Only matters for damage output through Aegis re-reading that
  // higher scenario reduction total — with no such reader owned, this has no measurable effect (a
  // real no-op, not a gap), so manaShieldScenarioAegisAmt stays equal to aegisRealAmt in that case.
  const manaShieldOwned = MANA_SHIELD_ARTIFACT && ownsArtifactByName('Mana Shield');
  const manaShieldMaxPct = manaShieldOwned
    ? ((MANA_SHIELD_ARTIFACT.effects.find(e => /Damage Taken/i.test(e.text || '')) || {}).value || 50)
    : 0;
  const manaShieldScenarioDamageReductionMult = manaShieldOwned ? damageReductionMult * (1 - manaShieldMaxPct / 100) : damageReductionMult;
  const manaShieldScenarioDamageReductionPct = (1 - manaShieldScenarioDamageReductionMult) * 100;
  const manaShieldScenarioAegisAmt = (aegisOwned && manaShieldScenarioDamageReductionPct)
    ? Math.round(aegisPerUnit * (manaShieldScenarioDamageReductionPct / 10) * 100) / 100
    : aegisRealAmt;
  // Akashic Record (Artifact): AMP% += 1 x player's current character level (the in-game tooltip's
  // "[2]" is a bracket-noise reference marker from a second, unrelated effect line rendered right
  // after it — see id 128's raw text — not a real divisor).
  const akashicRecordOwned = AKASHIC_RECORD_ARTIFACT && ownsArtifactByName('Akashic Record');
  if (akashicRecordOwned && state.playerLevel) {
    const perLevel = (AKASHIC_RECORD_ARTIFACT.effects.find(e => e.id === 128) || {}).value || 1;
    const amt = perLevel * state.playerLevel;
    if (amt) { ampPct += amt; ledger.amp.push({ source: 'Akashic Record (Relic, Character Lv' + state.playerLevel + ')', text: 'Amplify ATK by ' + amt + '%', amount: amt }); }
  }
  // Magic Wand / Otherworldly Tentacle: spell-specific Magic Damage% bonus, scaled by that spell's
  // own total computed projectile count — only applies while viewing that exact spell (Spirit /
  // Arcane Ray respectively), same scoping as Robot's Electric-Zone-only Additional Damage above.
  const magicWandOwned = MAGIC_WAND_ARTIFACT && ownsArtifactByName('Magic Wand');
  if (magicWandOwned && SPIRIT_SPELL && spell.name === 'Spirit') {
    const perUnit = (MAGIC_WAND_ARTIFACT.effects[0] && MAGIC_WAND_ARTIFACT.effects[0].value) || 10;
    const spiritCount = computeSpellTotalCount(SPIRIT_SPELL);
    const amt = perUnit * spiritCount;
    if (amt) { mdmgPct += amt; ledger.mdmg.push({ source: 'Magic Wand (Relic, ' + spiritCount + ' Spirits)', text: 'Increase Damage by ' + amt + '%', amount: amt }); }
  }
  const otherworldlyTentacleOwned = OTHERWORLDLY_TENTACLE_ARTIFACT && ownsArtifactByName('Otherworldly Tentacle');
  if (otherworldlyTentacleOwned && ARCANE_RAY_SPELL && spell.name === 'Arcane Ray') {
    const perUnit = (OTHERWORLDLY_TENTACLE_ARTIFACT.effects[0] && OTHERWORLDLY_TENTACLE_ARTIFACT.effects[0].value) || 8;
    const arcaneRayCount = computeSpellTotalCount(ARCANE_RAY_SPELL);
    const amt = perUnit * arcaneRayCount;
    if (amt) { mdmgPct += amt; ledger.mdmg.push({ source: 'Otherworldly Tentacle (Relic, ' + arcaneRayCount + ' Arcane Rays)', text: 'Increase Damage by ' + amt + '%', amount: amt }); }
  }
  // Photon Explosion (Fusion): "[Damage] and [Size] of Shields increase by 33% per Shield" — same
  // per-count shape as Magic Wand/Otherworldly Tentacle above. See PHOTON_EXPLOSION_FUSION for why
  // this is hand-coded rather than flowing through classifyEffect (pure description text, no
  // structured effect).
  const photonExplosionActive = PHOTON_EXPLOSION_FUSION && state.fusionIds.includes(PHOTON_EXPLOSION_FUSION.id);
  if (photonExplosionActive && SHIELD_SPELL && spell.name === 'Shield') {
    const shieldCount = computeSpellTotalCount(SHIELD_SPELL);
    const amt = 33 * shieldCount;
    if (amt) { mdmgPct += amt; ledger.mdmg.push({ source: 'Photon Explosion (Fusion, ' + shieldCount + ' Shields)', text: 'Increase Damage by ' + amt + '%', amount: amt }); }
  }
  // Bishop (Class): "For each active Shield, ATK is Amplified by 10%" — reads the class's own
  // structured effect value rather than hardcoding, same as Archmage's combo-damage block above.
  if (BISHOP_CLASS && state.classId === BISHOP_CLASS.id && SHIELD_SPELL) {
    for (const eff of unlockedClassEffects(BISHOP_CLASS, state.classLevel)) {
      if (/For each active Shield, ATK/.test(eff.text || '')) {
        const shieldCount = computeSpellTotalCount(SHIELD_SPELL);
        const amt = eff.value * shieldCount;
        if (amt) { ampPct += amt; ledger.amp.push({ source: 'Bishop (Class Lv' + state.classLevel + ', ' + shieldCount + ' Shields)', text: 'Amplify ATK by ' + amt + '%', amount: amt }); }
      }
    }
  }

  // Nexus: pick one Attack Spell to receive +240% Damage (scaled to +360% if Conflux is also
  // active, per Conflux's "1.5X the effect of Nexus" text). Its own raw text ("increase its Damage
  // by 240%") is phrased identically to any other MDMG-pool contributor, and the community
  // damage-formula guide explicitly lists "nexus" among "every source of MDMG" (base, magic level
  // up, class mastery, nexus, combination damage, spell specific damage, subject bonus) — so
  // despite reading like a flat multiplier at a glance, it's additive with the rest of the Magic
  // Damage pool, not a separate late-multiplicative factor the way Titan's Power really is.
  const nexusOwned = NEXUS_ARTIFACT && !!state.bonusSelections[bonusKey({ ...NEXUS_ARTIFACT, category: 'Artifact' })];
  const confluxActive = CONFLUX_SYNERGY && getActiveSynergies().some(s => s.id === CONFLUX_SYNERGY.id);
  const nexusBasePct = 240 * (confluxActive ? 1.5 : 1);
  // Re-validates state.nexusSpellId is still a real Attack Spell (same test as the dropdown's own
  // filter) rather than trusting it outright — guards against a stale value saved before that
  // filter existed, or a hand-edited localStorage value, pointing at Shield/Cloaking/Armageddon/
  // Magic Circle.
  const nexusSpellValid = state.nexusSpellId != null && GAMEDATA.classes.school.some(c => c.linkedSpellId === state.nexusSpellId);
  const nexusAppliesHere = nexusOwned && nexusSpellValid && state.nexusSpellId === state.selectedSpellId;
  if (nexusAppliesHere) {
    mdmgPct += nexusBasePct;
    ledger.mdmg.push({ source: 'Nexus (Relic' + (confluxActive ? ' + Conflux' : '') + ')', text: 'Increase Damage by ' + nexusBasePct + '%', amount: nexusBasePct });
  }

  // Matrix (Artifact): "All Magic Damage increases by 20% of the total of [All Magic Size, Duration
  // Increase Rate] and [Cooldown Reduction Rate]" — Cooldown Reduction Rate is the positive-framed
  // reduction amount, i.e. the negative side of allMagicCooldownPct's own sign convention (a
  // "Decrease All Magic Cooldown by 12%" effect leaves allMagicCooldownPct at -12, which is +12 CDR
  // here) — so matrixCDR is allMagicCooldownPct negated, not the raw pool value.
  const matrixOwned = MATRIX_ARTIFACT && ownsArtifactByName('Matrix');
  let matrixContribution = 0;
  if (matrixOwned) {
    const matrixCDR = -allMagicCooldownPct;
    const matrixRate = (MATRIX_ARTIFACT.effects[0] && MATRIX_ARTIFACT.effects[0].value) || 20;
    matrixContribution = Math.round((matrixRate / 100) * (sizePct + durationPct + matrixCDR) * 100) / 100;
    if (matrixContribution) {
      mdmgPct += matrixContribution;
      ledger.mdmg.push({
        source: 'Matrix (Relic, ' + matrixRate + '% of Size ' + fmtSigned(sizePct) + '% + Duration ' + fmtSigned(durationPct) + '% + CDR ' + fmtSigned(matrixCDR) + '%)',
        text: 'Increase All Magic Damage by ' + matrixContribution + '%', amount: matrixContribution,
      });
    }
  }
  // AGI (Synergy): requires owning Matrix, and extends that same computed number to ATK and AMP —
  // on top of Matrix's own AMD bonus above, not instead of it.
  const agiActive = AGI_SYNERGY && getActiveSynergies().some(s => s.id === AGI_SYNERGY.id);
  if (agiActive && matrixContribution) {
    atkPct += matrixContribution;
    ledger.atk.push({ source: 'AGI (Synergy, extends Matrix)', text: 'Increase ATK by ' + matrixContribution + '%', amount: matrixContribution });
    ampPct += matrixContribution;
    ledger.amp.push({ source: 'AGI (Synergy, extends Matrix)', text: 'Amplify ATK by ' + matrixContribution + '%', amount: matrixContribution });
  }

  // Wizard's Hat: +1% ATK per 2% All-Magic Cooldown Reduction Rate (same CDR reading as Matrix's
  // own CDR term above, independent of whether Matrix itself is owned).
  const wizardsHatOwned = WIZARDS_HAT_ARTIFACT && ownsArtifactByName('Wizard’s Hat');
  if (wizardsHatOwned) {
    const cdr = -allMagicCooldownPct;
    const ratio = (WIZARDS_HAT_ARTIFACT.effects[0] && WIZARDS_HAT_ARTIFACT.effects[0].value) || 1;
    const amt = Math.round(ratio * (cdr / 2) * 100) / 100;
    if (amt) {
      atkPct += amt;
      ledger.atk.push({ source: 'Wizard’s Hat (Relic, CDR ' + fmtSigned(cdr) + '%)', text: 'Increase ATK by ' + amt + '%', amount: amt });
    }
  }

  const ATKPreTitan = PLAYER_BASE_ATK * (1 + atkPct / 100);
  const AMP = 1 + ampPct / 100;
  const MDMG = Math.max(0, 1 + mdmgPct / 100);

  // Jet Engine / War Flag (Artifacts) — AMP is additive-then-multiplied (AMP = 1 + ampPct/100), so
  // the scenario multiplier for "what if this bonus were also active" isn't naively (1 + bonus/100)
  // — it has to be (new AMP)/(current AMP), computed against the actual ampPct already on the
  // build, same associativity trick used for expectedVsHighHp/expectedVsSurvived below.
  const jetEngineOwned = JET_ENGINE_ARTIFACT && ownsArtifactByName('Jet Engine');
  const jetEnginePct = jetEngineOwned
    ? ((JET_ENGINE_ARTIFACT.effects.find(e => /When moving/i.test(e.text || '')) || {}).value || 15)
    : 0;
  const jetEngineMult = jetEngineOwned ? (1 + (ampPct + jetEnginePct) / 100) / AMP : 1;

  const warFlagOwned = WAR_FLAG_ARTIFACT && ownsArtifactByName('War Flag');
  const warFlagMaxPct = warFlagOwned
    ? ((WAR_FLAG_ARTIFACT.effects.find(e => /Max Stack/i.test(e.text || '')) || {}).value || 20)
    : 0;
  const warFlagMult = warFlagOwned ? (1 + (ampPct + warFlagMaxPct) / 100) / AMP : 1;

  // Merlin's Cape / Magic Fountain — same "assume max" AMP-scenario shape as Jet Engine/War Flag,
  // just Mana-based rather than movement/positioning-based. Merlin's Cape's own coefficient IS its
  // max (100% Mana), Magic Fountain has its own separate stated Max Stack cap.
  const merlinsCapeOwned = MERLINS_CAPE_ARTIFACT && ownsArtifactByName('Merlin\'s Cape');
  const merlinsCapeMaxPct = merlinsCapeOwned ? ((MERLINS_CAPE_ARTIFACT.effects[0] && MERLINS_CAPE_ARTIFACT.effects[0].value) || 25) : 0;
  const merlinsCapeMult = merlinsCapeOwned ? (1 + (ampPct + merlinsCapeMaxPct) / 100) / AMP : 1;

  const magicFountainOwned = MAGIC_FOUNTAIN_ARTIFACT && ownsArtifactByName('Magic Fountain');
  const magicFountainMaxPct = magicFountainOwned
    ? ((MAGIC_FOUNTAIN_ARTIFACT.effects.find(e => /Max Stack/i.test(e.text || '')) || {}).value || 20)
    : 0;
  const magicFountainMult = magicFountainOwned ? (1 + (ampPct + magicFountainMaxPct) / 100) / AMP : 1;

  // Mana Shield — no direct AMP contribution of its own; its scenario instead substitutes
  // manaShieldScenarioAegisAmt for the real aegisRealAmt already folded into ampPct above, so the
  // multiplier collapses to exactly 1 (a true no-op) whenever Aegis isn't owned.
  const manaShieldMult = manaShieldOwned ? (1 + (ampPct - aegisRealAmt + manaShieldScenarioAegisAmt) / 100) / AMP : 1;

  // Arbiter (Synergy): flat x1.25 "Total Magic Damage Multiplier" — pushed into xMults like any
  // other multiplicative modifier so it shows up in the Special Modifiers list automatically.
  const arbiterActive = ARBITER_SYNERGY && getActiveSynergies().some(s => s.id === ARBITER_SYNERGY.id);
  if (arbiterActive) xMults.push({ source: 'Arbiter (Synergy) — Total Magic Damage Multiplier', amount: 1.25, dir: 'Increase' });

  // xMultTotal accumulates every X-multiplier effect (fusions' flat "10X" grants, evolutions,
  // ultimates below, Arbiter) into one running product. No fusion/non-fusion split needed anymore —
  // that used to exist solely so Combination Magic Damage could multiply just the Fusion share, but
  // it's additive with mdmgPct now instead (see comboDamageApplies above).
  let xMultTotal = 1;
  for (const x of xMults) {
    const m = x.dir === 'Decrease' ? (1 / x.amount) : x.amount;
    xMultTotal *= m;
  }

  // Titan's Power doesn't multiply total damage by 1.5x — per community-reported testing, it
  // transforms the character's own ATK stat directly: "take the amount of ATK in your stat screen
  // [before Titan], subtract 100, multiply that by 1.5, add the 100 back." So 100 ATK is an
  // untouched baseline and only the portion above it gets amplified — its effect flows entirely
  // through a modified ATK term, not a separate multiplicative bucket on the damage total.
  const titanOwned = TITANS_POWER && !!state.bonusSelections[bonusKey({ ...TITANS_POWER, category: 'Artifact' })];
  const ATK = titanOwned ? 100 + (ATKPreTitan - 100) * 1.5 : ATKPreTitan;

  // Space Warp: its explosion damage scales 1:1 with Cloaking's own total Duration multiplier (see
  // SPACE_WARP_EVOLUTION above for the confirming real-data calculation) — only while viewing
  // Cloaking with Space Warp actually picked and unlocked (same gating as any other evolution
  // effect). Folded into xMultTotal as its own factor, same treatment as Teleport's 3X (which
  // already applies correctly via the normal fusion-xmult pipeline below, unrelated to this).
  const spaceWarpEvoActive = !!(SPACE_WARP_EVOLUTION && spell.name === 'Cloaking' &&
    spellState(state.selectedSpellId).evolutions.has(SPACE_WARP_EVOLUTION.id) &&
    spellEvolutionTierUnlocked(spell, SPACE_WARP_EVOLUTION.tier, spellState(state.selectedSpellId).level));
  const cloakingDurationBonusPct = durationPct + durationSpellPct;
  const spaceWarpDurationMult = spaceWarpEvoActive ? Math.max(0, 1 + cloakingDurationBonusPct / 100) : 1;
  // xMultTotal was already fully accumulated from the xMults array above by this point in the
  // function (the loop that consumes xMults runs earlier, before Titan's Power) — so this factor is
  // multiplied in directly here rather than pushed into xMults, which would silently no-op this late.
  if (spaceWarpDurationMult !== 1) xMultTotal *= spaceWarpDurationMult;

  // Nuclear Fusion: see NUCLEAR_FUSION_EVOLUTION above for the confirming real-data calculation —
  // same gating pattern as Space Warp (evolution picked+unlocked, independent of any fusion).
  const nuclearFusionActive = !!(NUCLEAR_FUSION_EVOLUTION && spell.name === 'Satellite' &&
    spellState(state.selectedSpellId).evolutions.has(NUCLEAR_FUSION_EVOLUTION.id) &&
    spellEvolutionTierUnlocked(spell, NUCLEAR_FUSION_EVOLUTION.tier, spellState(state.selectedSpellId).level));
  const nuclearFusionMult = nuclearFusionActive ? computeSpellTotalCount(SATELLITE_SPELL) : 1;
  if (nuclearFusionMult !== 1) xMultTotal *= nuclearFusionMult;

  // Photon Explosion: "[Damage] increases in relation to [All Magic Size Increase]" — unlike
  // Furnace/Space Warp below, its own text names "All Magic Size Increase" specifically, not
  // Shield's own Size, so this reads the already-tracked All-Magic-wide sizePct pool directly
  // rather than a spell-specific one (see PHOTON_EXPLOSION_FUSION above for the 1:1 ratio caveat).
  const photonExplosionSizeMult = photonExplosionActive && spell.name === 'Shield' ? Math.max(0, 1 + sizePct / 100) : 1;
  if (photonExplosionSizeMult !== 1) xMultTotal *= photonExplosionSizeMult;

  // Furnace: "[Damage] increases in relation to Lava Zone's duration" — assumed 1:1 with Lava
  // Zone's own total Duration% (All-Magic-wide + Lava-Zone-specific sources combined), same
  // pattern as Space Warp's confirmed Cloaking-Duration scaling above (see FURNACE_FUSION).
  const furnaceActive = FURNACE_FUSION && state.fusionIds.includes(FURNACE_FUSION.id);
  const lavaZoneDurationBonusPct = durationPct + durationSpellPct;
  const furnaceDurationMult = furnaceActive && spell.name === 'Lava Zone' ? Math.max(0, 1 + lavaZoneDurationBonusPct / 100) : 1;
  if (furnaceDurationMult !== 1) xMultTotal *= furnaceDurationMult;

  // Gate: "Flash Shock Size Increase is converted into Damage" — assumed 1:1 with Flash Shock's own
  // total Size% (All-Magic-wide + Flash-Shock-specific sources combined), same pattern as Furnace's
  // Duration scaling above (see GATE_FUSION).
  const gateActive = GATE_FUSION && state.fusionIds.includes(GATE_FUSION.id);
  const flashShockSizeBonusPct = sizePct + sizeSpellPct;
  const gateSizeMult = gateActive && spell.name === 'Flash Shock' ? Math.max(0, 1 + flashShockSizeBonusPct / 100) : 1;
  if (gateSizeMult !== 1) xMultTotal *= gateSizeMult;

  // UNVERIFIED, HELD PENDING REVIEW (see the comment block near GHASTLY_RAMPAGE_FUSION's declaration
  // above) — the six blocks below plus High Output all assume the same unconfirmed 1:1 ratio and
  // separate-xMultTotal-factor bucketing Gate/Furnace use, by analogy only. Not committed/pushed yet.

  // Ghastly Rampage: "Fireball Duration Increase is converted proportionally into Damage."
  const ghastlyRampageActive = GHASTLY_RAMPAGE_FUSION && state.fusionIds.includes(GHASTLY_RAMPAGE_FUSION.id);
  const fireballDurationBonusPct = durationPct + durationSpellPct;
  const ghastlyRampageDurationMult = ghastlyRampageActive && spell.name === 'Fireball' ? Math.max(0, 1 + fireballDurationBonusPct / 100) : 1;
  if (ghastlyRampageDurationMult !== 1) xMultTotal *= ghastlyRampageDurationMult;

  // Prism Spray: "Arcane Ray Duration Increase is converted proportionally into Damage." No curated
  // ultimate exists for Prism Spray to cross-check this ratio against.
  const prismSprayActive = PRISM_SPRAY_FUSION && state.fusionIds.includes(PRISM_SPRAY_FUSION.id);
  const arcaneRayDurationBonusPct = durationPct + durationSpellPct;
  const prismSprayDurationMult = prismSprayActive && spell.name === 'Arcane Ray' ? Math.max(0, 1 + arcaneRayDurationBonusPct / 100) : 1;
  if (prismSprayDurationMult !== 1) xMultTotal *= prismSprayDurationMult;

  // Great Rift: "Frost Nova Size Increase is converted proportionally into Damage." No curated
  // ultimate exists for Great Rift to cross-check this ratio against.
  const greatRiftActive = GREAT_RIFT_FUSION && state.fusionIds.includes(GREAT_RIFT_FUSION.id);
  const frostNovaSizeBonusPct = sizePct + sizeSpellPct;
  const greatRiftSizeMult = greatRiftActive && spell.name === 'Frost Nova' ? Math.max(0, 1 + frostNovaSizeBonusPct / 100) : 1;
  if (greatRiftSizeMult !== 1) xMultTotal *= greatRiftSizeMult;

  // Black Death: "Fireball Size Increase is converted proportionally into Damage." Black Death also
  // has a separate "Convert Piercing to 50% of Count" line — a different, non-damage mechanic,
  // deliberately NOT implemented here.
  const blackDeathActive = BLACK_DEATH_FUSION && state.fusionIds.includes(BLACK_DEATH_FUSION.id);
  const fireballSizeBonusPctForBlackDeath = sizePct + sizeSpellPct;
  const blackDeathSizeMult = blackDeathActive && spell.name === 'Fireball' ? Math.max(0, 1 + fireballSizeBonusPctForBlackDeath / 100) : 1;
  if (blackDeathSizeMult !== 1) xMultTotal *= blackDeathSizeMult;

  // Genocide: "Arcane Ray Size Increase is converted proportionally into Damage." Genocide also has a
  // separate "Count increases Damage Multiplier by 4 each" line — a different, count-based mechanic,
  // deliberately NOT implemented here.
  const genocideActive = GENOCIDE_FUSION && state.fusionIds.includes(GENOCIDE_FUSION.id);
  const arcaneRaySizeBonusPct = sizePct + sizeSpellPct;
  const genocideSizeMult = genocideActive && spell.name === 'Arcane Ray' ? Math.max(0, 1 + arcaneRaySizeBonusPct / 100) : 1;
  if (genocideSizeMult !== 1) xMultTotal *= genocideSizeMult;

  // Hyperion: "Satellite Size Increase is converted proportionally into Damage" — an ADDITIONAL factor
  // layered on top of the existing, separately-confirmed Nuclear-Fusion-adjacent count-based mechanic
  // above (nuclearFusionMult). Must not disturb that existing calculation, only multiply in alongside it.
  const hyperionActive = HYPERION_FUSION && state.fusionIds.includes(HYPERION_FUSION.id);
  const satelliteSizeBonusPct = sizePct + sizeSpellPct;
  const hyperionSizeMult = hyperionActive && spell.name === 'Satellite' ? Math.max(0, 1 + satelliteSizeBonusPct / 100) : 1;
  if (hyperionSizeMult !== 1) xMultTotal *= hyperionSizeMult;

  // High Output (Electric Shock evolution, NOT fusion-gated): "Size Increase is converted proportionally
  // into Damage." Uses the same evolution-active pattern as Space Warp/Nuclear Fusion's own gating.
  const highOutputActive = !!(HIGH_OUTPUT_EVOLUTION && spell.name === 'Electric Shock' &&
    spellState(state.selectedSpellId).evolutions.has(HIGH_OUTPUT_EVOLUTION.id) &&
    spellEvolutionTierUnlocked(spell, HIGH_OUTPUT_EVOLUTION.tier, spellState(state.selectedSpellId).level));
  const electricShockSizeBonusPct = sizePct + sizeSpellPct;
  const highOutputSizeMult = highOutputActive ? Math.max(0, 1 + electricShockSizeBonusPct / 100) : 1;
  if (highOutputSizeMult !== 1) xMultTotal *= highOutputSizeMult;

  // Black Hole: explicit 3X ratio (see BLACK_HOLE_FUSION above), not the 1:1-by-analogy assumption
  // the other items in this block carry.
  const blackHoleActive = BLACK_HOLE_FUSION && state.fusionIds.includes(BLACK_HOLE_FUSION.id);
  const cycloneDurationBonusPctForBlackHole = durationPct + durationSpellPct;
  const blackHoleDurationMult = blackHoleActive && spell.name === 'Cyclone' ? Math.max(0, 1 + 3 * cycloneDurationBonusPctForBlackHole / 100) : 1;
  if (blackHoleDurationMult !== 1) xMultTotal *= blackHoleDurationMult;

  // Plasma Ray: "Arcane Ray Damage Multiplier increases by 1 per count" — see
  // computePlasmaRayRayCount above for how the ray count itself is derived.
  const plasmaRayActive = PLASMA_RAY_FUSION && state.fusionIds.includes(PLASMA_RAY_FUSION.id);
  const plasmaRayRayCount = plasmaRayActive ? computePlasmaRayRayCount() : 0;
  const plasmaRayMult = plasmaRayActive && spell.name === 'Arcane Ray' ? 1 + plasmaRayRayCount : 1;
  if (plasmaRayMult !== 1) xMultTotal *= plasmaRayMult;

  // Telekinetic Sword: see computeTelekineticSwordStacks above.
  const telekineticSwordActive = TELEKINETIC_SWORD_FUSION && state.fusionIds.includes(TELEKINETIC_SWORD_FUSION.id);
  const telekineticSwordStacks = telekineticSwordActive ? computeTelekineticSwordStacks() : 0;
  const telekineticSwordMult = telekineticSwordActive && spell.name === 'Spirit' ? 1 + telekineticSwordStacks : 1;
  if (telekineticSwordMult !== 1) xMultTotal *= telekineticSwordMult;

  // Super Cyclone: no damage math here (see SUPER_CYCLONE_FUSION above) — just a flag for the UI
  // caveat note, true only while actually viewing Cyclone with the fusion active.
  const superCycloneActive = !!(SUPER_CYCLONE_FUSION && spell.name === 'Cyclone' && state.fusionIds.includes(SUPER_CYCLONE_FUSION.id));

  // Inferno: same treatment as Super Cyclone above (see INFERNO_FUSION) — no damage math, just a
  // flag for the UI caveat note.
  const infernoActive = !!(INFERNO_FUSION && spell.name === 'Incineration' && state.fusionIds.includes(INFERNO_FUSION.id));

  // Ultimates — only the ones belonging to a fusion whose parent spell is the one currently
  // being viewed actually apply (a Meteor ultimate shouldn't multiply Magic Bolt's damage).
  const activeUltimates = [];
  for (const fusionId of state.fusionIds) {
    const fusion = GAMEDATA.fusions.find(f => f.id === fusionId);
    const ult = getUltimateInfo(fusion);
    if (!ult || ult.verified === 'unusable') continue;
    if (!state.ultimatesOn[fusionId]) continue;
    if (fusionPrimarySpellId(fusion) !== state.selectedSpellId) continue;
    if (!isUltimateUnlocked(fusion)) continue;
    let mult = null;
    if (ult.special === 'raySquared') mult = plasmaRayRayCount * plasmaRayRayCount;
    else if (ult.special === 'critScalingLinear') mult = ult.multiplier + (ult.multiplierMax - ult.multiplier) * (critChance / 100);
    else if (ult.multiplier) mult = ult.multiplier;
    if (mult) { xMultTotal *= mult; activeUltimates.push({ ult, mult }); }
  }

  const base = spell.base ? spell.base.damage : null;
  const nonCrit = base != null ? base * ATK * AMP * MDMG * demMult * classMult * additionalDamageMult * xMultTotal : null;
  // Titan's delta: recompute with the pre-Titan ATK substituted in, holding every other factor
  // constant — well-defined since multiplication commutes.
  const nonCritWithoutTitan = base != null && titanOwned ? base * ATKPreTitan * AMP * MDMG * demMult * classMult * additionalDamageMult * xMultTotal : null;
  const titanDelta = nonCritWithoutTitan != null ? nonCrit - nonCritWithoutTitan : null;
  // Joker: chance = min(50%, critChance / 2) per crit to double the BONUS portion of the crit
  // multiplier (critMulti - 200) an additional time, not the flat 200% base — folded directly into
  // critMultFactor as an expected value across that chance, same treatment as crit chance/crit
  // multiplier themselves already get. See JOKER_ARTIFACT above: unverified against actual game
  // logic, modeled per the user's own community-sourced description.
  const jokerOwned = JOKER_ARTIFACT && ownsArtifactByName('Joker');
  const jokerProcChance = jokerOwned ? Math.min(50, critChance / 2) / 100 : 0;
  const critMultiWithJoker = jokerOwned ? critMulti + jokerProcChance * (critMulti - 200) : critMulti;
  const critMultFactor = critMultiWithJoker / 100;
  const crit = nonCrit != null ? nonCrit * critMultFactor : null;
  // Heartbreaker's delta: same idea as titanDelta — recompute crit with the pre-Heartbreaker crit
  // multiplier substituted in, holding nonCrit constant.
  const critWithoutHeartbreaker = nonCrit != null && heartbreakerActive ? nonCrit * (critMultiPreHeartbreaker / 100) : null;
  const heartbreakerDelta = critWithoutHeartbreaker != null ? crit - critWithoutHeartbreaker : null;
  // Siege Hammer: +N% Additional Damage on non-crit hits only — the non-crit condition's own
  // probability (1 - critChance) is already tracked, so it folds directly into the expected-damage
  // weighting rather than becoming an unknowable "if this condition holds" scenario like the HP%/
  // time-gated group above. nonCrit itself (and crit, derived from it) stay untouched — only the
  // weighted expected value reflects Siege Hammer's bonus.
  const siegeHammerOwned = SIEGE_HAMMER_ARTIFACT && ownsArtifactByName('Siege Hammer');
  const siegeHammerPct = siegeHammerOwned
    ? ((SIEGE_HAMMER_ARTIFACT.effects.find(e => /not a Critical Strike/i.test(e.text || '')) || {}).value || 20)
    : 0;
  const nonCritWithSiegeHammer = nonCrit != null ? nonCrit * (1 + siegeHammerPct / 100) : null;
  const expected = nonCrit != null ? nonCritWithSiegeHammer * (1 - critChance / 100) + crit * (critChance / 100) : null;
  // Conditional Modifiers — scenario damage figures when the HP%/time-gated Additional Damage
  // sources' own condition holds. Scaling the already-fully-computed expected value directly is
  // exactly equivalent to baking the factor into nonCrit/crit from the start (multiplication is
  // associative), so no need to recompute the whole formula for each scenario.
  const expectedVsHighHp = expected != null && hpGatedAdditionalDamageLedger.length ? expected * hpGatedAdditionalDamageMult : null;
  const expectedVsSurvived = expected != null && timeGatedAdditionalDamageLedger.length ? expected * timeGatedAdditionalDamageMult : null;
  const expectedVsMoving = expected != null && jetEngineOwned ? expected * jetEngineMult : null;
  const expectedVsStandingStill = expected != null && warFlagOwned ? expected * warFlagMult : null;
  const expectedVsFullManaCape = expected != null && merlinsCapeOwned ? expected * merlinsCapeMult : null;
  const expectedVsMaxManaOrbs = expected != null && magicFountainOwned ? expected * magicFountainMult : null;
  const expectedVsFullManaShield = expected != null && manaShieldOwned && aegisOwned ? expected * manaShieldMult : null;
  // Effective Damage — same associativity trick, applied to the enemy-Max-HP-reduction/Execute
  // multipliers computed way above (before expected existed yet). The Effective Damage section
  // previously only showed the multiplier itself with no resulting damage figure, unlike Conditional
  // Modifiers' scenario rows which always paired the multiplier with an actual number.
  const expectedEffectiveVsNormal = expected != null ? expected * effectiveDamageMultVsNormal : null;
  const expectedEffectiveVsElite = expected != null ? expected * effectiveDamageMultVsElite : null;
  const expectedEffectiveVsLarge = expected != null ? expected * effectiveDamageMultVsLarge : null;
  const expectedEffectiveVsBossWave = expected != null ? expected * effectiveDamageMultVsBossWave : null;
  const expectedEffectiveVsNormalWave = expected != null ? expected * effectiveDamageMultVsNormalWave : null;

  return {
    spell, ATK, ATKPreTitan, AMP, MDMG, xMultTotal, xMults, base, nonCrit, crit, expected,
    critChance, critMulti, critMultiPreHeartbreaker, critChancePct, critMultPct,
    atkPct, ampPct, mdmgPct, cooldownPct, countFlat, ledger, active,
    totalLevels, overmindActive, demActive, demMult, classMult, classScaling, activeUltimates,
    titanOwned, titanDelta, nexusOwned, nexusAppliesHere, confluxActive,
    arbiterActive, heartbreakerActive, heartbreakerDelta,
    monarchActive, crownOwned, pyramidOwned,
    comboDamagePct, comboLedger, comboDamageApplies, dominusActive,
    sizePct, durationPct, allMagicCooldownPct, matrixOwned, matrixContribution, agiActive,
    additionalDamageLedger, additionalDamageMult, transcendenceOwned, maxedSpellCount, wizardsHatOwned,
    evasionPct, pickupRangePct, manaAcquisitionPct, moveSpeedPct, maxHpTotal, maxHpBonusPct, maxHpReductionPct,
    evasionLedger, pickupRangeLedger, manaAcquisitionLedger, moveSpeedLedger, maxHpBonusLedger, maxHpReductionLedgerPlayer,
    damageTakenLedger,
    damageReductionPct, oculusOwned, carnivalOwned, gaiaOwned, abyssOwned, acceleratorOwned, aegisOwned,
    akashicRecordOwned, magicWandOwned, otherworldlyTentacleOwned,
    spaceWarpEvoActive, cloakingDurationBonusPct, spaceWarpDurationMult, durationSpellPct,
    nuclearFusionActive, nuclearFusionMult,
    photonExplosionActive, photonExplosionSizeMult, furnaceActive, furnaceDurationMult, gateActive, gateSizeMult, sizeSpellPct, plasmaRayActive, plasmaRayMult, plasmaRayRayCount,
    ghastlyRampageActive, ghastlyRampageDurationMult, prismSprayActive, prismSprayDurationMult, greatRiftActive, greatRiftSizeMult,
    blackDeathActive, blackDeathSizeMult, genocideActive, genocideSizeMult, hyperionActive, hyperionSizeMult, highOutputActive, highOutputSizeMult,
    blackHoleActive, blackHoleDurationMult,
    telekineticSwordActive, telekineticSwordStacks, telekineticSwordMult, superCycloneActive, infernoActive,
    venomOwned, occultOwned, magicSwordOwned, egoSwordActive, executeThresholdPct, effectiveDamageActive,
    enemyMaxHpReductionGeneralPct, enemyMaxHpReductionGeneralFraction,
    enemyMaxHpReductionElitePct, enemyMaxHpReductionLargePct,
    enemyMaxHpReductionEliteFraction, enemyMaxHpReductionLargeFraction,
    enemyMaxHpModBossWavePct, enemyMaxHpModNormalWavePct,
    enemyMaxHpModBossWaveFraction, enemyMaxHpModNormalWaveFraction,
    enemyMaxHpReductionVsNormal, enemyMaxHpReductionVsElite, enemyMaxHpReductionVsLarge,
    enemyMaxHpReductionVsBossWave, enemyMaxHpReductionVsNormalWave,
    effectiveDamageMultVsNormal, effectiveDamageMultVsElite, effectiveDamageMultVsLarge,
    effectiveDamageMultVsBossWave, effectiveDamageMultVsNormalWave,
    requiredDamageFractionVsNormal, requiredDamageFractionVsElite, requiredDamageFractionVsLarge,
    requiredDamageFractionVsBossWave, requiredDamageFractionVsNormalWave,
    expectedEffectiveVsNormal, expectedEffectiveVsElite, expectedEffectiveVsLarge,
    expectedEffectiveVsBossWave, expectedEffectiveVsNormalWave,
    sniperActive, hpGatedAdditionalDamageLedger, hpGatedAdditionalDamageMult, expectedVsHighHp,
    timeGatedAdditionalDamageLedger, timeGatedAdditionalDamageMult, expectedVsSurvived,
    jetEngineOwned, jetEnginePct, jetEngineMult, expectedVsMoving,
    warFlagOwned, warFlagMaxPct, warFlagMult, expectedVsStandingStill,
    merlinsCapeOwned, merlinsCapeMaxPct, merlinsCapeMult, expectedVsFullManaCape,
    magicFountainOwned, magicFountainMaxPct, magicFountainMult, expectedVsMaxManaOrbs,
    manaShieldOwned, manaShieldMaxPct, manaShieldMult, expectedVsFullManaShield,
    siegeHammerOwned, siegeHammerPct, nonCritWithSiegeHammer,
    jokerOwned, jokerProcChance, critMultiWithJoker, widowmakerOwned,
  };
}

// ===================== Rendering =====================
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}
const fmt = (n, d = 0) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtSigned = (n, d = 1) => (n > 0 ? '+' : '') + fmt(n, d);

// Icons were mined from the same APK as everything else, keyed by the same internal ids used
// throughout gamedata.json (confirmed by cross-checking known items against their art — e.g.
// artifact id 41 "ASI" -> Ability41Portrait, fusion id 1 "Empyrean Wrath" -> its lightning icon).
// ICON_MAP: semantic key ("artifact:41") -> source filename. ICON_DATA: filename -> data URI.
// Evolutions and Test Subjects have no unique art in the client, so their manifest entries just
// point at their parent spell's icon file already.
function iconUrl(key) {
  const file = ICON_MAP[key];
  return file ? ICON_DATA[file] : null;
}
function iconImg(key, className) {
  const url = iconUrl(key);
  if (!url) return null;
  // Explicit intrinsic width/height (every source sprite is ~62-64px) — every CSS class that sizes
  // these (.pi-icon, .ic-icon, etc.) still wins via its own width/height rule, so this changes no
  // layout; it just gives the browser the real decode size upfront instead of inferring it, which
  // some mobile renderers handle more reliably for small-scale-downscaled inline images.
  return el('img', { class: 'icon-img' + (className ? ' ' + className : ''), src: url, alt: '', width: '64', height: '64' });
}

// Native confirm()/alert() can be blocked or unreliable inside a sandboxed iframe (e.g. an
// Artifact preview), so every destructive/overwriting action here uses an inline "are you sure"
// toggle instead: { type: 'save'|'load'|'delete'|'reset', name?: string }, or null.
let pendingConfirm = null;
let loadoutNameDraft = ''; // preserved across re-renders so confirming save doesn't lose the typed name
const cardSearchDrafts = {}; // { category: searchText } — per-tab search boxes on the card browser

function confirmRow(message, onYes) {
  return el('div', { style: 'display:flex; gap:10px; align-items:center;' }, [
    el('span', { style: 'flex:1; color:var(--crit); font-size:12px;' }, message),
    el('button', { class: 'linklike', style: 'color:var(--crit);', onclick: () => { onYes(); pendingConfirm = null; renderAll(); } }, 'Yes'),
    el('button', { class: 'linklike', onclick: () => { pendingConfirm = null; renderAll(); } }, 'Cancel'),
  ]);
}

function renderLoadoutsSection() {
  const loadouts = getLoadouts();
  const names = Object.keys(loadouts).sort();

  let saveArea;
  if (pendingConfirm && pendingConfirm.type === 'save') {
    const overwriting = names.includes(pendingConfirm.name);
    saveArea = confirmRow(
      (overwriting ? 'Overwrite existing loadout "' : 'Save as "') + pendingConfirm.name + '"?',
      () => saveLoadout(pendingConfirm.name)
    );
  } else {
    const nameInput = el('input', {
      type: 'text', placeholder: 'Loadout name…', value: loadoutNameDraft,
      oninput: e => { loadoutNameDraft = e.target.value; },
    });
    const saveBtn = el('button', {
      class: 'linklike', style: 'border:1px solid var(--border); border-radius:4px; padding:6px 10px;',
      onclick: () => {
        const name = loadoutNameDraft.trim();
        if (!name) { nameInput.focus(); return; }
        pendingConfirm = { type: 'save', name };
        renderAll();
      },
    }, 'Save current as…');
    saveArea = el('div', { style: 'display:flex; gap:6px;' }, [nameInput, saveBtn]);
  }

  const list = el('div', { class: 'pick-list', style: names.length ? '' : 'display:none;' });
  for (const name of names) {
    if (pendingConfirm && pendingConfirm.type === 'load' && pendingConfirm.name === name) {
      list.appendChild(el('div', { class: 'pick-item', style: 'cursor:default;' }, [
        confirmRow('Load "' + name + '"? Replaces your current unsaved progress.', () => loadLoadout(name)),
      ]));
    } else if (pendingConfirm && pendingConfirm.type === 'delete' && pendingConfirm.name === name) {
      list.appendChild(el('div', { class: 'pick-item', style: 'cursor:default;' }, [
        confirmRow('Delete "' + name + '"?', () => deleteLoadout(name)),
      ]));
    } else {
      list.appendChild(el('div', { class: 'pick-item', style: 'cursor:default;' }, [
        el('div', { style: 'flex:1; cursor:pointer;', onclick: () => { pendingConfirm = { type: 'load', name }; renderAll(); } }, name),
        el('button', { class: 'linklike', title: 'Delete loadout', onclick: () => { pendingConfirm = { type: 'delete', name }; renderAll(); } }, '✕'),
      ]));
    }
  }

  const resetBtn = (pendingConfirm && pendingConfirm.type === 'reset')
    ? confirmRow('Clear everything? (saved loadouts are kept)', () => resetAll())
    : el('button', {
        class: 'linklike', style: 'margin-top:10px; color:var(--crit);',
        onclick: () => { pendingConfirm = { type: 'reset' }; renderAll(); },
      }, 'Clear All / Reset');

  return el('div', { class: 'section' }, [
    el('div', { class: 'section-title' }, 'Loadouts'),
    el('div', { style: 'margin-bottom:8px;' }, saveArea),
    list,
    !names.length ? el('div', { class: 'note' }, 'No saved loadouts yet.') : null,
    resetBtn,
  ]);
}

// Level stepper for a selected Class/Test Subject — null when nothing's selected. Clamps the
// stored level down if it's stale from a previously-selected class with a higher max level.
function classLevelStepper(cls, stateKey, label) {
  if (!cls) return null;
  const max = classMaxLevel(cls);
  if (state[stateKey] > max) state[stateKey] = max;
  if (state[stateKey] < 1) state[stateKey] = 1;
  const level = state[stateKey];
  return el('div', { class: 'stepper', style: 'margin-top:8px;' }, [
    el('span', { style: 'font-size:12px; color:var(--text-dim); margin-right:auto;' }, label),
    el('button', {
      onclick: () => { if (state[stateKey] > 1) { state[stateKey]--; renderAll(); } },
      disabled: level <= 1 ? 'disabled' : null,
    }, '−'),
    el('span', { class: 'num' }, level + ' / ' + max),
    el('button', {
      onclick: () => { if (state[stateKey] < max) { state[stateKey]++; renderAll(); } },
      disabled: level >= max ? 'disabled' : null,
    }, '+'),
  ]);
}

function renderLeftPane() {
  const pane = document.getElementById('leftPane');
  pane.innerHTML = '';

  pane.appendChild(renderLoadoutsSection());

  // Character
  const charSection = el('div', { class: 'section' }, [
    el('div', { class: 'section-title' }, 'Character'),
    el('div', { class: 'field-label' }, [el('span', {}, 'Base ATK'), el('span', { class: 'val' }, String(PLAYER_BASE_ATK))]),
    (() => {
      const playerLevelVal = el('span', { class: 'val' }, String(state.playerLevel));
      return el('label', { class: 'field' }, [
        el('div', { class: 'field-label' }, [el('span', {}, 'Player Level (this run)'), playerLevelVal]),
        el('input', {
          type: 'number', value: state.playerLevel, min: '1', step: '1',
          // Patches the value + re-renders only what's downstream (main pane's scaling display,
          // results pane's totals) rather than renderAll() — a full left-pane rebuild would
          // replace this very input mid-keystroke and drop focus, same bug the search boxes had.
          // saveAutosave() is called directly here since it's the one thing renderAll() would
          // otherwise have provided (it only touches localStorage, not the DOM, so it's safe
          // alongside the focus-preserving partial render) — without it, Player Level was live in
          // the UI but silently never persisted, resetting to 1 on every reload.
          oninput: e => {
            state.playerLevel = Math.max(1, parseInt(e.target.value, 10) || 1);
            playerLevelVal.textContent = String(state.playerLevel);
            renderMainPane();
            renderResultsPane();
            saveAutosave();
          },
        }),
      ]);
    })(),
    el('label', { class: 'field' }, [
      el('div', { class: 'field-label' }, [el('span', {}, 'Class (School)')]),
      el('div', { class: 'select-icon-row' }, [
        iconImg('class:' + state.classId),
        (() => {
          const sel = el('select', { onchange: e => { state.classId = e.target.value ? parseInt(e.target.value, 10) : null; renderAll(); } });
          sel.appendChild(el('option', { value: '' }, '— None —'));
          for (const c of [...GAMEDATA.classes.school].sort((a, b) => a.name.localeCompare(b.name))) {
            const linkedSpell = c.linkedSpellId != null && classGatesAnyUltimate(c) ? GAMEDATA.spells[c.linkedSpellId] : null;
            const opt = el('option', { value: c.id }, c.name + (linkedSpell ? ' — ' + linkedSpell.name : ''));
            if (state.classId === c.id) opt.setAttribute('selected', 'selected');
            sel.appendChild(opt);
          }
          return sel;
        })(),
      ]),
      classLevelStepper(GAMEDATA.classes.school.find(c => c.id === state.classId), 'classLevel', 'Class Level'),
    ]),
    el('label', { class: 'field' }, [
      el('div', { class: 'field-label' }, [el('span', {}, 'Test Subject')]),
      el('div', { class: 'select-icon-row' }, [
        iconImg('testSubject:' + state.testSubjectId),
        (() => {
          const sel = el('select', { onchange: e => { state.testSubjectId = e.target.value ? parseInt(e.target.value, 10) : null; renderAll(); } });
          sel.appendChild(el('option', { value: '' }, '— None —'));
          for (const c of [...GAMEDATA.classes.testSubject].sort((a, b) => a.name.localeCompare(b.name))) {
            const linkedSpell = c.linkedSpellId != null && testSubjectGatesAnyUltimate(c) ? GAMEDATA.spells[c.linkedSpellId] : null;
            const opt = el('option', { value: c.id }, c.name + (linkedSpell ? ' — ' + linkedSpell.name : ''));
            if (state.testSubjectId === c.id) opt.setAttribute('selected', 'selected');
            sel.appendChild(opt);
          }
          return sel;
        })(),
      ]),
    ]),
  ]);
  pane.appendChild(charSection);

  // Nexus — only relevant once owned: pick which one spell gets its +240% (×1.5 more if Conflux
  // is also active) damage bonus.
  if (NEXUS_ARTIFACT && !!state.bonusSelections[bonusKey({ ...NEXUS_ARTIFACT, category: 'Artifact' })]) {
    const confluxOn = CONFLUX_SYNERGY && getActiveSynergies().some(s => s.id === CONFLUX_SYNERGY.id);
    const nexusSection = el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, 'Nexus'),
      el('label', { class: 'field' }, [
        el('div', { class: 'field-label' }, [el('span', {}, 'Spell chosen for +' + (confluxOn ? '360' : '240') + '% Damage')]),
        (() => {
          const sel = el('select', { onchange: e => { state.nexusSpellId = e.target.value ? parseInt(e.target.value, 10) : null; renderAll(); } });
          sel.appendChild(el('option', { value: '' }, '— None —'));
          // Nexus can only target a real Attack Spell — the same "has a linked Class" test used
          // for Ultimate-unlocking distinguishes this exactly (Shield/Cloaking/Armageddon/Magic
          // Circle are the 4 utility spells with none). A plain `s.base` check isn't enough: every
          // spell has a base object, including those 4 (Shield/Cloaking specifically have
          // base.damage too, for Photon Explosion/Teleport's own use).
          for (const s of Object.values(GAMEDATA.spells).filter(s => GAMEDATA.classes.school.some(c => c.linkedSpellId === s.id)).sort((a, b) => a.name.localeCompare(b.name))) {
            const opt = el('option', { value: s.id }, s.name);
            if (state.nexusSpellId === s.id) opt.setAttribute('selected', 'selected');
            sel.appendChild(opt);
          }
          return sel;
        })(),
        confluxOn ? el('div', { class: 'note' }, 'Conflux is active: ×1.5 applied to Nexus\'s own bonus.') : null,
      ]),
    ]);
    pane.appendChild(nexusSection);
  }

  // Enchant — only relevant once owned: one dropdown per owned level (max 3), each independently
  // picking a Spell for Enchant's own +50% Damage (×2 with Fairy) plus that Spell's own unique
  // secondary effect.
  const enchantLevel = ENCHANT_ITEM ? (state.bonusSelections[bonusKey({ ...ENCHANT_ITEM, category: 'Passive' })] || 0) : 0;
  if (enchantLevel > 0) {
    const fairyOn = FAIRY_ARTIFACT && ownsArtifactByName('Fairy');
    const enchantableSpells = Object.values(GAMEDATA.spells).filter(s => s.enchant).sort((a, b) => a.name.localeCompare(b.name));
    const enchantSection = el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, 'Enchant'),
      fairyOn ? el('div', { class: 'note' }, 'Fairy is active: ×2 applied to Enchant\'s own bonuses.') : null,
    ]);
    for (let i = 0; i < enchantLevel; i++) {
      // Excludes whichever Spells are already picked in the OTHER slots — Enchant can't be applied
      // to the same Spell twice.
      const takenElsewhere = new Set(state.enchantSpellIds.filter((id, idx) => idx !== i && id != null));
      enchantSection.appendChild(el('label', { class: 'field' }, [
        el('div', { class: 'field-label' }, [el('span', {}, 'Slot ' + (i + 1))]),
        (() => {
          const sel = el('select', { onchange: e => { state.enchantSpellIds[i] = e.target.value ? parseInt(e.target.value, 10) : null; renderAll(); } });
          sel.appendChild(el('option', { value: '' }, '— None —'));
          for (const s of enchantableSpells) {
            if (takenElsewhere.has(s.id)) continue;
            const mult = fairyOn ? 2 : 1;
            const dmgText = scaleEnchantEffectText(s.enchant.damage, mult).text;
            const secText = scaleEnchantEffectText(s.enchant.secondary, mult).text;
            const opt = el('option', { value: s.id }, s.name + ' (' + dmgText + ', ' + secText + ')');
            if (state.enchantSpellIds[i] === s.id) opt.setAttribute('selected', 'selected');
            sel.appendChild(opt);
          }
          return sel;
        })(),
      ]));
    }
    pane.appendChild(enchantSection);
  }

  // Fusion(s) — the game supports multiple simultaneous combination slots, so this is a
  // multi-select rather than a single dropdown. Magic Circle fusions (stat-boost, not damage)
  // are excluded here and shown in their own section below, but still draw from the same cap.
  const spell = GAMEDATA.spells[state.selectedSpellId];
  const ss = spellState(state.selectedSpellId);
  const ownedEvos = allSelectedEvolutionIds();
  const isMagicCircleFusion = f => MAGIC_CIRCLE_FUSIONS.some(mc => mc.id === f.id);
  const availableFusions = GAMEDATA.fusions.filter(f =>
    !isMagicCircleFusion(f) && f.requiresEvolutionIds.length > 0 && f.requiresEvolutionIds.every(id => ownedEvos.has(id))
  );
  const demAvailable = isDeusExMachinaAvailable();
  // Drop any selected fusion that's no longer qualified (evolution unpicked, or DEM's own
  // Overmind+other-fusion requirement no longer met).
  state.fusionIds = state.fusionIds.filter(id =>
    availableFusions.some(f => f.id === id) ||
    MAGIC_CIRCLE_FUSIONS.some(f => f.id === id && f.id !== DEM_FUSION?.id) ||
    (DEM_FUSION && id === DEM_FUSION.id && demAvailable)
  );

  const cap = fusionSlotCap();
  const capNote = [];
  capNote.push('Base 3 combination slots.');
  if (ownsArtifactByName('Domain of Power')) capNote.push('+1 from Domain of Power.');
  if (GATE_OF_CREATION_FUSION && state.fusionIds.includes(GATE_OF_CREATION_FUSION.id)) capNote.push('+1 net from Gate of Creation.');

  const fusionSection = el('div', { class: 'section' }, [
    el('div', { class: 'section-title' }, 'Fusions'),
    el('div', { class: 'field-label' }, [el('span', {}, 'Slots used'), el('span', { class: 'val' + (state.fusionIds.length >= cap ? ' over' : '') }, state.fusionIds.length + ' / ' + cap)]),
    el('div', { class: 'note', style: 'margin-bottom:8px;' }, capNote.join(' ')),
  ]);

  const atCap = state.fusionIds.length >= cap;
  const fusionList = el('div', { class: 'pick-list' });
  if (!availableFusions.length) {
    fusionList.appendChild(el('div', { class: 'pick-item' }, 'Empty until two matching Evolutions are picked (every fusion needs exactly 2, sometimes from two different spells) — pick them in the Evolutions section below, on whichever spell(s) they belong to. Fusions you qualify for will appear here automatically.'));
  }
  for (const f of availableFusions) {
    const active = state.fusionIds.includes(f.id);
    const row = el('label', { class: 'pick-item' }, [
      el('input', {
        type: 'checkbox', checked: active ? 'checked' : null, disabled: (!active && atCap) ? 'disabled' : null,
        onchange: e => {
          if (e.target.checked) state.fusionIds.push(f.id);
          else state.fusionIds = state.fusionIds.filter(id => id !== f.id);
          renderAll();
        },
      }),
      iconImg('fusion:' + f.id, 'pi-icon'),
      el('div', {}, [
        el('div', { class: 'pi-name' }, f.name + (f.ultimateName && f.ultimateName !== '`' ? ' → ' + f.ultimateName : '')),
        el('div', { class: 'pi-desc' }, descriptionNodes(f.description, f.effects)),
        f.name === 'Super Cyclone' ? el('div', { class: 'note' }, 'Damage shown is the initial/spawn value — this fusion\'s own Damage Multiplier scales up the longer a Cyclone persists, but the exact rate isn\'t in the extracted data, so it isn\'t included in the number below.') : null,
        f.name === 'Inferno' ? el('div', { class: 'note' }, 'Damage shown is the initial/unstacked value — this fusion\'s own Max Multiplier ramps up toward Damage X30 (Size X2) the more Incineration is cast, but the exact rate isn\'t in the extracted data, so it isn\'t included in the number below.') : null,
      ]),
    ]);
    fusionList.appendChild(row);
  }
  fusionSection.appendChild(fusionList);

  // Magic Circle — stat-boost fusions, kept separate from the damage-fusion list above.
  const mcSection = el('div', { class: 'section' }, [
    el('div', { class: 'section-title' }, 'Magic Circle'),
  ]);
  const mcList = el('div', { class: 'pick-list' });
  const mcOptions = [OVERMIND_FUSION, PERPETUAL_ENGINE_FUSION, GATE_OF_CREATION_FUSION].filter(f =>
    f && f.requiresEvolutionIds.length > 0 && f.requiresEvolutionIds.every(id => ownedEvos.has(id))
  );
  if (demAvailable && DEM_FUSION) mcOptions.push(DEM_FUSION);
  if (!mcOptions.length) {
    mcList.appendChild(el('div', { class: 'pick-item' }, 'Empty until you pick one of the Magic Circle spell\'s own 3 evolutions — select "Magic Circle" from the spell grid above, then choose an evolution there. Overmind/Perpetual Engine/Gate of Creation will appear here once you have.'));
  }
  for (const f of mcOptions) {
    const active = state.fusionIds.includes(f.id);
    const disabledByCap = !active && atCap && f.id !== DEM_FUSION?.id; // DEM check happens via demAvailable already
    mcList.appendChild(el('label', { class: 'pick-item' }, [
      el('input', {
        type: 'checkbox', checked: active ? 'checked' : null, disabled: disabledByCap ? 'disabled' : null,
        onchange: e => { selectMagicCircleFusion(f.id, e.target.checked); renderAll(); },
      }),
      iconImg('fusion:' + f.id, 'pi-icon'),
      el('div', {}, [
        el('div', { class: 'pi-name' }, f.name),
        el('div', { class: 'pi-desc' }, descriptionNodes(f.description, f.effects)),
      ]),
    ]));
  }
  mcSection.appendChild(mcList);
  if (state.fusionIds.some(id => MAGIC_CIRCLE_FUSIONS.some(f => f.id === id && f.id !== GATE_OF_CREATION_FUSION?.id))) {
    mcSection.appendChild(el('div', { class: 'note' }, 'Total invested spell levels: ' + totalActiveMagicLevels() + ' — Overmind/DEM scale off this.'));
  }

  // Per-fusion Ultimate toggles, for whichever selected fusions have one.
  for (const fusionId of state.fusionIds) {
    const fusion = GAMEDATA.fusions.find(f => f.id === fusionId);
    const ult = getUltimateInfo(fusion);
    if (!ult) continue;
    const ultBox = el('div', { style: 'margin-top:10px; padding-top:10px; border-top:1px solid var(--border-soft);' });
    // The real in-game ultimate description — ult.note is calculator-internal reasoning about how
    // the multiplier was derived and is intentionally never rendered here.
    // highlightStatKeywords, not a bare string — this real in-game flavor text sometimes names a
    // stat directly (e.g. Aura Blade's "...strengthened in proportion to Critical Rate"), which
    // previously rendered fully uncolored since this call bypassed the whole coloring system.
    const ultDesc = fusion.ultimateDescription ? el('div', { class: 'pi-desc', style: 'margin:4px 0 6px;' }, highlightStatKeywords(resolveDisplayText(fusion.ultimateDescription))) : null;
    if (ult.verified === 'unusable') {
      ultBox.appendChild(el('div', { class: 'pi-name' }, ult.ultimateName));
      if (ultDesc) ultBox.appendChild(ultDesc);
    } else {
      const unlocked = isUltimateUnlocked(ult.fusion);
      if (!unlocked) state.ultimatesOn[fusionId] = false;
      ultBox.appendChild(el('label', { class: 'toggle-row' }, [
        el('div', { style: 'display:flex; align-items:center; gap:8px;' }, [
          iconImg('ultimate:' + fusionId, 'pi-icon') || iconImg('fusion:' + fusionId, 'pi-icon'),
          el('span', { class: 'field-label' }, 'Ultimate: ' + ult.ultimateName),
        ]),
        el('input', {
          type: 'checkbox', checked: state.ultimatesOn[fusionId] ? 'checked' : null, disabled: unlocked ? null : 'disabled',
          onchange: e => { state.ultimatesOn[fusionId] = e.target.checked; renderResultsPane(); },
        }),
      ]));
      if (ultDesc) ultBox.appendChild(ultDesc);
      if (ult.multiplier) {
        ultBox.appendChild(el('div', { class: 'note' }, '×' + ult.multiplier + ' damage multiplier' + (ult.verified === true ? ' ✓' : ' (approx.)')));
      }
      if (ult.damageScalingText) {
        ultBox.appendChild(el('div', { class: 'note' }, ult.damageScalingText));
      }
      if (!unlocked) {
        ultBox.appendChild(el('div', { class: 'note' }, 'Locked — select the matching Class + Test Subject above to unlock this.'));
      }
      if (ult.special === 'raySquared' && state.ultimatesOn[fusionId]) {
        // Derived from Arcane Ray's own total Cooldown Reduction (see computePlasmaRayRayCount) —
        // not player-editable, so this is a plain readout rather than an input.
        ultBox.appendChild(el('div', { class: 'field-label' }, [el('span', {}, 'Active rays'), el('span', { class: 'val' }, String(computePlasmaRayRayCount()))]));
      }
    }
    fusionSection.appendChild(ultBox);
  }
  pane.appendChild(fusionSection);
  pane.appendChild(mcSection);

  // Crit Chance/Multiplier base values are fixed, not player-editable, same treatment as Base ATK.
  // Every "Increase Critical Strike Rate/Multiplier by X%" effect among current selections is
  // found automatically and added on top.
  const critR = compute();
  const critSection = el('div', { class: 'section' }, [
    el('div', { class: 'section-title' }, 'Critical Hit'),
    el('div', { class: 'field-label' }, [el('span', {}, 'Base Crit Chance'), el('span', { class: 'val stat-crit' }, PLAYER_BASE_CRIT_CHANCE + '%')]),
    el('div', { class: 'field-label', style: 'margin-bottom:10px;' }, [el('span', {}, 'Final Crit Chance'), el('span', { class: 'val stat-crit' }, fmt(critR.critChance, 1) + '%' + (critR.critChancePct ? ' (' + fmtSigned(critR.critChancePct, 1) + '%)' : ''))]),
    el('div', { class: 'field-label' }, [el('span', {}, 'Base Crit Multiplier'), el('span', { class: 'val stat-crit' }, PLAYER_BASE_CRIT_MULT + '%')]),
    el('div', { class: 'field-label' }, [el('span', {}, 'Final Crit Multiplier'), el('span', { class: 'val stat-crit' }, fmt(critR.critMulti, 1) + '%' + (critR.critMultPct ? ' (' + fmtSigned(critR.critMultPct, 1) + '%)' : ''))]),
  ]);
  pane.appendChild(critSection);

  // Artifacts/Passives/Research live in their own tabs (top of the page) — just a count here.
  const totalSelected = BONUS_POOL.filter(item => state.bonusSelections[bonusKey(item)]).length;
  pane.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'field-label' }, [el('span', {}, 'Relics, Passives & Research'), el('span', { class: 'val' }, String(totalSelected))]),
  ]));
}

// The spell's own progressive level-up sequence, rendered as one ordered list of selectable cards
// — stat-grant cards and evolution-tier picks interleaved in their real level order, matching how
// the game's own Level Bonus table lays them out. Clicking any stat card sets your level to (at
// least) that card's level, cumulatively unlocking everything up to it — same idea as Class Level,
// just per-card instead of a separate number field. Level 0 ("not chosen this run") is a real,
// distinct state below Lv1 — you don't always pick up every magic in a given run — toggled via the
// Lv1 "Acquire" card itself, same as any other card. An evolution tier only becomes pickable once
// your level reaches its unlock level; clicking a locked evolution card raises your level to that
// point and picks it in the same click.
function renderSpellLevelSection(spell, ss) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('div', { class: 'section-title' }, 'Level Upgrades'));
  section.appendChild(el('div', { class: 'field-label', style: 'margin-bottom:10px;' }, [
    el('span', {}, 'Level'), el('span', { class: 'val' }, ss.level > 0 ? ss.level + ' / ' + spell.maxLevel : 'Not chosen this run'),
  ]));

  // A level can grant more than one simultaneous stat (e.g. Spirit's Lv2-6 each grant both a
  // Damage% and a Spirit-count bonus at once) — levelUpgrades stays a flat per-effect list for the
  // compute pipeline (gatherActiveEffects just iterates it directly), but consecutive 'stat'
  // entries sharing the same level are grouped into a single card here, one line per stat.
  const renderedStatLevels = new Set();
  for (const lu of spell.levelUpgrades) {
    if (lu.kind === 'acquire') {
      const acquired = ss.level >= 1;
      section.appendChild(el('div', {
        class: 'evo-card' + (acquired ? ' active' : ''),
        onclick: () => { setSpellLevel(spell, ss, acquired ? 0 : 1); renderAll(); },
      }, [
        el('div', { class: 'evo-head' }, [el('span', { class: 'level-badge' }, 'Lv 1'), el('span', { class: 'evo-name' }, 'Acquire ' + spell.name)]),
      ]));
    } else if (lu.kind === 'stat') {
      if (renderedStatLevels.has(lu.level)) continue;
      renderedStatLevels.add(lu.level);
      const group = spell.levelUpgrades.filter(x => x.kind === 'stat' && x.level === lu.level);
      const active = ss.level >= lu.level;
      section.appendChild(el('div', {
        class: 'evo-card' + (active ? ' active' : ''),
        onclick: () => { setSpellLevel(spell, ss, lu.level); renderAll(); },
      }, [
        el('div', { class: 'evo-head' }, [
          el('span', { class: 'level-badge' }, 'Lv ' + lu.level),
          el('div', {}, group.map(g => el('div', { class: 'evo-name' }, effectNode(g)))),
        ]),
      ]));
    } else if (lu.kind === 'empty') {
      // Not every level grants a bonus (e.g. Shield only grants one, at Lv2, despite maxing at
      // Lv5) — still its own card so the level sequence stays continuous and every level is
      // individually selectable, just with nothing to show but that fact.
      const active = ss.level >= lu.level;
      section.appendChild(el('div', {
        class: 'evo-card' + (active ? ' active' : ''),
        onclick: () => { setSpellLevel(spell, ss, lu.level); renderAll(); },
      }, [
        el('div', { class: 'evo-head' }, [el('span', { class: 'level-badge' }, 'Lv ' + lu.level), el('span', { class: 'evo-name', style: 'color:var(--text-faint); font-weight:400;' }, 'No bonus this level')]),
      ]));
    } else if (lu.kind === 'evolution') {
      const unlocked = ss.level >= lu.level;
      const tierEvos = spell.evolutions.filter(e => e.tier === lu.tier);
      section.appendChild(el('div', { class: 'field-label', style: 'margin-top:10px;' }, [
        el('span', {}, 'Lv ' + lu.level + ' — Tier ' + lu.tier + ' Evolution'),
        el('span', { class: 'val' }, 'pick one'),
      ]));
      // One click both raises your level to this tier's unlock point (if you're not there yet)
      // and picks the evolution — no separate "unlock, then pick" step. Radio input is always
      // rendered (not just once unlocked) so a locked card looks and behaves exactly like any
      // other not-yet-reached level card, just also picking on click.
      const pickEvo = (evo) => { if (!unlocked) setSpellLevel(spell, ss, lu.level); toggleSpellEvolution(spell, ss, evo); renderAll(); };
      for (const evo of tierEvos) {
        const picked = ss.evolutions.has(evo.id);
        const card = el('div', {
          class: 'evo-card' + (picked ? ' active' : ''),
          onclick: () => pickEvo(evo),
        }, [
          el('div', { class: 'evo-head' }, [
            iconImg('evolution:' + evo.id),
            el('span', { class: 'evo-name' }, evo.name),
            el('input', { type: 'radio', name: 'evo-tier-' + spell.id + '-' + evo.tier, class: 'evo-check', checked: picked ? 'checked' : null, onclick: e => e.stopPropagation(), onchange: () => pickEvo(evo) }),
          ]),
          el('div', { class: 'evo-desc' }, evo.description.map(d => el('div', {}, describeLineNode(d, evo.effects)))),
        ]);
        section.appendChild(card);
      }
    }
  }
  section.appendChild(el('div', { class: 'note' }, 'Click any card to set your level to it (levels below it come along automatically). Each evolution tier is a mutually-exclusive pick, locked until your level reaches it — click a locked card to unlock its tier without picking it yet.'));
  return section;
}

function renderMainPane() {
  const pane = document.getElementById('mainPane');
  pane.innerHTML = '';

  // Spell grid
  const grid = el('div', { class: 'spell-grid' });
  for (let id = 1; id <= 21; id++) {
    const s = GAMEDATA.spells[id];
    if (!s) continue;
    const hasBase = !!s.base && s.base.damage != null;
    // Always selectable, even without a damage stat — utility spells like Magic Circle need to
    // be viewed here just to reach their Evolutions section below (that's the only place their
    // evolutions can be picked, which several other features — e.g. the Magic Circle fusions —
    // depend on).
    const chip = el('div', {
      class: 'spell-chip' + (id === state.selectedSpellId ? ' active' : '') + (!hasBase ? ' no-damage' : ''),
      onclick: () => { state.selectedSpellId = id; renderAll(); },
    }, [iconImg('spell:' + id), s.name]);
    grid.appendChild(chip);
  }
  pane.appendChild(el('div', { class: 'section' }, [el('div', { class: 'section-title' }, 'Spell'), grid]));

  const spell = GAMEDATA.spells[state.selectedSpellId];
  const ss = spellState(state.selectedSpellId);

  const head = el('div', { class: 'spell-head' }, [
    el('h2', {}, spell.name),
  ]);
  const statsRow = el('div', { class: 'spell-stats' });
  if (spell.base) {
    for (const [k, v] of Object.entries(spell.base)) {
      if (k === 'name' || k === 'note') continue;
      statsRow.appendChild(el('div', { class: 'spell-stat' }, [
        document.createTextNode(labelize(k) + ' '),
        el('span', { class: 'num' }, String(v)),
      ]));
    }
  }

  // highlightStatKeywords, not a bare string — same bypass as the ultimate-description case above
  // (e.g. Magic Circle's own "Amplify ATK for a certain duration." was rendering fully uncolored).
  pane.appendChild(el('div', { class: 'section' }, [head, statsRow, el('div', { class: 'spell-desc' }, highlightStatKeywords(resolveDisplayText(spell.description) || ''))]));

  pane.appendChild(renderSpellLevelSection(spell, ss));
}

function labelize(k) {
  const map = { damage: 'Damage', size: 'Size', number: 'Number', cooldown: 'Cooldown', explosionRange: 'Explosion Range', damageInterval: 'Dmg Interval', duration: 'Duration', rotationSpeed: 'Rotation Speed' };
  return map[k] || k;
}

function renderResultsPane() {
  const pane = document.getElementById('resultsPane');
  pane.innerHTML = '';
  const r = compute();

  const hero = el('div', { class: 'damage-hero' }, [
    el('div', { class: 'label' }, r.spell.name + ' — expected damage'),
    el('div', { class: 'figure' }, r.expected != null ? fmt(r.expected, 1) : '—'),
    el('div', { class: 'sub' }, 'per hit, weighted by crit chance'),
    el('div', { class: 'damage-split' }, [
      el('div', {}, [el('div', { class: 'k' }, 'Non-crit'), el('div', { class: 'v' }, fmt(r.nonCrit, 1))]),
      el('div', {}, [el('div', { class: 'k' }, 'Crit'), el('div', { class: 'v crit' }, fmt(r.crit, 1))]),
    ]),
  ]);
  pane.appendChild(hero);

  const ledgerSection = el('div', { class: 'section' });
  ledgerSection.appendChild(el('div', { class: 'section-title' }, 'Formula Breakdown'));
  ledgerSection.appendChild(row('Base (Encyclopedia)', fmt(r.base, 0)));
  ledgerSection.appendChild(row('ATK (' + fmtSigned(r.atkPct) + (r.titanOwned ? ' x1.5' : '%') + ')', fmt(r.ATK, 1), false, 'stat-atk'));
  ledgerSection.appendChild(row('Amplification', 'x' + fmt(r.AMP, 2) + '  (' + fmtSigned(r.ampPct) + '%)', false, 'stat-amp'));
  ledgerSection.appendChild(row('Magic Damage (' + r.spell.name + ')', 'x' + fmt(r.MDMG, 2) + '  (' + fmtSigned(r.mdmgPct) + '%)', false, 'stat-amd'));
  ledgerSection.appendChild(row('Non-crit damage', fmt(r.nonCrit, 1), true));
  pane.appendChild(ledgerSection);

  // Special Modifiers — every individual multiplicative bucket beyond ATK/AMP/MDMG, named and
  // shown separately (evolution/fusion X-multipliers, e.g. size- or count-scaled damage, plus
  // Ultimates). Nothing here gets silently merged into one aggregate number. Every entry here is by
  // definition the stat-xmult bucket (a separate multiplicative factor, same family as "Other
  // Multipliers"/"Damage Multiplier"-phrased tooltips) — colored the same way Formula Breakdown's
  // own ATK/AMP rows already are (row()'s keyClass arg), this section just never had it before.
  const modSection = el('div', { class: 'section' });
  modSection.appendChild(el('div', { class: 'section-title' }, 'Special Modifiers'));
  const hasModifiers = r.xMults.length > 0 || r.activeUltimates.length > 0;
  if (!hasModifiers) {
    modSection.appendChild(row('None active', 'x1.00'));
  }
  for (const x of r.xMults) {
    const mult = x.dir === 'Decrease' ? (1 / x.amount) : x.amount;
    modSection.appendChild(row(x.source, 'x' + fmt(mult, 2), false, 'stat-xmult'));
  }
  for (const { ult, mult } of r.activeUltimates) {
    modSection.appendChild(row('Ultimate (' + ult.fusion.name + ' → ' + ult.ultimateName + (ult.verified === true ? ', verified' : ', approx.') + ')', 'x' + fmt(mult, 2), false, 'stat-xmult'));
  }
  if (hasModifiers) {
    modSection.appendChild(row('Combined', 'x' + fmt(r.xMultTotal, 2), true, 'stat-xmult'));
  }
  // These all caveat/explain the Special Modifiers figures directly above, so they belong inside
  // this section rather than floating as orphaned notes between it and whatever section comes next.
  if (r.overmindActive || r.demActive) {
    modSection.appendChild(el('div', { class: 'note' }, 'Total invested spell levels: ' + r.totalLevels + ' — Overmind/Deus Ex Machina scale off this.'));
  }
  if (r.superCycloneActive) {
    modSection.appendChild(el('div', { class: 'note' }, 'This is the initial/spawn damage. Super Cyclone\'s own Damage Multiplier increases the longer a Cyclone persists, but the exact rate isn\'t in the extracted data, so it isn\'t reflected above.'));
  }
  if (r.infernoActive) {
    modSection.appendChild(el('div', { class: 'note' }, 'This is the initial/unstacked damage. Inferno\'s own Max Multiplier ramps up toward Damage X30 (Size X2) the more Incineration is cast, but the exact rate isn\'t in the extracted data, so it isn\'t reflected above.'));
  }
  pane.appendChild(modSection);

  // Effective Damage — enemy Max HP reduction (general/Elite/Large pools, Venom's multiplicative
  // transform) and Magic Sword's Execute threshold, both confirmed to compound rather than act
  // independently. A fundamentally different kind of output from everything above (build-wide and
  // enemy-type-scoped, not per-spell/per-hit), so it's its own section rather than folded into
  // Special Modifiers or Active Sources.
  if (r.effectiveDamageActive) {
    const edSection = el('div', { class: 'section' });
    edSection.appendChild(el('div', { class: 'section-title' }, 'Effective Damage (vs. enemy Max HP)'));
    // Leads with "only need to land N% of original Max HP" — the framing that actually explains
    // what the multiplier means, rather than the multiplier itself with no context for where it
    // comes from.
    const edRow = (label, requiredFraction, mult, expectedEffective) => el('div', { class: 'ledger-row wrap' }, [
      el('span', { class: 'lk' }, label + ' — only ' + fmt(requiredFraction * 100, 1) + '% of original Max HP required'),
      el('span', { class: 'lv' }, [
        'x' + fmt(mult, 2) + '   ',
        el('span', { class: 'dmg-figure' }, fmt(expectedEffective, 1)),
        ' effective damage',
      ]),
    ]);
    edSection.appendChild(edRow('vs. Normal Enemies', r.requiredDamageFractionVsNormal, r.effectiveDamageMultVsNormal, r.expectedEffectiveVsNormal));
    edSection.appendChild(edRow('vs. Elite Monsters', r.requiredDamageFractionVsElite, r.effectiveDamageMultVsElite, r.expectedEffectiveVsElite));
    edSection.appendChild(edRow('vs. Large Monsters', r.requiredDamageFractionVsLarge, r.effectiveDamageMultVsLarge, r.expectedEffectiveVsLarge));
    // Boss Wave / Normal Wave (Imp) — a narrower scope than Normal/Elite/Large (currently the only
    // item touching it at all), so only shown once it's actually contributing rather than always
    // appearing as a 3rd/4th/5th redundant-when-empty row.
    if (r.enemyMaxHpModBossWavePct !== 0 || r.enemyMaxHpModNormalWavePct !== 0) {
      edSection.appendChild(edRow('vs. Boss Wave Monsters', r.requiredDamageFractionVsBossWave, r.effectiveDamageMultVsBossWave, r.expectedEffectiveVsBossWave));
      edSection.appendChild(edRow('vs. Normal Wave Monsters', r.requiredDamageFractionVsNormalWave, r.effectiveDamageMultVsNormalWave, r.expectedEffectiveVsNormalWave));
    }
    if (r.magicSwordOwned) {
      // Spells out the cascade concretely (using the Normal-enemy numbers as the worked example,
      // since the reduction% is the only thing that varies by enemy type — Execute's own mechanism
      // is identical for all three): reduction removes its share first, then Execute removes its
      // own share of what's LEFT, not of the original 100%.
      const remainingAfterReduction = 1 - r.enemyMaxHpReductionVsNormal;
      const executeOwnShareOfOriginal = remainingAfterReduction * r.executeThresholdPct / 100;
      edSection.appendChild(el('div', { class: 'note' }, 'Magic Sword\'s Execute (vs. Normal enemies as the example): Max HP reduction alone leaves ' + fmt(remainingAfterReduction * 100, 1) + '% of the enemy\'s original Max HP needing real damage. Execute instakills enemies below ' + fmt(r.executeThresholdPct, 0) + '%' + (r.egoSwordActive ? ' (raised from 20% by Ego Sword)' : '') + ' of THAT remaining amount — cutting ' + fmt(executeOwnShareOfOriginal * 100, 1) + '% more off the original total, for ' + fmt(r.requiredDamageFractionVsNormal * 100, 1) + '% required overall.'));
    }
    if (r.occultOwned) {
      edSection.appendChild(el('div', { class: 'note' }, 'Occult: +' + fmt(r.enemyMaxHpReductionGeneralFraction * 100, 1) + '% Max HP (from the general reduction pool total, already included in your Max HP above).'));
    }
    if (r.venomOwned) {
      edSection.appendChild(el('div', { class: 'note' }, 'Venom: multiplies the general pool\'s already-resolved reduction rate by x1.15, per its own effect — the pool itself always combines its sources multiplicatively (not additively), Venom or not.'));
    }
    if (r.enemyMaxHpModBossWavePct !== 0 || r.enemyMaxHpModNormalWavePct !== 0) {
      // Reads the resolved (multiplicative) fraction, not the raw additive Pct sum — currently
      // identical since Imp is the pool's only source, but stays correct if a second Boss/Normal-
      // Wave source is ever found (same reason the pool itself was changed to combine this way).
      edSection.appendChild(el('div', { class: 'note' }, 'Imp: -' + fmt(r.enemyMaxHpModBossWaveFraction * 100, 0) + '% Max HP vs. Boss Wave Monsters, +' + fmt(-r.enemyMaxHpModNormalWaveFraction * 100, 0) + '% vs. Normal Wave Monsters — its own separate pool, layered on top of the general pool above rather than folded into it.'));
    }
    pane.appendChild(edSection);
  }

  // Conditional Modifiers — HP%-gated (Guillotine/Rose/Ballista/Sniper) and time-gated (Brand)
  // Additional Damage, plus Siege Hammer/Joker's own probability-weighted effects. The HP%/time
  // conditions can't be known live, so they're shown as separate "if this holds" scenario figures
  // rather than folded into the main expected-damage number above; Siege Hammer/Joker's conditions
  // ARE already probability-weighted into that main figure (their own known-stat odds), so they get
  // an explanatory note here instead of their own scenario row.
  const hasConditionalModifiers = r.hpGatedAdditionalDamageLedger.length || r.timeGatedAdditionalDamageLedger.length || r.jetEngineOwned || r.warFlagOwned || r.merlinsCapeOwned || r.magicFountainOwned || r.manaShieldOwned || r.siegeHammerOwned || r.jokerOwned;
  if (hasConditionalModifiers) {
    const cmSection = collapsibleSection('cm', 'Conditional Modifiers', (cmSection) => {
      const cmRow = (label, mult, expectedValue) => el('div', { class: 'ledger-row wrap' }, [
        el('span', { class: 'lk' }, label),
        el('span', { class: 'lv' }, '×' + fmt(mult, 3) + '   ' + fmt(expectedValue, 1) + ' expected damage'),
      ]);
      if (r.hpGatedAdditionalDamageLedger.length) {
        cmSection.appendChild(cmRow('vs. enemies ≥75% HP', r.hpGatedAdditionalDamageMult, r.expectedVsHighHp));
        for (const a of sortedBySource(r.hpGatedAdditionalDamageLedger)) {
          cmSection.appendChild(el('div', { class: 'ledger-row' }, [
            el('span', { class: 'lk', style: 'padding-left:16px;' }, a.source),
            el('span', { class: 'lv' }, '+' + fmt(a.pct, 1) + '%'),
          ]));
        }
      }
      if (r.timeGatedAdditionalDamageLedger.length) {
        cmSection.appendChild(cmRow('vs. enemies survived >5s', r.timeGatedAdditionalDamageMult, r.expectedVsSurvived));
        for (const a of sortedBySource(r.timeGatedAdditionalDamageLedger)) {
          cmSection.appendChild(el('div', { class: 'ledger-row' }, [
            el('span', { class: 'lk', style: 'padding-left:16px;' }, a.source),
            el('span', { class: 'lv' }, '+' + fmt(a.pct, 1) + '%'),
          ]));
        }
      }
      // Jet Engine/War Flag/Merlin's Cape/Magic Fountain's own source rows literally state "+N%
      // Amplify ATK" — the AMP bucket, same color Active Sources' own AMP subsection uses. The
      // scenario summary row above each (cmRow) stays uncolored, matching the HP%/time-gated group's
      // own precedent — it represents a derived damage multiplier, not a raw stat contribution.
      if (r.jetEngineOwned) {
        cmSection.appendChild(cmRow('vs. while moving (assumes full uptime)', r.jetEngineMult, r.expectedVsMoving));
        cmSection.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk', style: 'padding-left:16px;' }, 'Jet Engine (Relic)'),
          el('span', { class: 'lv stat-amp' }, '+' + fmt(r.jetEnginePct, 1) + '% Amplify ATK'),
        ]));
      }
      if (r.warFlagOwned) {
        cmSection.appendChild(cmRow('vs. standing still (assumes max stack)', r.warFlagMult, r.expectedVsStandingStill));
        cmSection.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk', style: 'padding-left:16px;' }, 'War Flag (Relic, Max Stack)'),
          el('span', { class: 'lv stat-amp' }, '+' + fmt(r.warFlagMaxPct, 1) + '% Amplify ATK'),
        ]));
      }
      if (r.merlinsCapeOwned) {
        cmSection.appendChild(cmRow('vs. full Mana (assumes max stacks)', r.merlinsCapeMult, r.expectedVsFullManaCape));
        cmSection.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk', style: 'padding-left:16px;' }, 'Merlin\'s Cape (Relic)'),
          el('span', { class: 'lv stat-amp' }, '+' + fmt(r.merlinsCapeMaxPct, 1) + '% Amplify ATK'),
        ]));
      }
      if (r.magicFountainOwned) {
        cmSection.appendChild(cmRow('vs. max Mana Orbs held (assumes max stacks)', r.magicFountainMult, r.expectedVsMaxManaOrbs));
        cmSection.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk', style: 'padding-left:16px;' }, 'Magic Fountain (Relic, Max Stack)'),
          el('span', { class: 'lv stat-amp' }, '+' + fmt(r.magicFountainMaxPct, 1) + '% Amplify ATK'),
        ]));
      }
      if (r.manaShieldOwned && r.aegisOwned) {
        cmSection.appendChild(cmRow('vs. full Mana (assumes max stacks)', r.manaShieldMult, r.expectedVsFullManaShield));
        cmSection.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk', style: 'padding-left:16px;' }, 'Mana Shield (Relic, via Aegis)'),
          el('span', { class: 'lv' }, '+' + fmt(r.manaShieldMaxPct, 1) + '% Damage Taken Reduction'),
        ]));
      } else if (r.manaShieldOwned) {
        cmSection.appendChild(el('div', { class: 'note' }, 'Mana Shield: no damage-relevant effect without Aegis (or another item reading the Damage Taken Reduction total) also owned — it\'s a purely defensive stat otherwise.'));
      }
      if (r.siegeHammerOwned) {
        cmSection.appendChild(el('div', { class: 'note' }, 'Siege Hammer: +' + fmt(r.siegeHammerPct, 0) + '% Additional Damage on non-crit hits only — already weighted into the expected damage above by your crit chance, not a separate scenario.'));
      }
      if (r.jokerOwned) {
        cmSection.appendChild(el('div', { class: 'note' }, 'Joker: ' + fmt(r.jokerProcChance * 100, 1) + '% chance per crit to double the bonus portion of your crit multiplier — already weighted into the expected damage above.'));
      }
    });
    pane.appendChild(cmSection);
  }

  // Active synergies (auto-triggered by owned artifacts) — damage-irrelevant ones (pure utility/QoL,
  // e.g. Elixir's Life Orb HP Recovery) are excluded, see synergyAffectsDamage.
  const activeSynergies = getActiveSynergies().filter(synergyAffectsDamage);
  const synSection = collapsibleSection('syn', 'Active Synergies', (synSection) => {
    if (!activeSynergies.length) {
      synSection.appendChild(el('div', { class: 'note' }, 'None triggered — synergies activate automatically once you\'ve selected all of their required relics.'));
    }
    for (const syn of activeSynergies) {
      const noop = synergyNoopViaLeniency(syn);
      synSection.appendChild(el('div', { style: 'margin-bottom:8px;' }, [
        el('div', { class: 'pi-name' }, syn.name + (noop ? ' (no benefit — see below)' : '')),
        el('div', { class: 'pi-desc' }, descriptionNodes(syn.description, syn.effects)),
        noop ? el('div', { class: 'note', style: 'color:var(--crit);' }, 'Counted as met via Magnum Opus, but gives no benefit — the missing piece is exactly what this synergy modifies.') : null,
      ]));
    }
  });
  pane.appendChild(synSection);

  // Contribution sources
  // Active Sources — grouped into per-category collapsible subsections (ATK/AMP/AMD/Crit-Chance/
  // Crit-Multi/Other Multipliers) so a long build's list doesn't force scrolling through every
  // category to find one. Each subsection shows a source count in its header even when collapsed.
  const sourceSection = el('div', { class: 'section' });
  sourceSection.appendChild(el('div', { class: 'section-title' }, 'Active Sources'));
  const lineRow = (source, tag, cls, amount) => el('div', { class: 'ledger-row' }, [
    el('span', { class: 'lk' }, source),
    el('span', { class: 'lv ' + cls }, tag + ' ' + fmtSigned(amount, 2) + '%'),
  ]);
  const atkLines = r.ledger.atk;
  const ampLines = r.ledger.amp;
  const amdLines = r.ledger.mdmg;
  const critChanceLines = r.ledger.crit.filter(x => x.tag === 'Chance');
  const critMultiLines = r.ledger.crit.filter(x => x.tag === 'Multi');
  const comboNotApplying = r.comboLedger.length && !r.comboDamageApplies;
  const hasOtherMults = r.demActive || (r.classScaling && r.classMult !== 1) || r.spaceWarpEvoActive || r.additionalDamageLedger.length;
  const nothingActive = !atkLines.length && !r.titanOwned && !ampLines.length && !amdLines.length && !comboNotApplying
    && !critChanceLines.length && !critMultiLines.length && !r.heartbreakerActive && !hasOtherMults;
  if (nothingActive) {
    sourceSection.appendChild(el('div', { class: 'note' }, 'No damage-related bonuses active yet — pick upgrades, relics, or a class on the left.'));
  }

  if (atkLines.length || r.titanOwned) {
    collapsibleSubsection(sourceSection, 'as-atk', 'ATK', atkLines.length + (r.titanOwned ? 1 : 0), (sub) => {
      for (const l of sortedBySource(atkLines)) sub.appendChild(lineRow(l.source, 'ATK', 'stat-atk', l.amount));
      // Titan's Power is a fixed 1.5x transform on bonus ATK, not a % contribution to the additive
      // pool above — shown as a flat label rather than a computed damage delta, since the delta
      // scales with the whole build and isn't a meaningful number on its own (see Formula
      // Breakdown's ATK row for how it actually factors into ATK).
      if (r.titanOwned) sub.appendChild(el('div', { class: 'ledger-row' }, [el('span', { class: 'lk' }, "Titan's Power"), el('span', { class: 'lv' }, 'Bonus ATK x1.5')]));
    }, 'stat-atk');
  }
  if (ampLines.length) {
    collapsibleSubsection(sourceSection, 'as-amp', 'AMP', ampLines.length, (sub) => {
      for (const l of sortedBySource(ampLines)) sub.appendChild(lineRow(l.source, 'AMP', 'stat-amp', l.amount));
    }, 'stat-amp');
  }
  if (amdLines.length || comboNotApplying) {
    // Nexus is not shown separately here — it's a normal contributor to the additive Magic Damage
    // pool (see compute()), so it already appears in amdLines like any other AMD source.
    collapsibleSubsection(sourceSection, 'as-amd', 'AMD', amdLines.length + (comboNotApplying ? 1 : 0), (sub) => {
      for (const l of sortedBySource(amdLines)) sub.appendChild(lineRow(l.source, 'AMD', 'stat-amd', l.amount));
      // When comboDamageApplies is true, its sources already appear above via the standard
      // AMD-tagged loop (same tag/color as every other Magic Damage source) — nothing extra to
      // render. When it's NOT applying, there's no "source" to list (it isn't contributing right
      // now), so this stays a plain informational note rather than a styled Active Sources row.
      if (comboNotApplying) sub.appendChild(el('div', { class: 'note' }, 'Combination Magic Damage (' + fmtSigned(r.comboDamagePct) + '% from ' + r.comboLedger.map(c => c.source).join(', ') + ') — no active Fusion multiplier on this spell, not currently contributing.'));
    }, 'stat-amd');
  }
  if (critChanceLines.length) {
    collapsibleSubsection(sourceSection, 'as-crit-chance', 'Crit Chance', critChanceLines.length, (sub) => {
      for (const l of sortedBySource(critChanceLines)) sub.appendChild(lineRow(l.source, 'CRIT-Chance', 'stat-crit', l.amount));
    }, 'stat-crit');
  }
  if (critMultiLines.length || r.heartbreakerActive) {
    collapsibleSubsection(sourceSection, 'as-crit-multi', 'Crit Multiplier', critMultiLines.length + (r.heartbreakerActive ? 1 : 0), (sub) => {
      for (const l of sortedBySource(critMultiLines)) sub.appendChild(lineRow(l.source, 'CRIT-Multi', 'stat-crit', l.amount));
      if (r.heartbreakerActive) {
        sub.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk' }, 'Heartbreaker (Crit Multi ' + fmt(r.critMultiPreHeartbreaker, 0) + '% → ' + fmt(r.critMulti, 0) + '%, on Crit only)'),
          el('span', { class: 'lv' }, r.heartbreakerDelta != null ? '+' + fmt(r.heartbreakerDelta, 1) : '—'),
        ]));
      }
    }, 'stat-crit');
  }
  if (hasOtherMults) {
    const otherMultCount = (r.demActive ? 1 : 0) + (r.classScaling && r.classMult !== 1 ? 1 : 0) + (r.spaceWarpEvoActive ? 1 : 0) + (r.additionalDamageLedger.length ? 1 : 0);
    // DEM/Class multiplier/Space Warp are all genuinely separate multiplicative factors (same
    // family "Damage Multiplier"-phrased tooltips already get colored stat-xmult) — tagged here too,
    // matching every other Active Sources subsection's own convention of coloring both its header
    // chip and each row's value. Additional Damage is a different bucket entirely (its own position
    // in the formula, not a Magic-Damage variant at all) with no dedicated color anywhere else in
    // the app, so its rows deliberately stay uncolored rather than borrowing xmult's.
    collapsibleSubsection(sourceSection, 'as-other', 'Other Multipliers', otherMultCount, (sub) => {
      if (r.demActive) {
        sub.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk' }, 'Deus Ex Machina (' + r.totalLevels + ' levels × 1% = ' + fmt(r.totalLevels * 1, 0) + '%, separate multiplier)'),
          el('span', { class: 'lv stat-xmult' }, '×' + fmt(r.demMult, 4)),
        ]));
      }
      if (r.classScaling && r.classMult !== 1) {
        sub.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk' }, 'Class multiplier (' + r.classScaling.text + ', separate from Magic Damage)'),
          el('span', { class: 'lv stat-xmult' }, '×' + fmt(r.classMult, 3)),
        ]));
      }
      if (r.spaceWarpEvoActive) {
        sub.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk' }, 'Space Warp (Cloaking Duration ' + fmtSigned(r.cloakingDurationBonusPct) + '%, 1:1 with explosion damage)'),
          el('span', { class: 'lv stat-xmult' }, '×' + fmt(r.spaceWarpDurationMult, 3)),
        ]));
      }
      if (r.additionalDamageLedger.length) {
        sub.appendChild(el('div', { class: 'ledger-row' }, [
          el('span', { class: 'lk' }, 'Additional Damage (multiplicative, ×' + fmt(r.additionalDamageMult, 3) + ' combined)'),
          el('span', { class: 'lv' }, '×' + fmt(r.additionalDamageMult, 3)),
        ]));
        for (const a of sortedBySource(r.additionalDamageLedger)) {
          sub.appendChild(el('div', { class: 'ledger-row' }, [
            el('span', { class: 'lk', style: 'padding-left:16px;' }, a.source),
            el('span', { class: 'lv' }, '+' + fmt(a.pct, 1) + '%'),
          ]));
        }
      }
    }, 'stat-xmult');
  }
  pane.appendChild(sourceSection);

  // Player Stats — the "hidden" input pools that feed stat-conversion relics (Oculus/Carnival/
  // Gaia/Abyss/Accelerator/Aegis), previously only visible indirectly through each conversion
  // relic's own single summary line (e.g. "Gaia (Relic, Max HP 330)") with no breakdown of what's
  // actually contributing to the pool itself. Max HP is always shown (a base value exists even
  // with zero relics, same treatment as ATK/AMP in Formula Breakdown); the rest only appear once
  // at least one source contributes, since 0% is uninteresting noise otherwise.
  const psSection = collapsibleSection('ps', 'Player Stats', (psSection) => {
    const psRow = (label, value) => el('div', { class: 'ledger-row' }, [
      el('span', { class: 'lk' }, label),
      el('span', { class: 'lv' }, value),
    ]);
    const psSourceRow = (source, amount) => el('div', { class: 'ledger-row' }, [
      el('span', { class: 'lk', style: 'padding-left:16px;' }, source),
      el('span', { class: 'lv' }, fmtSigned(amount, 1) + '%'),
    ]);
    const psPool = (label, pct, ledgerArr) => {
      if (!ledgerArr.length) return;
      psSection.appendChild(psRow(label, fmtSigned(pct, 1) + '%'));
      for (const s of sortedBySource(ledgerArr)) psSection.appendChild(psSourceRow(s.source, s.amount));
    };
    const maxHpSummary = (r.maxHpBonusPct || r.maxHpReductionPct)
      ? '  (' + fmtSigned(r.maxHpBonusPct, 1) + '% bonus' + (r.maxHpReductionPct ? ', -' + fmt(r.maxHpReductionPct, 1) + '% reduction' : '') + ')'
      : ' (base, no bonuses)';
    psSection.appendChild(psRow('Max HP', fmt(r.maxHpTotal, 0) + maxHpSummary));
    for (const m of sortedBySource(r.maxHpBonusLedger)) psSection.appendChild(psSourceRow(m.source, m.amount));
    for (const m of sortedBySource(r.maxHpReductionLedgerPlayer)) psSection.appendChild(psSourceRow(m.source, -m.amount));
    psPool('Evasion', r.evasionPct, r.evasionLedger);
    psPool('Item Pickup Range', r.pickupRangePct, r.pickupRangeLedger);
    psPool('Movement Speed', r.moveSpeedPct, r.moveSpeedLedger);
    psPool('Mana Acquisition', r.manaAcquisitionPct, r.manaAcquisitionLedger);
    if (r.damageTakenLedger.length) {
      psSection.appendChild(psRow('Damage Reduction', fmt(r.damageReductionPct, 1) + '%'));
      for (const d of sortedBySource(r.damageTakenLedger)) psSection.appendChild(psSourceRow(d.source, d.amount));
    }
  });
  pane.appendChild(psSection);
  saveAutosave();
}

function row(k, v, total, keyClass) {
  return el('div', { class: 'ledger-row' + (total ? ' total' : '') }, [
    el('span', { class: 'lk' + (keyClass ? ' ' + keyClass : '') }, k),
    el('span', { class: 'lv' }, v),
  ]);
}

// Collapse/expand state for the results pane's collapsible sections/subsections — deliberately NOT
// part of `state` (never saved/loaded/exported), since it's an ephemeral display preference, not
// build data. Keyed by a caller-chosen id. Defaults to COLLAPSED (anything other than an explicit
// `false` counts as collapsed) — a section only stays open once the user has explicitly clicked it
// open. Resets on page reload.
const uiCollapsed = {};
function isCollapsed(id) { return uiCollapsed[id] !== false; }
function toggleCollapsed(id) { uiCollapsed[id] = !isCollapsed(id); renderResultsPane(); }
// Top-level collapsible section (e.g. Player Stats) — same look as a normal `.section-title`, just
// clickable, with an arrow indicating state.
function collapsibleSection(id, title, buildContentFn) {
  const sec = el('div', { class: 'section' });
  const collapsed = isCollapsed(id);
  sec.appendChild(el('div', { class: 'section-title collapsible', onclick: () => toggleCollapsed(id) }, [
    el('span', { class: 'collapse-arrow' }, collapsed ? '▸' : '▾'),
    el('span', {}, title),
  ]));
  if (!collapsed) buildContentFn(sec);
  return sec;
}
// Subsection within a section (e.g. each Active Sources category) — smaller/dimmer than a full
// section title, with an optional source count so a collapsed group still shows how much it holds.
function collapsibleSubsection(parent, id, title, count, buildContentFn, colorClass) {
  const sub = el('div', { class: 'subsection' });
  const collapsed = isCollapsed(id);
  sub.appendChild(el('div', { class: 'subsection-title' + (colorClass ? ' ' + colorClass : ''), onclick: () => toggleCollapsed(id) }, [
    el('span', { class: 'collapse-arrow' }, collapsed ? '▸' : '▾'),
    el('span', {}, title),
    el('span', { class: 'subsection-count' }, '(' + count + ')'),
  ]));
  if (!collapsed) buildContentFn(sub);
  parent.appendChild(sub);
}
// Alphabetical by source name — the ledger arrays are otherwise ordered by when classifyEffect
// happened to process them (roughly selection order), which reads as arbitrary once a subsection
// has more than a couple of entries.
function sortedBySource(entries) {
  return [...entries].sort((a, b) => a.source.localeCompare(b.source));
}

// ===================== Tabs =====================
const RARITY_TABS = ['Common', 'Rare', 'Epic', 'Special', 'Legendary'];
const TABS = [
  { id: 'calculator', label: 'Calculator' },
  { id: 'research', label: 'Research' },
  { id: 'passives', label: 'Passives' },
  { id: 'synergies', label: 'Synergies' },
  { id: 'testsubjects', label: 'Test Subjects' },
  { id: 'maxedclasses', label: 'Maxed Classes' },
  ...RARITY_TABS.map(r => ({ id: 'rarity:' + r, label: r })),
  { id: 'encyclopedia', label: 'Encyclopedia' },
  { id: 'mechanics', label: 'Mechanics' },
];

function selectionCountForTab(tabId) {
  if (tabId === 'research') return GAMEDATA.research.filter(x => state.bonusSelections[bonusKey({ ...x, category: 'Research' })]).length;
  if (tabId === 'synergies') return getActiveSynergies().length;
  if (tabId === 'maxedclasses') return state.maxedClassIds.length;
  if (tabId === 'testsubjects') return state.unlockedTestSubjectIds.length;
  if (tabId === 'passives') {
    return GAMEDATA.passives.filter(x => state.bonusSelections[bonusKey({ ...x, category: 'Passive' })]).length +
      PASSIVES_POST_MAX.filter(x => state.bonusSelections[bonusKey({ ...x, category: 'Passive (Post-Max)' })]).length +
      GAMEDATA.specialPassives.filter(x => state.bonusSelections[bonusKey({ ...x, category: 'Special Passive' })]).length;
  }
  if (tabId.startsWith('rarity:')) {
    const rarity = tabId.slice('rarity:'.length);
    return GAMEDATA.artifacts.filter(a => a.rarity === rarity && state.bonusSelections[bonusKey({ ...a, category: 'Artifact' })]).length;
  }
  return 0;
}

function renderTabBar() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = '';
  for (const tab of TABS) {
    const count = tab.id === 'calculator' ? null : selectionCountForTab(tab.id);
    bar.appendChild(el('button', {
      class: 'tab-btn' + (state.activeTab === tab.id ? ' active' : ''),
      onclick: () => { state.activeTab = tab.id; renderAll(); },
    }, [
      document.createTextNode(tab.label),
      count ? el('span', { class: 'count' }, String(count)) : null,
    ]));
  }
}

function renderTabContent() {
  const workbench = document.getElementById('workbench');
  const tabContent = document.getElementById('tabContent');
  if (state.activeTab === 'calculator') {
    workbench.style.display = '';
    tabContent.style.display = 'none';
    return;
  }
  workbench.style.display = 'none';
  tabContent.style.display = '';
  tabContent.innerHTML = '';

  if (state.activeTab === 'research') {
    tabContent.appendChild(renderCardBrowserSection({
      title: 'Research', subtitle: 'Upgraded with Research Points from the main menu.',
      items: GAMEDATA.research, category: 'Research', hasLevels: true,
    }));
  } else if (state.activeTab === 'passives') {
    const leftCol = el('div', {});
    leftCol.appendChild(renderCardBrowserSection({
      title: 'Passives — Normal', subtitle: null,
      items: GAMEDATA.passives, category: 'Passive', hasLevels: true,
      getLevelBonus: () => normalPassiveMaxLevelBonus(),
      maxLevelNote: normalPassiveMaxLevelBonus() ? [ownsArtifactByName('Cube') && 'Cube', ownsSpecialPassiveByName('Taoist') && 'Taoist'].filter(Boolean).join(' + ') + ': +' + normalPassiveMaxLevelBonus() + ' max level applied.' : null,
    }));
    leftCol.appendChild(renderCardBrowserSection({
      title: 'Passives — Post-Max-Level', subtitle: null,
      items: PASSIVES_POST_MAX, category: 'Passive (Post-Max)', hasLevels: true,
    }));
    const rightCol = el('div', {});
    rightCol.appendChild(renderCardBrowserSection({
      title: 'Passives — Special', subtitle: null,
      items: GAMEDATA.specialPassives, category: 'Special Passive', hasLevels: false, sortSelectedFirst: true,
    }));
    tabContent.appendChild(el('div', { class: 'passives-columns' }, [leftCol, rightCol]));
  } else if (state.activeTab === 'synergies') {
    tabContent.appendChild(renderSynergiesTab());
  } else if (state.activeTab === 'testsubjects') {
    tabContent.appendChild(renderTestSubjectsTab());
  } else if (state.activeTab === 'maxedclasses') {
    tabContent.appendChild(renderMaxedClassesTab());
  } else if (state.activeTab.startsWith('rarity:')) {
    const rarity = state.activeTab.slice('rarity:'.length);
    tabContent.appendChild(renderCardBrowserSection({
      title: rarity + ' Relics',
      subtitle: rarity === 'Special' ? 'Special Relics skipped in relic chests can never appear again in your run.' : null,
      items: GAMEDATA.artifacts.filter(a => a.rarity === rarity), category: 'Artifact', hasLevels: false,
      sortSelectedFirst: true,
    }));
  } else if (state.activeTab === 'encyclopedia') {
    tabContent.appendChild(renderEncyclopediaTab());
  } else if (state.activeTab === 'mechanics') {
    tabContent.appendChild(renderMechanicsTab());
  }
}

// Builds a segmented-ring progress indicator: `total` equal segments around the ring, the first
// `activeCount` of them filled. Uses a conic-gradient (no SVG/canvas/external assets needed).
// The synergy's icon sits in the center hole — the component list below the card already spells
// out exactly which pieces are owned, so the ring itself only needs to communicate progress
// (via filled segments), not repeat the count as text.
function buildRingElement(total, activeCount, iconEl) {
  const segAngle = 360 / total;
  const gap = Math.min(8, segAngle * 0.18);
  const stops = [];
  for (let i = 0; i < total; i++) {
    const segStart = i * segAngle;
    const fillStart = segStart + gap / 2;
    const fillEnd = (i + 1) * segAngle - gap / 2;
    const segEnd = (i + 1) * segAngle;
    const color = i < activeCount ? 'var(--buff)' : 'var(--border)';
    stops.push('transparent ' + segStart + 'deg ' + fillStart + 'deg');
    stops.push(color + ' ' + fillStart + 'deg ' + fillEnd + 'deg');
    stops.push('transparent ' + fillEnd + 'deg ' + segEnd + 'deg');
  }
  const ring = el('div', { class: 'synergy-ring', style: 'background: conic-gradient(' + stops.join(', ') + ');' }, [
    el('div', { class: 'hole' }, [iconEl]),
  ]);
  return ring;
}

// Test Subjects don't level and aren't part of the shared bonusSelections pool — this tracks
// which ones you've unlocked (their "(All Classes)" passive applies permanently once unlocked,
// independent of which one is currently active), a simple multi-select whole-card toggle like
// Special Passives/Relics use, just backed by its own id array instead of bonusSelections.
function renderTestSubjectsTab() {
  const wrap = el('div', { class: 'card-browser' });
  wrap.appendChild(el('h2', {}, 'Test Subjects'));
  wrap.appendChild(el('div', { class: 'sub' }, 'Mark which Test Subjects you\'ve unlocked — their passive "(All Classes)" bonus applies permanently once unlocked, whether or not that one is your currently active pick (set on the main Calculator tab).'));

  if (GAMEDATA.classes.testSubject.length > 12) {
    wrap.appendChild(makeSearchBox('TestSubject', 'Test Subjects'));
  }
  const q = (cardSearchDrafts['TestSubject'] || '').trim().toLowerCase();
  const items = q ? GAMEDATA.classes.testSubject.filter(t => t.name.toLowerCase().includes(q) || t.description.join(' ').toLowerCase().includes(q)) : GAMEDATA.classes.testSubject;
  const sorted = [...items].sort((a, b) => {
    const aOn = state.unlockedTestSubjectIds.includes(a.id);
    const bOn = state.unlockedTestSubjectIds.includes(b.id);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const ts of sorted) {
    const active = state.unlockedTestSubjectIds.includes(ts.id);
    grid.appendChild(el('div', {
      class: 'item-card clickable' + (active ? ' active' : ''),
      onclick: () => {
        state.unlockedTestSubjectIds = active
          ? state.unlockedTestSubjectIds.filter(id => id !== ts.id)
          : [...state.unlockedTestSubjectIds, ts.id];
        renderAll();
      },
    }, [
      iconImg('testSubject:' + ts.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, [
        el('div', { class: 'ic-name' }, ts.name),
        el('div', { class: 'ic-desc' }, cardDescriptionNodes(ts)),
      ]),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

// Only the (All Classes) bonus is shown per card here — that's the only thing this tab tracks.
// A class's other 4 bonuses only apply when it's your active class at a sufficient level (set on
// the main Calculator tab), which this list is deliberately not implying.
function renderMaxedClassesTab() {
  const wrap = el('div', { class: 'card-browser' });
  wrap.appendChild(el('h2', {}, 'Maxed Classes'));
  wrap.appendChild(el('div', { class: 'sub' }, 'Mark which classes you\'ve brought to max level — each one\'s final "(All Classes)" bonus applies permanently once maxed, whether or not that class is your currently active pick (set on the main Calculator tab). A class\'s other bonuses only apply while it\'s active.'));

  if (GAMEDATA.classes.school.length > 12) {
    wrap.appendChild(makeSearchBox('MaxedClass', 'classes'));
  }
  const q = (cardSearchDrafts['MaxedClass'] || '').trim().toLowerCase();
  const items = q ? GAMEDATA.classes.school.filter(c => c.name.toLowerCase().includes(q)) : GAMEDATA.classes.school;
  const sorted = [...items].sort((a, b) => {
    const aOn = state.maxedClassIds.includes(a.id);
    const bOn = state.maxedClassIds.includes(b.id);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const cls of sorted) {
    const active = state.maxedClassIds.includes(cls.id);
    const allClassesEff = classAllClassesEffect(cls);
    grid.appendChild(el('div', {
      class: 'item-card clickable' + (active ? ' active' : ''),
      onclick: () => {
        state.maxedClassIds = active
          ? state.maxedClassIds.filter(id => id !== cls.id)
          : [...state.maxedClassIds, cls.id];
        renderAll();
      },
    }, [
      iconImg('class:' + cls.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, [
        el('div', { class: 'ic-name' }, cls.name),
        el('div', { class: 'ic-desc' }, allClassesEff ? effectNode(allClassesEff) : 'No (All Classes) bonus found.'),
      ]),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderSynergiesTab() {
  const owned = new Set(selectedArtifactIds());
  const leniency = magnumOpusActive() ? 1 : 0;
  const wrap = el('div', { class: 'card-browser' });
  wrap.appendChild(el('h2', {}, 'Synergies'));
  wrap.appendChild(el('div', { class: 'sub' }, 'Auto-activated once synergy requirements are active.'
    + (leniency ? ' Magnum Opus is active: any synergy missing exactly 1 relic still counts as met (though it gives no benefit if that missing piece is specifically what the synergy modifies).' : '')));

  if (GAMEDATA.synergies.length > 12) {
    wrap.appendChild(makeSearchBox('Synergy', 'synergies'));
  }
  const q = (cardSearchDrafts['Synergy'] || '').trim().toLowerCase();
  const items = q ? GAMEDATA.synergies.filter(s => s.name.toLowerCase().includes(q) || s.description.join(' ').toLowerCase().includes(q)) : GAMEDATA.synergies;

  const rows = items.map(syn => {
    const total = syn.requiresArtifactIds.length;
    const missing = synergyMissingIds(syn, owned);
    const activeCount = total - missing.length;
    const isActive = total > 0 && missing.length <= leniency;
    const isNoop = isActive && synergyNoopViaLeniency(syn);
    return { syn, total, activeCount, isActive, isNoop };
  }).sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (!a.isActive && a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
    return a.syn.name.localeCompare(b.syn.name);
  });

  const grid = el('div', { class: 'card-grid' });
  if (!rows.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const { syn, total, activeCount, isActive, isNoop } of rows) {
    const componentNames = syn.requiresArtifactIds.map(id => {
      const art = GAMEDATA.artifacts.find(a => a.id === id);
      const have = owned.has(id);
      return el('div', { class: have ? 'have' : '' }, (have ? '✓ ' : '· ') + (art ? art.name : '#' + id));
    });
    const card = el('div', { class: 'item-card synergy' + (isActive ? ' active' : '') }, [
      buildRingElement(total, activeCount, iconImg('synergy:' + syn.id, 'synergy-ring-icon')),
      el('div', { class: 'ic-name' }, syn.name),
      el('div', { class: 'ic-desc' }, cardDescriptionNodes(syn)),
      el('div', { class: 'synergy-components' }, componentNames),
      isNoop ? el('div', { class: 'note', style: 'color:var(--crit); margin-top:6px;' }, 'Counted as met via Magnum Opus, but gives no benefit — the missing piece is exactly what this synergy modifies.') : null,
    ]);
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  return wrap;
}

// ===================== Encyclopedia =====================
// Always-visible reference cards for content that's otherwise only reachable contextually (Spells/
// Evolutions/Fusions/Ultimates are gated behind the Calculator tab's own selection/level state;
// Classes/Test Subjects have no lookup view at all outside Maxed Classes/Test Subjects' own
// progress-tracking tabs). Deliberately shows pure base game values, never state-dependent — stays
// a clean reference distinct from the Calculator tab, which is where your actual build's numbers
// live. Ultimates: iterating GAMEDATA.ultimates.byFusionName (not GAMEDATA.fusions + a manual
// "is this released" check) already excludes the 8 fusions with real-but-unreleased ultimates for
// free — that curated dict only has the 24 real, live ones to begin with.
const ENCYCLOPEDIA_SUBTABS = [
  { id: 'spells', label: 'Spells' },
  { id: 'evolutions', label: 'Evolutions' },
  { id: 'fusions', label: 'Fusions' },
  { id: 'ultimates', label: 'Ultimates' },
  { id: 'classes', label: 'Classes' },
  { id: 'testsubjects', label: 'Test Subjects' },
];

function renderEncyclopediaTab() {
  const wrap = el('div', { class: 'card-browser' });
  wrap.appendChild(el('h2', {}, 'Encyclopedia'));
  wrap.appendChild(el('div', { class: 'sub' }, 'Reference lookup for every Spell, Evolution, Fusion, Ultimate, Class, and Test Subject — base game values, independent of your current build (see the Calculator tab for your actual numbers).'));

  const subBar = el('div', { class: 'rarity-tabbar' });
  for (const sub of ENCYCLOPEDIA_SUBTABS) {
    subBar.appendChild(el('button', {
      class: state.encyclopediaSubTab === sub.id ? 'active' : null,
      onclick: () => { state.encyclopediaSubTab = sub.id; renderAll(); },
    }, sub.label));
  }
  wrap.appendChild(subBar);

  if (state.encyclopediaSubTab === 'evolutions') wrap.appendChild(renderEncyclopediaEvolutions());
  else if (state.encyclopediaSubTab === 'fusions') wrap.appendChild(renderEncyclopediaFusions());
  else if (state.encyclopediaSubTab === 'ultimates') wrap.appendChild(renderEncyclopediaUltimates());
  else if (state.encyclopediaSubTab === 'classes') wrap.appendChild(renderEncyclopediaClasses());
  else if (state.encyclopediaSubTab === 'testsubjects') wrap.appendChild(renderEncyclopediaTestSubjects());
  else wrap.appendChild(renderEncyclopediaSpells());

  return wrap;
}

function renderEncyclopediaSpells() {
  const wrap = el('div', {});
  wrap.appendChild(makeSearchBox('EncySpells', 'spells'));
  const q = (cardSearchDrafts['EncySpells'] || '').trim().toLowerCase();
  const spells = [];
  for (let id = 1; id <= 21; id++) { if (GAMEDATA.spells[id]) spells.push(GAMEDATA.spells[id]); }
  const filtered = q ? spells.filter(s => s.name.toLowerCase().includes(q) || (resolveDisplayText(s.description) || '').toLowerCase().includes(q)) : spells;
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const s of sorted) {
    const statsRow = el('div', { class: 'spell-stats' });
    if (s.base) {
      for (const [k, v] of Object.entries(s.base)) {
        if (k === 'name' || k === 'note') continue;
        statsRow.appendChild(el('div', { class: 'spell-stat' }, [document.createTextNode(labelize(k) + ' '), el('span', { class: 'num' }, String(v))]));
      }
    }
    grid.appendChild(el('div', { class: 'item-card' }, [
      iconImg('spell:' + s.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, [
        el('div', { class: 'ic-name' }, s.name),
        el('div', { class: 'ic-desc' }, highlightStatKeywords(resolveDisplayText(s.description) || '')),
        statsRow,
      ]),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderEncyclopediaEvolutions() {
  const wrap = el('div', {});
  wrap.appendChild(makeSearchBox('EncyEvolutions', 'evolutions'));
  const q = (cardSearchDrafts['EncyEvolutions'] || '').trim().toLowerCase();
  const evos = [];
  for (let id = 1; id <= 21; id++) {
    const s = GAMEDATA.spells[id];
    if (!s) continue;
    for (const evo of s.evolutions) evos.push({ evo, spell: s });
  }
  const filtered = q ? evos.filter(({ evo, spell }) => evo.name.toLowerCase().includes(q) || spell.name.toLowerCase().includes(q) || evo.description.join(' ').toLowerCase().includes(q)) : evos;
  const sorted = [...filtered].sort((a, b) => a.spell.name.localeCompare(b.spell.name) || a.evo.tier - b.evo.tier || a.evo.name.localeCompare(b.evo.name));

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const { evo, spell } of sorted) {
    const unconfirmed = HIGH_OUTPUT_EVOLUTION && evo.id === HIGH_OUTPUT_EVOLUTION.id;
    grid.appendChild(el('div', { class: 'item-card' }, [
      iconImg('evolution:' + evo.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, [
        el('div', { class: 'ic-name' }, evo.name + ' (' + spell.name + ', Tier ' + evo.tier + ')'),
        el('div', { class: 'ic-desc' }, evo.description.map(d => el('div', {}, describeLineNode(d, evo.effects)))),
        unconfirmed ? el('div', { class: 'note' }, 'This calculator treats this Size→Damage conversion as 1:1, its own separate multiplier — unconfirmed (see Mechanics tab).') : null,
      ]),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

// The E16 batch's ratio/bucket questions are still unresolved (see the Mechanics tab's own caveat
// section and .agentkanban/tasks/task_20260818_e16_size-duration-damage-conversions.md) — flagging
// it right on each affected fusion's own Encyclopedia card too, not just in Mechanics, per the
// user's explicit direction, so the uncertainty is visible wherever these numbers actually surface.
const UNCONFIRMED_CONVERSION_FUSION_NOTES = new Map([
  [GATE_FUSION, '1:1 Size→Damage'], [GHASTLY_RAMPAGE_FUSION, '1:1 Duration→Damage'],
  [PRISM_SPRAY_FUSION, '1:1 Duration→Damage'], [GREAT_RIFT_FUSION, '1:1 Size→Damage'],
  [BLACK_DEATH_FUSION, '1:1 Size→Damage'], [GENOCIDE_FUSION, '1:1 Size→Damage'],
  [HYPERION_FUSION, '1:1 Size→Damage (additional factor)'], [BLACK_HOLE_FUSION, '3X Duration→Damage'],
].filter(([f]) => f));

function renderEncyclopediaFusions() {
  const wrap = el('div', {});
  wrap.appendChild(makeSearchBox('EncyFusions', 'fusions'));
  const q = (cardSearchDrafts['EncyFusions'] || '').trim().toLowerCase();
  const filtered = q ? GAMEDATA.fusions.filter(f => f.name.toLowerCase().includes(q) || f.description.join(' ').toLowerCase().includes(q)) : GAMEDATA.fusions;
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const f of sorted) {
    const unconfirmedRatio = UNCONFIRMED_CONVERSION_FUSION_NOTES.get(f);
    grid.appendChild(el('div', { class: 'item-card' }, [
      iconImg('fusion:' + f.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, [
        el('div', { class: 'ic-name' }, f.name),
        el('div', { class: 'ic-desc' }, descriptionNodes(f.description, f.effects)),
        unconfirmedRatio ? el('div', { class: 'note' }, 'This calculator treats this conversion as ' + unconfirmedRatio + ', its own separate multiplier — unconfirmed (see Mechanics tab).') : null,
      ]),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderEncyclopediaUltimates() {
  const wrap = el('div', {});
  wrap.appendChild(makeSearchBox('EncyUltimates', 'ultimates'));
  const q = (cardSearchDrafts['EncyUltimates'] || '').trim().toLowerCase();
  const rows = GAMEDATA.fusions.map(f => ({ f, ult: getUltimateInfo(f) })).filter(r => r.ult);
  const filtered = q ? rows.filter(({ f, ult }) => ult.ultimateName.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) : rows;
  const sorted = [...filtered].sort((a, b) => a.ult.ultimateName.localeCompare(b.ult.ultimateName));

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const { f, ult } of sorted) {
    const body = [
      el('div', { class: 'ic-name' }, ult.ultimateName + ' (' + f.name + ')'),
      f.ultimateDescription ? el('div', { class: 'ic-desc' }, highlightStatKeywords(resolveDisplayText(f.ultimateDescription))) : null,
      ult.multiplier ? el('div', { class: 'note' }, '×' + ult.multiplier + ' damage multiplier' + (ult.verified === true ? ' ✓' : ' (approx.)')) : null,
      ult.damageScalingText ? el('div', { class: 'note' }, ult.damageScalingText) : null,
    ];
    grid.appendChild(el('div', { class: 'item-card' }, [
      iconImg('ultimate:' + f.id, 'ic-icon') || iconImg('fusion:' + f.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, body),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

// Class cards get a distinct dark, decorative visual shell (see .class-card/.class-card-* CSS)
// modeled on the real in-game class detail screen the user shared reference screenshots of —
// black background, large display-style title, thin divider. Text coloring reuses the calculator's
// own stat-color pipeline (effectNode/highlightStatKeywords) rather than trying to replicate the
// real game's own per-line color rotation, which turned out not to track stat type consistently
// across all 24 real screenshots (checked directly) — the one real, consistent signal in the real
// game is that any "(All Classes)" line is always shown distinctly, which isAllClassesEffect (see
// classAllClassesEffect above) already detects, so that gets its own small badge here instead.
function renderEncyclopediaClasses() {
  const wrap = el('div', {});
  wrap.appendChild(makeSearchBox('EncyClasses', 'classes'));
  const q = (cardSearchDrafts['EncyClasses'] || '').trim().toLowerCase();
  const filtered = q ? GAMEDATA.classes.school.filter(c => c.name.toLowerCase().includes(q) || c.description.join(' ').toLowerCase().includes(q)) : GAMEDATA.classes.school;
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  const grid = el('div', { class: 'class-card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const cls of sorted) {
    const lines = cls.effects.map(eff => {
      const allClasses = isAllClassesEffect(eff);
      return el('div', { class: 'class-card-line' }, [
        effectNode(eff),
        allClasses ? el('span', { class: 'allclasses-badge' }, 'ALL CLASSES') : null,
      ]);
    });
    grid.appendChild(el('div', { class: 'class-card' }, [
      iconImg('class:' + cls.id, 'class-card-icon'),
      el('div', { class: 'class-card-name' }, cls.name),
      el('div', { class: 'class-card-divider' }),
      el('div', { class: 'class-card-lines' }, lines),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderEncyclopediaTestSubjects() {
  const wrap = el('div', {});
  wrap.appendChild(makeSearchBox('EncyTestSubjects', 'test subjects'));
  const q = (cardSearchDrafts['EncyTestSubjects'] || '').trim().toLowerCase();
  const filtered = q ? GAMEDATA.classes.testSubject.filter(t => t.name.toLowerCase().includes(q) || t.description.join(' ').toLowerCase().includes(q)) : GAMEDATA.classes.testSubject;
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  const grid = el('div', { class: 'card-grid' });
  if (!sorted.length) grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  for (const ts of sorted) {
    grid.appendChild(el('div', { class: 'item-card' }, [
      iconImg('testSubject:' + ts.id, 'ic-icon'),
      el('div', { class: 'ic-body' }, [
        el('div', { class: 'ic-name' }, ts.name),
        el('div', { class: 'ic-desc' }, descriptionNodes(ts.description, ts.effects)),
      ]),
    ]));
  }
  wrap.appendChild(grid);
  return wrap;
}

// ===================== Mechanics =====================
// Plain-language explainer of the calculator's own formulas, with real equations (cited against the
// actual compute() code, not approximated) and a worked numeric example per section. Section 6
// (Size/Duration -> Damage conversions) covers the pending E16 batch, explicitly marked unconfirmed
// per the user's own direction — update this section if/when that batch's ratio/bucket questions
// get resolved (see .agentkanban/tasks/task_20260818_e16_size-duration-damage-conversions.md).
function mechSection(title, bodyNodes) {
  return el('div', { class: 'mech-section' }, [
    el('h3', {}, title),
    ...bodyNodes,
  ]);
}
function mechEq(text) {
  return el('div', { class: 'mech-eq' }, text);
}
function mechExample(text) {
  return el('div', { class: 'mech-example' }, [el('span', { class: 'mech-example-label' }, 'Example: '), text]);
}

function renderMechanicsTab() {
  const wrap = el('div', { class: 'card-browser mechanics-tab' });
  wrap.appendChild(el('h2', {}, 'Mechanics'));
  wrap.appendChild(el('div', { class: 'sub' }, 'How the calculator\'s own formulas work — the same math the Calculator tab actually runs, explained plainly with worked examples.'));

  wrap.appendChild(mechSection('Player Base Stats', [
    el('div', { class: 'spell-stats' }, [
      el('div', { class: 'spell-stat' }, [document.createTextNode('Base ATK '), el('span', { class: 'num stat-atk' }, String(PLAYER_BASE_ATK))]),
      el('div', { class: 'spell-stat' }, [document.createTextNode('Base Crit Chance '), el('span', { class: 'num stat-crit' }, PLAYER_BASE_CRIT_CHANCE + '%')]),
      el('div', { class: 'spell-stat' }, [document.createTextNode('Base Crit Multiplier '), el('span', { class: 'num stat-crit' }, PLAYER_BASE_CRIT_MULT + '%')]),
      el('div', { class: 'spell-stat' }, [document.createTextNode('Base Max HP '), el('span', { class: 'num' }, String(PLAYER_BASE_MAX_HP))]),
      el('div', { class: 'spell-stat' }, [document.createTextNode('Base Move Speed '), el('span', { class: 'num' }, String(PLAYER_BASE_MOVE_SPEED))]),
    ]),
    el('div', { class: 'note' }, 'Not player-editable — every bonus you select adds on top of these through the pools below.'),
  ]));

  wrap.appendChild(mechSection('Core Damage Formula', [
    mechEq('Non-Crit Damage = Base × ATK × AMP × MDMG × DEM × Class × Additional Damage × Fusion/Ultimate Multiplier'),
    mechEq('Crit Damage = Non-Crit Damage × (Crit Multiplier / 100)'),
    el('div', {}, [
      el('div', {}, [el('span', { class: 'stat-atk' }, 'ATK'), document.createTextNode(' = 100 × (1 + ATK% / 100) — the flat "Increase ATK by X%" pool.')]),
      el('div', {}, [el('span', { class: 'stat-amp' }, 'AMP'), document.createTextNode(' = 1 + Amplify% / 100 — the "Amplify ATK by X%" pool, mechanically separate from ATK%.')]),
      el('div', {}, [el('span', { class: 'stat-amd' }, 'MDMG'), document.createTextNode(' = max(0, 1 + Magic Damage% / 100) — the additive Magic/Combination Damage pool.')]),
      el('div', {}, [el('span', { class: 'stat-xmult' }, 'DEM, Class, Additional Damage, Fusion/Ultimate'), document.createTextNode(' — each its own separate multiplicative factor, not folded into MDMG.')]),
    ]),
    mechExample('Base 100, ATK% +50 → ATK = 150, everything else at 1 → Non-Crit = 100 × 150 × 1 × 1 × 1 × 1 × 1 × 1 = 15,000.'),
  ]));

  wrap.appendChild(mechSection('Cooldown Reduction', [
    el('div', {}, 'Cooldown Reduction combines multiplicatively across unique sources, not additively — each source\'s own total is grouped first (so two triggers of the same source add together), then every unique source multiplies together.'),
    mechEq('Final Cooldown Multiplier = ∏ (1 + source_total% / 100) across each unique source'),
    mechExample('Two different -20% CDR sources: 0.8 × 0.8 = 0.64 → a 36% net reduction, not 40%.'),
  ]));

  wrap.appendChild(mechSection('Enemy Max HP Reduction', [
    el('div', {}, 'Same multiplicative-per-source idea as Cooldown Reduction, expressed as a reduction fraction instead of a final multiplier — confirmed against real in-game readings (see the Max HP Reduction rework in this project\'s history).'),
    mechEq('Reduction Fraction = 1 − ∏ (1 − source% / 100) across each source'),
    mechExample('Two different -20% sources: 1 − (0.8 × 0.8) = 1 − 0.64 = 0.36 → 36% total reduction, not 40%.'),
  ]));

  wrap.appendChild(mechSection('Critical Hits', [
    el('div', {}, ['Crit Chance and Crit Multiplier both start from the base stats above and add every "Increase Critical Strike Rate/Multiplier" bonus you select on top.']),
    mechEq('Crit Damage = Non-Crit Damage × (Crit Multiplier / 100)'),
    mechExample('Base Crit Multiplier 200% with no bonuses: a crit simply doubles the non-crit hit.'),
  ]));

  wrap.appendChild(mechSection('Size/Duration → Damage Conversions (unconfirmed ratios)', [
    el('div', { class: 'note' }, 'The fusions/evolutions below convert a spell\'s own Size% or Duration% directly into a damage multiplier. Only Space Warp\'s 1:1 ratio has been independently confirmed against a real reported ultimate value — every other ratio below is an assumption by analogy (1:1 unless the item\'s own text states otherwise, like Black Hole\'s 3X), and whether these belong in their own multiplicative bucket (current treatment) versus the additive Magic Damage pool is also still an open question the community is being asked about. Treat every number in this section as provisional.'),
    el('div', { class: 'mech-conversion-list' }, [
      'Space Warp (Cloaking) — Duration → Damage, 1:1, confirmed.',
      'Furnace (Lava Zone) — Duration → Damage, 1:1, assumed.',
      'Photon Explosion (Shield) — Size → Damage, 1:1, assumed.',
      'Gate (Flash Shock) — Size → Damage, 1:1, assumed.',
      'Ghastly Rampage (Fireball) — Duration → Damage, 1:1, assumed.',
      'Prism Spray (Arcane Ray) — Duration → Damage, 1:1, assumed.',
      'Great Rift (Frost Nova) — Size → Damage, 1:1, assumed.',
      'Black Death (Fireball) — Size → Damage, 1:1, assumed.',
      'Genocide (Arcane Ray) — Size → Damage, 1:1, assumed.',
      'Hyperion (Satellite) — Size → Damage, 1:1, assumed (additional to its own separately-confirmed count-based factor).',
      'High Output (Electric Shock evolution) — Size → Damage, 1:1, assumed.',
      'Black Hole (Cyclone) — Duration → Damage, 3X stated directly in the game\'s own text (more trustworthy than the 1:1 assumptions above).',
    ].map(t => el('div', { class: 'mech-conversion-item' }, t))),
  ]));

  return wrap;
}

// Research's raw description text is literally "Increase ATK by □%" — the game fills that box in
// live based on your current Research Points, so the static source text never has a real number.
// The decoded effect text (built from the structured effectID/value columns, falling back to a
// globally-learned template) does have the real number, so prefer that over raw description
// wherever it's available — this matters for Research specifically, but is strictly more correct
// everywhere else too since it's derived from the same underlying data.
function cardDescriptionNodes(item) {
  if (item.effects && item.effects.length) {
    // Deduped by exact resolved text — a systematic audit (prompted by finding Wonderland double-
    // counting its own Max HP reduction) found 7 items (Meat, Gravity Orb, Worldtree Leaf, Pandora's
    // Box, Clockwork, Holy Chest, Longinus' Spear) whose raw effects carry a generic "(Cooldown: Ns)"
    // marker (id 706, confirmed used consistently for exactly this across 9 items total) ALONGSIDE a
    // second, item-specific effect that also resolves to the identical "(Cooldown: Ns)" text — a
    // genuine data duplicate (these items' real "what happens on trigger" text has no numeric stat to
    // describe, e.g. Meat's "Generate Life Orbs near the character", so extraction apparently fell
    // back to repeating the cooldown text for that slot too), not a real double-stack. Unlike the
    // Wonderland fix, this is safe to dedupe generally rather than scoping to specific item names —
    // cardDescriptionNodes is never used for School Classes (Wizard's genuinely-separate double
    // Magic Bolt Lv+1 grant, Archmage's still-unconfirmed double Combination Magic Damage line both
    // render through a different path, unlockedClassEffects, untouched by this), so there's no known
    // real double-grant case that could be silently hidden here the way the earlier attempt broke.
    const withText = item.effects
      .filter(e => e.text)
      .filter((e, i, arr) => arr.findIndex(x => x.text === e.text) === i);
    if (withText.length) {
      const nodes = [];
      withText.forEach((e, i) => {
        if (i > 0) nodes.push(' — ');
        // effectNode may now return an array (its own keyword-fallback path) — spread rather than
        // push, same reason descriptionNodes already spreads describeLineNode's array results:
        // el()'s children list must stay flat, one level deep, never nested.
        const node = effectNode(e);
        if (Array.isArray(node)) nodes.push(...node); else nodes.push(node);
      });
      return nodes;
    }
    // None of this item's effects resolved their own display text (the decoder found no fragment
    // to match against) — the raw description's own "□"-style characters are the game's live-fill
    // placeholder for these exact values, so substitute the real numbers in directly rather than
    // falling all the way back to showing literal boxes. Filled positionally (Nth box-run gets the
    // Nth effect's value) — correct for the common one-box-one-effect case; a rarer multi-effect,
    // single-box item (e.g. Awakening) only gets its first value filled, which is still strictly
    // better than showing no number at all.
    if (item.description.some(d => /□/.test(d))) {
      let idx = 0;
      const filled = item.description.map(line => line.replace(/□+/g, () => {
        const eff = item.effects[idx++];
        return eff ? String(Math.abs(eff.value)) : '';
      }));
      // "Current Amplification Effect: □%" is a generic template line the game reuses on 7 items
      // regardless of which stat bucket the item actually affects — accurate on DNA/Crown (real
      // effect IS Amplify ATK), but genuinely misleading on Oculus/Carnival (real effect: Critical
      // Rate), Gaia/Abyss (real effect: ATK), and Matrix (real effect: All Magic Damage) if colored
      // as AMP. Turns out only DNA and Abyss ever actually reach this branch and display that line
      // at all — Oculus/Carnival/Gaia/Matrix's OWN effects all carry their own real per-effect text,
      // so they render through the branch above instead, which only ever shows an item's own
      // `.effects`, silently dropping this description-only line since no effect matches it (never
      // a live bug for those 4 in practice). Kept in this list anyway, defensively, in case a future
      // data refresh ever changes that. The □-filled number itself is also just this item's own
      // static raw effect value (often a bare marker, e.g. Abyss's is literally `value: 1`), not a
      // live computed figure, so recoloring it to the "correct" bucket would still overstate its
      // precision — left fully plain instead, processed per-line (not as one joined blob) so the
      // rest of the item's own lines still get their own real, correct keyword coloring.
      const AMPLIFICATION_LABEL_MISMATCHED = ['Oculus', 'Carnival', 'Gaia', 'Abyss', 'Matrix'];
      if (AMPLIFICATION_LABEL_MISMATCHED.includes(item.name)) {
        const nodes = [];
        filled.forEach((line, i) => {
          if (i > 0) nodes.push(' — ');
          const resolved = resolveDisplayText(line);
          if (/^Current Amplification Effect:/.test(resolved)) nodes.push(resolved);
          else nodes.push(...highlightStatKeywords(resolved));
        });
        return nodes;
      }
      // Same keyword fallback as the final return below — without it, this branch's own stat
      // language (e.g. DNA/Abyss's "ATK is Amplified by...") rendered fully uncolored, since it's
      // a separate early return that previously skipped straight to a bare string.
      return highlightStatKeywords(resolveDisplayText(filled.join(' — ')));
    }
  }
  return highlightStatKeywords(resolveDisplayText(item.description.join(' — ')));
}

// Maps a card-browser `category` string to the ICON_MAP key prefix for its underlying items.
// "Passive (Post-Max)" entries reuse the normal-tier passive's id (see PASSIVES_POST_MAX above),
// so they share the same icon key prefix as "Passive".
const ICON_CATEGORY_PREFIX = {
  Research: 'research', Passive: 'passive', 'Passive (Post-Max)': 'passive',
  'Special Passive': 'specialPassive', Artifact: 'artifact',
};

// renderTabContent() rebuilds the whole tab pane from scratch on every keystroke (same "re-render
// everything" approach used throughout), which normally replaces the <input> itself and drops
// focus after a single character. Giving the input a stable id and explicitly refocusing +
// restoring the cursor position right after the rebuild keeps typing continuous.
function makeSearchBox(category, noun) {
  const inputId = 'search-' + category.replace(/[^a-zA-Z0-9]/g, '_');
  return el('div', { class: 'searchbox', style: 'max-width:320px;' }, [
    el('input', {
      id: inputId, type: 'text', placeholder: 'Search ' + noun.toLowerCase() + '…',
      value: cardSearchDrafts[category] || '',
      oninput: e => {
        const cursor = e.target.selectionStart;
        cardSearchDrafts[category] = e.target.value;
        renderTabContent();
        const input = document.getElementById(inputId);
        if (input && input.focus) {
          input.focus();
          if (input.setSelectionRange) input.setSelectionRange(cursor, cursor);
        }
      },
    }),
  ]);
}

function renderCardBrowserSection({ title, subtitle, items, category, hasLevels, getLevelBonus, maxLevelNote, sortSelectedFirst }) {
  const wrap = el('div', { class: 'card-browser' });
  wrap.appendChild(el('h2', {}, title));
  if (subtitle) wrap.appendChild(el('div', { class: 'sub' }, subtitle));
  if (maxLevelNote) wrap.appendChild(el('div', { class: 'note', style: 'margin-bottom:12px;' }, maxLevelNote));

  if (items.length > 12) {
    wrap.appendChild(makeSearchBox(category, title));
  }
  // Cards carry their own +/- (or add/remove) controls directly — no separate "selected" list.
  // Search only filters which cards are shown; it never affects what's actually selected.
  const q = (cardSearchDrafts[category] || '').trim().toLowerCase();
  const filtered = q ? items.filter(x => x.name.toLowerCase().includes(q) || x.description.join(' ').toLowerCase().includes(q)) : items;
  // Selected-first sorting is only wanted on the Relic/rarity tabs — everywhere else keeps a
  // stable alphabetical order regardless of what's picked, so the grid doesn't reshuffle under you.
  const gridItems = [...filtered].sort((a, b) => {
    if (sortSelectedFirst) {
      const aOn = !!state.bonusSelections[bonusKey({ ...a, category })];
      const bOn = !!state.bonusSelections[bonusKey({ ...b, category })];
      if (aOn !== bOn) return aOn ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const grid = el('div', { class: 'card-grid' });
  if (!gridItems.length) {
    grid.appendChild(el('div', { class: 'note' }, 'No matches.'));
  }
  for (const item of gridItems) {
    const key = bonusKey({ ...item, category });
    // `count` is only ever the player's own manual investment (clicked via +/-), capped at the
    // item's base maxLevel. Cube/Taoist's bonus levels (getLevelBonus) apply automatically on top
    // for display and stat purposes once at least 1 level is manually invested — they're never
    // themselves clickable, so the stepper's own ceiling stays at the base maxLevel always.
    const count = state.bonusSelections[key] || 0;
    const active = count > 0;
    const levelBonus = (active && getLevelBonus) ? getLevelBonus(item) : 0;
    const displayLevel = count + levelBonus;
    const maxLvl = hasLevels ? item.maxLevel : 1;
    const displayMax = maxLvl + (getLevelBonus ? getLevelBonus(item) : 0);

    const iconKey = (ICON_CATEGORY_PREFIX[category] || '') + ':' + item.id;
    const icon = iconImg(iconKey, 'ic-icon');
    const body = hasLevels
      ? el('div', { class: 'ic-body' }, [
          el('div', { class: 'ic-name' }, item.name + ' (max ' + displayMax + ')'),
          el('div', { class: 'ic-desc' }, cardDescriptionNodes(item)),
        ])
      : el('div', { class: 'ic-body' }, [
          el('div', { class: 'ic-name' }, item.name),
          el('div', { class: 'ic-desc' }, cardDescriptionNodes(item)),
        ]);

    let card;
    if (hasLevels) {
      const controls = el('div', { class: 'ic-stepper' }, [
        el('button', {
          onclick: () => { if (count > 0) { state.bonusSelections[key] = count - 1; renderAll(); } },
          disabled: count <= 0 ? 'disabled' : null,
        }, '−'),
        el('span', { class: 'ic-level' }, String(displayLevel)),
        el('button', {
          onclick: () => { if (count < maxLvl) { state.bonusSelections[key] = count + 1; renderAll(); } },
          disabled: count >= maxLvl ? 'disabled' : null,
        }, '+'),
      ]);
      card = el('div', { class: 'item-card' + (item.rarity ? ' rarity-' + item.rarity : '') + (active ? ' active' : '') }, [
        icon, body,
        el('div', { class: 'ic-controls' }, controls),
      ]);
    } else {
      // Not leveled (Special Passives, Relics/Artifacts) — the whole card is the toggle, no
      // separate button.
      card = el('div', {
        class: 'item-card clickable' + (item.rarity ? ' rarity-' + item.rarity : '') + (active ? ' active' : ''),
        onclick: () => { state.bonusSelections[key] = active ? 0 : 1; renderAll(); },
      }, [icon, body]);
    }
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderAll() {
  renderTabBar();
  renderTabContent();
  renderLeftPane();
  renderMainPane();
  renderResultsPane();
  saveAutosave();
}

loadAutosave();
renderAll();
