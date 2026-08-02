const fs = require('fs');
const { parseCSV } = require('./parse_csv.js');
const BASE = __dirname + '/magicsurvival/export/textassets';

function stripColor(s) { return (s || '').replace(/<color=[^>]*>/g, '').replace(/<\/color>/g, '').trim(); }

function loadFile(name) {
  const text = fs.readFileSync(BASE + '/' + name, 'utf8');
  const rows = parseCSV(text);
  return { header: rows[0], data: rows.slice(2) };
}

const { header, data } = loadFile('eng_Dictionary_Ability.txt');
function col(name) { const i = header.indexOf(name); if (i === -1) throw new Error('missing col ' + name); return i; }
const IDX = {
  id: 0, name: col('이름'), type: col('유형'), reqLevel: col('요구레벨'),
  traitId: col('특성ID'), traitA: col('특성A레벨'), traitB: col('특성B레벨'), traitC: col('특성C레벨'),
  maxLevel: col('최대레벨'), derivedId: col('파생기술ID'),
};

function getEffects(row) {
  const effects = [];
  for (let k = 1; k <= 9; k++) {
    const idc = col(`효과ID_0${k}`);
    const valc = header.indexOf(`효과ID_0${k}값`);
    const id = parseInt(row[idc], 10);
    const val = parseFloat(row[valc]);
    if (!isNaN(id) && id !== 1 && id !== 0) {
      effects.push({ id, value: isNaN(val) ? 0 : val });
    }
  }
  return effects;
}

function getDescLines(row) {
  const lines = [];
  for (let k = 1; k <= 6; k++) {
    const c = header.indexOf(`효과 설명줄0${k}`);
    if (c === -1) continue;
    const v = stripColor(row[c]);
    if (v && v !== '`') lines.push(v);
  }
  return lines;
}

// Load the effect id -> template decoder built earlier, to label each effect
const idMap = JSON.parse(fs.readFileSync(__dirname + '/magicsurvival/decoded/effect_id_map.json', 'utf8'));
function labelEffect(eff) {
  const m = idMap[eff.id];
  if (!m || !m.template) return { ...eff, text: null };
  const text = m.template.replace('{V}', eff.value);
  return { ...eff, text };
}

// Magic-type spells (the 21 base spells)
const spells = {};
for (const row of data) {
  if (row[IDX.type] === '마법') {
    const id = parseInt(row[IDX.id], 10);
    spells[id] = {
      id,
      name: row[IDX.name],
      description: getDescLines(row)[0] || null,
      maxLevel: parseInt(row[IDX.maxLevel], 10) || 0,
      traitUnlockLevels: [row[IDX.traitA], row[IDX.traitB], row[IDX.traitC]].map(s => parseInt(s, 10)).filter(n => n > 0),
      genericUpgrades: [], // distinct repeatable effect options
      evolutions: [], // named branch upgrades
    };
    // distinct effect ids across the row = the generic repeatable upgrade options
    const seen = new Map();
    for (const eff of getEffects(row)) {
      if (eff.id === -1 || eff.id < 0) continue; // skip the "counts as a pick" marker
      if (!seen.has(eff.id)) seen.set(eff.id, eff.value);
    }
    for (const [id, value] of seen.entries()) {
      spells[id === undefined ? -1 : id]; // no-op, just clarity
    }
    for (const [id, value] of seen.entries()) {
      spells[row[IDX.id]] // no-op
    }
    for (const [effId, value] of seen) {
      spells[parseInt(row[IDX.id], 10)].genericUpgrades.push(labelEffect({ id: effId, value }));
    }
  }
}

// Trait-type rows = evolution branches, linked via derivedId -> parent spell id
for (const row of data) {
  if (row[IDX.type] === '특성') {
    const derivedId = parseInt(row[IDX.derivedId], 10);
    if (!spells[derivedId]) continue; // orphan / not a spell branch
    const name = row[IDX.name];
    if (!name || name === '`') continue;
    const traitId = parseInt(row[IDX.traitId], 10) || 0;
    const effects = getEffects(row).filter(e => e.id !== -1).map(labelEffect);
    spells[derivedId].evolutions.push({
      id: parseInt(row[IDX.id], 10),
      name,
      tier: traitId,
      description: getDescLines(row),
      effects,
    });
  }
}

const outDir = __dirname + '/magicsurvival/decoded';
fs.writeFileSync(outDir + '/spells_full.json', JSON.stringify(spells, null, 2));
console.log('Spells extracted:', Object.keys(spells).length);
for (const id of Object.keys(spells)) {
  const s = spells[id];
  console.log(id, s.name, '| generic:', s.genericUpgrades.length, '| evolutions:', s.evolutions.length, '| maxLevel:', s.maxLevel);
}
