// Determines which sprite file each gamedata item should use, based on the confirmed
// shared "Ability<id>Portrait" namespace (spells/passives/artifacts/research/specialPassives)
// plus separate Synergy<id>/MagicCom<id>/Ultimate<id>/Class<id> namespaces.
// Evolutions and test subjects have no unique art in the APK; they fall back to their
// parent spell's icon.
const fs = require('fs');
const g = require('./magicsurvival/decoded/gamedata.json');

const SPRITE_DIR = __dirname + '/magicsurvival/export/sprites';
function exists(name) { return fs.existsSync(SPRITE_DIR + '/' + name); }

const manifest = {}; // key -> sprite filename
const missing = [];

function want(key, filename) {
  if (exists(filename)) manifest[key] = filename;
  else missing.push(key + ' -> ' + filename);
}

for (const id of Object.keys(g.spells)) {
  const s = g.spells[id];
  want('spell:' + s.id, `Ability${s.id}Portrait.png`);
  for (const e of (s.evolutions || [])) want('evolution:' + e.id, `Ability${s.id}Portrait.png`);
}
for (const p of g.passives) want('passive:' + p.id, `Ability${p.id}Portrait.png`);
for (const a of g.artifacts) want('artifact:' + a.id, `Ability${a.id}Portrait.png`);
for (const r of g.research) want('research:' + r.id, `Ability${r.id}Portrait.png`);
for (const sp of g.specialPassives) want('specialPassive:' + sp.id, `Ability${sp.id}Portrait.png`);
for (const syn of g.synergies) want('synergy:' + syn.id, `Synergy${syn.id}Portrait.png`);
for (const f of g.fusions) {
  want('fusion:' + f.id, `MagicCom${f.id}Portrait.png`);
  if (exists(`Ultimate${f.id}Portrait.png`)) manifest['ultimate:' + f.id] = `Ultimate${f.id}Portrait.png`;
}
for (const c of g.classes.school) want('class:' + c.id, `Class${c.id}Portrait.png`);
for (const t of g.classes.testSubject) {
  if (t.linkedSpellId) want('testSubject:' + t.id, `Ability${t.linkedSpellId}Portrait.png`);
}

console.log('Mapped:', Object.keys(manifest).length, 'Missing:', missing.length);
if (missing.length) console.log(missing.slice(0, 20).join('\n'));

fs.writeFileSync(__dirname + '/icon_manifest.json', JSON.stringify(manifest, null, 1));
