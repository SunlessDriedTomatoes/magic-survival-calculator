const fs = require('fs');
const { parseCSV } = require('./parse_csv.js');
const BASE = __dirname + '/magicsurvival/export/textassets';
const OUT = __dirname + '/magicsurvival/decoded';

function stripColor(s) { return (s || '').replace(/<color=[^>]*>/g, '').replace(/<\/color>/g, '').trim(); }
function loadFile(name) {
  const text = fs.readFileSync(BASE + '/' + name, 'utf8');
  const rows = parseCSV(text);
  return { header: rows[0], data: rows.slice(2) };
}
const idMap = JSON.parse(fs.readFileSync(OUT + '/effect_id_map.json', 'utf8'));

function getEffectsGeneric(header, row, maxPairs) {
  const effects = [];
  for (let k = 1; k <= maxPairs; k++) {
    const idc = header.indexOf(`효과ID_0${k}`);
    const valc = header.indexOf(`효과ID_0${k}값`);
    if (idc === -1 || valc === -1) continue;
    const id = parseInt(row[idc], 10);
    const val = parseFloat(row[valc]);
    if (!isNaN(id) && id !== 1 && id !== 0) effects.push({ id, value: isNaN(val) ? 0 : val });
  }
  return effects;
}
function getDescLines(header, row, prefix) {
  const lines = [];
  for (let k = 1; k <= 6; k++) {
    const c = header.indexOf(`${prefix}0${k}`);
    if (c === -1) continue;
    const v = stripColor(row[c]);
    if (v && v !== '`') lines.push(v);
  }
  return lines;
}
// Split effect-description lines into individual fragments (tiers separated by ^, simultaneous effects by @).
function extractFragments(descLines) {
  const fragments = [];
  for (const raw of descLines) {
    const tiers = raw.split('^');
    for (const tier of tiers) {
      const cleanTier = tier.replace(/《/g, '').replace(/》/g, '').trim();
      if (!cleanTier || cleanTier === '`') continue;
      for (const p of cleanTier.split('@').map(s => s.trim()).filter(Boolean)) fragments.push(p);
    }
  }
  return fragments;
}
// Try to find eff.value (optionally scaled by /10 or /100, to handle fixed-point-encoded fields
// like "666" meaning "6.66X") inside one of this row's own text fragments, by comparing complete
// number tokens numerically (not substring matching, which can hit partial numbers like the "3"
// inside "3.3"). Returns the resolved display text. Falls back to the globally-learned template
// (raw value, unscaled) if nothing in the row's own text matches.
const NUMBER_TOKEN_RE = /(?<![0-9.])\d+(?:\.\d+)?(?![0-9.])/g;
const CLEAN_STAT_RE = /^(Increase|Decrease) .+ by /;
// Finds an unused fragment (not already in usedFragments) whose numeric token matches absV*scale,
// preferring "clean" Increase/Decrease-by-N sentences over loose narrative text. Marks whatever it
// returns as used, so a later effect in the same row with a coincidentally identical value (e.g. a
// 20%-cooldown AND a 20%-damage line in the same row) can't steal the same sentence twice.
function findInFragments(fragments, usedFragments, scale, absV) {
  const scaled = Math.round(absV * scale * 100) / 100; // avoid float noise
  if (scaled === 0) return null;
  const ordered = [...fragments.filter(f => CLEAN_STAT_RE.test(f)), ...fragments.filter(f => !CLEAN_STAT_RE.test(f))];
  for (const frag of ordered) {
    if (usedFragments.has(frag)) continue;
    const tokens = frag.match(NUMBER_TOKEN_RE);
    if (!tokens) continue;
    for (const tok of tokens) {
      if (Math.abs(parseFloat(tok) - scaled) < 0.005) {
        usedFragments.add(frag);
        return frag.replace(tok, String(scaled));
      }
    }
  }
  return null;
}
// Resolves display text for every effect in a row together (not one at a time), sharing a single
// usedFragments set across the whole row — this is what prevents two same-valued effects (e.g. a
// cooldown% and a damage% that both happen to be "20") from both matching the first "20" sentence
// they see. Falls back to the globally-learned template (raw value, unscaled) only when nothing in
// the row's own text is left to match against.
function labelEffects(effects, descLines) {
  const fragments = extractFragments(descLines);
  const usedFragments = new Set();
  return effects.map(eff => {
    const absV = Math.abs(eff.value);
    let text = null;
    for (const scale of [1, 0.1, 0.01]) {
      text = findInFragments(fragments, usedFragments, scale, absV);
      if (text) break;
    }
    if (!text) {
      const m = idMap[eff.id];
      text = (m && m.template) ? m.template.replace('{V}', absV) : null;
    }
    return { id: eff.id, value: eff.value, text };
  });
}

// A raw row can carry the same resolved effect text more than once — sometimes genuinely (e.g.
// Wizard's two separate "Magic Bolt Lv+1" grants, confirmed via in-game screenshot: the description
// itself mentions "Magic Bolt Lv +1" twice, once in the bracketed line-1 marker and once again as
// its own line 2), sometimes as a pure extraction artifact (Bishop's "Increase the maximum number
// of Shields by 1" appears twice in effects but only once in the description — confirmed via
// screenshot the game only grants it once; one of the two raw columns is a redundant encoding of
// the same single bonus, not a second grant). The description text itself is the ground truth for
// how many times a bonus is really granted, so this trims each same-text effect group down to at
// most that many occurrences, dropping the extras (kept in raw row order, so the reliably-matched
// ones — resolved from the row's own text rather than a generic id template — are kept first).
function trimEffectDuplicates(effects, descLines) {
  const descJoined = descLines.join(' @ ');
  const counts = new Map();
  for (const e of effects) if (e.text) counts.set(e.text, (counts.get(e.text) || 0) + 1);
  const kept = new Map();
  const out = [];
  for (const e of effects) {
    if (!e.text || counts.get(e.text) < 2) { out.push(e); continue; }
    const descCount = descJoined.split(e.text).length - 1;
    const soFar = kept.get(e.text) || 0;
    if (soFar < descCount) { out.push(e); kept.set(e.text, soFar + 1); }
  }
  return out;
}

// Reads a row's raw 효과ID_0k/효과ID_0k값 slots directly, preserving slot POSITION (unlike
// getEffectsGeneric, which filters out id 0/1 entirely and so can't be used to tell which level a
// given slot belongs to). Returns a 1-indexed-feeling array where result[k-1] is slot k.
function getRawEffectSlots(header, row, maxSlots) {
  const slots = [];
  for (let k = 1; k <= maxSlots; k++) {
    const idc = header.indexOf(`효과ID_0${k}`);
    const valc = header.indexOf(`효과ID_0${k}값`);
    if (idc === -1 || valc === -1) { slots.push(null); continue; }
    const id = parseInt(row[idc], 10);
    const val = parseFloat(row[valc]);
    slots.push({ id: isNaN(id) ? null : id, value: isNaN(val) ? 0 : val });
  }
  return slots;
}

// ---------- SPELLS ----------
const { header: aHeader, data: aData } = loadFile('eng_Dictionary_Ability.txt');
function acol(name) { const i = aHeader.indexOf(name); if (i === -1) throw new Error('missing ' + name); return i; }
const AIDX = {
  id: 0, name: acol('이름'), type: acol('유형'), reqLevel: acol('요구레벨'),
  traitId: acol('특성ID'), traitA: acol('특성A레벨'), traitB: acol('특성B레벨'), traitC: acol('특성C레벨'),
  maxLevel: acol('최대레벨'), derivedId: acol('파생기술ID'),
};
const baseStats = JSON.parse(fs.readFileSync(OUT + '/base_spell_stats.json', 'utf8'));

const spells = {};
for (const row of aData) {
  if (row[AIDX.type] === '마법') {
    const id = parseInt(row[AIDX.id], 10);
    const descLines = getDescLines(aHeader, row, '효과 설명줄');
    const maxLevel = parseInt(row[AIDX.maxLevel], 10) || 0;
    const traitUnlockLevels = [row[AIDX.traitA], row[AIDX.traitB], row[AIDX.traitC]].map(s => parseInt(s, 10)).filter(n => n > 0);
    // The spell's own LAST description line (descLines[descLines.length-1]) is a "^"-separated tier
    // list: one segment per level from 2 up to maxLevel-1, in order (confirmed against every one of
    // the 21 spells with zero exceptions — segment count always equals maxLevel-2). A segment can
    // itself contain multiple simultaneous grants separated by "@" (e.g. Spirit's "Damage +20% @
    // Number +1" applies BOTH at every level 2-6, not one or the other — this was a real, confirmed
    // bug in the previous positional-slot model, which could only ever assign one stat per level and
    // silently dropped the second). traitUnlockLevels are evolution-unlock levels (no stat of their
    // own) and always land on an empty "《》" segment. The row's own raw 효과ID_0k slots 1-7 (see
    // getRawEffectSlots) are NOT a level-by-level map — they're a redundant, position-scrambled
    // catalog of the same distinct (id,value) pairs the tier list uses, just repeated/duplicated
    // across slots however many times they happen to occur — so they're only used here as an id
    // lookup pool (matched to the tier list's own text via labelEffects, then deduped by resolved
    // text), never read positionally. Slots 8-9 are still never read at all (confirmed duplicate
    // "Damage+50% + [Cooldown/Size]" preview, matching descLines' second-to-last line).
    const rawSlots = getRawEffectSlots(aHeader, row, 7);
    const idPool = rawSlots.filter(s => s && s.id != null && s.id > 0); // excludes acquire markers (negative id) and the id=1 empty placeholder
    const tierListLine = descLines.length ? descLines[descLines.length - 1] : null;
    const labeledPoolRaw = labelEffects(idPool, [tierListLine]);
    const seenText = new Set();
    const labeledPool = labeledPoolRaw.filter(p => {
      if (!p.text || seenText.has(p.text)) return false;
      seenText.add(p.text);
      return true;
    });
    const tierSegments = tierListLine
      ? tierListLine.split('^').map(seg => seg.replace(/《/g, '').replace(/》/g, '').trim()).map(s => (s === '`' ? '' : s))
      : [];
    const levelUpgrades = [{ level: 1, kind: 'acquire' }];
    for (let level = 2; level <= maxLevel; level++) {
      if (traitUnlockLevels.includes(level)) continue;
      const segment = tierSegments[level - 2] || '';
      const matches = labeledPool.filter(p => p.text && segment.includes(p.text));
      if (!matches.length) levelUpgrades.push({ level, kind: 'empty' });
      else for (const m of matches) levelUpgrades.push({ level, kind: 'stat', id: m.id, value: m.value, text: m.text });
    }
    traitUnlockLevels.forEach((lvl, i) => levelUpgrades.push({ level: lvl, kind: 'evolution', tier: i + 1 }));
    levelUpgrades.sort((a, b) => a.level - b.level);
    spells[id] = {
      id, name: row[AIDX.name],
      description: descLines[0] || null,
      base: baseStats[String(id)] || null,
      maxLevel,
      traitUnlockLevels,
      levelUpgrades,
      evolutions: [],
    };
  }
}
for (const row of aData) {
  if (row[AIDX.type] === '특성') {
    const derivedId = parseInt(row[AIDX.derivedId], 10);
    if (!spells[derivedId]) continue;
    const name = row[AIDX.name];
    if (!name || name === '`') continue;
    const descLines = getDescLines(aHeader, row, '효과 설명줄');
    spells[derivedId].evolutions.push({
      id: parseInt(row[AIDX.id], 10),
      name,
      description: descLines,
      effects: labelEffects(getEffectsGeneric(aHeader, row, 9).filter(e => e.id !== -1), descLines),
    });
  }
}
// The raw "특성ID" (traitId) field does NOT correspond to the evolution tier/pick-group —
// verified against known game data that e.g. Magic Bolt's Magic Arrow/Fireworks/Fission are
// one mutually-exclusive tier-1 choice and Chain Casting/Fire at Will/Doppelganger are the
// tier-2 choice, while traitId gave inconsistent values across them. The rows are laid out in
// the source data as contiguous groups of 3 per tier (in ID order), so derive tier from that.
for (const spell of Object.values(spells)) {
  spell.evolutions.sort((a, b) => a.id - b.id);
  spell.evolutions.forEach((evo, i) => { evo.tier = Math.floor(i / 3) + 1; });
}

// ---------- ARTIFACTS, PASSIVES, TRAITS(non-spell), RESEARCH ----------
const typeNames = { '아티팩트': 'artifact', '특수패시브': 'specialPassive', '연구': 'research', '패시브': 'passive', '인챈트': 'enchant' };
// Artifacts repurpose the "요구레벨" (required-level) column as a 1-5 rarity tier instead of a
// real level gate (verified: every other row type uses this field for genuine level requirements
// like 800, while artifacts only ever show 1-5). Mapping confirmed against known rarities from an
// in-game infographic: Ruby(Common)=1, Rose(Rare)=2, Moon Crystal(Epic)=3, DNA(Legendary)=5 — 4 is
// Special by elimination.
const RARITY_BY_REQLEVEL = { 1: 'Common', 2: 'Rare', 3: 'Epic', 4: 'Special', 5: 'Legendary' };
const otherItems = { artifact: [], specialPassive: [], research: [], passive: [], enchant: [] };
const specialValue01Col = aHeader.indexOf('특수값01');
for (const row of aData) {
  const t = row[AIDX.type];
  const bucket = typeNames[t];
  if (!bucket) continue;
  const name = row[AIDX.name];
  if (!name || name === '`') continue;
  const descLines = getDescLines(aHeader, row, '효과 설명줄');
  // Negative effect IDs are "counts as N picks of this" self-reference markers (the same
  // convention spell evolutions use, e.g. Magic Bolt's own id=-1) — not real stat effects, and
  // left in, they can wrongly steal a description fragment meant for another effect (verified:
  // this broke Fast Casting/Snipe's post-max value extraction below).
  let effects = labelEffects(getEffectsGeneric(aHeader, row, 9).filter(e => e.id > 0), descLines);
  // A handful of items (verified: Research "Support"/Mana Orb Currency) have their entire real
  // value living in 특수값01 with every one of the normal effectID/value slots empty/noise — the
  // row's own description still has a "□"-style live-fill placeholder, so there's a real number
  // to show, just not reachable through the usual effect slots. No real effect id exists for
  // this, so it's synthesized with a placeholder one purely for display purposes here.
  if (!effects.length) {
    const specialVal = parseFloat(row[specialValue01Col]);
    if (specialVal && descLines.some(d => /□/.test(d))) {
      effects = [{ id: -9999, value: specialVal, text: null }];
    }
  }
  const item = {
    id: parseInt(row[AIDX.id], 10),
    name,
    maxLevel: parseInt(row[AIDX.maxLevel], 10) || 1,
    description: descLines,
    effects,
  };
  if (bucket === 'artifact') item.rarity = RARITY_BY_REQLEVEL[parseInt(row[AIDX.reqLevel], 10)] || null;
  // Normal Passives ("패시브") carry a *second*, separate progression tier that only unlocks after
  // the passive hits its normal Max Level — a reduced per-level value on the same stat, drawn from
  // the "특수값01" (Special Value 01) column rather than the usual effectID/value slots. Verified
  // against 6 passives (Intelligence, Vitality, Fast Casting, Haste, Concentration, Snipe): this
  // number always matches an otherwise-unused description line for the same stat as the primary
  // effect. It's a distinct, separately-picked upgrade in-game, not part of the same card.
  if (bucket === 'passive') {
    const specialVal = parseFloat(row[specialValue01Col]);
    const usedTexts = new Set(effects.map(e => e.text).filter(Boolean));
    const leftoverLine = descLines.find(l => !usedTexts.has(l));
    if (specialVal && effects[0]) {
      item.postMaxEffect = { id: effects[0].id, value: specialVal, text: leftoverLine || null };
      item.description = descLines.filter(l => l !== leftoverLine);
    }
  }
  otherItems[bucket].push(item);
}

// ---------- CLASSES ----------
const { header: cHeader, data: cData } = loadFile('eng_Dictionary_Class.txt');
function ccol(name) { const i = cHeader.indexOf(name); if (i === -1) throw new Error('missing ' + name); return i; }
const CIDX = { id: 0, name: ccol('이름'), type: ccol('유형') };
const classes = { school: [], testSubject: [] };
for (const row of cData) {
  const t = row[CIDX.type];
  const name = row[CIDX.name];
  if (!name || name === '`') continue;
  const descLines = getDescLines(cHeader, row, '효과 설명줄');
  const item = {
    id: parseInt(row[CIDX.id], 10),
    name,
    description: descLines,
    effects: trimEffectDuplicates(labelEffects(getEffectsGeneric(cHeader, row, 9), descLines), descLines),
  };
  if (t === '학파') classes.school.push(item);
  else if (t === '실험체') classes.testSubject.push(item);
}
// Most School classes tie to one specific spell — their own description literally says
// "〔SpellName Lv +1〕" (e.g. Wizard -> "〔Magic Bolt Lv +1〕"). A handful (Scholar, Archmage) boost
// "All Magic"/"Combination Magic" broadly instead of one spell, and correctly get no link. This
// text match is used rather than the row's raw negative-ID markers — those looked like a clean
// "-spellId" convention at first (Wizard carries id=-1) but multi-marker rows and generic-bonus
// rows (e.g. Scholar's "-316") broke that pattern, while the description text is unambiguous.
// Test Subjects share the same name as their paired School class (verified: 23 of 24 school names
// have an identically-named Test Subject) so they inherit the link via that name match.
const spellNamesById = Object.fromEntries(Object.values(spells).map(s => [s.name, s.id]));
for (const c of classes.school) {
  const m = (c.description[0] || '').match(/〔([^〕]+?) Lv \+1〕/);
  c.linkedSpellId = m ? (spellNamesById[m[1].trim()] || null) : null;
}
for (const c of classes.testSubject) {
  const twin = classes.school.find(s => s.name === c.name);
  c.linkedSpellId = twin ? twin.linkedSpellId : null;
}

// ---------- FUSIONS (MagicCom) ----------
const { header: mHeader, data: mData } = loadFile('eng_Dictionary_MagicCom.txt');
function mcol(name) { const i = mHeader.indexOf(name); if (i === -1) throw new Error('missing ' + name); return i; }
const MIDX = { id: 0, name: mcol('이름'), type: mcol('유형'), reqA: mcol('특성A레벨'), reqB: mcol('특성B레벨') };
const fusions = [];
for (const row of mData) {
  if (row[MIDX.type] !== '조합') continue;
  const name = row[MIDX.name];
  if (!name || name === '`') continue;
  const ultNameCol = mHeader.indexOf('궁극기 이름');
  const ultDescCol = mHeader.indexOf('궁극기 설명줄01');
  const descLines = getDescLines(mHeader, row, '효과 설명줄');
  fusions.push({
    id: parseInt(row[MIDX.id], 10),
    name,
    requiresEvolutionIds: [parseInt(row[MIDX.reqA], 10), parseInt(row[MIDX.reqB], 10)].filter(n => n > 0),
    description: descLines,
    effects: labelEffects(getEffectsGeneric(mHeader, row, 9), descLines),
    ultimateName: row[ultNameCol] || null,
    ultimateDescription: ultDescCol !== -1 ? stripColor(row[ultDescCol]) : null,
  });
}

// ---------- SYNERGIES ----------
const { header: sHeader, data: sData } = loadFile('eng_Dictionary_Synergy.txt');
function scol(name) { const i = sHeader.indexOf(name); if (i === -1) throw new Error('missing ' + name); return i; }
const SIDX = { id: 0, name: scol('이름'), count: scol('개수') };
const synergies = [];
for (const row of sData) {
  const name = row[SIDX.name];
  if (!name || name === '`') continue;
  const reqIds = [];
  for (let k = 1; k <= 5; k++) {
    const c = sHeader.indexOf(`ID_0${k}`);
    const v = parseInt(row[c], 10);
    if (v > 0) reqIds.push(v);
  }
  const descLines = getDescLines(sHeader, row, '효과 설명줄');
  synergies.push({
    id: parseInt(row[SIDX.id], 10),
    name,
    requiresArtifactIds: reqIds,
    description: descLines,
    effects: labelEffects(getEffectsGeneric(sHeader, row, 3), descLines),
  });
}

const ultimates = JSON.parse(fs.readFileSync(OUT + '/ultimates.json', 'utf8'));
const gamedata = { spells, artifacts: otherItems.artifact, specialPassives: otherItems.specialPassive, research: otherItems.research, passives: otherItems.passive, enchants: otherItems.enchant, classes, fusions, synergies, ultimates };
fs.writeFileSync(OUT + '/gamedata.json', JSON.stringify(gamedata, null, 2));
console.log('spells:', Object.keys(spells).length);
console.log('artifacts:', otherItems.artifact.length);
console.log('specialPassives:', otherItems.specialPassive.length);
console.log('research:', otherItems.research.length);
console.log('passives:', otherItems.passive.length);
console.log('classes.school:', classes.school.length, 'classes.testSubject:', classes.testSubject.length);
console.log('fusions:', fusions.length);
console.log('synergies:', synergies.length);
