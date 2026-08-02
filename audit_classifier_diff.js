// Reconstructs the OLD classifyEffect() verbatim (as it existed before the text-first rewrite)
// and diffs its output against the CURRENT one, across every single effect in the entire dataset —
// not just the 3 patterns spot-checked earlier. This is the rigorous version of that check.
const g = require('./magicsurvival/decoded/gamedata.json');

const ATK_PERCENT_ID = 4, AMP_PERCENT_ID = 16, ALL_MAGIC_DMG_ID = 17;

function classifyEffectOLD(effect, spellName) {
  if (!effect || !effect.text) return { kind: 'other' };
  if (effect.id === ATK_PERCENT_ID) return { kind: 'atk', amount: effect.value };
  if (effect.id === AMP_PERCENT_ID) return { kind: 'amp', amount: effect.value };
  const text = effect.text;
  const pctMatch = text.match(/^(Increase|Decrease) (.+?) Damage by ([\d.]+)%/);
  if (pctMatch) {
    const [, dir, target, amt] = pctMatch;
    const sign = dir === 'Increase' ? 1 : -1;
    if (effect.id === ALL_MAGIC_DMG_ID || target === spellName || target === 'All Magic') {
      return { kind: 'mdmg', amount: sign * parseFloat(amt), target };
    }
    return { kind: 'other_spell_dmg', amount: sign * parseFloat(amt), target };
  }
  const xMatch = text.match(/^(Increase|Decrease) (.+?) Damage by ([\d.]+)X/i);
  if (xMatch) {
    const [, dir, target, amt] = xMatch;
    if (target === spellName) return { kind: 'xmult', amount: parseFloat(amt), dir, target };
    return { kind: 'other_spell_dmg_x', amount: parseFloat(amt), target };
  }
  const cdMatch = text.match(/^(Increase|Decrease) (.+?) Cooldown by ([\d.]+)%/);
  if (cdMatch) {
    const [, dir, target, amt] = cdMatch;
    if (target === spellName || target === 'All Magic') {
      const sign = dir === 'Decrease' ? -1 : 1;
      return { kind: 'cooldown', amount: sign * parseFloat(amt), target };
    }
    return { kind: 'other' };
  }
  const numMatch = text.match(/^Increase the number of (.+?) by ([\d.]+)(X)?/i);
  if (numMatch) {
    const [, target, amt, isX] = numMatch;
    if (spellName && target.toLowerCase().includes(spellName.toLowerCase())) {
      return isX ? { kind: 'countx', amount: parseFloat(amt) } : { kind: 'count', amount: parseFloat(amt) };
    }
  }
  return { kind: 'other', label: text };
}

function classifyEffectNEW(effect, spellName) {
  if (!effect || !effect.text) return { kind: 'other' };
  const text = effect.text;
  if (/^Amplify ATK by [\d.]+%/.test(text)) return { kind: 'amp', amount: effect.value };
  if (/^(Increase|Decrease) All Magic Damage by [\d.]+%/.test(text)) {
    return { kind: 'mdmg', amount: /^Decrease/.test(text) ? -Math.abs(effect.value) : Math.abs(effect.value) };
  }
  if (/^Increase ATK by [\d.]+%/.test(text)) return { kind: 'atk', amount: effect.value };
  if (effect.id === ATK_PERCENT_ID) return { kind: 'atk', amount: effect.value };
  if (effect.id === AMP_PERCENT_ID) return { kind: 'amp', amount: effect.value };
  const pctMatch = text.match(/^(Increase|Decrease) (.+?) Damage by ([\d.]+)%/);
  if (pctMatch) {
    const [, dir, target, amt] = pctMatch;
    const sign = dir === 'Increase' ? 1 : -1;
    if (effect.id === ALL_MAGIC_DMG_ID || target === spellName || target === 'All Magic') {
      return { kind: 'mdmg', amount: sign * parseFloat(amt), target };
    }
    return { kind: 'other_spell_dmg', amount: sign * parseFloat(amt), target };
  }
  const xMatch = text.match(/^(Increase|Decrease) (.+?) Damage by ([\d.]+)X/i);
  if (xMatch) {
    const [, dir, target, amt] = xMatch;
    if (target === spellName) return { kind: 'xmult', amount: parseFloat(amt), dir, target };
    return { kind: 'other_spell_dmg_x', amount: parseFloat(amt), target };
  }
  const cdMatch = text.match(/^(Increase|Decrease) (.+?) Cooldown by ([\d.]+)%/);
  if (cdMatch) {
    const [, dir, target, amt] = cdMatch;
    if (target === spellName || target === 'All Magic') {
      const sign = dir === 'Decrease' ? -1 : 1;
      return { kind: 'cooldown', amount: sign * parseFloat(amt), target };
    }
    return { kind: 'other' };
  }
  const numMatch = text.match(/^Increase the number of (.+?) by ([\d.]+)(X)?/i);
  if (numMatch) {
    const [, target, amt, isX] = numMatch;
    if (spellName && target.toLowerCase().includes(spellName.toLowerCase())) {
      return isX ? { kind: 'countx', amount: parseFloat(amt) } : { kind: 'count', amount: parseFloat(amt) };
    }
  }
  return { kind: 'other', label: text };
}

const diffs = [];
function check(itemName, category, effect) {
  const o = classifyEffectOLD(effect, null);
  const n = classifyEffectNEW(effect, null);
  if (o.kind !== n.kind || (o.amount || 0) !== (n.amount || 0)) {
    diffs.push({ item: itemName, category, id: effect.id, text: effect.text, oldKind: o.kind, oldAmt: o.amount, newKind: n.kind, newAmt: n.amount });
  }
}
function scanPool(pool, category) {
  for (const item of pool) if (item.effects) for (const e of item.effects) check(item.name, category, e);
}
scanPool(g.artifacts, 'Artifact');
scanPool(g.passives, 'Passive');
scanPool(g.specialPassives, 'SpecialPassive');
scanPool(g.research, 'Research');
scanPool(g.synergies, 'Synergy');
scanPool(g.fusions, 'Fusion');
scanPool(g.classes.school, 'Class');
scanPool(g.classes.testSubject, 'TestSubject');
for (const k of Object.keys(g.spells)) {
  const s = g.spells[k];
  if (s.genericUpgrades) for (const u of s.genericUpgrades) check(s.name, 'SpellUpgrade', u);
  for (const evo of s.evolutions) if (evo.effects) for (const e of evo.effects) check(s.name + ' / ' + evo.name, 'Evolution', e);
}

console.log('Total effects scanned across every category. Diffs found:', diffs.length);
console.log(JSON.stringify(diffs, null, 1));
