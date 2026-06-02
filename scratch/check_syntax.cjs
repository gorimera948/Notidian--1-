const fs = require('fs');
const path = require('path');
const { Script } = require('vm');

const filePath = path.join(__dirname, '../src/database.js');
const code = fs.readFileSync(filePath, 'utf8');

try {
  // `vm.Script` はコードをパースしてコンパイルするため、構文エラーがあれば例外を投げ、何行目かが分かります
  new Script(code, { filename: 'database.js' });
  console.log("Syntax is perfectly OK!");
} catch (e) {
  console.error("Syntax Error Detected!");
  console.error(e.message);
  if (e.stack) {
    console.error(e.stack);
  }
}
