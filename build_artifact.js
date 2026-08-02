const fs = require('fs');
const dir = __dirname;
const gamedata = fs.readFileSync(dir + '/magicsurvival/decoded/gamedata.json', 'utf8');
const iconData = fs.readFileSync(dir + '/icon_data.json', 'utf8');
const iconMap = fs.readFileSync(dir + '/icon_map.json', 'utf8');
const appJs = fs.readFileSync(dir + '/app.js', 'utf8');
let html = fs.readFileSync(dir + '/calc_template.html', 'utf8');
html = html.replace('__GAMEDATA_JSON__', gamedata.trim());
html = html.replace('__ICON_DATA_JSON__', iconData.trim());
html = html.replace('__ICON_MAP_JSON__', iconMap.trim());
html = html.replace('__APP_JS__', appJs);
fs.writeFileSync(dir + '/magic_survival_calculator.html', html);
// index.html is the same build output, just under the name GitHub Pages serves automatically at
// the repo's root URL — keeping both names avoids renaming the file everyone's been using all along.
fs.writeFileSync(dir + '/index.html', html);
console.log('Built. Size:', (fs.statSync(dir + '/magic_survival_calculator.html').size / 1024 / 1024).toFixed(2) + 'MB');
