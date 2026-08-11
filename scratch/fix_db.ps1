$path = "h:\_soft\zisaku\Notidian\src\database.js"
$content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

$target = @"
          const applyBtn = document.createElement('button');    // 重複する初期化コードを除去しました。
              saveNotesToStorage();
              popover.remove();
            }
          });
          item.appendChild(delBtn);

          popover.appendChild(item);
        });
      }
"@

$replacement = @"
          const applyBtn = document.createElement('button');
          applyBtn.className = 'btn-bulk-action';
          applyBtn.textContent = '適用';
          applyBtn.addEventListener('click', () => {
            const val = parseFloat(input.value);
            if (!isNaN(val)) {
              applyBulkPropertyChange(block, colId, val);
            }
          });

          valueInputContainer.appendChild(input);
          valueInputContainer.appendChild(applyBtn);
        }
        else {
          // text
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'bulk-action-date-input';
          input.placeholder = 'テキストを入力';
          input.style.width = '120px';

          const applyBtn = document.createElement('button');
          applyBtn.className = 'btn-bulk-action';
          applyBtn.textContent = '適用';
          applyBtn.addEventListener('click', () => {
            const val = input.value.trim();
            applyBulkPropertyChange(block, colId, val);
          });

          valueInputContainer.appendChild(input);
          valueInputContainer.appendChild(applyBtn);
        }
"@

# Normalize line endings to support replace on Windows
$targetNormalized = $target -replace "`r`n", "`n" -replace "`r", "`n"
$contentNormalized = $content -replace "`r`n", "`n" -replace "`r", "`n"
$replacementNormalized = $replacement -replace "`r`n", "`n" -replace "`r", "`n"

if ($contentNormalized.Contains($targetNormalized)) {
    $contentNormalized = $contentNormalized.Replace($targetNormalized, $replacementNormalized)
    # Save back as UTF-8 without BOM
    [System.IO.File]::WriteAllText($path, $contentNormalized, [System.Text.Encoding]::UTF8)
    Write-Output "Successfully fixed database.js"
} else {
    Write-Error "Target string not found in database.js"
}
