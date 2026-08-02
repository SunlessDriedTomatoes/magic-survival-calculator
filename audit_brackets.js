const g = require('./magicsurvival/decoded/gamedata.json');
const texts = [];
function collect(obj) {
  if (!obj) return;
  if (Array.isArray(obj.description)) texts.push(...obj.description);
  if (Array.isArray(obj.effects)) for (const e of obj.effects) if (e.text) texts.push(e.text);
  if (Array.isArray(obj.genericUpgrades)) for (const u of obj.genericUpgrades) if (u.text) texts.push(u.text);
  if (Array.isArray(obj.evolutions)) for (const e of obj.evolutions) collect(e);
}
for (const k of Object.keys(g.spells)) collect(g.spells[k]);
for (const a of g.artifacts) collect(a);
for (const p of g.passives) collect(p);
for (const s of g.specialPassives) collect(s);
for (const r of g.research) collect(r);
for (const syn of g.synergies) collect(syn);
for (const f of g.fusions) collect(f);
for (const c of g.classes.school) collect(c);
for (const c of g.classes.testSubject) collect(c);
const all = texts.join('');
console.log('total text strings scanned:', texts.length);
const chars = {
  hashId: /##\d+##/g,
  openTortoise: '〔', // 〔
  closeCorner: '』', // 』
  openCorner: '『', // 『 (double corner, different from single corner used for names)
  openCorner2: '「', // 『 single corner bracket start
  closeCorner2: '」',
  angleOpen: '〈', // 〈
  angleClose: '〉',
  dAngleOpen: '《', // 《
  dAngleClose: '》',
  lenticOpen: '【', // 【
  lenticClose: '】',
  curlyOpen: '{',
  curlyClose: '}',
};
for (const [name, pat] of Object.entries(chars)) {
  const re = typeof pat === 'string' ? new RegExp(pat.replace(/[{}]/g, '\\$&'), 'g') : pat;
  console.log(name, ':', (all.match(re) || []).length);
}
