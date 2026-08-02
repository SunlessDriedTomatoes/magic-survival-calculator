const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const strs = data.ScriptString;
const indices = process.argv.slice(3).map(Number);
for (const i of indices) {
  const s = strs[i - 1];
  console.log(i + '\t' + (s ? JSON.stringify(s.Value) : '(missing)'));
}
