const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/database.js');
let content = fs.readFileSync(filePath, 'utf8');

// 文字化けしている特定の行を本来の正しい日本語に置き換える
content = content.replace("input.placeholder = '繝・く繧ｹ繝医ｒ蜈･蜉・;", "input.placeholder = 'テキストを入力';");
content = content.replace("applyBtn.textContent = '驕ｩ逕ｨ';", "applyBtn.textContent = '適用';");

fs.writeFileSync(filePath, content, 'utf8');
console.log("Successfully fixed database.js UTF-8 character corruption!");
