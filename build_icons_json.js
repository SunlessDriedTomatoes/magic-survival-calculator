// Base64-encodes each unique resized icon once (ICON_DATA), and writes the semantic-key ->
// filename lookup (ICON_MAP) separately, so 519 gamedata keys don't duplicate the ~432 unique
// image payloads (evolutions/test subjects reuse their parent spell's icon, etc).
const fs = require('fs');
const manifest = require('./icon_manifest.json'); // key -> filename
const dir = __dirname + '/magicsurvival/export/icons_resized';

const uniqueFiles = [...new Set(Object.values(manifest))];
const iconData = {};
for (const f of uniqueFiles) {
  const buf = fs.readFileSync(dir + '/' + f);
  iconData[f] = 'data:image/png;base64,' + buf.toString('base64');
}

fs.writeFileSync(__dirname + '/icon_data.json', JSON.stringify(iconData));
fs.writeFileSync(__dirname + '/icon_map.json', JSON.stringify(manifest));

const dataSize = fs.statSync(__dirname + '/icon_data.json').size;
console.log('icon_data.json:', (dataSize / 1024 / 1024).toFixed(2) + 'MB', 'icon_map.json entries:', Object.keys(manifest).length);
