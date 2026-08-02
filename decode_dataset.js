const fs = require('fs');
const path = require('path');
const { parseCSV } = require('./parse_csv.js');

const BASE = 'C:/Users/Kyle/AppData/Local/Temp/claude/C--Users-Kyle/6a4c237c-8aa3-4c62-b075-1614b0354937/scratchpad/magicsurvival/export/textassets';

function loadCsv(name) {
  const text = fs.readFileSync(path.join(BASE, name), 'utf8');
  const rows = parseCSV(text);
  const header = rows[0];
  const data = rows.slice(2); // row0=header, row1=default/blank template row
  return { header, data };
}

function stripColor(s) {
  if (!s) return '';
  return s.replace(/<color=[^>]*>/g, '').replace(/<\/color>/g, '').trim();
}

// Ability/Class/MagicCom/Synergy files share a similar layout for the columns we need.
// We locate columns by header name (Korean) rather than hardcoded index, for robustness.
function colIndex(header, name) {
  const i = header.indexOf(name);
  if (i === -1) throw new Error('column not found: ' + name);
  return i;
}

function extractEffectPairs(header, row, maxPairs) {
  const pairs = [];
  for (let k = 1; k <= maxPairs; k++) {
    const idCol = colIndex(header, `효과ID_0${k}`);
    const valCol = header.indexOf(`효과ID_0${k}값`);
    const id = parseInt(row[idCol], 10);
    const val = parseFloat(row[valCol]);
    if (!isNaN(id) && id !== 1 && id !== 0) {
      pairs.push({ id, value: isNaN(val) ? 0 : val });
    }
  }
  return pairs;
}

function extractDescFragments(header, row) {
  // Effect description lines: "효과 설명줄01".."효과 설명줄06" (or up to whatever exists)
  const fragments = [];
  for (let k = 1; k <= 6; k++) {
    const col = header.indexOf(`효과 설명줄0${k}`);
    if (col === -1) continue;
    const raw = stripColor(row[col]);
    if (!raw || raw === '`') continue;
    // Split tiers by ^, then each tier by @ for simultaneous effects
    const tiers = raw.split('^');
    for (const tier of tiers) {
      const cleanTier = tier.replace(/《/g, '').replace(/》/g, '').trim();
      if (!cleanTier || cleanTier === '`') continue;
      const parts = cleanTier.split('@').map(s => s.trim()).filter(Boolean);
      for (const p of parts) fragments.push(p);
    }
  }
  return fragments;
}

// Try to match a fragment's embedded number(s) to an effect value.
// Returns a template string with the matched number replaced by {V}, or null.
function matchFragmentToValue(fragment, value) {
  const absV = Math.abs(value);
  // Candidate textual forms the value might appear as
  const candidates = new Set([
    String(absV),
    absV.toFixed(0),
    absV.toFixed(1),
    absV.toFixed(2),
  ]);
  for (const cand of candidates) {
    if (cand === '' ) continue;
    // Match as standalone number possibly followed by % or X, with word boundary
    const re = new RegExp('(?<![0-9.])' + cand.replace('.', '\\.') + '(?![0-9])', 'g');
    if (re.test(fragment)) {
      const template = fragment.replace(re, '{V}');
      return template;
    }
  }
  return null;
}

function decodeFile(name, maxPairs, effectIdMap) {
  const { header, data } = loadCsv(name);
  const idCol = 0;
  const nameCol = colIndex(header, '이름');
  const typeCol = header.indexOf('유형');

  const entries = [];
  for (const row of data) {
    if (!row[idCol] || row[idCol].trim() === '') continue;
    const id = parseInt(row[idCol], 10);
    if (isNaN(id)) continue;
    const nm = row[nameCol];
    if (!nm || nm === '`') continue;

    const pairs = extractEffectPairs(header, row, maxPairs);
    const fragments = extractDescFragments(header, row);

    const usedFragments = new Set();
    const decodedEffects = [];
    for (const { id: effId, value } of pairs) {
      let matched = null;
      for (const frag of fragments) {
        if (usedFragments.has(frag)) continue;
        const t = matchFragmentToValue(frag, value);
        if (t) { matched = { fragment: frag, template: t }; usedFragments.add(frag); break; }
      }
      decodedEffects.push({ effectId: effId, value, matchedText: matched ? matched.fragment : null, template: matched ? matched.template : null });

      if (matched) {
        if (!effectIdMap[effId]) effectIdMap[effId] = {};
        const key = matched.template;
        effectIdMap[effId][key] = (effectIdMap[effId][key] || 0) + 1;
      }
    }

    entries.push({
      sourceFile: name,
      id,
      name: nm,
      type: typeCol !== -1 ? row[typeCol] : null,
      effects: decodedEffects,
      unmatchedFragments: fragments.filter(f => !usedFragments.has(f)),
    });
  }
  return entries;
}

const effectIdMap = {};
const allEntries = [];
allEntries.push(...decodeFile('eng_Dictionary_Ability.txt', 9, effectIdMap));
allEntries.push(...decodeFile('eng_Dictionary_Class.txt', 9, effectIdMap));
allEntries.push(...decodeFile('eng_Dictionary_MagicCom.txt', 9, effectIdMap));
allEntries.push(...decodeFile('eng_Dictionary_Synergy.txt', 3, effectIdMap));

// Build canonical effect ID -> best template
const effectIdCanonical = {};
for (const [id, templates] of Object.entries(effectIdMap)) {
  let best = null, bestCount = -1;
  for (const [tmpl, count] of Object.entries(templates)) {
    if (count > bestCount) { best = tmpl; bestCount = count; }
  }
  effectIdCanonical[id] = { template: best, count: bestCount, allTemplates: templates };
}

const outDir = 'C:/Users/Kyle/AppData/Local/Temp/claude/C--Users-Kyle/6a4c237c-8aa3-4c62-b075-1614b0354937/scratchpad/magicsurvival/decoded';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'effect_id_map.json'), JSON.stringify(effectIdCanonical, null, 2));
fs.writeFileSync(path.join(outDir, 'entries.json'), JSON.stringify(allEntries, null, 2));

// Stats
let totalEffects = 0, matchedEffects = 0;
for (const e of allEntries) {
  for (const eff of e.effects) {
    totalEffects++;
    if (eff.template) matchedEffects++;
  }
}
console.log('Entries:', allEntries.length);
console.log('Unique effect IDs:', Object.keys(effectIdCanonical).length);
console.log('Total effect instances:', totalEffects, 'Matched:', matchedEffects, 'Rate:', (matchedEffects/totalEffects*100).toFixed(1) + '%');
