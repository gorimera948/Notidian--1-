$path = "h:\_soft\zisaku\Notidian\src\database.js"
$lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)

# 4115行目から4124行目（1-indexedなので、0-indexedでは 4114 から 4123）が置換対象
$startIdx = 4114
$endIdx = 4123

Write-Output "Lines to be replaced:"
for ($i = $startIdx; $i -le $endIdx; $i++) {
    Write-Output "$($i+1): $($lines[$i])"
}

$prefix = $lines[0..($startIdx-1)]
$suffix = $lines[($endIdx+1)..($lines.Length-1)]

$replacement = @(
"          const applyBtn = document.createElement('button');",
"          applyBtn.className = 'btn-bulk-action';",
"          applyBtn.textContent = '適用';",
"          applyBtn.addEventListener('click', () => {",
"            const val = parseFloat(input.value);",
"            if (!isNaN(val)) {",
"              applyBulkPropertyChange(block, colId, val);",
"            }",
"          });",
"",
"          valueInputContainer.appendChild(input);",
"          valueInputContainer.appendChild(applyBtn);",
"        }",
"        else {",
"          // text",
"          const input = document.createElement('input');",
"          input.type = 'text';",
"          input.className = 'bulk-action-date-input';",
"          input.placeholder = 'テキストを入力';",
"          input.style.width = '120px';",
"",
"          const applyBtn = document.createElement('button');",
"          applyBtn.className = 'btn-bulk-action';",
"          applyBtn.textContent = '適用';",
"          applyBtn.addEventListener('click', () => {",
"            const val = input.value.trim();",
"            applyBulkPropertyChange(block, colId, val);",
"          });",
"",
"          valueInputContainer.appendChild(input);",
"          valueInputContainer.appendChild(applyBtn);",
"        }"
)

$newLines = $prefix + $replacement + $suffix
[System.IO.File]::WriteAllLines($path, $newLines, [System.Text.Encoding]::UTF8)
Write-Output "Successfully replaced lines 4115-4124 in database.js"
