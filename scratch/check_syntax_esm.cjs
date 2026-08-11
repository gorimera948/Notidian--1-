const fs = require('fs');
const path = require('path');
const { Script } = require('vm');

const filePath = path.join(__dirname, '../src/database.js');
let code = fs.readFileSync(filePath, 'utf8');

// `import` 文と `export` 記述をダミー置換してスクリプトとしてパース可能にします
code = code.replace(/import\s+[\s\S]*?from\s+['"].*?['"];/g, '');
code = code.replace(/export\s+function/g, 'function');
code = code.replace(/export\s+let/g, 'let');
code = code.replace(/export\s+const/g, 'const');

try {
  new Script(code, { filename: 'database.js' });
  console.log("Syntax is perfectly OK!");
} catch (e) {
  console.error("Syntax Error Detected!");
  console.error(e.message);
  if (e.stack) {
    console.error(e.stack);
  }
}
