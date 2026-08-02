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
const NUMBER_TOKEN_RE = /(?<![0-9.])\d+(?:\.\d+)?(?![0-9.])/g;
const CLEAN_STAT_RE = /^(Increase|Decrease) .+ by /;
function findInFragments(fragments, usedFragments, scale, absV) {
  const scaled = Math.round(absV * scale * 100) / 100;
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
function parseTierEntries(line) {
  if (!line) return [];
  return line.split('^').map(entry => entry.replace(/《/g, '').replace(/》/g, '').trim()).map(s => (s === '`' ? '' : s));
}

const { header: aHeader, data: aData } = loadFile('eng_Dictionary_Ability.txt');
function acol(name) { const i = aHeader.indexOf(name); if (i === -1) throw new Error('missing ' + name); return i; }
const AIDX = {
  id: 0, name: acol('이름'), type: acol('유형'), reqLevel: acol('요구레벨'),
  traitId: acol('특성ID'), traitA: acol('특성A레벨'), traitB: acol('특성B레벨'), traitC: acol('특성C레벨'),
  maxLevel: acol('최대레벨'), derivedId: acol('파생기술ID'),
};

const allSpellRows = aData.filter(r => r[AIDX.type] === '마법');
for (const row of allSpellRows) {
  const testName = row[AIDX.name];
  const descLines = getDescLines(aHeader, row, '효과 설명줄');
  const maxLevel = parseInt(row[AIDX.maxLevel], 10) || 0;
  const traitUnlockLevels = [row[AIDX.traitA], row[AIDX.traitB], row[AIDX.traitC]].map(s => parseInt(s, 10)).filter(n => n > 0);
  const rawSlots = getRawEffectSlots(aHeader, row, 7);
  const pool = rawSlots.filter(s => s && s.id != null && s.id > 0); // excludes acquire markers (negative) and empty (id 1/0)
  const tierListLine = descLines.length ? descLines[descLines.length - 1] : null;
  const labeledPoolRaw = labelEffects(pool, [tierListLine]);
  // Raw slots can encode the same (id, value) stat more than once across the row's own 9 slots
  // (redundant, not a second distinct stat) — dedupe by resolved text before per-level matching.
  const seenText = new Set();
  const labeledPool = labeledPoolRaw.filter(p => {
    if (!p.text || seenText.has(p.text)) return false;
    seenText.add(p.text);
    return true;
  });
  const tierEntries = parseTierEntries(tierListLine);

  const result = [{ level: 1, kind: 'acquire' }];
  for (let level = 2; level <= maxLevel; level++) {
    if (traitUnlockLevels.includes(level)) { result.push({ level, kind: 'evolution' }); continue; }
    const idx = level - 2;
    const segment = tierEntries[idx] || '';
    const matches = labeledPool.filter(p => p.text && segment.includes(p.text));
    if (!matches.length) result.push({ level, kind: 'empty' });
    else for (const m of matches) result.push({ level, kind: 'stat', id: m.id, value: m.value, text: m.text });
  }
  // Validation: every non-empty, non-evolution segment's @-split fragment count should match the
  // number of 'stat' entries found for that level (catches silent mismatches).
  let ok = true;
  for (let level = 2; level <= maxLevel; level++) {
    if (traitUnlockLevels.includes(level)) continue;
    const idx = level - 2;
    const segment = tierEntries[idx] || '';
    const fragCount = segment ? segment.split('@').map(s => s.trim()).filter(Boolean).length : 0;
    const statCount = result.filter(r => r.level === level && r.kind === 'stat').length;
    if (fragCount !== statCount) { ok = false; console.log('  MISMATCH at Lv' + level + ': segment has ' + fragCount + ' fragments but matched ' + statCount + ' pool entries. segment="' + segment + '"'); }
  }
  console.log(testName + ':', ok ? 'OK' : 'MISMATCH FOUND', '| maxLevel=' + maxLevel);
}
