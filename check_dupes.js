const g = require('./magicsurvival/decoded/gamedata.json');
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
for (const cls of [...g.classes.school, ...g.classes.testSubject]) {
  const textCounts = new Map();
  for (const e of cls.effects) {
    if (!e.text) continue;
    textCounts.set(e.text, (textCounts.get(e.text) || 0) + 1);
  }
  const descJoined = cls.description.join(' @ ');
  for (const [text, count] of textCounts) {
    if (count < 2) continue;
    const re = new RegExp(escapeRe(text), 'g');
    const descCount = (descJoined.match(re) || []).length;
    console.log(cls.name, '::', JSON.stringify(text), 'effectsCount=', count, 'descCount=', descCount, count !== descCount ? '<-- MISMATCH' : '');
  }
}
