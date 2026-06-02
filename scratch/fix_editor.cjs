const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/editor.js');
const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

// 1683行目から1968行目を削除（1-indexedなので、0-indexedでは 1682 から 1967）
const startIdx = 1682;
const endIdx = 1967;

console.log("Lines to remove start:", lines[startIdx]);
console.log("Lines to remove end:", lines[endIdx]);

const prefix = lines.slice(0, startIdx);
const suffix = lines.slice(endIdx + 1);

const newLines = prefix.concat(suffix);
fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');

console.log("Successfully removed duplicated WikiLinks engine from editor.js!");
