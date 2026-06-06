import { state, getActiveNote, saveNotesToStorage, getActiveNormalNotes, pushHistory, historyState } from './state.js';
import { generateId, escapeHTML, showToast, formatMS, getFormattedTime, getFormattedTimeFromMs } from './utils.js';
import { parseWikiLinks, serializeHtmlToWikiText, handleWikiLinkTrigger, closeLinkMenu, selectLinkMenuItem, navigateLinkMenu } from './wikilinks.js';

let isDraggingViewTab = false;

function renderEditor() {
  if (window.Notidian && typeof window.Notidian.renderEditor === 'function') {
    window.Notidian.renderEditor();
  }
}

function renderNoteList() {
  if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
    window.Notidian.renderNoteList();
  }
}

export function getStatusClass(val) {
  // val が ID（opt-xxx）か値そのものかどちらでも動くようにフォールバック
  if (val === '進行中' || val === 'opt-progress') return 'progress';
  if (val === '完了' || val === 'opt-complete') return 'complete';
  return 'todo';
}

function getTagHashColor(val) {
  if (!val || val === '選択なし') return 'gray';
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'pink', 'gray'];
  let hash = 0;
  for (let i = 0; i < val.length; i++) {
    hash = val.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getTagColor(col, val) {
  if (!val || val === '選択なし') return 'gray';
  if (col && col.options) {
    const opt = col.options.find(o => o.id === val || o.name === val);
    if (opt && opt.color) return opt.color;
  }
  return getTagHashColor(val);
}

function getStatusOptionName(col, val) {
  const options = col.options || [];
  const found = options.find(opt => opt.id === val || opt.name === val);
  return found ? found.name : val;
}

function getStatusOptionColor(col, val) {
  const options = col.options || [];
  const found = options.find(opt => opt.id === val || opt.name === val);
  return found ? found.color : 'gray';
}

function addNewDbRow(block, initialData = {}) {
  block.properties = block.properties || { columns: [], rows: [] };
  block.properties.rows = block.properties.rows || [];

  const newRow = {};
  block.properties.columns.forEach(col => {
    if (initialData[col.id] !== undefined) {
      newRow[col.id] = initialData[col.id];
    } else {
      if (col.type === 'status') {
        const defaultOpt = col.options && col.options.length > 0 ? col.options[0].name : '未着手';
        newRow[col.id] = defaultOpt;
      }
      else if (col.type === 'checkbox') newRow[col.id] = false;
      else newRow[col.id] = '';
    }
  });

  block.properties.rows.push(newRow);
  saveNotesToStorage();
  renderEditor();
}

function deleteDbRow(block, rowIndex, e) {
  showDeleteConfirmPopover(e, 'この行を削除しますか？', () => {
    block.properties.rows.splice(rowIndex, 1);
    saveNotesToStorage();
    renderEditor();
  });
}

function renderFooterCellContent(td, block, col, visibleRows = null) {
  const rows = visibleRows || block.properties.rows || [];
  const colId = col.id;
  const type = col.type;

  let calcType = col.calc;
  if (!calcType) {
    if (type === 'number') calcType = 'sum';
    else if (type === 'status') calcType = 'percent';
    else calcType = 'count';
    col.calc = calcType;
  }

  td.innerHTML = '';

  if (rows.length === 0) {
    td.textContent = '-';
    return;
  }

  if (calcType === 'count') {
    td.innerHTML = `<span class="db-calc-label">行数:</span>${rows.length}`;
    return;
  }

  if (calcType === 'none') {
    td.textContent = '-';
    return;
  }

  if (type === 'number') {
    const nums = rows.map(r => parseFloat(r[colId])).filter(n => !isNaN(n));
    if (nums.length === 0) {
      td.textContent = '-';
      return;
    }

    if (calcType === 'sum') {
      const sum = nums.reduce((a, b) => a + b, 0);
      td.innerHTML = `<span class="db-calc-label">合計:</span>${sum}`;
    } else if (calcType === 'avg') {
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      td.innerHTML = `<span class="db-calc-label">平均:</span>${avg.toFixed(2)}`;
    } else if (calcType === 'max') {
      const max = Math.max(...nums);
      td.innerHTML = `<span class="db-calc-label">最大:</span>${max}`;
    } else if (calcType === 'min') {
      const min = Math.min(...nums);
      td.innerHTML = `<span class="db-calc-label">最小:</span>${min}`;
    }
  } else if (type === 'status') {
    if (calcType === 'percent') {
      const completeCount = rows.filter(r => {
        const val = r[colId];
        return val === '完了' || val === 'opt-complete' || (col.options && col.options.find(o => o.id === val && o.name === '完了'));
      }).length;
      const ratio = (completeCount / rows.length) * 100;
      td.innerHTML = `<span class="db-calc-label">完了率:</span>${ratio.toFixed(1)}%`;
    }
  } else if (type === 'date') {
    const dates = rows.map(r => r[colId]).filter(d => d);
    if (dates.length === 0) {
      td.textContent = '-';
      return;
    }

    dates.sort();
    if (calcType === 'latest') {
      td.innerHTML = `<span class="db-calc-label">最新:</span>${dates[dates.length - 1].replace(/-/g, '/')}`;
    } else if (calcType === 'earliest') {
      td.innerHTML = `<span class="db-calc-label">最古:</span>${dates[0].replace(/-/g, '/')}`;
    }
  } else {
    td.textContent = '-';
  }
}

export function recalculateTableFooter(table, block, visibleRows = null) {
  const columns = block.properties.columns || [];
  columns.forEach(col => {
    const td = table.querySelector(`tfoot td[data-col-id="${col.id}"]`);
    if (td) {
      renderFooterCellContent(td, block, col, visibleRows);
    }
  });
}

// ----------------------------------------------------
// COLUMN DRAG RESIZE ENGINE
// ----------------------------------------------------
function setupDbColumnResizer(resizerEl, col, th, table, block, visibleRows) {
  resizerEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    resizerEl.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const isLeftCol = (col === 'left-col');

    // ドラッグ中の列のインデックスを取得
    const colIndex = Array.from(th.parentNode.children).indexOf(th);
    const nextTh = th.parentNode.children[colIndex + 1];

    // 右隣の列のモデル（プロパティ）を取得
    const nextCol = isLeftCol ? block.properties.columns[0] : block.properties.columns[colIndex];

    const startWidth = isLeftCol ? (block.properties.leftColWidth || 34) : (col.width || th.getBoundingClientRect().width);
    const startNextWidth = (nextTh && nextCol) ? nextCol.width : null;

    function onMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;

      let newWidth = startWidth + deltaX;
      let newNextWidth = startNextWidth !== null ? startNextWidth - deltaX : null;

      // 最小幅制限 (30px) の適用
      if (newWidth < 30) {
        newWidth = 30;
        if (newNextWidth !== null) {
          newNextWidth = startNextWidth + (startWidth - 30);
        }
      }
      if (newNextWidth !== null && newNextWidth < 30) {
        newNextWidth = 30;
        newWidth = startWidth + (startNextWidth - 30);
      }

      // 1. ドラッグ中の列幅の更新
      if (isLeftCol) {
        block.properties.leftColWidth = newWidth;
      } else {
        col.width = newWidth;
      }

      th.style.width = `${newWidth}px`;
      th.style.minWidth = `${newWidth}px`;
      th.style.maxWidth = `${newWidth}px`;

      const rows = table.querySelectorAll('tr');
      rows.forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell) {
          cell.style.width = `${newWidth}px`;
          cell.style.minWidth = `${newWidth}px`;
          cell.style.maxWidth = `${newWidth}px`;
        }
      });

      // 2. 右隣 of 列幅の更新（隣の列のみ融通し合う）
      if (nextTh && newNextWidth !== null) {
        if (nextCol) {
          nextCol.width = newNextWidth;
        }

        nextTh.style.width = `${newNextWidth}px`;
        nextTh.style.minWidth = `${newNextWidth}px`;
        nextTh.style.maxWidth = `${newNextWidth}px`;

        rows.forEach(tr => {
          const cell = tr.children[colIndex + 1];
          if (cell) {
            cell.style.width = `${newNextWidth}px`;
            cell.style.minWidth = `${newNextWidth}px`;
            cell.style.maxWidth = `${newNextWidth}px`;
          }
        });
      }

      // 3. テーブル全体の合計幅を再計算してリアルタイム同期（吸い付きリサイズと余白バグ解消）
      const leftColW = block.properties.leftColWidth || 34;
      let totalW = leftColW;
      block.properties.columns.forEach(c => {
        totalW += c.width || (c.type === 'text' && c.id === 'col-title' ? 220 : 130);
      });
      totalW += 40; // 新規列追加列
      table.style.width = `${totalW}px`;
      table.style.minWidth = `${totalW}px`;
    }

    function onMouseUp() {
      resizerEl.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      saveNotesToStorage();
      renderEditor();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// ----------------------------------------------------
// COLUMN DRAG REORDER ENGINE
// ----------------------------------------------------
let draggedColId = null;

function setupDbColumnDragDrop(th, colId, block) {
  th.setAttribute('draggable', 'true');

  th.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    draggedColId = colId;
    th.classList.add('db-th-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  th.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedColId === colId) return;

    const rect = th.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;

    if (xRatio < 0.5) {
      th.classList.add('db-th-dragover-left');
      th.classList.remove('db-th-dragover-right');
    } else {
      th.classList.add('db-th-dragover-right');
      th.classList.remove('db-th-dragover-left');
    }
  });

  th.addEventListener('dragleave', () => {
    th.classList.remove('db-th-dragover-left', 'db-th-dragover-right');
  });

  th.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    th.classList.remove('db-th-dragover-left', 'db-th-dragover-right');

    if (!draggedColId || draggedColId === colId) return;

    const columns = block.properties.columns;
    const dragIdx = columns.findIndex(c => c.id === draggedColId);
    const dropIdx = columns.findIndex(c => c.id === colId);

    if (dragIdx === -1 || dropIdx === -1) return;

    const rect = th.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;

    // ドラッグ要素を一旦抜き取る
    const [draggedCol] = columns.splice(dragIdx, 1);

    let targetIdx = columns.findIndex(c => c.id === colId);
    if (xRatio >= 0.5) {
      targetIdx += 1;
    }

    columns.splice(targetIdx, 0, draggedCol);

    saveNotesToStorage();
    renderEditor();
  });

  th.addEventListener('dragend', () => {
    th.classList.remove('db-th-dragging');
    draggedColId = null;

    // 他のthのデコレーションも確実にリセット
    const ths = th.parentNode.querySelectorAll('th');
    ths.forEach(t => t.classList.remove('db-th-dragover-left', 'db-th-dragover-right'));
  });
}

// ----------------------------------------------------
// RENDER FULL DATABASE BLOCK
// ----------------------------------------------------
export function createDatabaseDOM(block) {
  const container = document.createElement('div');
  container.className = 'database-container';

  block.properties = block.properties || { columns: [], rows: [] };

  // 1. ビュー（インデックスタブ）の初期化 ＆ レンダリング
  if (!block.properties.views || block.properties.views.length === 0) {
    block.properties.views = [
      { id: 'view-all', name: 'すべて', filters: [] },
      { id: 'view-progress', name: '進行中', filters: [{ id: 'f-progress', columnId: 'col-status', value: '進行中' }] },
      { id: 'view-complete', name: '完了', filters: [{ id: 'f-complete', columnId: 'col-status', value: '完了' }] }
    ];
    block.properties.activeViewId = 'view-all';
  }

  const views = block.properties.views;

  // 互換性：もし古い filter プロパティがある場合は、自動的に filters 配列へ移行する
  views.forEach(v => {
    if (v.filter && (!v.filters || v.filters.length === 0)) {
      v.filters = [{ id: 'f-' + generateId(), columnId: v.filter.columnId, value: v.filter.value }];
      delete v.filter;
    } else if (!v.filters) {
      v.filters = [];
    }
  });

  const activeViewId = block.properties.activeViewId || views[0].id;
  const activeView = views.find(v => v.id === activeViewId) || views[0];

  // データベースタイトル（テーブル名）の追加
  const dbTitleRow = document.createElement('div');
  dbTitleRow.className = 'db-title-row';

  const dbTitleInput = document.createElement('input');
  dbTitleInput.type = 'text';
  dbTitleInput.className = 'db-title-input';
  dbTitleInput.placeholder = 'データベース名を入力...';
  dbTitleInput.value = block.properties.tableName || 'データベース';

  dbTitleInput.addEventListener('change', () => {
    block.properties.tableName = dbTitleInput.value.trim() || 'データベース';
    saveNotesToStorage();
    // タイマー設定側の挿入先テーブルプルダウンを再更新する
    if (window.Notidian && typeof window.Notidian.updateTimerTargetTableSelect === 'function') {
      window.Notidian.updateTimerTargetTableSelect();
    }
  });
  dbTitleRow.appendChild(dbTitleInput);
  container.appendChild(dbTitleRow);

  const tabBar = document.createElement('div');
  tabBar.className = 'db-views-tab-bar';

  // ドラッグ可能なタブ要素のみを格納する専用のコンテナ
  const tabContainer = document.createElement('div');
  tabContainer.className = 'db-views-tab-container';

  views.forEach(view => {
    const tab = document.createElement('div');
    tab.className = `db-view-tab ${view.id === activeViewId ? 'active' : ''}`;

    const icon = document.createElement('i');
    const hasActiveFilters = view.filters && view.filters.length > 0;
    icon.className = `db-view-tab-icon ${hasActiveFilters ? 'fa-solid fa-filter' : 'fa-solid fa-table'}`;
    tab.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'db-view-tab-name';
    nameSpan.textContent = view.name;

    // ダブルクリックでビュー名編集
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'db-view-tab-input';
      input.style.fontSize = '12px';
      input.style.padding = '2px 4px';
      input.style.background = 'rgba(0,0,0,0.6)';
      input.style.border = '1px solid var(--accent-primary)';
      input.style.color = '#fff';
      input.style.borderRadius = '3px';
      input.value = view.name;

      tab.replaceChild(input, nameSpan);
      input.focus();
      input.select();

      const saveTabName = () => {
        const val = input.value.trim();
        if (val) {
          view.name = val;
          saveNotesToStorage();
          renderEditor();
        } else {
          tab.replaceChild(nameSpan, input);
        }
      };

      input.addEventListener('blur', saveTabName);
      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') saveTabName();
      });
    });

    tab.appendChild(nameSpan);

    // ビュー設定（レイアウト・表示設定）ボタン
    const configBtn = document.createElement('button');
    configBtn.className = 'btn-tab-settings';
    configBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
    configBtn.title = '表示設定を変更';
    configBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showViewConfigPopover(e, block, view);
    });
    tab.appendChild(configBtn);

    // ビュー削除ボタン（ビューが複数ある場合のみ）
    if (views.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-tab-delete';
      delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      delBtn.title = 'ビューを削除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`ビュー「${view.name}」を削除してもよろしいですか？`)) {
          block.properties.views = views.filter(v => v.id !== view.id);
          if (block.properties.activeViewId === view.id) {
            block.properties.activeViewId = block.properties.views[0].id;
          }
          saveNotesToStorage();
          renderEditor();
        }
      });
      tab.appendChild(delBtn);
    }

    tab.addEventListener('click', () => {
      if (isDraggingViewTab) return;
      if (block.properties.activeViewId !== view.id) {
        block.properties.activeViewId = view.id;
        saveNotesToStorage();
        renderEditor();
      }
    });

    tabContainer.appendChild(tab);
  });

  tabBar.appendChild(tabContainer);

  // ビュー追加ボタン
  const addViewBtn = document.createElement('button');
  addViewBtn.className = 'btn-add-view-tab';
  addViewBtn.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:4px;"></i>ビュー追加';
  addViewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showAddViewPopover(e, block);
  });
  tabBar.appendChild(addViewBtn);

  // Sortable.js を適用してビュータブの並び替えを有効にする
  Sortable.create(tabContainer, {
    animation: 150,
    draggable: '.db-view-tab',
    filter: '.db-view-tab-input, button', // 入力フィールドや削除ボタンでのドラッグを防ぐ
    preventOnFilter: false,
    forceFallback: true,
    fallbackClass: 'sortable-fallback-tab',
    ghostClass: 'sortable-ghost-tab',
    onStart: () => {
      isDraggingViewTab = true;
    },
    onEnd: (evt) => {
      setTimeout(() => {
        isDraggingViewTab = false;
      }, 200);

      if (evt.oldIndex === evt.newIndex) return;

      const movedView = block.properties.views.splice(evt.oldIndex, 1)[0];
      block.properties.views.splice(evt.newIndex, 0, movedView);

      saveNotesToStorage();
      renderEditor();
    }
  });

  container.appendChild(tabBar);

  // 2. データベース・ツールバー (フィルター状態 ＆ グループ化ボタン)
  const toolbar = document.createElement('div');
  toolbar.className = 'db-toolbar';

  // フィルターボタン
  const hasActiveFilters = activeView.filters && activeView.filters.length > 0;
  const filterBtn = document.createElement('button');
  filterBtn.className = `btn-db-toolbar ${hasActiveFilters ? 'active' : ''}`;
  filterBtn.innerHTML = `<i class="fa-solid fa-filter"></i> フィルター ${hasActiveFilters ? `(${activeView.filters.length})` : ''}`;
  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showFilterConfigPopover(e, block, activeView);
  });
  toolbar.appendChild(filterBtn);

  // フィルターとグループ分けの間のセレクトタグ用プルダウン（常時表示、幅90px固定のボタンに変更）
  const dbColumns = block.properties.columns || [];
  const selectFilter = activeView.filters ? activeView.filters.find(f => {
    const col = dbColumns.find(c => c.id === f.columnId);
    return col && col.type === 'select';
  }) : null;

  const tagFilterDropdownBtn = document.createElement('button');
  tagFilterDropdownBtn.className = 'btn-db-toolbar db-select-filter-dropdown';

  if (selectFilter) {
    const col = dbColumns.find(c => c.id === selectFilter.columnId);
    if (col) {
      tagFilterDropdownBtn.style.pointerEvents = 'auto';
      tagFilterDropdownBtn.style.opacity = '1';
      tagFilterDropdownBtn.title = `${col.name}フィルターの値を切り替え`;
      
      const currentVal = selectFilter.value || '';
      // 表示用のラベル
      let displayLabel = '';
      if (currentVal) {
        const tagOptions = col.options || [];
        const currentVals = currentVal.split(',').map(v => v.trim()).filter(Boolean);
        const names = currentVals.map(val => {
          const found = tagOptions.find(o => (typeof o === 'string' ? o : (o.id || o.name)) === val);
          return found ? (typeof found === 'string' ? found : found.name) : val;
        });
        displayLabel = names.join(', ');
      } else {
        displayLabel = '選択なし';
      }
      tagFilterDropdownBtn.textContent = displayLabel;

      tagFilterDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        const existing = document.querySelectorAll('.db-floating-popover');
        existing.forEach(p => p.remove());

        const popover = document.createElement('div');
        popover.className = 'db-floating-popover db-select-multi-filter-popover';
        
        const rect = tagFilterDropdownBtn.getBoundingClientRect();
        popover.style.left = `${rect.left}px`;
        popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
        popover.style.width = '180px';
        popover.style.maxHeight = '250px';
        popover.style.overflowY = 'auto';
        popover.style.display = 'flex';
        popover.style.flexDirection = 'column';
        popover.style.gap = '4px';
        popover.style.padding = '6px';

        popover.addEventListener('click', (evt) => {
          evt.stopPropagation();
        });
        popover.addEventListener('mousedown', (evt) => {
          evt.stopPropagation();
        });
        popover.addEventListener('mouseup', (evt) => {
          evt.stopPropagation();
        });

        const tagOptions = col.options || [];
        const currentVals = currentVal.split(',').map(v => v.trim()).filter(Boolean);

        if (tagOptions.length === 0) {
          const emptyItem = document.createElement('div');
          emptyItem.style = 'font-size: 11px; color: var(--text-muted); padding: 6px; text-align: center;';
          emptyItem.textContent = 'タグ未登録';
          popover.appendChild(emptyItem);
        } else {
          tagOptions.forEach(opt => {
            const optId = typeof opt === 'string' ? opt : (opt.id || opt.name);
            const optName = typeof opt === 'string' ? opt : opt.name;
            const color = typeof opt === 'string' ? 'gray' : (opt.color || 'gray');
            const isChecked = currentVals.includes(optId) || currentVals.includes(optName);

            const item = document.createElement('div');
            item.className = 'db-popover-item';
            item.style = 'display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; cursor: pointer;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isChecked;
            checkbox.style = 'margin: 0; cursor: pointer;';

            const badge = document.createElement('span');
            badge.className = `db-select-badge db-tag-${color}`;
            badge.textContent = optName;
            badge.style.cursor = 'pointer';

            item.addEventListener('click', (evt) => {
              evt.stopPropagation();
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event('change'));
            });

            checkbox.addEventListener('click', (evt) => {
              evt.stopPropagation();
            });

            checkbox.addEventListener('change', () => {
              const checkedItems = [];
              popover.querySelectorAll('input[type="checkbox"]').forEach((cb, idx) => {
                if (cb.checked) {
                  const targetOpt = tagOptions[idx];
                  const targetId = typeof targetOpt === 'string' ? targetOpt : (targetOpt.id || targetOpt.name);
                  checkedItems.push(targetId);
                }
              });
              selectFilter.value = checkedItems.join(',');
              saveNotesToStorage();
              // レンダリング遅延（ゴーストクリック対策）
              setTimeout(() => {
                renderEditor();
              }, 0);
            });

            item.appendChild(checkbox);
            item.appendChild(badge);
            popover.appendChild(item);
          });
        }

        document.body.appendChild(popover);
      });
    }
  } else {
    tagFilterDropdownBtn.style.pointerEvents = 'none';
    tagFilterDropdownBtn.style.opacity = '0.5';
    tagFilterDropdownBtn.textContent = '選択なし';
  }

  toolbar.appendChild(tagFilterDropdownBtn);

  // グループ化ボタン
  const isGrouped = block.properties.groupBy === 'col-status';
  const groupBtn = document.createElement('button');
  groupBtn.className = `btn-db-toolbar ${isGrouped ? 'active' : ''}`;
  groupBtn.innerHTML = `<i class="fa-solid fa-folder-tree"></i> グループ分け: ${isGrouped ? 'ON' : 'OFF'}`;
  groupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    block.properties.groupBy = isGrouped ? null : 'col-status';
    saveNotesToStorage();
    renderEditor();
  });
  toolbar.appendChild(groupBtn);

  // CSV Menu (Import / Export Dropdown)
  const csvFileInput = document.createElement('input');
  csvFileInput.type = 'file';
  csvFileInput.accept = '.csv';
  csvFileInput.style.display = 'none';
  csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importFromCSV(block, file);
    }
  });
  toolbar.appendChild(csvFileInput);

  const csvMenuBtn = document.createElement('button');
  csvMenuBtn.className = 'btn-db-toolbar';
  csvMenuBtn.innerHTML = '<i class="fa-solid fa-file-csv"></i> CSV操作 <i class="fa-solid fa-chevron-down" style="font-size: 8px; margin-left: 4px;"></i>';
  csvMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // 他のポップオーバーをクリア
    const existing = document.querySelectorAll('.db-floating-popover');
    existing.forEach(p => p.remove());

    const popover = document.createElement('div');
    popover.className = 'db-floating-popover';
    popover.style.width = '155px';
    popover.style.left = `${e.clientX}px`;
    popover.style.top = `${e.clientY + 12}px`;

    // エクスポート項目
    const exportItem = document.createElement('div');
    exportItem.className = 'db-popover-item';
    exportItem.style.whiteSpace = 'nowrap';
    exportItem.innerHTML = '<i class="fa-solid fa-file-export" style="width:14px;"></i> CSVエクスポート';
    exportItem.addEventListener('click', (evt) => {
      evt.stopPropagation();
      popover.remove();
      exportToCSV(block);
    });
    popover.appendChild(exportItem);

    // インポート項目
    const importItem = document.createElement('div');
    importItem.className = 'db-popover-item';
    importItem.style.whiteSpace = 'nowrap';
    importItem.innerHTML = '<i class="fa-solid fa-file-import" style="width:14px;"></i> CSVインポート';
    importItem.addEventListener('click', (evt) => {
      evt.stopPropagation();
      popover.remove();
      csvFileInput.click();
    });
    popover.appendChild(importItem);

    document.body.appendChild(popover);
  });
  toolbar.appendChild(csvMenuBtn);

  // delete database button
  const deleteDbBtn = document.createElement('button');
  deleteDbBtn.className = 'btn-db-toolbar btn-db-delete';
  deleteDbBtn.style.color = '#f87171';
  deleteDbBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
  deleteDbBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> テーブルを削除`;
  deleteDbBtn.addEventListener('mouseenter', () => {
    deleteDbBtn.style.background = 'rgba(239, 68, 68, 0.1)';
    deleteDbBtn.style.borderColor = '#ef4444';
  });
  deleteDbBtn.addEventListener('mouseleave', () => {
    deleteDbBtn.style.background = 'none';
    deleteDbBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
  });
  deleteDbBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('このデータベーステーブルを完全に削除してもよろしいですか？')) {
      const note = getActiveNote();
      if (!note) return;
      pushHistory();
      note.blocks = note.blocks.filter(b => b.id !== block.id);
      saveNotesToStorage();
      renderEditor();
    }
  });
  toolbar.appendChild(deleteDbBtn);



  container.appendChild(toolbar);

  // 3. データ行のフィルタリング抽出（複数 AND 結合ロジック）
  const allRows = block.properties.rows || [];
  let visibleRows = allRows;

  if (activeView.filters && activeView.filters.length > 0) {
    visibleRows = allRows.filter(row => {
      return activeView.filters.every(filter => {
        const val = row[filter.columnId];
        const col = block.properties.columns.find(c => c.id === filter.columnId);
        if (!col) return true;

        const filterVal = filter.value;
        if (filterVal === undefined || filterVal === '') return true; // 空フィルター条件はパス

        if (col.type === 'status') {
          const name = getStatusOptionName(col, val);
          return name === filterVal || val === filterVal;
        }
        if (col.type === 'select') {
          const tagOptions = col.options || [];
          const getTagName = (idOrName) => {
            const found = tagOptions.find(o => {
              const oid = typeof o === 'string' ? o : (o.id || o.name);
              const oname = typeof o === 'string' ? o : o.name;
              return oid.toLowerCase() === idOrName.toLowerCase() || oname.toLowerCase() === idOrName.toLowerCase();
            });
            return found ? (typeof found === 'string' ? found : found.name) : idOrName;
          };
          const getTagId = (idOrName) => {
            const found = tagOptions.find(o => {
              const oid = typeof o === 'string' ? o : (o.id || o.name);
              const oname = typeof o === 'string' ? o : o.name;
              return oid.toLowerCase() === idOrName.toLowerCase() || oname.toLowerCase() === idOrName.toLowerCase();
            });
            return found ? (typeof found === 'string' ? found : (found.id || found.name)) : idOrName;
          };

          const valLower = String(val || '').trim().toLowerCase();
          const valName = getTagName(valLower).trim().toLowerCase();
          const valId = getTagId(valLower).trim().toLowerCase();

          const filterVals = typeof filterVal === 'string' ? filterVal.split(',').map(t => t.trim().toLowerCase()) : [];
          if (filterVals.length === 0) return true;

          return filterVals.some(fVal => {
            const fName = getTagName(fVal).trim().toLowerCase();
            const fId = getTagId(fVal).trim().toLowerCase();
            return valLower === fVal || valName === fVal || valId === fVal || 
                   valLower === fName || valName === fName || valId === fName || 
                   valLower === fId || valName === fId || valId === fId;
          });
        }
        if (col.type === 'checkbox') {
          const boolFilterVal = (filterVal === 'ON' || filterVal === 'true' || filterVal === true);
          return (val === true) === boolFilterVal;
        }
        if (col.type === 'date') {
          if (filterVal === '全期間' || !filterVal) return true;

          const dateInfo = parseDatePropertyValue(val);
          if (!dateInfo || !dateInfo.start.date) return false;

          const itemDate = new Date(dateInfo.start.date);
          const now = new Date();

          if (filterVal === '今週') {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);

            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23, 59, 59, 999);

            return itemDate >= startOfWeek && itemDate <= endOfWeek;
          }
          if (filterVal === '今月') {
            return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
          }
          if (filterVal === '今年') {
            return itemDate.getFullYear() === now.getFullYear();
          }
          return true;
        }

        // テキスト部分一致
        return String(val || '').toLowerCase().includes(String(filterVal || '').toLowerCase());
      });
    });
  }

  // 3.5. ソートの適用
  activeView.sorts = activeView.sorts || [];
  if (activeView.sorts.length > 0) {
    const sort = activeView.sorts[0];
    const col = block.properties.columns.find(c => c.id === sort.columnId);
    if (col) {
      visibleRows = [...visibleRows].sort((a, b) => {
        let valA = a[sort.columnId];
        let valB = b[sort.columnId];

        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        if (col.type === 'number') {
          const numA = parseFloat(valA);
          const numB = parseFloat(valB);
          const isNumA = !isNaN(numA);
          const isNumB = !isNaN(numB);

          if (!isNumA && !isNumB) return 0;
          if (!isNumA) return 1;
          if (!isNumB) return -1;

          return sort.direction === 'asc' ? numA - numB : numB - numA;
        } else if (col.type === 'date') {
          const dateInfoA = parseDatePropertyValue(valA);
          const dateInfoB = parseDatePropertyValue(valB);
          const dateA = dateInfoA ? dateInfoA.start.date : '';
          const dateB = dateInfoB ? dateInfoB.start.date : '';

          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;

          return sort.direction === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
        } else {
          const strA = String(valA).toLowerCase();
          const strB = String(valB).toLowerCase();

          if (!strA && !strB) return 0;
          if (!strA) return 1;
          if (!strB) return -1;

          return sort.direction === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        }
      });
    }
  }

  // 4. グループ化分割表示（groupByがONの場合）
  const statusCol = block.properties.columns.find(c => c.type === 'status');

  if (isGrouped && statusCol) {
    const groupsWrapper = document.createElement('div');
    groupsWrapper.className = 'db-groups-wrapper';

    // ステータスオプションの取得（デフォルトプリセットを含む）
    const statusOptions = statusCol.options || [
      { id: 'opt-todo', name: '未着手', color: 'gray' },
      { id: 'opt-progress', name: '進行中', color: 'blue' },
      { id: 'opt-complete', name: '完了', color: 'green' }
    ];

    const collapsedGroups = block.properties.collapsedGroups || [];

    statusOptions.forEach(opt => {
      // このステータスグループに属する行
      const groupRows = visibleRows.filter(row => {
        const val = row[statusCol.id];
        return val === opt.id || val === opt.name;
      });

      const isCollapsed = collapsedGroups.includes(opt.id);

      const groupContainer = document.createElement('div');
      groupContainer.className = `db-group-container ${isCollapsed ? 'collapsed' : ''}`;

      // グループヘッダー
      const groupHeader = document.createElement('div');
      groupHeader.className = 'db-group-header';

      const arrow = document.createElement('span');
      arrow.className = 'db-group-toggle-arrow';
      arrow.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      groupHeader.appendChild(arrow);

      const badge = document.createElement('span');
      badge.className = `db-group-title-badge db-select-badge db-tag-${opt.color || 'gray'}`;
      badge.textContent = opt.name;
      groupHeader.appendChild(badge);

      const count = document.createElement('span');
      count.className = 'db-group-count';
      count.textContent = `(${groupRows.length})`;
      groupHeader.appendChild(count);

      // トグルの開閉切り替え
      groupHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        const activeCollapsed = block.properties.collapsedGroups || [];
        const currentlyCollapsed = activeCollapsed.includes(opt.id);
        if (currentlyCollapsed) {
          block.properties.collapsedGroups = activeCollapsed.filter(id => id !== opt.id);
        } else {
          block.properties.collapsedGroups = [...activeCollapsed, opt.id];
        }
        saveNotesToStorage();
        renderEditor();
      });

      groupContainer.appendChild(groupHeader);

      // ミニサブテーブル
      const subTableWrapper = document.createElement('div');
      subTableWrapper.className = 'db-group-subtable';

      const subTable = renderSingleTableDOM(block, groupRows, (newRowData) => {
        // このグループのステータスを初期セット
        newRowData[statusCol.id] = opt.id;

        // 且つ、他のフィルター条件もすべて代入
        if (activeView.filters && activeView.filters.length > 0) {
          activeView.filters.forEach(filter => {
            if (filter.columnId !== statusCol.id) {
              newRowData[filter.columnId] = filter.value;
            }
          });
        }
      });

      subTableWrapper.appendChild(subTable);
      groupContainer.appendChild(subTableWrapper);
      groupsWrapper.appendChild(groupContainer);
    });

    container.appendChild(groupsWrapper);
  } else {
    // Layoutに応じた切り替え（テーブル、カレンダー、各種グラフ）
    if (activeView.layout === 'calendar') {
      const calendarWrapper = document.createElement('div');
      calendarWrapper.style.padding = '16px';
      calendarWrapper.style.overflowX = 'auto';

      const calendarEl = renderCalendarViewDOM(block, visibleRows);
      calendarWrapper.appendChild(calendarEl);
      container.appendChild(calendarWrapper);
    } else if (activeView.layout && activeView.layout.startsWith('chart')) {
      const chartWrapper = document.createElement('div');
      chartWrapper.style.padding = '16px';
      chartWrapper.style.overflowX = 'auto';

      const chartEl = renderChartViewDOM(block, visibleRows);
      chartWrapper.appendChild(chartEl);
      container.appendChild(chartWrapper);
    } else {
      // 5. 通常フラットテーブル表示
      const flatTableWrapper = document.createElement('div');
      flatTableWrapper.style.padding = '16px';
      flatTableWrapper.style.overflowX = 'auto';

      const flatTable = renderSingleTableDOM(block, visibleRows, (newRowData) => {
        // フィルター条件をすべて自動セット（AND結合の特性）
        if (activeView.filters && activeView.filters.length > 0) {
          activeView.filters.forEach(filter => {
            newRowData[filter.columnId] = filter.value;
          });
        }
      });

      flatTableWrapper.appendChild(flatTable);
      container.appendChild(flatTableWrapper);
    }
  }



  return container;
}

// ----------------------------------------------------
// RENDER INDIVIDUAL TABLE (SHARED FOR FLAT & GROUPED SUB-TABLES)
// ----------------------------------------------------
function renderSingleTableDOM(block, rowDataList, onAddRowCallback = null) {
  const table = document.createElement('table');
  table.className = 'notion-db-table';

  const columns = block.properties.columns || [];

  // 1. HEAD (thead)
  const thead = document.createElement('thead');
  const headerTr = document.createElement('tr');

  // 削除用・一括選択用制御列のth（全選択チェックボックスの復元・新設）
  const leftColWidth = block.properties.leftColWidth || 34;
  const controlTh = document.createElement('th');
  controlTh.className = 'db-row-controls-header';
  controlTh.style.width = `${leftColWidth}px`;
  controlTh.style.minWidth = `${leftColWidth}px`;
  controlTh.style.maxWidth = `${leftColWidth}px`;
  controlTh.style.display = 'flex';
  controlTh.style.alignItems = 'center';
  controlTh.style.justifyContent = 'center';
  controlTh.style.position = 'relative';

  // 全選択チェックボックスの生成
  const allCheck = document.createElement('input');
  allCheck.type = 'checkbox';
  allCheck.className = 'db-select-all-check';
  allCheck.title = 'すべての行を選択/解除';
  allCheck.style.cursor = 'pointer';
  allCheck.style.margin = '0';
  allCheck.style.width = '11px';
  allCheck.style.height = '11px';
  allCheck.style.accentColor = 'var(--accent-primary)';

  // 現在テーブル内の行がすべて選択されているかどうかで初期状態を設定
  const isAllChecked = rowDataList.length > 0 && rowDataList.every(r => tableSelection.blockId === block.id && tableSelection.selectedRows.includes(r));
  allCheck.checked = isAllChecked;

  allCheck.addEventListener('change', (e) => {
    e.stopPropagation();
    const checked = e.target.checked;

    if (checked) {
      tableSelection.blockId = block.id;
      tableSelection.selectedRows = [...rowDataList];
    } else {
      tableSelection.blockId = null;
      tableSelection.selectedRows = [];
    }

    // テーブル内のすべてのチェックボックス状態を同期
    table.querySelectorAll('.db-row-select-check').forEach(chk => {
      chk.checked = checked;
    });

    // 他のテーブルの全選択状態もクリア
    document.querySelectorAll('.db-select-all-check').forEach(achk => {
      if (achk !== allCheck) achk.checked = false;
    });

    updateBulkActionBar(block, rowDataList);
  });
  controlTh.appendChild(allCheck);

  headerTr.appendChild(controlTh);

  columns.forEach(col => {
    const th = document.createElement('th');
    th.setAttribute('data-col-id', col.id);

    // 列幅の適用
    const w = col.width || (col.type === 'text' && col.id === 'col-title' ? 220 : 130);
    col.width = w;
    th.style.width = `${w}px`;
    th.style.minWidth = `${w}px`;
    th.style.maxWidth = `${w}px`;

    const container = document.createElement('div');
    container.className = 'db-header-content';

    let iconClass = 'fa-regular fa-file-lines';
    if (col.type === 'number') iconClass = 'fa-solid fa-hashtag';
    if (col.type === 'select') iconClass = 'fa-solid fa-list-ul';
    if (col.type === 'status') iconClass = 'fa-solid fa-circle-check';
    if (col.type === 'date') iconClass = 'fa-regular fa-calendar';
    if (col.type === 'checkbox') iconClass = 'fa-regular fa-square-check';

    container.innerHTML = `
      <i class="${iconClass} db-header-icon"></i>
      <span class="db-col-name-span">${escapeHTML(col.name)}</span>
    `;

    container.addEventListener('click', (e) => {
      e.stopPropagation();
      showColumnConfigPopover(e, block, col);
    });

    th.appendChild(container);

    // 列幅リサイザーの追加
    const resizer = document.createElement('div');
    resizer.className = 'db-column-resizer';
    setupDbColumnResizer(resizer, col, th, table, block, rowDataList);
    th.appendChild(resizer);

    // 列ドラッグ＆ドロップ入れ替えの設定 (最初のth以外にもドラッグイベント登録)
    setupDbColumnDragDrop(th, col.id, block);

    headerTr.appendChild(th);
  });

  // 新規列追加「+」ボタン付きth
  const addColTh = document.createElement('th');
  addColTh.style.width = '40px';
  addColTh.style.minWidth = '40px';
  addColTh.style.textAlign = 'center';
  const addColBtn = document.createElement('button');
  addColBtn.className = 'btn-add-db-col';
  addColBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addColBtn.title = '列を追加';
  addColBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showAddColumnPopover(e, block);
  });
  addColTh.appendChild(addColBtn);

  // 「+」ボタン列へのドラッグ＆ドロップイベント統合（最後尾への移動を阻害しないための措置）
  addColTh.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedColId) return;

    // 「+」マーク列の左隣（最後のプロパティ列）に「右側ハイライト」を適用して最後尾移動を示す
    const lastPropertyTh = addColTh.previousElementSibling;
    if (lastPropertyTh && lastPropertyTh.getAttribute('data-col-id')) {
      lastPropertyTh.classList.add('db-th-dragover-right');
    }
  });

  addColTh.addEventListener('dragleave', () => {
    const lastPropertyTh = addColTh.previousElementSibling;
    if (lastPropertyTh) {
      lastPropertyTh.classList.remove('db-th-dragover-right');
    }
  });

  addColTh.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const lastPropertyTh = addColTh.previousElementSibling;
    if (lastPropertyTh) {
      lastPropertyTh.classList.remove('db-th-dragover-right');
    }

    if (!draggedColId) return;

    const columns = block.properties.columns;
    const dragIdx = columns.findIndex(c => c.id === draggedColId);
    if (dragIdx === -1) return;

    // ドラッグ要素を最後尾に移動
    const [draggedCol] = columns.splice(dragIdx, 1);
    columns.push(draggedCol);

    saveNotesToStorage();
    renderEditor();
  });

  headerTr.appendChild(addColTh);

  // テーブル全体の合計幅を全列の合計値に同期する（マウスズレ解消と余白引き締め）
  let totalTableWidth = leftColWidth;
  columns.forEach(col => {
    totalTableWidth += col.width;
  });
  totalTableWidth += 40; // 新規列追加列
  table.style.width = `${totalTableWidth}px`;
  table.style.minWidth = `${totalTableWidth}px`;

  thead.appendChild(headerTr);
  table.appendChild(thead);

  // 2. BODY (tbody)
  const tbody = document.createElement('tbody');

  rowDataList.forEach((row) => {
    // block.properties.rows 内での実際のインデックスを探す
    const actualIndex = block.properties.rows.indexOf(row);
    if (actualIndex === -1) return;

    const tr = document.createElement('tr');
    tr.className = 'db-data-row';

    tr.addEventListener('click', (e) => {
      // 編集可能要素などをクリックして編集に入る際、選択状態があればリセットする
      const isEditTarget = e.target.closest('.db-cell-edit, input, button, select, .db-select-badge, .db-date-span');
      if (isEditTarget) {
        if ((tableSelection.selectedRows && tableSelection.selectedRows.length > 0) || (state.selectedBlockIds && state.selectedBlockIds.length > 0)) {
          clearTableSelection();
          clearBlockSelection();
        }
        return;
      }
    });
    // 削除・一括選択コントロールtd（極小コンパクト化）
    const controlTd = document.createElement('td');
    controlTd.className = 'db-row-controls-cell';
    controlTd.style.width = `${leftColWidth}px`;
    controlTd.style.minWidth = `${leftColWidth}px`;
    controlTd.style.maxWidth = `${leftColWidth}px`;

    const controlsWrapper = document.createElement('div');
    controlsWrapper.className = 'db-row-controls-inner';

    // 一括操作用選択チェックボックス
    const rowCheck = document.createElement('input');
    rowCheck.type = 'checkbox';
    rowCheck.className = 'db-row-select-check';
    rowCheck.checked = tableSelection.blockId === block.id && tableSelection.selectedRows.includes(row);
    rowCheck.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRowClick(e, block, row, rowDataList.indexOf(row), rowDataList, rowCheck);
    });

    controlsWrapper.appendChild(rowCheck);

    // ドラッグ＆ドロップ用グリップハンドルを追加
    const dragHandle = document.createElement('div');
    dragHandle.className = 'db-row-drag-handle';
    dragHandle.title = 'ドラッグして行を並べ替え';
    dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
    controlsWrapper.appendChild(dragHandle);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-db-row';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.title = '行を削除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDbRow(block, actualIndex, e);
    });
    controlsWrapper.appendChild(delBtn);

    controlTd.appendChild(controlsWrapper);
    tr.appendChild(controlTd);
    columns.forEach(col => {
      const td = document.createElement('td');
      td.className = `cell-type-${col.type}`;
      const val = row[col.id] !== undefined ? row[col.id] : '';

      // 列幅の適用
      td.style.width = `${col.width}px`;
      td.style.minWidth = `${col.width}px`;
      td.style.maxWidth = `${col.width}px`;

      if (col.type === 'status') {
        if (!col.options || col.options.length === 0) {
          col.options = [
            { id: 'opt-todo', name: '未着手', color: 'gray' },
            { id: 'opt-progress', name: '進行中', color: 'blue' },
            { id: 'opt-complete', name: '完了', color: 'green' }
          ];
        }
        const badge = document.createElement('span');
        const optName = getStatusOptionName(col, val) || '未着手';
        const optColor = getStatusOptionColor(col, val) || 'gray';

        badge.className = `db-select-badge db-tag-${optColor}`;
        badge.textContent = optName;
        badge.style.cursor = 'pointer';

        badge.addEventListener('click', (e) => {
          if (e.shiftKey) return;
          e.stopPropagation();
          showStatusSelectPopover(e, block, actualIndex, col.id);
        });

        td.appendChild(badge);
      } else if (col.type === 'select') {
        const badge = document.createElement('span');
        badge.className = `db-select-badge db-tag-${getTagColor(col, val)}`;
        badge.textContent = val || '選択なし';
        badge.style.cursor = 'pointer';

        badge.addEventListener('click', (e) => {
          if (e.shiftKey) return;
          e.stopPropagation();
          showSelectTagPopover(e, block, actualIndex, col.id, col.options || []);
        });

        td.appendChild(badge);
      } else if (col.type === 'date') {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'db-date-span';
        dateSpan.style.cursor = 'pointer';
        dateSpan.style.display = 'block';
        dateSpan.style.minHeight = '18px';

        dateSpan.textContent = val ? formatDatePropertyValueForDisplay(val, col) : '日付を入力...';
        if (!val) {
          dateSpan.style.color = 'var(--text-muted)';
        }

        dateSpan.addEventListener('click', (e) => {
          if (e.shiftKey) return;
          e.stopPropagation();
          showDatabaseDatePickerPopover(e, block, actualIndex, col.id);
        });

        td.appendChild(dateSpan);
      } else if (col.type === 'checkbox') {
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = val === true;
        check.style.cursor = 'pointer';
        check.addEventListener('change', () => {
          row[col.id] = check.checked;
          saveNotesToStorage();
          recalculateTableFooter(table, block, rowDataList);
        });
        td.style.textAlign = 'center';
        td.appendChild(check);
      } else {
        const cellDiv = document.createElement('div');
        cellDiv.className = 'db-cell-edit';

        if (col.type === 'number') {
          cellDiv.style.textAlign = 'right';
          renderNumberCell(cellDiv, val, col);

          if (col.numberFormat === 'progress') {
            cellDiv.contentEditable = 'false';
            cellDiv.addEventListener('click', (e) => {
              if (cellDiv.querySelector('.db-progress-edit-wrapper')) return;
              state.lastActiveEditTarget = cellDiv;
              setupProgressInlineEdit(cellDiv, row, col, table, block, rowDataList);
            });
          } else {
            cellDiv.contentEditable = 'true';
            // フォーカスON時はプレーンな数値に
            cellDiv.addEventListener('focus', () => {
              state.lastActiveEditTarget = cellDiv;
              cellDiv.textContent = row[col.id] !== undefined ? row[col.id] : '';
            });
          }
        } else {
          cellDiv.contentEditable = 'true';
          // テキストタイプの場合はWikiリンクをパースしてHTML描画
          if (col.type === 'text' || !col.type) {
            cellDiv.innerHTML = parseWikiLinks(escapeHTML(val));
          } else {
            cellDiv.textContent = val;
          }

          // フォーカスON時もHTML表示を維持（WikiLinkバッジを表示したまま編集）
          cellDiv.addEventListener('focus', () => {
            state.lastActiveEditTarget = cellDiv;
            const val = row[col.id] !== undefined ? row[col.id] : '';
            if (col.type === 'text' || !col.type) {
              cellDiv.innerHTML = parseWikiLinks(escapeHTML(val));
            } else {
              cellDiv.textContent = val;
            }
          });
        }

        cellDiv.addEventListener('blur', () => {
          // すでにDOMから取り除かれている古い要素なら、非同期の暴発によるデータ破壊を防ぐため無視する
          if (!document.body.contains(cellDiv)) return;
          if (historyState.isApplying) return;

          // progress形式の場合は setupProgressInlineEdit 内部で保存と再描画を行うので、ここでは何もしない
          if (col.type === 'number' && col.numberFormat === 'progress') {
            return;
          }

          let newVal;
          if (col.type === 'text' || !col.type) {
            newVal = serializeHtmlToWikiText(cellDiv).trim();
            cellDiv.innerHTML = parseWikiLinks(escapeHTML(newVal));
          } else {
            newVal = cellDiv.textContent.trim();
            if (col.type === 'number') {
              const parsed = parseFloat(newVal);
              newVal = isNaN(parsed) ? '' : parsed;
              renderNumberCell(cellDiv, newVal, col);
            } else {
              cellDiv.textContent = newVal;
            }
          }
          row[col.id] = newVal;
          saveNotesToStorage();
          recalculateTableFooter(table, block, rowDataList);
        });

        cellDiv.addEventListener('input', (e) => {
          if (col.type === 'text' || !col.type) {
            row[col.id] = serializeHtmlToWikiText(cellDiv);
          } else {
            row[col.id] = cellDiv.textContent;
          }
          handleWikiLinkTrigger(cellDiv, e);
        });

        cellDiv.addEventListener('keydown', (evt) => {
          if (state.linkMenuOpen) {
            if (evt.key === 'ArrowDown') {
              evt.preventDefault();
              navigateLinkMenu(1);
              return;
            }
            if (evt.key === 'ArrowUp') {
              evt.preventDefault();
              navigateLinkMenu(-1);
              return;
            }
            if (evt.key === 'Enter') {
              if (evt.isComposing) return;
              evt.preventDefault();
              selectLinkMenuItem();
              return;
            }
            if (evt.key === 'Escape') {
              evt.preventDefault();
              closeLinkMenu();
              return;
            }
          }

          if (evt.key === 'Enter') {
            if (evt.isComposing) return;

            // 補完メニューが開いていなくても、「「キーワード の直後でEnterが押された場合に自動置換する処理
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              let node = range.startContainer;
              let offset = range.startOffset;

              // 要素ノードを指している場合は、実際の子テキストノードとオフセットに解決
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.childNodes.length > 0 && offset > 0) {
                  const targetChild = node.childNodes[offset - 1];
                  if (targetChild && targetChild.nodeType === Node.TEXT_NODE) {
                    node = targetChild;
                    offset = targetChild.length;
                  }
                }
              }

              if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                const beforeText = text.substring(0, offset);

                const match = beforeText.match(/(?:「「|\[\[)([^「「\[\[\]\]」」]+)$/);
                if (match) {
                  evt.preventDefault();
                  const keyword = match[1];
                  const trimmedKeyword = keyword.trim();
                  if (!trimmedKeyword) return;

                  // トリガーされたカッコの種類を特定
                  const triggerType = beforeText.substring(beforeText.length - keyword.length - 2, beforeText.length - keyword.length);
                  const isJp = triggerType === '「「';
                  const closeBracket = isJp ? '」」' : ']]';

                  // 🌟 存在しないノートの場合、裏で自動的に新規ノートを作成！
                  let existingNote = state.notes.find(n => n.title.toLowerCase() === trimmedKeyword.toLowerCase());
                  if (!existingNote) {
                    const activeNote = getActiveNote();
                    const parentFolderId = activeNote ? activeNote.folderId : null;
                    existingNote = {
                      id: 'note-' + generateId(),
                      title: trimmedKeyword,
                      folderId: parentFolderId,
                      updatedAt: Date.now(),
                      blocks: [
                        { id: generateId(), type: 'p', content: '' }
                      ]
                    };
                    state.notes.push(existingNote);
                    saveNotesToStorage();
                    renderNoteList();
                  }

                  // 🌟 その場で即座に青い WikiLink の HTML/DOM 要素を生成
                  const span = document.createElement('span');
                  span.className = existingNote ? 'wiki-link' : 'wiki-link wiki-link-new';
                  span.setAttribute('data-target', trimmedKeyword);
                  span.setAttribute('data-bracket', isJp ? 'jp' : 'en');
                  span.setAttribute('title', 'ノートを開く');
                  span.textContent = keyword;

                  // カーソルの直後にすでに閉じカッコが存在するかどうかを確認（存在する場合は削除）
                  const afterText = text.substring(offset);
                  if (afterText.startsWith(closeBracket)) {
                    const caretRange = selection.getRangeAt(0);
                    caretRange.setStart(node, offset);
                    caretRange.setEnd(node, offset + 2);
                    caretRange.deleteContents();
                  }

                  // 入力中の 「「キーワード の部分を削除して、代わりに作成した span を挿入！
                  const caretRange = selection.getRangeAt(0);
                  caretRange.setStart(node, offset - keyword.length - 2);
                  caretRange.setEnd(node, offset);
                  caretRange.deleteContents();

                  caretRange.insertNode(span);

                  // カーソルを挿入した span の直後にセット！
                  selection.removeAllRanges();
                  const newRange = document.createRange();
                  newRange.setStartAfter(span);
                  newRange.collapse(true);
                  selection.addRange(newRange);

                  // セルのデータをWikiText形式で更新
                  row[col.id] = serializeHtmlToWikiText(cellDiv);
                  saveNotesToStorage();
                  return;
                }
              }
            }

            evt.preventDefault();
            cellDiv.blur();
          }
        });

        td.appendChild(cellDiv);
      }

      tr.appendChild(td);
    });

    // プラス列分の調整空セル
    const dummyTd = document.createElement('td');
    tr.appendChild(dummyTd);
    tbody.appendChild(tr);
  });

  // 新規行追加tr
  const addRowTr = document.createElement('tr');
  addRowTr.className = 'db-add-row-tr';
  const addRowTd = document.createElement('td');
  addRowTd.setAttribute('colspan', columns.length + 2);
  addRowTd.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:8px;"></i>新規行を追加';
  addRowTd.addEventListener('click', (e) => {
    e.stopPropagation();
    const newRowData = {};
    if (onAddRowCallback) {
      onAddRowCallback(newRowData);
    }
    addNewDbRow(block, newRowData);
  });
  addRowTr.appendChild(addRowTd);
  tbody.appendChild(addRowTr);
  table.appendChild(tbody);

  // 3. FOOT (tfoot)
  const tfoot = document.createElement('tfoot');
  const footerTr = document.createElement('tr');
  footerTr.className = 'db-calc-row';

  // コントロール列用の空td
  const firstFooterTd = document.createElement('td');
  firstFooterTd.className = 'db-row-controls-cell';
  firstFooterTd.style.width = `${leftColWidth}px`;
  firstFooterTd.style.minWidth = `${leftColWidth}px`;
  firstFooterTd.style.maxWidth = `${leftColWidth}px`;
  footerTr.appendChild(firstFooterTd);



  columns.forEach(col => {
    const td = document.createElement('td');
    td.className = 'db-calc-cell';
    td.setAttribute('data-col-id', col.id);

    td.style.width = `${col.width}px`;
    td.style.minWidth = `${col.width}px`;
    td.style.maxWidth = `${col.width}px`;

    renderFooterCellContent(td, block, col, rowDataList);

    td.addEventListener('click', (e) => {
      e.stopPropagation();
      showCalcOptionsPopover(e, block, col, td, rowDataList);
    });

    footerTr.appendChild(td);
  });

  const lastFooterTd = document.createElement('td');
  footerTr.appendChild(lastFooterTd);
  tfoot.appendChild(footerTr);
  table.appendChild(tfoot);

  // Sortable.js による行並び替えの有効化
  Sortable.create(tbody, {
    handle: '.db-row-drag-handle',
    animation: 150,
    draggable: '.db-data-row',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return;

      const draggedRowData = rowDataList[evt.oldIndex];
      if (!draggedRowData) return;

      const actualOldIdx = block.properties.rows.indexOf(draggedRowData);
      if (actualOldIdx === -1) return;

      // 履歴スタックに現在の状態をプッシュ（Ctrl+Z対応）
      pushHistory();

      // 一旦削除
      block.properties.rows.splice(actualOldIdx, 1);

      // 一時的な配列を作成して移動先インデックスを特定
      const tempRowList = [...rowDataList];
      tempRowList.splice(evt.oldIndex, 1);

      let targetIdx;
      if (evt.newIndex >= tempRowList.length) {
        targetIdx = block.properties.rows.length;
      } else {
        const nextRowData = tempRowList[evt.newIndex];
        targetIdx = block.properties.rows.indexOf(nextRowData);
      }

      if (targetIdx === -1) {
        targetIdx = block.properties.rows.length;
      }

      // 新しい位置に挿入
      block.properties.rows.splice(targetIdx, 0, draggedRowData);

      saveNotesToStorage();
      renderEditor();
    }
  });

  return table;
}

// ----------------------------------------------------
// FLOATING POPOVERS & DIALOGS
// ----------------------------------------------------

function showAddColumnPopover(e, block) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-col-popover';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  popover.innerHTML = `
    <div style="font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;">新規列を追加</div>
    <input type="text" class="db-popover-input" id="new-col-name" value="プロパティ" placeholder="プロパティ名">
    <div class="db-popover-divider"></div>
    <div style="font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;">タイプ</div>
    <div class="db-popover-item active" data-type="text"><i class="fa-regular fa-file-lines" style="width:14px;"></i>テキスト</div>
    <div class="db-popover-item" data-type="number"><i class="fa-solid fa-hashtag" style="width:14px;"></i>数値</div>
    <div class="db-popover-item" data-type="select"><i class="fa-solid fa-list-ul" style="width:14px;"></i>セレクトタグ</div>
    <div class="db-popover-item" data-type="status"><i class="fa-solid fa-circle-check" style="width:14px;"></i>ステータス</div>
    <div class="db-popover-item" data-type="date"><i class="fa-regular fa-calendar" style="width:14px;"></i>日付</div>
    <div class="db-popover-item" data-type="checkbox"><i class="fa-regular fa-square-check" style="width:14px;"></i>チェックボックス</div>
    <div class="db-popover-divider"></div>
    <div class="db-popover-item" id="btn-create-col" style="justify-content:center; background:var(--accent-primary); color:white; font-weight:600; margin-top:4px;">作成</div>
  `;

  let selectedType = 'text';
  let isUserTyped = false;

  const nameInput = popover.querySelector('#new-col-name');
  nameInput.addEventListener('input', () => {
    isUserTyped = true;
  });

  const defaultNames = {
    'text': 'テキスト',
    'number': '数値',
    'select': 'セレクトタグ',
    'status': 'ステータス',
    'date': '日付',
    'checkbox': 'チェックボックス'
  };

  const defaultNameList = ['プロパティ', 'テキスト', '数値', 'セレクトタグ', 'セレクト', 'ステータス', '日付', 'チェックボックス', ''];

  const items = popover.querySelectorAll('.db-popover-item[data-type]');
  items.forEach(item => {
    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      selectedType = item.getAttribute('data-type');

      // 手動入力されていない、かつ現在の値がデフォルト名のいずれかの場合に自動更新
      const currentVal = nameInput.value.trim();
      if (!isUserTyped && defaultNameList.includes(currentVal)) {
        nameInput.value = defaultNames[selectedType] || 'プロパティ';
      }
    });
  });

  popover.querySelector('#btn-create-col').addEventListener('click', (evt) => {
    evt.stopPropagation();
    const name = popover.querySelector('#new-col-name').value.trim() || 'プロパティ';
    const colId = 'col-' + generateId();

    const newCol = {
      id: colId,
      name: name,
      type: selectedType,
      width: 130
    };

    // ステータス列の場合は、初期プリセットを設定
    if (selectedType === 'status') {
      newCol.options = [
        { id: 'opt-todo', name: '未着手', color: 'gray' },
        { id: 'opt-progress', name: '進行中', color: 'blue' },
        { id: 'opt-complete', name: '完了', color: 'green' }
      ];
    }

    block.properties.columns.push(newCol);

    // 既存行への初期値の代入
    block.properties.rows.forEach(row => {
      if (selectedType === 'status') row[colId] = 'opt-todo';
      else if (selectedType === 'checkbox') row[colId] = false;
      else row[colId] = '';
    });

    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  document.body.appendChild(popover);
  setTimeout(() => popover.querySelector('#new-col-name').focus(), 50);
}

function showAddViewPopover(e, block) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-view-add-popover';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;
  popover.style.width = '200px';

  popover.innerHTML = `
    <div style="font-size:10px; color:var(--text-muted); font-weight:700; padding:4px 6px; border-bottom:1px solid var(--border-light);">新規ビューを追加</div>
    <div style="padding:8px; display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:9px; color:var(--text-muted); font-weight:700;">ビューの名前</label>
      <input type="text" id="new-view-name" class="db-filter-val-input" style="width:100%; border:1px solid var(--border-light); background:var(--bg-secondary); color:var(--text-primary); border-radius:4px; padding:4px 6px; font-size:12px;" placeholder="ビューの名前を入力...">
    </div>
    <div class="db-popover-divider" style="margin:4px 0 2px 0;"></div>
    <div style="font-size:10px; color:var(--text-muted); font-weight:700; padding:4px 6px;">ビューの種類を選択</div>
    <div style="padding:6px; display:flex; flex-direction:column; gap:4px;">
      <div class="db-popover-item" data-layout="table" data-name="テーブル"><i class="fa-solid fa-table" style="width:14px; color:#60a5fa; margin-right:6px;"></i>📋 テーブル（表）</div>
      <div class="db-popover-item" data-layout="calendar" data-name="カレンダー"><i class="fa-regular fa-calendar" style="width:14px; color:#34d399; margin-right:6px;"></i>📅 カレンダー</div>
      <div class="db-popover-item" data-layout="chart-bar" data-name="棒グラフ"><i class="fa-solid fa-chart-bar" style="width:14px; color:#f472b6; margin-right:6px;"></i>📊 棒グラフ</div>
      <div class="db-popover-item" data-layout="chart-line" data-name="折れ線グラフ"><i class="fa-solid fa-chart-line" style="width:14px; color:#a78bfa; margin-right:6px;"></i>📈 折れ線グラフ</div>
      <div class="db-popover-item" data-layout="chart-donut" data-name="ドーナツグラフ"><i class="fa-solid fa-chart-pie" style="width:14px; color:#fbbf24; margin-right:6px;"></i>🍩 ドーナツグラフ</div>
    </div>
  `;

  const items = popover.querySelectorAll('.db-popover-item[data-layout]');
  items.forEach(item => {
    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const layout = item.getAttribute('data-layout');
      const inputVal = popover.querySelector('#new-view-name').value.trim();
      const name = inputVal || item.getAttribute('data-name');

      // 履歴スタックへのプッシュ（Ctrl+Z対応）
      pushHistory();

      const newId = 'view-' + generateId();
      block.properties.views.push({
        id: newId,
        name: name,
        layout: layout,
        filters: [],
        sorts: []
      });
      block.properties.activeViewId = newId;

      popover.remove();
      saveNotesToStorage();
      renderEditor();
    });
  });

  document.body.appendChild(popover);
  setTimeout(() => {
    const input = popover.querySelector('#new-view-name');
    if (input) input.focus();
  }, 50);
}

// ----------------------------------------------------
// INTELLIGENT MULTIPLE AND FILTER POPOVER
// ----------------------------------------------------
function showViewConfigPopover(e, block, view) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-view-config-popover';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;
  popover.style.width = '220px';

  view.layout = view.layout || 'table';

  popover.innerHTML = `
    <div style="font-size:10px; color:var(--text-muted); font-weight:700; padding:4px 6px; border-bottom:1px solid var(--border-light);">表示設定</div>
    <div style="padding:8px; display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:9px; color:var(--text-muted); font-weight:700;">表示レイアウト</label>
      <select id="view-layout-select" class="db-filter-val-select" style="width:100%;">
        <option value="table" ${view.layout === 'table' ? 'selected' : ''}>📋 テーブル（表）</option>
        <option value="calendar" ${view.layout === 'calendar' ? 'selected' : ''}>📅 カレンダー</option>
        <option value="chart-bar" ${view.layout === 'chart-bar' ? 'selected' : ''}>📊 棒グラフ</option>
        <option value="chart-line" ${view.layout === 'chart-line' ? 'selected' : ''}>📈 線グラフ</option>
        <option value="chart-donut" ${view.layout === 'chart-donut' ? 'selected' : ''}>🍩 ドーナツグラフ</option>
      </select>
    </div>

    <div class="db-popover-divider" style="margin:6px 0 4px 0;"></div>
    <button id="btn-save-view-config" class="db-filter-apply-btn" style="margin-top:4px; padding:4px 0;">完了</button>
  `;

  const layoutSelect = popover.querySelector('#view-layout-select');

  popover.querySelector('#btn-save-view-config').addEventListener('click', (evt) => {
    evt.stopPropagation();
    view.layout = layoutSelect.value;
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  document.body.appendChild(popover);
}

function showFilterConfigPopover(e, block, view) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-filter-popover';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  view.filters = view.filters || [];
  const filters = view.filters;
  const columns = block.properties.columns || [];

  // ヘッダー部
  const header = document.createElement('div');
  header.className = 'db-filter-header';
  header.style.marginTop = '4px';
  header.innerHTML = `
    <span>フィルター条件（AND）</span>
    ${filters.length > 0 ? '<button class="btn-clear-all-filters" id="btn-clear-all">すべてクリア</button>' : ''}
  `;
  popover.appendChild(header);

  // 各フィルター行のレンダリングコンテナ
  const listContainer = document.createElement('div');
  listContainer.className = 'db-filter-list';

  if (filters.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style = 'font-size:11px; color:var(--text-muted); text-align:center; padding:12px 6px;';
    emptyMsg.textContent = 'フィルターが設定されていません。';
    listContainer.appendChild(emptyMsg);
  } else {
    filters.forEach((filter, idx) => {
      const row = document.createElement('div');
      row.className = 'db-filter-row';

      // 1. 列選択セレクトボックス
      const colSelect = document.createElement('select');
      colSelect.className = 'db-filter-col-select';
      columns.forEach(col => {
        const isSelected = filter.columnId === col.id;
        colSelect.innerHTML += `<option value="${col.id}" ${isSelected ? 'selected' : ''}>${escapeHTML(col.name)}</option>`;
      });

      row.appendChild(colSelect);

      // 「＝」等号ラベル
      const eqLabel = document.createElement('span');
      eqLabel.style = 'font-size:11px; color:var(--text-muted); font-weight:600;';
      eqLabel.textContent = '=';
      row.appendChild(eqLabel);

      // 2. 知的値コントロール（プロパティタイプに動的連動）
      const valContainer = document.createElement('div');
      valContainer.className = 'db-filter-val-container';
      valContainer.style.flex = '1.3';
      valContainer.style.minWidth = '0';

      const renderValControl = (targetColId) => {
        valContainer.innerHTML = '';
        const col = columns.find(c => c.id === targetColId);
        if (!col) return;

        if (col.type === 'status') {
          // ステータスオプションのドロップダウン
          const select = document.createElement('select');
          select.className = 'db-filter-val-select';
          select.style.width = '100%';

          const statusOptions = col.options || [
            { id: 'opt-todo', name: '未着手', color: 'gray' },
            { id: 'opt-progress', name: '進行中', color: 'blue' },
            { id: 'opt-complete', name: '完了', color: 'green' }
          ];

          statusOptions.forEach(opt => {
            const isSel = filter.value === opt.id || filter.value === opt.name;
            select.innerHTML += `<option value="${opt.name}" ${isSel ? 'selected' : ''}>${escapeHTML(opt.name)}</option>`;
          });

          // 初期値セット
          if (!filter.value || !statusOptions.some(o => o.id === filter.value || o.name === filter.value)) {
            filter.value = statusOptions[0].name;
          }

          select.addEventListener('change', () => {
            filter.value = select.value;
          });

          valContainer.appendChild(select);
        } else if (col.type === 'select') {
          // 検索機能付きのカスタムドロップダウン
          const searchWrapper = document.createElement('div');
          searchWrapper.style.position = 'relative';
          searchWrapper.style.width = '100%';

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'db-filter-val-input'; // フィルター用のテキストインプットと同じスタイル
          input.style.width = '100%';
          input.placeholder = 'タグを検索...';

          const tagOptions = col.options || [];
          // 現在値の表示名を取得
          const getOptName = (val) => {
            const found = tagOptions.find(o => (typeof o === 'string' ? o : (o.id || o.name)) === val);
            return found ? (typeof found === 'string' ? found : found.name) : val;
          };
          input.value = getOptName(filter.value || '');

          // ドロップダウンリストの作成
          const list = document.createElement('div');
          list.style = 'position: absolute; left: 0; right: 0; top: 100%; max-height: 150px; overflow-y: auto; background: rgba(15, 20, 35, 0.98); border: 1px solid var(--border-light); border-radius: 4px; z-index: 10000; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5); padding: 4px; flex-direction: column; gap: 2px;';

          // リストの項目を生成
          const renderListItems = (query = '') => {
            list.innerHTML = '';
            const filtered = tagOptions.filter(o => {
              const name = typeof o === 'string' ? o : o.name;
              return name.toLowerCase().includes(query.toLowerCase());
            });

            if (filtered.length === 0) {
              const empty = document.createElement('div');
              empty.style = 'font-size: 11px; color: var(--text-muted); padding: 6px; text-align: center;';
              empty.textContent = '見つかりません';
              list.appendChild(empty);
              return;
            }

            filtered.forEach(opt => {
              const optId = typeof opt === 'string' ? opt : (opt.id || opt.name);
              const optName = typeof opt === 'string' ? opt : opt.name;
              const color = typeof opt === 'string' ? 'gray' : (opt.color || 'gray');

              const item = document.createElement('div');
              item.className = 'db-popover-item';
              item.style = 'padding: 4px 6px; display: flex; align-items: center; border-radius: 4px; cursor: pointer;';
              item.innerHTML = `<span class="db-select-badge db-tag-${color}">${escapeHTML(optName)}</span>`;

              item.addEventListener('mousedown', (evt) => {
                evt.preventDefault(); // blurでの即閉じを防ぐ
                input.value = optName;
                filter.value = optId;
                list.style.display = 'none';
                popover.remove(); // 決定と同時にポップオーバーを閉じる
                saveNotesToStorage();
                renderEditor();
              });
              list.appendChild(item);
            });
          };

          input.addEventListener('focus', () => {
            renderListItems(input.value);
            list.style.display = 'flex';
          });

          input.addEventListener('blur', () => {
            setTimeout(() => {
              list.style.display = 'none';
              // 未選択や一致しない値の時のフォールバック
              const found = tagOptions.find(o => {
                const name = typeof o === 'string' ? o : o.name;
                return name.toLowerCase() === input.value.trim().toLowerCase();
              });
              if (found) {
                const optId = typeof found === 'string' ? found : (found.id || found.name);
                const optName = typeof found === 'string' ? found : found.name;
                input.value = optName;
                filter.value = optId;
              } else {
                input.value = getOptName(filter.value || '');
              }
              saveNotesToStorage();
              renderEditor();
            }, 150);
          });

          input.addEventListener('input', () => {
            renderListItems(input.value);
          });

          searchWrapper.appendChild(input);
          searchWrapper.appendChild(list);
          valContainer.appendChild(searchWrapper);
        } else if (col.type === 'checkbox') {
          // チェックボックス用のON / OFFセレクト
          const select = document.createElement('select');
          select.className = 'db-filter-val-select';
          select.style.width = '100%';

          const isCheckOn = filter.value === 'ON' || filter.value === 'true' || filter.value === true;

          select.innerHTML = `
            <option value="ON" ${isCheckOn ? 'selected' : ''}>ON (チェックあり)</option>
            <option value="OFF" ${!isCheckOn ? 'selected' : ''}>OFF (チェックなし)</option>
          `;

          if (filter.value === undefined || filter.value === '') {
            filter.value = 'ON';
          }

          select.addEventListener('change', () => {
            filter.value = select.value;
          });

          valContainer.appendChild(select);
        } else if (col.type === 'date') {
          // 日付用の期間指定（今週、今月、今年、全期間）セレクト
          const select = document.createElement('select');
          select.className = 'db-filter-val-select';
          select.style.width = '100%';

          const optVal = filter.value || '全期間';
          select.innerHTML = `
            <option value="全期間" ${optVal === '全期間' ? 'selected' : ''}>全期間</option>
            <option value="今週" ${optVal === '今週' ? 'selected' : ''}>今週</option>
            <option value="今月" ${optVal === '今月' ? 'selected' : ''}>今月</option>
            <option value="今年" ${optVal === '今年' ? 'selected' : ''}>今年</option>
          `;

          if (filter.value === undefined || filter.value === '') {
            filter.value = '全期間';
          }

          select.addEventListener('change', () => {
            filter.value = select.value;
          });

          valContainer.appendChild(select);
        } else {
          // テキスト等の場合は通常入力
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'db-filter-val-input';
          input.style.width = '100%';
          input.value = filter.value || '';
          input.placeholder = '値・キーワード';

          input.addEventListener('input', () => {
            filter.value = input.value.trim();
          });

          valContainer.appendChild(input);
        }
      };

      // 初回レンダリング
      renderValControl(filter.columnId);
      row.appendChild(valContainer);

      // 列選択が変更されたら値コントロールを切り替えて初期化
      colSelect.addEventListener('change', () => {
        filter.columnId = colSelect.value;
        filter.value = ''; // 値リセット
        renderValControl(colSelect.value);

        // セレクトタグ列が選択された場合、入力欄に自動フォーカスしてリストを展開する
        const targetCol = columns.find(c => c.id === colSelect.value);
        if (targetCol && targetCol.type === 'select') {
          const input = valContainer.querySelector('.db-filter-val-input');
          if (input) {
            setTimeout(() => {
              input.focus();
            }, 50);
          }
        }
      });

      // 3. 個別削除ボタン
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-filter';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      delBtn.title = 'この条件を削除';
      delBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        view.filters.splice(idx, 1);
        showFilterConfigPopover(e, block, view); // ポップアップ再描画（更新）
      });

      row.appendChild(delBtn);
      listContainer.appendChild(row);
    });
  }

  popover.appendChild(listContainer);

  // 4. 追加 ＆ アクションボタン
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-filter';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> フィルター条件を追加';
  addBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const defaultCol = columns[0] ? columns[0].id : '';
    view.filters.push({
      id: 'f-' + generateId(),
      columnId: defaultCol,
      value: ''
    });
    showFilterConfigPopover(e, block, view); // リロード
  });
  popover.appendChild(addBtn);

  const divider = document.createElement('div');
  divider.className = 'db-popover-divider';
  divider.style.margin = '10px 0 6px 0';
  popover.appendChild(divider);

  // 適用決定ボタン
  const applyBtn = document.createElement('button');
  applyBtn.className = 'db-filter-apply-btn';
  applyBtn.textContent = 'フィルターを適用';
  applyBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });
  popover.appendChild(applyBtn);

  // すべてクリアの機能紐付け
  const clearAllBtn = popover.querySelector('#btn-clear-all');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      view.filters = [];
      showFilterConfigPopover(e, block, view); // ポップアップ更新
    });
  }

  document.body.appendChild(popover);
}

function showColumnConfigPopover(e, block, col) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-col-popover';

  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  const views = block.properties.views;
  const activeViewId = block.properties.activeViewId || views[0].id;
  const activeView = views.find(v => v.id === activeViewId) || views[0];
  activeView.sorts = activeView.sorts || [];

  const currentSort = activeView.sorts.find(s => s.columnId === col.id);
  const isAsc = currentSort && currentSort.direction === 'asc';
  const isDesc = currentSort && currentSort.direction === 'desc';

  popover.innerHTML = `
    <div style="font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;">並べ替え</div>
    <div class="db-popover-item ${isAsc ? 'active' : ''}" id="btn-sort-asc"><i class="fa-solid fa-arrow-up-1-9" style="width:14px;"></i>昇順で並べ替え</div>
    <div class="db-popover-item ${isDesc ? 'active' : ''}" id="btn-sort-desc"><i class="fa-solid fa-arrow-down-9-1" style="width:14px;"></i>降順で並べ替え</div>
    ${currentSort ? '<div class="db-popover-item" id="btn-sort-clear" style="color:var(--text-muted);"><i class="fa-solid fa-xmark" style="width:14px;"></i>並べ替えをクリア</div>' : ''}
    <div class="db-popover-divider"></div>
    <div style="font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;">列の設定</div>
    <input type="text" class="db-popover-input" value="${escapeHTML(col.name)}" placeholder="プロパティ名">
    <div class="db-popover-divider"></div>
    <div style="font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;">タイプ</div>
    <div class="db-popover-item ${col.type === 'text' ? 'active' : ''}" data-type="text"><i class="fa-regular fa-file-lines" style="width:14px;"></i>テキスト</div>
    <div class="db-popover-item ${col.type === 'number' ? 'active' : ''}" data-type="number"><i class="fa-solid fa-hashtag" style="width:14px;"></i>数値</div>
    <div class="db-popover-item ${col.type === 'select' ? 'active' : ''}" data-type="select"><i class="fa-solid fa-list-ul" style="width:14px;"></i>セレクトタグ</div>
    <div class="db-popover-item ${col.type === 'status' ? 'active' : ''}" data-type="status"><i class="fa-solid fa-circle-check" style="width:14px;"></i>ステータス</div>
    <div class="db-popover-item ${col.type === 'date' ? 'active' : ''}" data-type="date"><i class="fa-regular fa-calendar" style="width:14px;"></i>日付</div>
    <div class="db-popover-item ${col.type === 'checkbox' ? 'active' : ''}" data-type="checkbox"><i class="fa-regular fa-square-check" style="width:14px;"></i>チェックボックス</div>
    <div class="db-popover-divider"></div>
    <div class="db-popover-item" style="color:var(--text-primary);" id="btn-dup-col"><i class="fa-solid fa-copy" style="width:14px; color:var(--accent-primary);"></i>列を複製</div>
    <div class="db-popover-divider"></div>
    <div class="db-popover-item" style="color:var(--accent-secondary);" id="btn-del-col"><i class="fa-solid fa-trash-can" style="width:14px;"></i>列を削除</div>
  `;

  const btnSortAsc = popover.querySelector('#btn-sort-asc');
  btnSortAsc.addEventListener('click', (evt) => {
    evt.stopPropagation();
    activeView.sorts = [{ columnId: col.id, direction: 'asc' }];
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  const btnSortDesc = popover.querySelector('#btn-sort-desc');
  btnSortDesc.addEventListener('click', (evt) => {
    evt.stopPropagation();
    activeView.sorts = [{ columnId: col.id, direction: 'desc' }];
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  const btnSortClear = popover.querySelector('#btn-sort-clear');
  if (btnSortClear) {
    btnSortClear.addEventListener('click', (evt) => {
      evt.stopPropagation();
      activeView.sorts = activeView.sorts.filter(s => s.columnId !== col.id);
      popover.remove();
      saveNotesToStorage();
      renderEditor();
    });
  }

  const input = popover.querySelector('.db-popover-input');
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (val && val !== col.name) {
      col.name = val;
      saveNotesToStorage();
      renderEditor();
    }
  });
  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      input.blur();
    }
  });

  const items = popover.querySelectorAll('.db-popover-item[data-type]');
  items.forEach(item => {
    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const newType = item.getAttribute('data-type');
      if (newType !== col.type) {
        // タイプ別デフォルト名辞書
        const defaultNames = {
          'text': 'テキスト',
          'number': '数値',
          'select': 'セレクトタグ',
          'status': 'ステータス',
          'date': '日付',
          'checkbox': 'チェックボックス'
        };

        const defaultNameList = ['プロパティ', 'テキスト', '数値', 'セレクトタグ', 'セレクト', 'ステータス', '日付', 'チェックボックス', ''];

        // 現在の名前がデフォルト名であれば新しいタイプ名に自動設定（すでに独自名なら無視）
        const currentName = col.name ? col.name.trim() : '';
        if (defaultNameList.includes(currentName)) {
          col.name = defaultNames[newType] || 'プロパティ';
        }

        col.type = newType;

        block.properties.rows.forEach(row => {
          if (newType === 'status') {
            row[col.id] = 'opt-todo';
          }
          else if (newType === 'checkbox') row[col.id] = false;
          else if (newType === 'number') {
            const parsed = parseFloat(row[col.id]);
            row[col.id] = isNaN(parsed) ? '' : parsed;
          } else row[col.id] = String(row[col.id] || '');
        });

        if (newType === 'status' && !col.options) {
          col.options = [
            { id: 'opt-todo', name: '未着手', color: 'gray' },
            { id: 'opt-progress', name: '進行中', color: 'blue' },
            { id: 'opt-complete', name: '完了', color: 'green' }
          ];
        }

        col.calc = undefined;
        popover.remove();
        saveNotesToStorage();
        renderEditor();
      }
    });
  });

  // 数値または日付タイプの場合の詳細設定UIを注入
  if (col.type === 'number' || col.type === 'date') {
    const detailDiv = document.createElement('div');
    detailDiv.style = 'padding: 6px; border-top: 1px solid var(--border-light); display: flex; flex-direction: column; gap: 4px;';

    if (col.type === 'number') {
      col.numberFormat = col.numberFormat || 'plain';
      detailDiv.innerHTML = `
        <label style="font-size:9px; color:var(--text-muted); font-weight:700; display:block; margin-bottom:2px;">数値の表示形式</label>
        <select id="col-num-format-select" class="db-filter-val-select" style="width:100%;">
          <option value="plain" ${col.numberFormat === 'plain' ? 'selected' : ''}>平文 (標準)</option>
          <option value="currency" ${col.numberFormat === 'currency' ? 'selected' : ''}>通貨 (¥値段)</option>
          <option value="percent" ${col.numberFormat === 'percent' ? 'selected' : ''}>パーセント (%)</option>
          <option value="progress" ${col.numberFormat === 'progress' ? 'selected' : ''}>進捗バー (読了率など)</option>
          <option value="custom" ${col.numberFormat === 'custom' ? 'selected' : ''}>カスタム単位</option>
        </select>
        <input type="text" id="col-custom-unit-input" class="db-popover-input" style="width:100%; margin-top:4px; display: ${col.numberFormat === 'custom' ? 'block' : 'none'}; font-size:10px; padding:2px 4px;" value="${escapeHTML(col.customUnit || '')}" placeholder="単位 (例: 円, 個)">
      `;

      const formatSelect = detailDiv.querySelector('#col-num-format-select');
      const customUnitInput = detailDiv.querySelector('#col-custom-unit-input');

      formatSelect.addEventListener('change', (evt) => {
        evt.stopPropagation();
        col.numberFormat = formatSelect.value;
        customUnitInput.style.display = formatSelect.value === 'custom' ? 'block' : 'none';
        saveNotesToStorage();
        renderEditor();
      });

      customUnitInput.addEventListener('change', (evt) => {
        evt.stopPropagation();
        col.customUnit = customUnitInput.value.trim();
        saveNotesToStorage();
        renderEditor();
      });
    }

    if (col.type === 'date') {
      col.dateDisplayMode = col.dateDisplayMode || 'date';
      detailDiv.innerHTML = `
        <label style="font-size:9px; color:var(--text-muted); font-weight:700; display:block; margin-bottom:2px;">日付の表示モード</label>
        <select id="col-date-mode-select" class="db-filter-val-select" style="width:100%;">
          <option value="date" ${col.dateDisplayMode === 'date' ? 'selected' : ''}>通常日付 (標準)</option>
          <option value="duration-days" ${col.dateDisplayMode === 'duration-days' ? 'selected' : ''}>経過日数 (〇〇日間)</option>
          <option value="remaining-days" ${col.dateDisplayMode === 'remaining-days' ? 'selected' : ''}>残り日数/期限</option>
        </select>
      `;

      const modeSelect = detailDiv.querySelector('#col-date-mode-select');
      modeSelect.addEventListener('change', (evt) => {
        evt.stopPropagation();
        col.dateDisplayMode = modeSelect.value;
        saveNotesToStorage();
        renderEditor();
      });
    }

    // タイプ一覧の直前に挿入する
    const delBtn = popover.querySelector('#btn-del-col');
    popover.insertBefore(detailDiv, delBtn.previousElementSibling.previousElementSibling);
  }

  popover.querySelector('#btn-dup-col').addEventListener('click', (evt) => {
    evt.stopPropagation();
    popover.remove();

    // 履歴スタックに現在の状態をプッシュ（Ctrl+Z対応）
    pushHistory();

    const newColId = 'col-' + generateId();

    // 元の列のプロパティ定義をディープコピーして新しいIDと名前を設定
    const newCol = JSON.parse(JSON.stringify(col));
    newCol.id = newColId;
    newCol.name = col.name;

    // 元の列のインデックスを取得
    const colIndex = block.properties.columns.findIndex(c => c.id === col.id);
    if (colIndex !== -1) {
      // 右隣に挿入
      block.properties.columns.splice(colIndex + 1, 0, newCol);
    } else {
      block.properties.columns.push(newCol);
    }

    // 全ての行のデータ値をコピー
    block.properties.rows.forEach(row => {
      if (row[col.id] !== undefined) {
        row[newColId] = JSON.parse(JSON.stringify(row[col.id]));
      } else {
        if (newCol.type === 'status') row[newColId] = 'opt-todo';
        else if (newCol.type === 'checkbox') row[newColId] = false;
        else row[newColId] = '';
      }
    });

    saveNotesToStorage();
    renderEditor();
  });

  popover.querySelector('#btn-del-col').addEventListener('click', (evt) => {
    evt.stopPropagation();
    popover.remove();
    deleteDbColumn(block, col.id);
  });

  document.body.appendChild(popover);
  setTimeout(() => input.focus(), 50);
}

function deleteDbColumn(block, colId) {
  if (confirm('この列を削除すると、列内のすべてのデータが完全に削除されます。よろしいですか？')) {
    // 履歴スタックに現在の状態をプッシュ（Ctrl+Z対応）
    pushHistory();

    block.properties.columns = block.properties.columns.filter(c => c.id !== colId);
    block.properties.rows.forEach(row => {
      delete row[colId];
    });

    // 各ビューの設定と連動（カレンダー表示設定、フィルター、ソート、グラフ等から自動クリーンアップ）
    if (block.properties.views) {
      block.properties.views.forEach(v => {
        // カレンダーの追加表示プロパティから削除
        if (v.calColIds) {
          v.calColIds = v.calColIds.filter(id => id !== colId);
        }
        // フィルターから削除
        if (v.filters) {
          v.filters = v.filters.filter(f => f.columnId !== colId);
        }
        // ソートから削除
        if (v.sorts) {
          v.sorts = v.sorts.filter(s => s.columnId !== colId);
        }
        // グラフ設定から自動クリア
        if (v.chartXColId === colId) v.chartXColId = null;
        if (v.chartYColId === colId || (v.chartYColId && v.chartYColId.startsWith(colId + '-'))) {
          v.chartYColId = null;
        }
      });
    }

    saveNotesToStorage();
    renderEditor();
  }
}

// ----------------------------------------------------
// DYNAMIC DELETE CONFIRM POPOVER & COLOR PALETTE POPOVER HELPERS
// ----------------------------------------------------
export function showDeleteConfirmPopover(e, message, onConfirm) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover delete-confirm-popover';
  popover.style.left = `${e.clientX - 60}px`;
  popover.style.top = `${e.clientY + 12}px`;
  popover.style.padding = '8px 12px';
  popover.style.width = '180px';
  popover.style.zIndex = '99999';

  popover.innerHTML = `
    <div style="font-size: 11px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; text-align: center;">${message}</div>
    <div style="display: flex; gap: 6px; justify-content: center;">
      <button class="btn-popover-delete-yes" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">削除</button>
      <button class="btn-popover-delete-no" style="background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-light); color: var(--text-secondary); font-size: 10px; padding: 3px 8px; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">キャンセル</button>
    </div>
  `;

  popover.querySelector('.btn-popover-delete-yes').addEventListener('click', (evt) => {
    evt.stopPropagation();
    onConfirm();
    popover.remove();
  });

  popover.querySelector('.btn-popover-delete-no').addEventListener('click', (evt) => {
    evt.stopPropagation();
    popover.remove();
  });

  document.body.appendChild(popover);
}

function showColorPalettePopover(e, onColorSelected) {
  const existingPalettes = document.querySelectorAll('.db-color-palette-popover');
  existingPalettes.forEach(p => p.remove());

  const palette = document.createElement('div');
  palette.className = 'db-floating-popover db-color-palette-popover';
  palette.style.left = `${e.clientX - 40}px`;
  palette.style.top = `${e.clientY + 12}px`;
  palette.style.padding = '6px';
  palette.style.display = 'flex';
  palette.style.gap = '6px';
  palette.style.zIndex = '999999';

  const colors = ['gray', 'red', 'blue', 'green', 'yellow', 'purple', 'pink'];
  colors.forEach(colName => {
    const dot = document.createElement('span');
    dot.style = `display:inline-block; width:12px; height:12px; border-radius:50%; background:var(--accent-${colName}); cursor:pointer; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 0 4px var(--accent-${colName}); transition: transform 0.15s ease;`;
    dot.title = colName;
    dot.addEventListener('mouseenter', () => dot.style.transform = 'scale(1.2)');
    dot.addEventListener('mouseleave', () => dot.style.transform = 'scale(1)');
    dot.addEventListener('click', (evt) => {
      evt.stopPropagation();
      onColorSelected(colName);
      palette.remove();
    });
    palette.appendChild(dot);
  });

  document.body.appendChild(palette);

  const closePalette = () => {
    palette.remove();
    document.removeEventListener('click', closePalette);
  };
  setTimeout(() => {
    document.addEventListener('click', closePalette);
  }, 100);
}

// ----------------------------------------------------
// STATUS PROPERTIES SELECT & MANAGEMENT POPOVER
// ----------------------------------------------------
function showStatusSelectPopover(e, block, rowIndex, colId) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-col-popover'; // 設定が多いため少し幅広にする
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  const col = block.properties.columns.find(c => c.id === colId);
  const statusOptions = col.options || [
    { id: 'opt-todo', name: '未着手', color: 'gray' },
    { id: 'opt-progress', name: '進行中', color: 'blue' },
    { id: 'opt-complete', name: '完了', color: 'green' }
  ];

  const currentVal = block.properties.rows[rowIndex][colId] || statusOptions[0].id;

  // 1. 選択肢リスト
  const listTitle = document.createElement('div');
  listTitle.style = 'font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;';
  listTitle.textContent = 'ステータスを変更';
  popover.appendChild(listTitle);

  statusOptions.forEach(opt => {
    const item = document.createElement('div');
    item.className = `db-popover-item ${currentVal === opt.id || currentVal === opt.name ? 'active' : ''}`;
    item.innerHTML = `<span class="db-select-badge db-tag-${opt.color || 'gray'}">${escapeHTML(opt.name)}</span>`;

    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      block.properties.rows[rowIndex][colId] = opt.id;
      popover.remove();
      saveNotesToStorage();
      renderEditor();
    });
    popover.appendChild(item);
  });

  const divider = document.createElement('div');
  divider.className = 'db-popover-divider';
  popover.appendChild(divider);

  // 2. ステータス自体をカスタム管理・並び替えするセクション
  const configTitle = document.createElement('div');
  configTitle.style = 'font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;';
  configTitle.textContent = 'ステータスの管理（ドラッグして並べ替え）';
  popover.appendChild(configTitle);

  // Sortableでドラッグ可能にするためのコンテナ
  const configContainer = document.createElement('div');
  configContainer.className = 'db-status-config-container';
  popover.appendChild(configContainer);

  statusOptions.forEach((opt, optIdx) => {
    const row = document.createElement('div');
    row.className = 'db-status-config-row';
    row.setAttribute('data-id', opt.id); // IDを記録しておく

    // ドラッグ用ハンドル
    const dragHandle = document.createElement('span');
    dragHandle.className = 'db-status-drag-handle';
    dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
    dragHandle.style = 'cursor: grab; color: var(--text-muted); margin-right: 4px; font-size: 11px; display: flex; align-items: center;';
    row.appendChild(dragHandle);

    // カラー選択ドット
    const colorDot = document.createElement('span');
    colorDot.style = `display:inline-block; width:10px; height:10px; border-radius:50%; background:var(--accent-${opt.color || 'muted'}); cursor:pointer; flex-shrink: 0; margin-right: 4px;`;
    colorDot.title = '色を変更';
    colorDot.addEventListener('click', (evt) => {
      evt.stopPropagation();
      showColorPalettePopover(evt, (selectedColor) => {
        opt.color = selectedColor;
        saveNotesToStorage();
        renderEditor();
        showStatusSelectPopover(e, block, rowIndex, colId); // リロード
      });
    });
    row.appendChild(colorDot);

    // 名前変更インプット
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'db-status-config-input';
    nameInput.value = opt.name;
    nameInput.style = 'flex: 1; min-width: 60px;';

    nameInput.addEventListener('blur', () => {
      const val = nameInput.value.trim();
      if (val && val !== opt.name) {
        opt.name = val;
        saveNotesToStorage();
        renderEditor();
      }
    });
    nameInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        nameInput.blur();
      }
    });

    row.appendChild(nameInput);

    // 削除ボタン（最低1つは必要）
    if (statusOptions.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-status-ctrl';
      delBtn.style.color = 'var(--accent-secondary)';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      delBtn.title = '削除';
      delBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        showDeleteConfirmPopover(evt, `ステータス「${opt.name}」を削除しますか？`, () => {
          col.options = statusOptions.filter(o => o.id !== opt.id);

          // 行側の参照を最初のステータスに切り替え
          block.properties.rows.forEach(r => {
            if (r[colId] === opt.id || r[colId] === opt.name) {
              r[colId] = col.options[0].id;
            }
          });

          saveNotesToStorage();
          renderEditor();
          showStatusSelectPopover(e, block, rowIndex, colId); // リロード
        });
      });
      row.appendChild(delBtn);
    }

    configContainer.appendChild(row);
  });

  // Sortable.js の初期化
  setTimeout(() => {
    Sortable.create(configContainer, {
      animation: 150,
      handle: '.db-status-drag-handle',
      onEnd: () => {
        // 並び替えた後のDOMの順番から新しいオプション配列を構築
        const newOptions = [];
        const rows = configContainer.querySelectorAll('.db-status-config-row');
        rows.forEach(r => {
          const optId = r.getAttribute('data-id');
          const foundOpt = statusOptions.find(o => o.id === optId);
          if (foundOpt) newOptions.push(foundOpt);
        });

        col.options = newOptions;
        saveNotesToStorage();
        renderEditor();
        showStatusSelectPopover(e, block, rowIndex, colId); // リロード
      }
    });
  }, 50);

  // 3. 新規ステータスの追加インプット
  const addDivider = document.createElement('div');
  addDivider.className = 'db-popover-divider';
  popover.appendChild(addDivider);

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'db-popover-input';
  addInput.placeholder = '+ 新規ステータスを追加...';

  addInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      evt.stopPropagation();
      const val = addInput.value.trim();
      if (val) {
        const colors = ['gray', 'red', 'blue', 'green', 'yellow', 'purple', 'pink'];
        const newId = 'opt-' + generateId();
        statusOptions.push({
          id: newId,
          name: val,
          color: colors[statusOptions.length % colors.length]
        });
        col.options = statusOptions;

        saveNotesToStorage();
        renderEditor();
        showStatusSelectPopover(e, block, rowIndex, colId); // ポップアップリロード
      }
    }
  });
  popover.appendChild(addInput);

  document.body.appendChild(popover);
}

function showSelectTagPopover(e, block, rowIndex, colId, options) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-col-popover'; // 幅広にする
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  const col = block.properties.columns.find(c => c.id === colId);
  const currentVal = block.properties.rows[rowIndex][colId] || '';

  // optionsを { id, name, color } のオブジェクト構造に正規化・自動変換
  let tagOptions = [];
  if (col) {
    if (!col.options) col.options = [];
    const seen = new Set();
    const uniqueOptions = [];
    col.options.forEach(opt => {
      let optObj = opt;
      if (typeof opt === 'string') {
        optObj = { id: opt, name: opt, color: getTagHashColor(opt) };
      }
      const normName = (optObj.name || '').trim().toLowerCase();
      if (normName && !seen.has(normName)) {
        seen.add(normName);
        uniqueOptions.push(optObj);
      }
    });
    col.options = uniqueOptions;
    tagOptions = col.options;
  }

  // 1. 検索＆新規作成インプット
  const searchWrapper = document.createElement('div');
  searchWrapper.style = 'padding: 6px; display: flex; flex-direction: column; gap: 4px;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'db-popover-input';
  searchInput.placeholder = 'タグを検索または新規作成...';
  searchInput.style.width = '100%';
  searchWrapper.appendChild(searchInput);
  popover.appendChild(searchWrapper);

  // 選択肢リストのスクロールコンテナ
  const optionsList = document.createElement('div');
  optionsList.className = 'db-popover-options-list';
  optionsList.style = 'max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;';
  popover.appendChild(optionsList);

  // 選択なし（クリア）オプション
  const noneItem = document.createElement('div');
  noneItem.className = `db-popover-item ${!currentVal ? 'active' : ''}`;
  noneItem.innerHTML = `<span class="db-select-badge db-tag-gray" style="opacity:0.6; font-style:italic;">選択なし (クリア)</span>`;
  noneItem.addEventListener('click', (evt) => {
    evt.stopPropagation();
    block.properties.rows[rowIndex][colId] = '';
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });
  optionsList.appendChild(noneItem);

  // 既存タグの生成
  const items = [];
  tagOptions.forEach(opt => {
    const item = document.createElement('div');
    const isAct = currentVal === opt.id || currentVal === opt.name;
    item.className = `db-popover-item ${isAct ? 'active' : ''}`;
    item.innerHTML = `<span class="db-select-badge db-tag-${opt.color || 'gray'}">${escapeHTML(opt.name)}</span>`;

    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      block.properties.rows[rowIndex][colId] = opt.name;
      popover.remove();
      saveNotesToStorage();
      renderEditor();
    });
    optionsList.appendChild(item);
    items.push({ el: item, name: opt.name.toLowerCase(), opt });
  });

  // 「新規作成」表示用のダミー項目
  const createNewItem = document.createElement('div');
  createNewItem.className = 'db-popover-item';
  createNewItem.style.display = 'none';
  optionsList.appendChild(createNewItem);

  // 検索・絞り込みロジック
  const updateSearch = () => {
    const q = searchInput.value.trim().toLowerCase();
    let exactMatch = false;

    items.forEach(item => {
      if (!q) {
        item.el.style.display = '';
      } else if (item.name.includes(q)) {
        item.el.style.display = '';
        if (item.name === q) exactMatch = true;
      } else {
        item.el.style.display = 'none';
      }
    });

    if (q) {
      noneItem.style.display = 'none';
      if (!exactMatch) {
        createNewItem.style.display = '';
        createNewItem.innerHTML = `<span style="font-size: 11px; color: var(--accent-primary); font-weight: 500;"><i class="fa-solid fa-plus" style="margin-right: 4px;"></i>「${escapeHTML(searchInput.value.trim())}」を作成する</span>`;
      } else {
        createNewItem.style.display = 'none';
      }
    } else {
      noneItem.style.display = '';
      createNewItem.style.display = 'none';
    }
  };

  searchInput.addEventListener('input', updateSearch);

  // Enterキーで選択または新規作成
  searchInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      evt.stopPropagation();
      const val = searchInput.value.trim();
      if (!val) return;

      let found = tagOptions.find(o => o.name.toLowerCase() === val.toLowerCase() || o.id.toLowerCase() === val.toLowerCase());
      if (!found) {
        found = { id: val, name: val, color: getTagHashColor(val) };
        tagOptions.push(found);
        col.options = tagOptions;
      }
      block.properties.rows[rowIndex][colId] = found.name;
      popover.remove();
      saveNotesToStorage();
      renderEditor();
    }
  });

  // 「新規作成」項目のクリック処理
  createNewItem.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const val = searchInput.value.trim();
    if (val) {
      const found = { id: val, name: val, color: getTagHashColor(val) };
      tagOptions.push(found);
      col.options = tagOptions;
      block.properties.rows[rowIndex][colId] = found.name;
      popover.remove();
      saveNotesToStorage();
      renderEditor();
    }
  });

  const divider = document.createElement('div');
  divider.className = 'db-popover-divider';
  popover.appendChild(divider);

  // フォーカスを検索インプットに当てる
  setTimeout(() => {
    searchInput.focus();
  }, 50);

  // 3. タグ管理セクション (色変更・並べ替え)
  const configTitle = document.createElement('div');
  configTitle.style = 'font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px;';
  configTitle.textContent = 'タグの管理（ドラッグして並べ替え）';
  popover.appendChild(configTitle);

  const configContainer = document.createElement('div');
  configContainer.className = 'db-status-config-container';
  popover.appendChild(configContainer);

  tagOptions.forEach((opt, optIdx) => {
    const row = document.createElement('div');
    row.className = 'db-status-config-row';
    row.setAttribute('data-id', opt.id);

    // ハンドル
    const dragHandle = document.createElement('span');
    dragHandle.className = 'db-status-drag-handle';
    dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
    dragHandle.style = 'cursor: grab; color: var(--text-muted); margin-right: 4px; font-size: 11px; display: flex; align-items: center;';
    row.appendChild(dragHandle);

    // カラー選択ドット
    const colorDot = document.createElement('span');
    colorDot.style = `display:inline-block; width:10px; height:10px; border-radius:50%; background:var(--accent-${opt.color || 'muted'}); cursor:pointer; flex-shrink: 0; margin-right: 4px;`;
    colorDot.title = '色を変更';
    colorDot.addEventListener('click', (evt) => {
      evt.stopPropagation();
      showColorPalettePopover(evt, (selectedColor) => {
        opt.color = selectedColor;
        saveNotesToStorage();
        renderEditor();
        showSelectTagPopover(e, block, rowIndex, colId, tagOptions); // リロード
      });
    });
    row.appendChild(colorDot);

    // 名前編集インプット
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'db-status-config-input';
    nameInput.value = opt.name;
    nameInput.addEventListener('blur', () => {
      const val = nameInput.value.trim();
      if (val && val !== opt.name) {
        const oldName = opt.name;
        opt.name = val;
        opt.id = val; // IDも同期
        // 行側の参照値も更新
        block.properties.rows.forEach(r => {
          if (r[colId] === oldName) r[colId] = val;
        });
        saveNotesToStorage();
        renderEditor();
      }
    });
    nameInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        nameInput.blur();
      }
    });
    row.appendChild(nameInput);

    // 削除ボタン
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-status-ctrl';
    delBtn.style.color = 'var(--accent-secondary)';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.title = '削除';
    delBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      showDeleteConfirmPopover(evt, `タグ「${opt.name}」を削除しますか？`, () => {
        col.options = tagOptions.filter(o => o.id !== opt.id);
        block.properties.rows.forEach(r => {
          if (r[colId] === opt.name || r[colId] === opt.id) {
            r[colId] = '';
          }
        });
        saveNotesToStorage();
        renderEditor();
        showSelectTagPopover(e, block, rowIndex, colId, col.options); // リロード
      });
    });
    row.appendChild(delBtn);

    configContainer.appendChild(row);
  });

  popover.appendChild(configContainer);

  document.body.appendChild(popover);

  // Sortable.js の初期化
  setTimeout(() => {
    Sortable.create(configContainer, {
      animation: 150,
      handle: '.db-status-drag-handle',
      onEnd: () => {
        const newOptions = [];
        const rows = configContainer.querySelectorAll('.db-status-config-row');
        rows.forEach(r => {
          const optId = r.getAttribute('data-id');
          const foundOpt = tagOptions.find(o => o.id === optId);
          if (foundOpt) newOptions.push(foundOpt);
        });
        col.options = newOptions;
        saveNotesToStorage();
      }
    });
    input.focus();
  }, 50);
}

function showCalcOptionsPopover(e, block, col, calcTd, rowDataList = null) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover';

  // フッターの上側にポップオーバーを表示させるための計算
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY - 140}px`;

  const type = col.type;
  const currentCalc = col.calc;

  const addOption = (label, calcVal) => {
    const item = document.createElement('div');
    item.className = `db-popover-item ${currentCalc === calcVal ? 'active' : ''}`;
    item.textContent = label;
    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      col.calc = calcVal;
      popover.remove();
      saveNotesToStorage();
      renderFooterCellContent(calcTd, block, col, rowDataList);
    });
    popover.appendChild(item);
  };

  addOption('計算なし', 'none');
  addOption('行数をカウント', 'count');

  if (type === 'number') {
    addOption('合計 (Sum)', 'sum');
    addOption('平均 (Average)', 'avg');
    addOption('最大値 (Max)', 'max');
    addOption('最小値 (Min)', 'min');
  } else if (type === 'status') {
    addOption('完了率 (Complete %)', 'percent');
  } else if (type === 'date') {
    addOption('最新の日付', 'latest');
    addOption('最古の日付', 'earliest');
  }

  document.body.appendChild(popover);
}

// ドキュメント全体をクリックしたときにフローティングメニューを閉じる
document.addEventListener('click', (e) => {
  if (!e.target.closest('.db-floating-popover')) {
    const popovers = document.querySelectorAll('.db-floating-popover');
    popovers.forEach(p => p.remove());
  }
});

// ==========================================
// 14. HIERARCHICAL FOLDERS & DRAG-DROP PATH PREVIEW
// ==========================================

function createNoteInFolder(folderId) {
  const newNote = {
    id: 'note-' + generateId(),
    title: '新規ノート',
    folderId: folderId,
    updatedAt: Date.now(),
    isTemplate: false,
    blocks: [
      { id: generateId(), type: 'p', content: '' }
    ]
  };
  state.notes.push(newNote);
  saveNotesToStorage();
  navigateToNote(newNote.id);

  // フォルダを展開
  state.collapsedFolders = state.collapsedFolders.filter(id => id !== folderId);
  localStorage.setItem('notidian_collapsed_folders', JSON.stringify(state.collapsedFolders));
  renderNoteList();

  setTimeout(() => {
    noteTitleInput.focus();
    noteTitleInput.select();
  }, 100);
}

function deleteFolder(folderId, e) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;

  showDeleteConfirmPopover(e, `フォルダ「${folder.name}」を削除しますか？`, () => {
    state.folders.forEach(f => {
      if (f.parentId === folderId) f.parentId = null;
    });

    // 【重要】フォルダ削除時、その中に属していたノートも連動して完全にデータベースから削除する！
    state.notes = state.notes.filter(n => n.folderId !== folderId);

    state.folders = state.folders.filter(f => f.id !== folderId);
    state.collapsedFolders = state.collapsedFolders.filter(id => id !== folderId);

    saveNotesToStorage();
    renderNoteList();
    renderEditor();
  });
}

function getFolderPathString(folderId) {
  const path = [];
  let currentId = folderId;
  let safety = 0;

  while (currentId && safety < 10) {
    const f = state.folders.find(x => x.id === currentId);
    if (f) {
      path.unshift(`📂${f.name}`);
      currentId = f.parentId;
    } else {
      break;
    }
    safety++;
  }

  return path.join(' / ');
}

function isFolderDescendant(parentFolderId, targetFolderId) {
  let currentId = targetFolderId;
  let safety = 0;

  while (currentId && safety < 10) {
    const f = state.folders.find(x => x.id === currentId);
    if (f) {
      if (f.parentId === parentFolderId) return true;
      currentId = f.parentId;
    } else {
      break;
    }
    safety++;
  }
  return false;
}

function showSidebarPathPreview(text) {
  // Deprecated - do nothing
}

function hideSidebarPathPreview() {
  // Deprecated - do nothing
}

function setupSidebarDragEvents(element, id, type) {
  element.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    state.draggedSidebarId = id;
    state.draggedSidebarType = type;
    element.classList.add('sidebar-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  element.addEventListener('dragend', () => {
    element.classList.remove('sidebar-dragging');
    state.draggedSidebarId = null;
    state.draggedSidebarType = null;
    state.dropTargetSidebarId = null;
    state.dropTargetSidebarType = null;
    state.sidebarDropLocation = null;
    hideSidebarPathPreview();
    document.querySelectorAll('.folder-header, .note-item').forEach(el => {
      el.classList.remove('dragover-active', 'dragover-inside', 'dragover-before', 'dragover-after');
    });
  });

  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // スマートフォルダ（お気に入り・未入力）へのドロップは完全に無効化・進入禁止
    if (element.getAttribute('data-smart-folder') || element.closest('[data-smart-folder]')) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    if (state.draggedSidebarId === id) return;
    if (state.draggedSidebarType === 'folder' && isFolderDescendant(state.draggedSidebarId, id)) return;

    // Y座標から「前（before）」「中（inside/folder限定）」「後（after）」を判定
    const rect = element.getBoundingClientRect();
    const yRatio = (e.clientY - rect.top) / rect.height;
    let dropLocation = 'inside';

    element.classList.remove('dragover-active', 'dragover-inside', 'dragover-before', 'dragover-after');

    if (type === 'folder') {
      if (yRatio < 0.25) {
        dropLocation = 'before';
        element.classList.add('dragover-before');
      } else if (yRatio > 0.75) {
        dropLocation = 'after';
        element.classList.add('dragover-after');
      } else {
        dropLocation = 'inside';
        element.classList.add('dragover-inside');
      }
    } else {
      if (yRatio < 0.5) {
        dropLocation = 'before';
        element.classList.add('dragover-before');
      } else {
        dropLocation = 'after';
        element.classList.add('dragover-after');
      }
    }

    state.dropTargetSidebarId = id;
    state.dropTargetSidebarType = type;
    state.sidebarDropLocation = dropLocation;

    if (type === 'folder' && dropLocation === 'inside') {
      const pathStr = getFolderPathString(id);
      showSidebarPathPreview(`格納先: ${pathStr}`);
    } else {
      const targetName = type === 'folder' ?
        (state.folders.find(f => f.id === id)?.name || '') :
        (state.notes.find(n => n.id === id)?.title || '');
      const actionText = dropLocation === 'before' ? 'の前' : 'の後';
      showSidebarPathPreview(`移動先: ${targetName} ${actionText}`);
    }
  });

  element.addEventListener('dragleave', () => {
    element.classList.remove('dragover-active', 'dragover-inside', 'dragover-before', 'dragover-after');
  });

  element.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideSidebarPathPreview();

    // スマートフォルダへのドロップは処理を完全に拒否して早期リターン
    if (element.getAttribute('data-smart-folder') || element.closest('[data-smart-folder]')) {
      return;
    }

    const draggedId = state.draggedSidebarId;
    const draggedType = state.draggedSidebarType;
    const targetId = state.dropTargetSidebarId;
    const targetType = state.dropTargetSidebarType;
    const dropLocation = state.sidebarDropLocation || 'inside';

    if (!draggedId) return;

    if (dropLocation === 'inside' && targetType === 'folder') {
      // フォルダ内に格納
      if (draggedType === 'note') {
        const note = state.notes.find(n => n.id === draggedId);
        if (note) {
          note.folderId = targetId;
          note.updatedAt = Date.now();
          // フォルダ内の他のノート・サブフォルダの sortIndex の最大値より大きい値にする
          const siblings = [
            ...state.notes.filter(n => n.folderId === targetId).map(n => n.sortIndex || 0),
            ...state.folders.filter(f => f.parentId === targetId).map(f => f.sortIndex || 0)
          ];
          const maxSort = siblings.length > 0 ? Math.max(...siblings) : Date.now();
          note.sortIndex = maxSort + 1000;
        }
      } else if (draggedType === 'folder') {
        const folder = state.folders.find(f => f.id === draggedId);
        if (folder) {
          folder.parentId = targetId;
          folder.updatedAt = Date.now();
          // フォルダ内の他のノート・サブフォルダの sortIndex の最大値より大きい値にする
          const siblings = [
            ...state.notes.filter(n => n.folderId === targetId).map(n => n.sortIndex || 0),
            ...state.folders.filter(f => f.parentId === targetId).map(f => f.sortIndex || 0)
          ];
          const maxSort = siblings.length > 0 ? Math.max(...siblings) : Date.now();
          folder.sortIndex = maxSort + 1000;
        }
      }
    } else if (dropLocation === 'before' || dropLocation === 'after') {
      // 直前または直後に並べ替え
      let targetParentId = null;
      if (targetType === 'note') {
        const targetNote = state.notes.find(n => n.id === targetId);
        if (targetNote) targetParentId = targetNote.folderId;
      } else if (targetType === 'folder') {
        const targetFolder = state.folders.find(f => f.id === targetId);
        if (targetFolder) targetParentId = targetFolder.parentId;
      }

      // 親を設定
      if (draggedType === 'note') {
        const note = state.notes.find(n => n.id === draggedId);
        if (note) {
          note.folderId = targetParentId;
          note.updatedAt = Date.now();
        }
      } else if (draggedType === 'folder') {
        const folder = state.folders.find(f => f.id === draggedId);
        if (folder) {
          folder.parentId = targetParentId;
          folder.updatedAt = Date.now();
        }
      }

      // 親フォルダ内の全要素リストを取得してソート
      const sameParentNotes = state.notes.filter(n => n.folderId === targetParentId);
      const sameParentFolders = state.folders.filter(f => f.parentId === targetParentId);
      const siblings = [
        ...sameParentNotes.map(n => ({ id: n.id, type: 'note', sortIndex: n.sortIndex || 0 })),
        ...sameParentFolders.map(f => ({ id: f.id, type: 'folder', sortIndex: f.sortIndex || 0 }))
      ];
      siblings.sort((a, b) => b.sortIndex - a.sortIndex);

      // ドラッグ中要素を除いたリストでのターゲット位置を見つける
      const filteredSiblings = siblings.filter(item => item.id !== draggedId);
      const targetIdx = filteredSiblings.findIndex(item => item.id === targetId);

      if (targetIdx !== -1) {
        let newSort = 0;
        if (dropLocation === 'before') {
          if (targetIdx === 0) {
            newSort = (filteredSiblings[0].sortIndex || 0) + 1000;
          } else {
            newSort = ((filteredSiblings[targetIdx - 1].sortIndex || 0) + (filteredSiblings[targetIdx].sortIndex || 0)) / 2;
          }
        } else if (dropLocation === 'after') {
          if (targetIdx === filteredSiblings.length - 1) {
            newSort = (filteredSiblings[targetIdx].sortIndex || 0) - 1000;
          } else {
            newSort = ((filteredSiblings[targetIdx].sortIndex || 0) + (filteredSiblings[targetIdx + 1].sortIndex || 0)) / 2;
          }
        }

        // 新しい sortIndex を割り当て
        if (draggedType === 'note') {
          const note = state.notes.find(n => n.id === draggedId);
          if (note) note.sortIndex = newSort;
        } else if (draggedType === 'folder') {
          const folder = state.folders.find(f => f.id === draggedId);
          if (folder) folder.sortIndex = newSort;
        }
      }
    }

    saveNotesToStorage();
    renderNoteList();
  });
}

function createFolderDOM(folder, normalNotes, depth) {
  const folderLi = document.createElement('li');
  folderLi.className = 'folder-item-wrapper';
  folderLi.setAttribute('data-folder-id', folder.id);
  folderLi.style.paddingLeft = `${depth * 12}px`;

  const isCollapsed = state.collapsedFolders.includes(folder.id);

  const folderHeader = document.createElement('div');
  folderHeader.className = `folder-header ${state.dropTargetSidebarId === folder.id ? 'dragover-active' : ''}`;
  folderHeader.setAttribute('draggable', 'true');

  const caret = document.createElement('i');
  caret.className = `fa-solid fa-caret-right caret-icon ${isCollapsed ? '' : 'open'}`;
  folderHeader.appendChild(caret);

  const folderIcon = document.createElement('i');
  folderIcon.className = `fa-regular ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} folder-icon`;
  folderHeader.appendChild(folderIcon);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'folder-name';
  nameSpan.textContent = folder.name;

  nameSpan.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-rename-input';
    input.value = folder.name;
    folderHeader.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    const saveName = () => {
      const val = input.value.trim();
      if (val) {
        folder.name = val;
        folder.updatedAt = Date.now();
        saveNotesToStorage();
        renderNoteList();
      } else {
        folderHeader.replaceChild(nameSpan, input);
      }
    };

    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') saveName();
      if (evt.key === 'Escape') folderHeader.replaceChild(nameSpan, input);
    });
  });

  folderHeader.appendChild(nameSpan);

  const actions = document.createElement('div');
  actions.className = 'folder-actions';

  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn-folder-action';
  renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  renameBtn.title = '名前を変更';
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-rename-input';
    input.value = folder.name;
    folderHeader.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    const saveName = () => {
      const val = input.value.trim();
      if (val) {
        folder.name = val;
        folder.updatedAt = Date.now();
        saveNotesToStorage();
        renderNoteList();
      } else {
        folderHeader.replaceChild(nameSpan, input);
      }
    };

    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') saveName();
      if (evt.key === 'Escape') folderHeader.replaceChild(nameSpan, input);
    });
  });
  actions.appendChild(renameBtn);

  const addNoteBtn = document.createElement('button');
  addNoteBtn.className = 'btn-folder-action';
  addNoteBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addNoteBtn.title = 'フォルダ内にノートを作成';
  addNoteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    createNoteInFolder(folder.id);
  });
  actions.appendChild(addNoteBtn);

  const delFolderBtn = document.createElement('button');
  delFolderBtn.className = 'btn-folder-action';
  delFolderBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
  delFolderBtn.title = 'フォルダを削除';
  delFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteFolder(folder.id, e);
  });
  actions.appendChild(delFolderBtn);

  folderHeader.appendChild(actions);
  folderLi.appendChild(folderHeader);

  folderHeader.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;

    if (isCollapsed) {
      state.collapsedFolders = state.collapsedFolders.filter(id => id !== folder.id);
    } else {
      state.collapsedFolders.push(folder.id);
    }
    localStorage.setItem('notidian_collapsed_folders', JSON.stringify(state.collapsedFolders));
    renderNoteList();
  });

  setupSidebarDragEvents(folderHeader, folder.id, 'folder');

  const childrenUl = document.createElement('ul');
  childrenUl.className = 'folder-children';
  if (isCollapsed) {
    childrenUl.style.display = 'none';
  } else {
    childrenUl.style.display = 'block';

    const subFolders = state.folders.filter(f => f.parentId === folder.id);
    const subNotes = normalNotes.filter(n => n.folderId === folder.id);

    const mixedList = [
      ...subFolders.map(f => ({ type: 'folder', data: f, sortIndex: f.sortIndex || 0 })),
      ...subNotes.map(n => ({ type: 'note', data: n, sortIndex: n.sortIndex || 0 }))
    ];

    mixedList.sort((a, b) => b.sortIndex - a.sortIndex);

    mixedList.forEach(item => {
      if (item.type === 'folder') {
        childrenUl.appendChild(createFolderDOM(item.data, normalNotes, depth + 1));
      } else {
        childrenUl.appendChild(createNoteDOM(item.data, depth + 1));
      }
    });
  }

  folderLi.appendChild(childrenUl);
  return folderLi;
}

function createNoteDOM(note, depth) {
  const li = document.createElement('li');
  li.className = `note-item ${note.id === state.activeNoteId ? 'active' : ''}`;
  li.setAttribute('draggable', 'true');
  li.style.paddingLeft = `${depth * 12 + 16}px`;

  // お気に入り状態に応じたクラスの付与
  const favStar = document.createElement('button');
  favStar.className = `btn-fav-star ${note.isFavorite ? 'active' : ''}`;
  favStar.innerHTML = `<i class="fa-${note.isFavorite ? 'solid' : 'regular'} fa-star"></i>`;
  favStar.title = note.isFavorite ? 'お気に入りから外す' : 'お気に入りに追加';

  favStar.addEventListener('click', (e) => {
    e.stopPropagation();
    note.isFavorite = !note.isFavorite;
    saveNotesToStorage();
    renderNoteList();
    renderEditor();
  });

  // 名称変更ペンボタン
  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn-rename-sidebar';
  renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  renameBtn.title = '名前を変更';
  renameBtn.style.background = 'none';
  renameBtn.style.border = 'none';
  renameBtn.style.cursor = 'pointer';
  renameBtn.style.opacity = '0';
  renameBtn.style.transition = 'opacity 0.15s ease';
  renameBtn.style.marginRight = '4px';
  renameBtn.style.fontSize = '10px';
  renameBtn.style.color = 'var(--text-muted, #6b7280)';

  // liにホバーしたときにペンボタンを表示させるためのスタイルをインライン追加
  li.addEventListener('mouseenter', () => {
    renameBtn.style.opacity = '0.7';
  });
  li.addEventListener('mouseleave', () => {
    renameBtn.style.opacity = '0';
  });
  renameBtn.addEventListener('mouseenter', () => {
    renameBtn.style.opacity = '1';
    renameBtn.style.color = 'var(--accent-primary)';
  });
  renameBtn.addEventListener('mouseleave', () => {
    renameBtn.style.opacity = '0.7';
    renameBtn.style.color = 'var(--text-muted)';
  });

  const icon = document.createElement('i');
  icon.className = 'fa-regular fa-file-lines note-item-icon';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'note-title';
  titleSpan.textContent = note.title;

  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-rename-input';
    input.value = note.title;
    li.replaceChild(input, titleSpan);
    input.focus();
    input.select();

    const saveName = () => {
      const val = input.value.trim();
      if (val) {
        note.title = val;
        note.updatedAt = Date.now();
        saveNotesToStorage();
        renderNoteList();
        const activeNote = getActiveNote();
        if (activeNote && activeNote.id === note.id) {
          renderEditor();
        }
      } else {
        li.replaceChild(titleSpan, input);
      }
    };

    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') saveName();
      if (evt.key === 'Escape') li.replaceChild(titleSpan, input);
    });
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-delete-note';
  delBtn.title = '削除';
  delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNote(note.id, e);
  });

  li.appendChild(icon);
  li.appendChild(titleSpan);
  li.appendChild(favStar);
  li.appendChild(renameBtn);
  li.appendChild(delBtn);

  li.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    navigateToNote(note.id);
  });

  setupSidebarDragEvents(li, note.id, 'note');
  return li;
}

function highlightText(text, query) {
  if (!query) return escapeHTML(text);
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return escapeHTML(text).replace(regex, '<mark class="search-highlight">$1</mark>');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createSearchFolderDOM(folder, normalNotes, matchedNotes, visibleFolderIds, searchVal, depth) {
  const folderLi = document.createElement('li');
  folderLi.className = 'folder-item-wrapper search-folder-active';
  folderLi.style.paddingLeft = `${depth * 12}px`;

  const folderHeader = document.createElement('div');
  folderHeader.className = 'folder-header';

  const caret = document.createElement('i');
  caret.className = 'fa-solid fa-caret-right caret-icon open';
  folderHeader.appendChild(caret);

  const folderIcon = document.createElement('i');
  folderIcon.className = 'fa-regular fa-folder-open folder-icon';
  folderHeader.appendChild(folderIcon);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'folder-name';
  nameSpan.innerHTML = highlightText(folder.name, searchVal);
  folderHeader.appendChild(nameSpan);
  folderLi.appendChild(folderHeader);

  const childrenUl = document.createElement('ul');
  childrenUl.className = 'folder-children';
  childrenUl.style.display = 'block';

  const subFolders = state.folders.filter(f => f.parentId === folder.id && visibleFolderIds.has(f.id));
  subFolders.sort((a, b) => b.updatedAt - a.updatedAt);
  subFolders.forEach(sub => {
    childrenUl.appendChild(createSearchFolderDOM(sub, normalNotes, matchedNotes, visibleFolderIds, searchVal, depth + 1));
  });

  const subNotes = matchedNotes.filter(n => n.folderId === folder.id);
  subNotes.sort((a, b) => b.updatedAt - a.updatedAt);
  subNotes.forEach(note => {
    childrenUl.appendChild(createSearchNoteDOM(note, searchVal, depth + 1));
  });

  folderLi.appendChild(childrenUl);
  return folderLi;
}

function createSearchNoteDOM(note, searchVal, depth) {
  const li = document.createElement('li');
  li.className = `note-item ${note.id === state.activeNoteId ? 'active' : ''}`;
  li.style.paddingLeft = `${depth * 12 + 16}px`;

  li.innerHTML = `
    <i class="fa-regular fa-file-lines note-item-icon"></i>
    <span class="note-title">${highlightText(note.title, searchVal)}</span>
    <button class="btn-delete-note" title="削除"><i class="fa-solid fa-trash-can"></i></button>
  `;

  li.addEventListener('click', (e) => {
    if (e.target.closest('.btn-delete-note')) {
      e.stopPropagation();
      deleteNote(note.id, e);
    } else {
      if (searchInput) {
        searchInput.value = '';
        renderNoteList();
      }
      navigateToNote(note.id);
    }
  });

  return li;
}

function renderSearchTree(normalNotes, searchVal) {
  const isTagSearch = searchVal.startsWith('#') || searchVal.startsWith('＃');
  // 先頭のシャープ記号（# や ＃）をトリミングしたタグ検索用のワードを作成
  const searchTagVal = searchVal.replace(/^[#＃]/, '').toLowerCase().trim();

  let matchedNotes;

  if (isTagSearch) {
    // タグ厳密検索：タイトルは無視し、タグリストに該当ワードが含まれるノートのみ抽出
    matchedNotes = normalNotes.filter(n =>
      n.tags && n.tags.some(t => t.toLowerCase().includes(searchTagVal))
    );
  } else {
    // 通常検索：タイトルまたはタグの部分一致
    matchedNotes = normalNotes.filter(n =>
      n.title.toLowerCase().includes(searchVal) ||
      (n.tags && n.tags.some(t => t.toLowerCase().includes(searchTagVal)))
    );
  }

  if (matchedNotes.length === 0) {
    noteListContainer.innerHTML = '<div class="no-data-msg">一致するノートなし</div>';
    return;
  }

  // マッチしたノートをフラットに並べてリスト表示する（親フォルダ名ラベル付き）
  matchedNotes.sort((a, b) => b.updatedAt - a.updatedAt);
  matchedNotes.forEach(note => {
    // 親フォルダ情報の取得
    const folder = state.folders.find(f => f.id === note.folderId);
    const folderPrefix = folder ? `<span style="font-size:10px; color:var(--text-muted); background:rgba(255,255,255,0.04); padding:1px 5px; border-radius:4px; margin-right:6px; font-weight:500; display:inline-flex; align-items:center; gap:3px;"><i class="fa-regular fa-folder"></i> ${escapeHTML(folder.name)}</span>` : '';

    const li = document.createElement('li');
    li.className = `note-item ${note.id === state.activeNoteId ? 'active' : ''}`;
    li.style.paddingLeft = '12px';
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.paddingTop = '6px';
    li.style.paddingBottom = '6px';

    li.innerHTML = `
          <i class="fa-regular fa-file-lines note-item-icon" style="margin-right:8px; font-size:12px; color:var(--text-muted);"></i>
          <div style="flex:1; display:flex; align-items:center; min-width:0; overflow:hidden;">
            ${folderPrefix}
            <span class="note-title" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:500;">${highlightText(note.title, searchVal)}</span>
          </div>
          <button class="btn-delete-note" title="削除" style="margin-left:auto; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-trash-can"></i></button>
        `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-note')) {
        e.stopPropagation();
        deleteNote(note.id, e);
      } else {
        // タグチップから別のノートへ快適に遷移できるよう、検索窓の値はクリアせず保持します
        navigateToNote(note.id);
      }
    });

    noteListContainer.appendChild(li);
  });
}

function renderNormalTree(normalNotes) {
  // --- 1. お気に入り（Starred）セクションの描画 ---
  const favoriteNotes = normalNotes.filter(n => n.isFavorite);
  if (favoriteNotes.length > 0) {
    const favHeader = document.createElement('div');
    favHeader.className = 'folder-header favorite-section-header';
    favHeader.setAttribute('data-smart-folder', 'favorite');
    favHeader.style.paddingLeft = '6px';
    favHeader.style.display = 'flex';
    favHeader.style.alignItems = 'center';
    favHeader.style.gap = '6px';
    favHeader.style.marginTop = '8px';
    favHeader.style.marginBottom = '4px';
    favHeader.style.cursor = 'pointer';

    // キャレット（矢印）アイコンの追加
    const caret = document.createElement('i');
    caret.className = `fa-solid fa-caret-right caret-icon ${state.collapsedFavorites ? '' : 'open'}`;
    favHeader.appendChild(caret);

    const starIcon = document.createElement('i');
    starIcon.className = 'fa-solid fa-star folder-icon';
    starIcon.style.color = '#fff9c4'; // プレミアムなゴールド

    const titleSpan = document.createElement('span');
    titleSpan.className = 'folder-name';
    titleSpan.textContent = 'お気に入り';

    favHeader.appendChild(starIcon);
    favHeader.appendChild(titleSpan);

    // クリックで折りたたみをトグル
    favHeader.addEventListener('click', (e) => {
      state.collapsedFavorites = !state.collapsedFavorites;
      localStorage.setItem('notidian_collapsed_favorites', state.collapsedFavorites);
      renderNoteList();
    });

    noteListContainer.appendChild(favHeader);

    if (!state.collapsedFavorites) {
      const favUl = document.createElement('ul');
      favUl.className = 'favorite-notes-list';
      favUl.style.listStyle = 'none';
      favUl.style.margin = '0';
      favUl.style.padding = '0';

      // sortIndexの降順でソートして描画
      favoriteNotes.sort((a, b) => b.sortIndex - a.sortIndex);
      favoriteNotes.forEach(note => {
        const li = createNoteDOM(note, 1);
        li.classList.add('favorite-note-item');
        li.setAttribute('data-smart-folder', 'favorite-item');
        favUl.appendChild(li);
      });
      noteListContainer.appendChild(favUl);
    }
  }

  // --- 1.5 未入力のノート（スマートフォルダ）セクションの描画 ---
  const emptyNotes = normalNotes.filter(n =>
    n.blocks.length === 0 ||
    (n.blocks.length === 1 && n.blocks[0].type === 'p' && !n.blocks[0].content.trim())
  );

  if (emptyNotes.length > 0) {
    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'folder-header empty-section-header';
    emptyHeader.setAttribute('data-smart-folder', 'empty');
    emptyHeader.style.paddingLeft = '6px';
    emptyHeader.style.display = 'flex';
    emptyHeader.style.alignItems = 'center';
    emptyHeader.style.gap = '6px';
    emptyHeader.style.marginTop = '8px';
    emptyHeader.style.marginBottom = '4px';
    emptyHeader.style.cursor = 'pointer';

    // キャレット（矢印）アイコンの追加
    const caret = document.createElement('i');
    caret.className = `fa-solid fa-caret-right caret-icon ${state.collapsedEmptyNotes ? '' : 'open'}`;
    emptyHeader.appendChild(caret);

    const folderIcon = document.createElement('i');
    folderIcon.className = 'fa-solid fa-folder-minus folder-icon';
    folderIcon.style.color = 'var(--accent-secondary, #ec4899)';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'folder-name';
    titleSpan.textContent = '未入力のノート';

    // 個数バッジの追加
    const badge = document.createElement('span');
    badge.className = 'empty-badge';
    badge.textContent = emptyNotes.length;
    badge.style.fontSize = '10px';
    badge.style.background = 'var(--accent-secondary, #ec4899)';
    badge.style.color = '#fff';
    badge.style.padding = '1px 6px';
    badge.style.borderRadius = '10px';
    badge.style.marginLeft = 'auto';
    badge.style.marginRight = '8px';

    emptyHeader.appendChild(folderIcon);
    emptyHeader.appendChild(titleSpan);
    emptyHeader.appendChild(badge);

    // クリックで折りたたみをトグル
    emptyHeader.addEventListener('click', (e) => {
      state.collapsedEmptyNotes = !state.collapsedEmptyNotes;
      localStorage.setItem('notidian_collapsed_empty_notes', state.collapsedEmptyNotes);
      renderNoteList();
    });

    noteListContainer.appendChild(emptyHeader);

    if (!state.collapsedEmptyNotes) {
      const emptyUl = document.createElement('ul');
      emptyUl.className = 'empty-notes-list';
      emptyUl.style.listStyle = 'none';
      emptyUl.style.margin = '0';
      emptyUl.style.padding = '0';

      emptyNotes.sort((a, b) => b.sortIndex - a.sortIndex);
      emptyNotes.forEach(note => {
        const li = createNoteDOM(note, 1);
        li.classList.add('empty-note-item');
        li.setAttribute('data-smart-folder', 'empty-item');
        emptyUl.appendChild(li);
      });
      noteListContainer.appendChild(emptyUl);
    }
  }

  // --- 2. 通常のフォルダ・ノート一覧の描画 (混在してソート) ---
  const rootFolders = state.folders.filter(f => !f.parentId);
  const rootNotes = normalNotes.filter(n => !n.folderId);

  const mixedList = [
    ...rootFolders.map(f => ({ type: 'folder', data: f, sortIndex: f.sortIndex || 0 })),
    ...rootNotes.map(n => ({ type: 'note', data: n, sortIndex: n.sortIndex || 0 }))
  ];

  mixedList.sort((a, b) => b.sortIndex - a.sortIndex);

  mixedList.forEach(item => {
    if (item.type === 'folder') {
      noteListContainer.appendChild(createFolderDOM(item.data, normalNotes, 0));
    } else {
      noteListContainer.appendChild(createNoteDOM(item.data, 0));
    }
  });
}

// ==========================================
// 15. DATABASE BULK ACTIONS (一括選択・操作)
// ==========================================

const tableSelection = {
  blockId: null,
  selectedRows: []
};

let lastSelectedRowIndex = null;

function handleRowClick(e, block, row, rowIndex, rowDataList, checkboxEl) {
  const isChecked = checkboxEl.checked;

  if (tableSelection.blockId !== block.id) {
    tableSelection.blockId = block.id;
    tableSelection.selectedRows = [];
    lastSelectedRowIndex = null;
  }

  if (e.shiftKey && lastSelectedRowIndex !== null) {
    // 範囲選択：範囲内のすべての行を選択（チェック状態）に倒す
    const start = Math.min(lastSelectedRowIndex, rowIndex);
    const end = Math.max(lastSelectedRowIndex, rowIndex);

    for (let i = start; i <= end; i++) {
      const targetRow = rowDataList[i];
      if (!targetRow) continue;

      if (!tableSelection.selectedRows.includes(targetRow)) {
        tableSelection.selectedRows.push(targetRow);
      }
    }
  } else {
    // 通常の選択
    const isCheckboxClick = e.target && e.target.classList.contains('db-row-select-check');
    if (!isCheckboxClick) {
      // チェックボックス自体の直接クリックではない場合、一括選択をクリアしてこの行のみを選択する
      tableSelection.selectedRows = [row];
      checkboxEl.checked = true;
      // ブロック選択をクリア
      clearBlockSelection();
    } else {
      // チェックボックス自体のクリックはこれまでのトグル（複数選択の追加/解除）
      if (isChecked) {
        if (!tableSelection.selectedRows.includes(row)) {
          tableSelection.selectedRows.push(row);
        }
      } else {
        tableSelection.selectedRows = tableSelection.selectedRows.filter(r => r !== row);
      }
    }
  }

  // 範囲選択時でも、通常選択時でも、最後にクリックしたインデックスを更新
  lastSelectedRowIndex = rowIndex;

  updateBulkActionBar(block, rowDataList);
  renderEditor();
}

function handleSelectAllChange(block, rowDataList, isChecked) {
  tableSelection.blockId = block.id;
  if (isChecked) {
    tableSelection.selectedRows = [...rowDataList];
  } else {
    tableSelection.selectedRows = [];
  }

  const tableEl = document.querySelector(`.block-wrapper[data-id="${block.id}"] table`);
  if (tableEl) {
    const checks = tableEl.querySelectorAll('.db-row-select-check');
    checks.forEach(c => c.checked = isChecked);
  }

  updateBulkActionBar(block, rowDataList);
}

function clearTableSelection() {
  tableSelection.blockId = null;
  tableSelection.selectedRows = [];
  lastSelectedRowIndex = null;

  document.querySelectorAll('.db-row-select-check, .db-select-all-check').forEach(c => c.checked = false);

  const bar = document.getElementById('db-bulk-action-bar');
  if (bar) bar.style.display = 'none';
}

function clearBlockSelection() {
  state.selectedBlockIds = [];
  document.querySelectorAll('.block-wrapper.selected').forEach(w => w.classList.remove('selected'));
  document.querySelectorAll('.block-select-check').forEach(chk => chk.checked = false);
  updateBlockBulkActionBar();
}

window.clearBlockSelection = clearBlockSelection; // グローバル（HTMLのonclick）から参照可能にする
window.clearTableSelection = clearTableSelection; // グローバルから参照可能にする
window.tableSelection = tableSelection; // グローバルから参照可能にする
window.handleBlockClick = handleBlockClick; // グローバルから参照可能にする

function handleBlockClick(e, blockId) {
  if (!state.selectedBlockIds) state.selectedBlockIds = [];

  const allBlockEls = Array.from(document.querySelectorAll('#block-canvas .block-wrapper[data-id]'));
  const allBlockIds = allBlockEls.map(el => el.getAttribute('data-id'));

  const targetIndex = allBlockIds.indexOf(blockId);
  if (targetIndex === -1) return;

  const isSelected = !state.selectedBlockIds.includes(blockId);

  if (e.shiftKey && state.lastSelectedBlockId !== null) {
    const lastIndex = allBlockIds.indexOf(state.lastSelectedBlockId);
    if (lastIndex !== -1) {
      const start = Math.min(lastIndex, targetIndex);
      const end = Math.max(lastIndex, targetIndex);

      for (let i = start; i <= end; i++) {
        const id = allBlockIds[i];
        if (!state.selectedBlockIds.includes(id)) {
          state.selectedBlockIds.push(id);
        }
      }
    }
  } else {
    // 通常の選択
    const isCheckboxClick = e.target && e.target.classList.contains('block-select-check');
    if (!isCheckboxClick) {
      // チェックボックス自体の直接クリックではない場合、一括選択をリセットしてこのブロックのみを選択する
      state.selectedBlockIds = [blockId];
      // テーブル選択をクリア
      clearTableSelection();
    } else {
      // チェックボックス自体の直接クリックはこれまでのトグル（複数選択の追加/解除）
      if (isSelected) {
        if (!state.selectedBlockIds.includes(blockId)) {
          state.selectedBlockIds.push(blockId);
        }
      } else {
        state.selectedBlockIds = state.selectedBlockIds.filter(item => item !== blockId);
      }
    }
  }

  state.lastSelectedBlockId = blockId;

  allBlockEls.forEach(el => {
    const id = el.getAttribute('data-id');
    const check = el.querySelector('.block-select-check');
    if (state.selectedBlockIds.includes(id)) {
      el.classList.add('selected');
      if (check) check.checked = true;
    } else {
      el.classList.remove('selected');
      if (check) check.checked = false;
    }
  });

  updateBlockBulkActionBar();
}

function updateBlockBulkActionBar() {
  const bar = document.getElementById('block-bulk-action-bar');
  const countSpan = document.getElementById('block-bulk-select-count');
  if (!bar || !countSpan) return;

  if (!state.selectedBlockIds) state.selectedBlockIds = [];
  const count = state.selectedBlockIds.length;

  if (count > 0) {
    countSpan.textContent = count;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

export function removeBlocksRecursively(blocks, targetIds) {
  return blocks.filter(block => {
    if (targetIds.includes(block.id)) {
      return false; // 削除
    }
    if (block.children && block.children.length > 0) {
      block.children = removeBlocksRecursively(block.children, targetIds);
    }
    return true;
  });
}

export function setupBlockBulkActionEvents() {
  const delBtn = document.getElementById('btn-block-bulk-delete');
  if (delBtn) {
    const newDelBtn = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(newDelBtn, delBtn);

    newDelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const count = state.selectedBlockIds ? state.selectedBlockIds.length : 0;
      if (count === 0) return;

      pushHistory();
      const activeNote = state.notes.find(n => n.id === state.activeNoteId);
      if (activeNote) {
        activeNote.blocks = removeBlocksRecursively(activeNote.blocks, state.selectedBlockIds);
        saveNotesToStorage();
        clearBlockSelection();
        renderEditor();
      }
    });
  }

  const dupBtn = document.getElementById('btn-block-bulk-duplicate');
  if (dupBtn) {
    const newDupBtn = dupBtn.cloneNode(true);
    dupBtn.parentNode.replaceChild(newDupBtn, dupBtn);

    newDupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const count = state.selectedBlockIds ? state.selectedBlockIds.length : 0;
      if (count === 0) return;

      pushHistory();
      const activeNote = state.notes.find(n => n.id === state.activeNoteId);
      if (activeNote) {
        const cloneAndReassignIds = (blockObj) => {
          const cloned = JSON.parse(JSON.stringify(blockObj));
          cloned.id = generateId();
          if (cloned.children && cloned.children.length > 0) {
            cloned.children = cloned.children.map(child => cloneAndReassignIds(child));
          }
          if (cloned.properties && cloned.properties.children && cloned.properties.children.length > 0) {
            cloned.properties.children = cloned.properties.children.map(child => cloneAndReassignIds(child));
          }
          return cloned;
        };

        const blocksToDuplicate = [];
        const findAndClone = (blocksList) => {
          blocksList.forEach(b => {
            if (state.selectedBlockIds.includes(b.id)) {
              blocksToDuplicate.push(cloneAndReassignIds(b));
            }
            if (b.children) findAndClone(b.children);
            if (b.properties && b.properties.children) findAndClone(b.properties.children);
          });
        };
        findAndClone(activeNote.blocks);

        if (blocksToDuplicate.length > 0) {
          let maxIndex = -1;
          let targetParentArray = activeNote.blocks;

          const findInsertPosition = (blocksList, parentArr = activeNote.blocks) => {
            for (let i = 0; i < blocksList.length; i++) {
              if (state.selectedBlockIds.includes(blocksList[i].id)) {
                if (i > maxIndex || parentArr !== targetParentArray) {
                  maxIndex = i;
                  targetParentArray = parentArr;
                }
              }
              if (blocksList[i].children && blocksList[i].children.length > 0) {
                findInsertPosition(blocksList[i].children, blocksList[i].children);
              }
              if (blocksList[i].properties && blocksList[i].properties.children && blocksList[i].properties.children.length > 0) {
                findInsertPosition(blocksList[i].properties.children, blocksList[i].properties.children);
              }
            }
          };
          findInsertPosition(activeNote.blocks);

          if (maxIndex !== -1) {
            targetParentArray.splice(maxIndex + 1, 0, ...blocksToDuplicate);
          } else {
            activeNote.blocks.push(...blocksToDuplicate);
          }
        }

        saveNotesToStorage();
        clearBlockSelection();
        renderEditor();
        showToast(`${blocksToDuplicate.length}件のブロックを複製しました`);
      }
    });
  }
}

function applyBulkPropertyChange(block, colId, value) {
  pushHistory();
  tableSelection.selectedRows.forEach(row => {
    row[colId] = value;
  });
  saveNotesToStorage();
  clearTableSelection();
  renderEditor();
}

function updateBulkActionBar(block, rowDataList = null) {
  const bar = document.getElementById('db-bulk-action-bar');
  const countSpan = document.getElementById('bulk-select-count');
  const container = document.getElementById('bulk-actions-container');

  if (!bar || !countSpan || !container) return;

  const count = tableSelection.selectedRows.length;
  if (count === 0) {
    bar.style.display = 'none';
    return;
  }

  countSpan.textContent = count;
  bar.style.display = 'flex';
  container.innerHTML = '';

  // --- 1. 一括削除 ---
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-bulk-action btn-bulk-danger';
  delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 一括削除';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pushHistory();
    block.properties.rows = block.properties.rows.filter(r => !tableSelection.selectedRows.includes(r));
    saveNotesToStorage();
    clearTableSelection();
    renderEditor();
  });
  container.appendChild(delBtn);

  // --- 2. 複製挿入 ---
  const cloneBtn = document.createElement('button');
  cloneBtn.className = 'btn-bulk-action';
  cloneBtn.style.background = 'rgba(139, 92, 246, 0.18)';
  cloneBtn.style.border = '1px solid rgba(139, 92, 246, 0.4)';
  cloneBtn.style.color = 'var(--text-primary)';
  cloneBtn.innerHTML = '<i class="fa-regular fa-clipboard"></i> 複製挿入';
  cloneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pushHistory();

    const copiedRows = tableSelection.selectedRows.map(r => {
      const newRow = JSON.parse(JSON.stringify(r));
      newRow.id = 'row-' + generateId();
      return newRow;
    });

    let maxIndex = -1;
    tableSelection.selectedRows.forEach(r => {
      const idx = block.properties.rows.indexOf(r);
      if (idx > maxIndex) maxIndex = idx;
    });

    if (maxIndex !== -1) {
      block.properties.rows.splice(maxIndex + 1, 0, ...copiedRows);
    } else {
      block.properties.rows.push(...copiedRows);
    }

    saveNotesToStorage();
    clearTableSelection();
    renderEditor();
  });
  container.appendChild(cloneBtn);

  // --- 3. プロパティ一括設定 ---
  const bulkPropBtn = document.createElement('button');
  bulkPropBtn.className = 'btn-bulk-action';
  bulkPropBtn.style.background = 'rgba(16, 185, 129, 0.18)';
  bulkPropBtn.style.border = '1px solid rgba(16, 185, 129, 0.4)';
  bulkPropBtn.style.color = 'var(--text-primary)';
  bulkPropBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> プロパティ一括設定';
  bulkPropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showBulkPropertySetterPopover(e, block);
  });
  container.appendChild(bulkPropBtn);
}

function showBulkPropertySetterPopover(e, block) {
  // 他のポップオーバーをクリア
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-bulk-prop-popover';
  popover.style.width = '240px';
  popover.style.padding = '12px';
  popover.style.display = 'flex';
  popover.style.flexDirection = 'column';
  popover.style.gap = '8px';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY - 240}px`; // 上方向に開く
  if (e.clientY < 300) {
    popover.style.top = `${e.clientY + 12}px`;
  }

  popover.addEventListener('click', (evt) => evt.stopPropagation());
  popover.addEventListener('mousedown', (evt) => evt.stopPropagation());
  popover.addEventListener('mouseup', (evt) => evt.stopPropagation());

  const title = document.createElement('div');
  title.style = 'font-weight: bold; font-size: 12px; margin-bottom: 4px; color: var(--text-primary);';
  title.textContent = 'プロパティを一括設定';
  popover.appendChild(title);

  // 列選択セレクト
  const colLabel = document.createElement('div');
  colLabel.style = 'font-size: 11px; color: var(--text-muted);';
  colLabel.textContent = '対象の列:';
  popover.appendChild(colLabel);

  const colSelect = document.createElement('select');
  colSelect.className = 'db-popover-input';
  colSelect.style = 'width: 100%; margin: 6px 0;';
  
  const columns = block.properties.columns || [];
  columns.forEach(col => {
    const opt = document.createElement('option');
    opt.value = col.id;
    opt.textContent = `${col.name} (${col.type})`;
    colSelect.appendChild(opt);
  });
  popover.appendChild(colSelect);

  // 値入力領域のコンテナ
  const valContainer = document.createElement('div');
  valContainer.style = 'display: flex; flex-direction: column; gap: 4px; margin-top: 4px;';
  popover.appendChild(valContainer);

  const renderValueInput = () => {
    valContainer.innerHTML = '';
    const selectedColId = colSelect.value;
    const col = columns.find(c => c.id === selectedColId);
    if (!col) return;

    const valLabel = document.createElement('div');
    valLabel.style = 'font-size: 11px; color: var(--text-muted);';
    valLabel.textContent = '設定する値:';
    valContainer.appendChild(valLabel);

    if (col.type === 'status') {
      const selectEl = document.createElement('select');
      selectEl.className = 'db-popover-input';
      selectEl.style = 'width: 100%; margin: 6px 0;';
      const opts = col.options || [];
      opts.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.name;
        o.textContent = opt.name;
        selectEl.appendChild(o);
      });
      valContainer.appendChild(selectEl);
      popover.getValue = () => selectEl.value;
    } 
    else if (col.type === 'select') {
      // 複数チェックボックス形式
      const optsDiv = document.createElement('div');
      optsDiv.style = 'max-height: 120px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; padding: 4px; display: flex; flex-direction: column; gap: 4px; background: rgba(0, 0, 0, 0.4); color: #fff;';
      const opts = col.options || [];
      
      if (opts.length === 0) {
        const noOpt = document.createElement('div');
        noOpt.style = 'font-size: 11px; color: var(--text-muted); padding: 4px; text-align: center;';
        noOpt.textContent = 'オプションがありません';
        optsDiv.appendChild(noOpt);
      } else {
        opts.forEach(opt => {
          const optName = typeof opt === 'string' ? opt : opt.name;
          const color = typeof opt === 'string' ? 'gray' : (opt.color || 'gray');

          const label = document.createElement('label');
          label.style = 'display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 3px;';
          label.onmouseover = () => label.style.background = 'rgba(255,255,255,0.05)';
          label.onmouseout = () => label.style.background = 'none';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = optName; // optIdからoptNameに変更
          cb.style = 'margin: 0; cursor: pointer;';
          
          const badge = document.createElement('span');
          badge.className = `db-select-badge db-tag-${color}`;
          badge.textContent = optName;

          label.appendChild(cb);
          label.appendChild(badge);
          optsDiv.appendChild(label);
        });
      }
      valContainer.appendChild(optsDiv);
      popover.getValue = () => {
        const checked = [];
        optsDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          if (cb.checked) checked.push(cb.value);
        });
        return checked.join(',');
      };
    } 
    else if (col.type === 'checkbox') {
      const selectEl = document.createElement('select');
      selectEl.className = 'db-popover-input';
      selectEl.style = 'width: 100%; margin: 6px 0;';
      const optTrue = document.createElement('option');
      optTrue.value = 'true';
      optTrue.textContent = 'チェックあり (True)';
      const optFalse = document.createElement('option');
      optFalse.value = 'false';
      optFalse.textContent = 'チェックなし (False)';
      selectEl.appendChild(optTrue);
      selectEl.appendChild(optFalse);
      valContainer.appendChild(selectEl);
      popover.getValue = () => selectEl.value === 'true';
    } 
    else if (col.type === 'date') {
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'db-popover-input';
      input.style = 'width: 100%; margin: 6px 0;';
      valContainer.appendChild(input);
      popover.getValue = () => input.value;
    } 
    else if (col.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'db-popover-input';
      input.style = 'width: 100%; margin: 6px 0;';
      input.placeholder = '数値を入力...';
      valContainer.appendChild(input);
      popover.getValue = () => input.value;
    } 
    else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'db-popover-input';
      input.style = 'width: 100%; margin: 6px 0;';
      input.placeholder = 'テキストを入力...';
      valContainer.appendChild(input);
      popover.getValue = () => input.value;
    }
  };

  colSelect.addEventListener('change', renderValueInput);
  renderValueInput();

  const btnDiv = document.createElement('div');
  btnDiv.style = 'display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.style = 'padding: 4px 8px; font-size: 11px; border: 1px solid var(--border-light); background: none; color: var(--text-secondary); border-radius: 4px; cursor: pointer;';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => popover.remove());
  btnDiv.appendChild(cancelBtn);

  const applyBtn = document.createElement('button');
  applyBtn.style = 'padding: 4px 8px; font-size: 11px; border: none; background: var(--accent-secondary, #ec4899); color: white; border-radius: 4px; cursor: pointer; font-weight: bold;';
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    const val = popover.getValue();
    const colId = colSelect.value;

    pushHistory();
    tableSelection.selectedRows.forEach(row => {
      row[colId] = val;
    });

    saveNotesToStorage();
    clearTableSelection();
    popover.remove();
    renderEditor();
  });
  btnDiv.appendChild(applyBtn);
  popover.appendChild(btnDiv);

  document.body.appendChild(popover);
}

// ==========================================
// 13. INITIALIZATION CALL
// ==========================================

// 重複した DOMContentLoaded イベントハンドラを削除しました。

// 重複した POMODORO DUAL SYNC ACTIONS などの変数・関数定義を削除しました。

function findTargetDatabaseBlock(blocks, targetName) {
  let firstDb = null;
  function search(arr) {
    for (let b of arr) {
      if (b.type === 'database') {
        if (!firstDb) firstDb = b;
        const dbName = b.properties.tableName || 'データベース';
        if (targetName && dbName === targetName) {
          return b;
        }
      }
      if (b.children && b.children.length > 0) {
        const found = search(b.children);
        if (found) return found;
      }
    }
    return null;
  }
  const found = search(blocks);
  return found || firstDb;
}

function findFirstDatabaseBlock(blocks) {
  for (let b of blocks) {
    if (b.type === 'database') {
      return b;
    }
    if (b.children && b.children.length > 0) {
      const found = findFirstDatabaseBlock(b.children);
      if (found) return found;
    }
  }
  return null;
}



export function insertPomodoroStartToActiveTable(taskName, durationMs) {
  const activeNote = getActiveNote();
  if (!activeNote) return;

  const currentTargetTableName = localStorage.getItem('timer_target_table_name') || '';
  const dbBlock = findTargetDatabaseBlock(activeNote.blocks, currentTargetTableName);
  if (!dbBlock) return;

  dbBlock.properties = dbBlock.properties || { columns: [], rows: [] };
  dbBlock.properties.rows = dbBlock.properties.rows || [];

  const newRow = {};
  const durationMin = Math.ceil(durationMs / 60000);
  const todayString = new Date().toISOString().split('T')[0];
  const startTimeStr = getFormattedTime();
  const dateVal = `${todayString} ${startTimeStr}~`;

  // 1. 分(Minutes)を表す列の特定
  const minTextCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('実行') || c.name.includes('作業') || c.name.includes('集中時間') || c.name.includes('経過分') || c.name.includes('実績分') || c.name === '分'));
  let minNumCol = dbBlock.properties.columns.find(c => c.type === 'number' && (c.name.includes('実行') || c.name.includes('作業') || c.name.includes('集中時間') || c.name.includes('経過分') || c.name.includes('実績分') || c.name === '分'));
  if (!minNumCol) {
    minNumCol = dbBlock.properties.columns.find(c => c.type === 'number');
  }

  // 2. 時間(Hours)を表す列の特定
  const hourTextCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('経過時間') || c.name.includes('実績時間') || c.name.includes('集中時間(h)') || c.name === '時間' || c.name.toLowerCase() === 'hour' || c.name.toLowerCase() === 'hours' || c.name.toLowerCase() === 'h'));
  const hourNumCol = dbBlock.properties.columns.find(c => c.type === 'number' && (c.name.includes('経過時間') || c.name.includes('実績時間') || c.name.includes('集中時間(h)') || c.name === '時間' || c.name.toLowerCase() === 'hour' || c.name.toLowerCase() === 'hours' || c.name.toLowerCase() === 'h'));

  // 3. 日数(Days)を表す列の特定
  const dayTextCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('経過日数') || c.name.includes('実績日数') || c.name === '日数' || c.name === '日間' || c.name.toLowerCase() === 'day' || c.name.toLowerCase() === 'days' || c.name.toLowerCase() === 'd'));
  const dayNumCol = dbBlock.properties.columns.find(c => c.type === 'number' && (c.name.includes('経過日数') || c.name.includes('実績日数') || c.name === '日数' || c.name === '日間' || c.name.toLowerCase() === 'day' || c.name.toLowerCase() === 'days' || c.name.toLowerCase() === 'd'));

  dbBlock.properties.columns.forEach(col => {
    const colName = col.name.toLowerCase();
    if (col.type === 'text') {
      if (colName.includes('開始') || colName.includes('start')) {
        newRow[col.id] = startTimeStr;
      } else if (colName.includes('終了') || colName.includes('end')) {
        newRow[col.id] = '';
      } else if (col.id === minTextCol?.id) {
        newRow[col.id] = `${durationMin}分`;
      } else if (col.id === hourTextCol?.id) {
        const valHour = parseFloat((durationMin / 60).toFixed(2));
        newRow[col.id] = valHour >= 1.0 ? `${valHour}時間` : '';
      } else if (col.id === dayTextCol?.id) {
        const valDay = parseFloat((durationMin / 1440).toFixed(3));
        newRow[col.id] = valDay >= 1.0 ? `${valDay}日間` : '';
      } else if (col.id === 'col-title' || (!colName.includes('開始') && !colName.includes('終了') && !colName.includes('実行') && !colName.includes('作業') && !colName.includes('集中時間') && !colName.includes('経過') && !colName.includes('実績') && col.type === 'text')) {
        newRow[col.id] = taskName || '作業セッション';
      } else {
        newRow[col.id] = '';
      }
    } else if (col.type === 'number') {
      if (col.id === minNumCol?.id) {
        newRow[col.id] = durationMin;
      } else if (col.id === hourNumCol?.id) {
        const valHour = parseFloat((durationMin / 60).toFixed(2));
        newRow[col.id] = valHour >= 1.0 ? valHour : '';
      } else if (col.id === dayNumCol?.id) {
        const valDay = parseFloat((durationMin / 1440).toFixed(3));
        newRow[col.id] = valDay >= 1.0 ? valDay : '';
      } else {
        newRow[col.id] = '';
      }
    } else if (col.type === 'date') {
      newRow[col.id] = dateVal;
    } else if (col.type === 'status') {
      const progressOpt = col.options && col.options.find(o => o.name === '進行中' || o.id === 'opt-progress');
      newRow[col.id] = progressOpt ? progressOpt.id : '進行中';
    } else if (col.type === 'select') {
      if (!col.options) col.options = [];
      const seen = new Set();
      const uniqueOptions = [];
      col.options.forEach(opt => {
        let optObj = opt;
        if (typeof opt === 'string') {
          optObj = { id: opt, name: opt, color: getTagHashColor(opt) };
        }
        const normName = (optObj.name || '').trim().toLowerCase();
        if (normName && !seen.has(normName)) {
          seen.add(normName);
          uniqueOptions.push(optObj);
        }
      });
      col.options = uniqueOptions;

      const tagName = (taskName || '作業セッション').trim();
      let found = col.options.find(o => o.name.trim().toLowerCase() === tagName.toLowerCase());
      if (!found) {
        found = { id: tagName, name: tagName, color: 'gray' };
        col.options.push(found);
      }
      newRow[col.id] = found.name;
    } else if (col.type === 'checkbox') {
      newRow[col.id] = false;
    } else {
      newRow[col.id] = '';
    }
  });

  pushHistory();
  dbBlock.properties.rows.push(newRow);

  saveNotesToStorage();
  renderEditor();
}

export function insertPomodoroLogToActiveNoteDb(taskName, durationMin) {
  const activeNote = getActiveNote();
  if (!activeNote) return;

  const currentTargetTableName = localStorage.getItem('timer_target_table_name') || '';
  const dbBlock = findTargetDatabaseBlock(activeNote.blocks, currentTargetTableName);
  if (!dbBlock) return;

  dbBlock.properties = dbBlock.properties || { columns: [], rows: [] };
  dbBlock.properties.rows = dbBlock.properties.rows || [];

  const todayString = new Date().toISOString().split('T')[0];
  const endTimeStr = getFormattedTime();

  // 各種列の自動特定
  const statusCol = dbBlock.properties.columns.find(c => c.type === 'status');
  const titleCol = dbBlock.properties.columns.find(c => c.id === 'col-title') || dbBlock.properties.columns.find(c => c.type === 'text' && !c.name.includes('開始') && !c.name.includes('終了') && !c.name.includes('実行') && !c.name.includes('作業') && !c.name.includes('時間') && !c.name.includes('経過') && !c.name.includes('実績') && !c.name.includes('日数'));
  const dateCol = dbBlock.properties.columns.find(c => c.type === 'date');
  const checkboxCol = dbBlock.properties.columns.find(c => c.type === 'checkbox');

  const startCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('開始') || c.name.includes('start')));
  const endCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('終了') || c.name.includes('end')));

  // 1. 分(Minutes)を表す列の特定
  const minTextCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('実行') || c.name.includes('作業') || c.name.includes('集中時間') || c.name.includes('経過分') || c.name.includes('実績分') || c.name === '分'));
  let minNumCol = dbBlock.properties.columns.find(c => c.type === 'number' && (c.name.includes('実行') || c.name.includes('作業') || c.name.includes('集中時間') || c.name.includes('経過分') || c.name.includes('実績分') || c.name === '分'));
  if (!minNumCol) {
    minNumCol = dbBlock.properties.columns.find(c => c.type === 'number');
  }

  // 2. 時間(Hours)を表す列の特定
  const hourTextCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('経過時間') || c.name.includes('実績時間') || c.name.includes('集中時間(h)') || c.name === '時間' || c.name.toLowerCase() === 'hour' || c.name.toLowerCase() === 'hours' || c.name.toLowerCase() === 'h'));
  const hourNumCol = dbBlock.properties.columns.find(c => c.type === 'number' && (c.name.includes('経過時間') || c.name.includes('実績時間') || c.name.includes('集中時間(h)') || c.name === '時間' || c.name.toLowerCase() === 'hour' || c.name.toLowerCase() === 'hours' || c.name.toLowerCase() === 'h'));

  // 3. 日数(Days)を表す列の特定
  const dayTextCol = dbBlock.properties.columns.find(c => c.type === 'text' && (c.name.includes('経過日数') || c.name.includes('実績日数') || c.name === '日数' || c.name === '日間' || c.name.toLowerCase() === 'day' || c.name.toLowerCase() === 'days' || c.name.toLowerCase() === 'd'));
  const dayNumCol = dbBlock.properties.columns.find(c => c.type === 'number' && (c.name.includes('経過日数') || c.name.includes('実績日数') || c.name === '日数' || c.name === '日間' || c.name.toLowerCase() === 'day' || c.name.toLowerCase() === 'days' || c.name.toLowerCase() === 'd'));

  // 開始時に挿入された「進行中」の行を末尾から検索
  let targetRow = null;
  const progressOptId = statusCol && statusCol.options ? (statusCol.options.find(o => o.name === '進行中' || o.id === 'opt-progress')?.id || '進行中') : '進行中';

  for (let i = dbBlock.properties.rows.length - 1; i >= 0; i--) {
    const row = dbBlock.properties.rows[i];
    // 開始時間が結合された日付にも部分一致（前方一致）でマッチさせる
    const isToday = !dateCol || String(row[dateCol.id] || '').startsWith(todayString);
    const isProgress = !statusCol || row[statusCol.id] === progressOptId || row[statusCol.id] === '進行中';
    const isTitleMatch = !titleCol || row[titleCol.id] === (taskName || '作業セッション');

    if (isToday && isProgress && isTitleMatch) {
      targetRow = row;
      break;
    }
  }

  pushHistory();

  if (targetRow) {
    // 既存の「進行中」の行を「完了」にアップデート
    if (statusCol) {
      const completeOpt = statusCol.options && statusCol.options.find(o => o.name === '完了' || o.id === 'opt-complete');
      targetRow[statusCol.id] = completeOpt ? completeOpt.id : '完了';
    }
    if (checkboxCol) {
      targetRow[checkboxCol.id] = true;
    }
    if (endCol) {
      targetRow[endCol.id] = endTimeStr;
    }

    // セレクトタグ列にテキスト（作業名）と同じタグを自動挿入
    const selectCols = dbBlock.properties.columns.filter(c => c.type === 'select');
    selectCols.forEach(col => {
      if (!col.options) col.options = [];
      const seen = new Set();
      const uniqueOptions = [];
      col.options.forEach(opt => {
        let optObj = opt;
        if (typeof opt === 'string') {
          optObj = { id: opt, name: opt, color: getTagHashColor(opt) };
        }
        const normName = (optObj.name || '').trim().toLowerCase();
        if (normName && !seen.has(normName)) {
          seen.add(normName);
          uniqueOptions.push(optObj);
        }
      });
      col.options = uniqueOptions;

      const tagName = (taskName || '作業セッション').trim();
      let found = col.options.find(o => o.name.trim().toLowerCase() === tagName.toLowerCase());
      if (!found) {
        found = { id: tagName, name: tagName, color: 'gray' };
        col.options.push(found);
      }
      targetRow[col.id] = found.name;
    });

    // 実績時間の書き込み（1以上限定）
    const valMin = durationMin;
    if (minTextCol) targetRow[minTextCol.id] = `${valMin}分`;
    if (minNumCol) targetRow[minNumCol.id] = valMin;

    const valHour = parseFloat((valMin / 60).toFixed(2));
    if (hourTextCol) targetRow[hourTextCol.id] = valHour >= 1.0 ? `${valHour}時間` : '';
    if (hourNumCol) targetRow[hourNumCol.id] = valHour >= 1.0 ? valHour : '';

    const valDay = parseFloat((valMin / 1440).toFixed(3));
    if (dayTextCol) targetRow[dayTextCol.id] = valDay >= 1.0 ? `${valDay}日間` : '';
    if (dayNumCol) targetRow[dayNumCol.id] = valDay >= 1.0 ? valDay : '';

    if (dateCol) {
      const curVal = String(targetRow[dateCol.id] || '');
      if (curVal.includes('~')) {
        targetRow[dateCol.id] = curVal.split('~')[0] + `~${endTimeStr}`;
      } else {
        targetRow[dateCol.id] = curVal + `~${endTimeStr}`;
      }
    }
  } else {
    // 見つからなかった場合の新規作成（フォールバック）
    const newRow = {};
    const startMs = Date.now() - durationMin * 60000;
    const startStr = getFormattedTimeFromMs(startMs);
    const fallbackDateVal = `${todayString} ${startStr}~${endTimeStr}`;

    dbBlock.properties.columns.forEach(col => {
      const colName = col.name.toLowerCase();
      if (col.type === 'text') {
        if (colName.includes('開始') || colName.includes('start')) {
          newRow[col.id] = startStr;
        } else if (colName.includes('終了') || colName.includes('end')) {
          newRow[col.id] = endTimeStr;
        } else if (col.id === minTextCol?.id) {
          newRow[col.id] = `${durationMin}分`;
        } else if (col.id === hourTextCol?.id) {
          const valHour = parseFloat((durationMin / 60).toFixed(2));
          newRow[col.id] = valHour >= 1.0 ? `${valHour}時間` : '';
        } else if (col.id === dayTextCol?.id) {
          const valDay = parseFloat((durationMin / 1440).toFixed(3));
          newRow[col.id] = valDay >= 1.0 ? `${valDay}日間` : '';
        } else if (!colName.includes('開始') && !colName.includes('終了') && !colName.includes('実行') && !colName.includes('作業') && !colName.includes('集中時間') && !colName.includes('経過') && !colName.includes('実績') && col.id !== 'col-title') {
          newRow[col.id] = taskName || '作業セッション';
        } else {
          newRow[col.id] = '';
        }
      } else if (col.type === 'number') {
        if (col.id === minNumCol?.id) {
          newRow[col.id] = durationMin;
        } else if (col.id === hourNumCol?.id) {
          const valHour = parseFloat((durationMin / 60).toFixed(2));
          newRow[col.id] = valHour >= 1.0 ? valHour : '';
        } else if (col.id === dayNumCol?.id) {
          const valDay = parseFloat((durationMin / 1440).toFixed(3));
          newRow[col.id] = valDay >= 1.0 ? valDay : '';
        } else {
          newRow[col.id] = '';
        }
      } else if (col.type === 'date') {
        newRow[col.id] = fallbackDateVal;
      } else if (col.type === 'status') {
        const completeOpt = col.options && col.options.find(o => o.name === '完了' || o.id === 'opt-complete');
        newRow[col.id] = completeOpt ? completeOpt.id : '完了';
      } else if (col.type === 'checkbox') {
        newRow[col.id] = true;
      } else if (col.type === 'select') {
        if (!col.options) col.options = [];
        const seen = new Set();
        const uniqueOptions = [];
        col.options.forEach(opt => {
          let optObj = opt;
          if (typeof opt === 'string') {
            optObj = { id: opt, name: opt, color: getTagHashColor(opt) };
          }
          const normName = (optObj.name || '').trim().toLowerCase();
          if (normName && !seen.has(normName)) {
            seen.add(normName);
            uniqueOptions.push(optObj);
          }
        });
        col.options = uniqueOptions;

        const tagName = (taskName || '作業セッション').trim();
        let found = col.options.find(o => o.name.trim().toLowerCase() === tagName.toLowerCase());
        if (!found) {
          found = { id: tagName, name: tagName, color: 'gray' };
          col.options.push(found);
        }
        newRow[col.id] = found.name;
      } else {
        newRow[col.id] = '';
      }
    });
    dbBlock.properties.rows.push(newRow);
  }

  saveNotesToStorage();
  renderEditor();
}

// ==========================================
// 18. CARET POSITION & WIKILINK RENAME HELPERS
// ==========================================

function getCaretCharacterOffsetWithin(element) {
  let caretOffset = 0;
  const doc = element.ownerDocument || element.document;
  const win = doc.defaultView || doc.parentWindow;
  const sel = win.getSelection();
  if (sel.rangeCount > 0) {
    const range = win.getSelection().getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    caretOffset = preCaretRange.toString().length;
  }
  return caretOffset;
}

function setCaretPosition(element, offset) {
  const range = document.createRange();
  const sel = window.getSelection();

  let currentOffset = 0;
  let nodeToFocus = null;
  let offsetInNode = 0;

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (currentOffset + node.length >= offset) {
        nodeToFocus = node;
        offsetInNode = offset - currentOffset;
        return true;
      }
      currentOffset += node.length;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        if (traverse(node.childNodes[i])) return true;
      }
    }
    return false;
  }

  traverse(element);

  if (nodeToFocus) {
    range.setStart(nodeToFocus, offsetInNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    // Fallback to end
    range.selectNodeContents(element);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function renameWikiLinksInAllNotes(oldTitle, newTitle) {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return;

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const oldTitleEscaped = escapeRegExp(oldTitle);
  const wikiRegex = new RegExp(`\\[\\[\\s*${oldTitleEscaped}\\s*\\]\\]`, 'gi');
  const jpRegex = new RegExp(`「「\\s*${oldTitleEscaped}\\s*」」`, 'gi');

  let hasTotalChanged = false;

  state.notes.forEach(note => {
    let hasChanged = false;

    function scanAndReplace(blocks) {
      blocks.forEach(block => {
        if (block.content) {
          let updatedContent = block.content;
          if (wikiRegex.test(updatedContent)) {
            updatedContent = updatedContent.replace(wikiRegex, `[[${newTitle}]]`);
            hasChanged = true;
          }
          if (jpRegex.test(updatedContent)) {
            updatedContent = updatedContent.replace(jpRegex, `[[${newTitle}]]`);
            hasChanged = true;
          }
          block.content = updatedContent;
        }
        if (block.children && block.children.length > 0) {
          scanAndReplace(block.children);
        }
      });
    }

    scanAndReplace(note.blocks);

    if (hasChanged) {
      hasTotalChanged = true;
    }
  });

  if (hasTotalChanged) {
    saveNotesToStorage();
  }
}

function findDOMPosition(element, targetOffset) {
  let currentOffset = 0;
  let result = null;

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (currentOffset + node.length >= targetOffset) {
        result = { node: node, offset: targetOffset - currentOffset };
        return true;
      }
      currentOffset += node.length;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        if (traverse(node.childNodes[i])) return true;
      }
    }
    return false;
  }

  traverse(element);

  if (result) {
    return result;
  } else {
    let lastTextNode = null;
    function findLastText(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        lastTextNode = node;
      } else {
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
          findLastText(node.childNodes[i]);
          if (lastTextNode) break;
        }
      }
    }
    findLastText(element);
    if (lastTextNode) {
      return { node: lastTextNode, offset: lastTextNode.length };
    }
    return null;
  }
}

function parseDatePropertyValue(val) {
  if (!val) return null;

  // スペースありの「 ~ 」か、スペースなしの「~」で分割
  let parts = [];
  if (String(val).includes(' ~ ')) {
    parts = String(val).split(' ~ ');
  } else {
    parts = String(val).split('~');
  }

  const parseSingle = (str) => {
    if (!str) return { date: '', time: '' };
    const spaceParts = str.trim().split(' ');
    return {
      date: spaceParts[0] || '',
      time: spaceParts[1] || ''
    };
  };

  if (parts.length === 2 && parts[1].trim() !== '') {
    const startObj = parseSingle(parts[0]);
    const endObj = parseSingle(parts[1]);

    // もし終了側の date が空か、HH:MM 形式の時刻だけが入ってしまっている場合
    // (例: parts[1] が '16:52' で、endObj.date が '16:52' になってしまっているケース)
    if (endObj.date && !endObj.date.includes('-') && endObj.date.includes(':')) {
      endObj.time = endObj.date;
      endObj.date = startObj.date; // 開始日の年月日をコピーして補完
    }

    return {
      start: startObj,
      end: endObj,
      isRange: true
    };
  } else {
    return {
      start: parseSingle(parts[0]),
      end: null,
      isRange: false
    };
  }
}

function formatNumberValue(val, col) {
  let num;
  
  if (typeof val === 'string' && val.includes('/')) {
    const parts = val.split('/');
    if (parts.length === 2) {
      const num1 = parseFloat(parts[0].trim());
      const num2 = parseFloat(parts[1].trim());
      if (!isNaN(num1) && !isNaN(num2) && num2 !== 0) {
        num = Math.round((num1 / num2) * 100);
      }
    }
  }
  
  if (num === undefined) {
    num = parseFloat(val);
  }
  
  if (isNaN(num)) return val;

  const format = col ? (col.numberFormat || 'plain') : 'plain';
  if (format === 'currency') {
    return '¥' + num.toLocaleString('ja-JP');
  } else if (format === 'percent' || format === 'progress') {
    return num + '%';
  } else if (format === 'custom' && col.customUnit) {
    return num.toLocaleString('ja-JP') + col.customUnit;
  }
  return num.toLocaleString('ja-JP'); // デフォルトも3桁カンマ区切りにして美しく
}

// 数値セルの表示を描画するヘルパー
function renderNumberCell(cellDiv, val, col) {
  if (val === '' || val === undefined || val === null) {
    cellDiv.innerHTML = '';
    return;
  }
  
  const format = col.numberFormat || 'plain';
  if (format === 'progress') {
    let pct = 0;
    
    if (typeof val === 'string' && val.includes('/')) {
      const parts = val.split('/');
      if (parts.length === 2) {
        const num1 = parseFloat(parts[0].trim());
        const num2 = parseFloat(parts[1].trim());
        if (!isNaN(num1) && !isNaN(num2) && num2 !== 0) {
          pct = Math.round((num1 / num2) * 100);
        }
      }
    } else {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        pct = num;
      }
    }
    
    pct = Math.max(0, Math.min(100, pct));
    
    cellDiv.innerHTML = `
      <div class="db-progress-cell" style="display: flex; align-items: center; gap: 8px; width: 100%; justify-content: flex-end; padding: 2px 4px; box-sizing: border-box;">
        <div class="db-progress-bar-bg" style="flex: 1; height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; min-width: 40px; max-width: 120px;">
          <div class="db-progress-bar-fill" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, var(--accent-primary, #8b5cf6), var(--accent-secondary, #ec4899)); border-radius: 4px; transition: width 0.3s ease;"></div>
        </div>
        <span class="db-progress-text" style="font-size: 11px; font-weight: 600; color: var(--text-primary); min-width: 32px; text-align: right;">${pct}%</span>
      </div>
    `;
  } else {
    cellDiv.textContent = formatNumberValue(val, col);
  }
}

// 進捗バーフォーマット用のインライン分数編集UIをセットアップするヘルパー
function setupProgressInlineEdit(cellDiv, row, col, table, block, rowDataList) {
  const currentVal = row[col.id] !== undefined ? String(row[col.id]) : '';
  let numerator = '';
  let denominator = '';

  if (currentVal.includes('/')) {
    const parts = currentVal.split('/');
    if (parts.length === 2) {
      numerator = parts[0].trim();
      denominator = parts[1].trim();
    }
  } else if (currentVal !== '') {
    numerator = currentVal;
    denominator = '100'; // デフォルト分母
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'db-progress-edit-wrapper';
  wrapper.style = 'display: inline-flex; align-items: center; gap: 4px; justify-content: flex-end; width: 100%;';

  const inputNum = document.createElement('input');
  inputNum.type = 'text';
  inputNum.value = numerator;
  inputNum.placeholder = '現在';
  inputNum.style = 'width: 38px; text-align: center; font-size: 11px; padding: 2px; border: 1px solid var(--accent-primary); border-radius: 4px; background: rgba(0,0,0,0.5); color: #fff; outline: none; box-sizing: border-box;';

  const slashSpan = document.createElement('span');
  slashSpan.textContent = '/';
  slashSpan.style = 'font-size: 11px; color: var(--text-secondary); font-weight: bold;';

  const inputDen = document.createElement('input');
  inputDen.type = 'text';
  inputDen.value = denominator;
  inputDen.placeholder = '全体';
  inputDen.style = 'width: 38px; text-align: center; font-size: 11px; padding: 2px; border: 1px solid var(--accent-primary); border-radius: 4px; background: rgba(0,0,0,0.5); color: #fff; outline: none; box-sizing: border-box;';

  wrapper.appendChild(inputNum);
  wrapper.appendChild(slashSpan);
  wrapper.appendChild(inputDen);

  cellDiv.innerHTML = '';
  cellDiv.appendChild(wrapper);

  inputNum.focus();
  inputNum.select();

  let isSaved = false;
  const saveProgressValue = () => {
    if (isSaved) return;
    isSaved = true;

    const valNum = inputNum.value.trim();
    const valDen = inputDen.value.trim();

    let finalVal = '';
    if (valNum !== '' && valDen !== '') {
      const n = parseFloat(valNum);
      const d = parseFloat(valDen);
      if (!isNaN(n) && !isNaN(d) && d !== 0) {
        finalVal = `${n}/${d}`;
      }
    } else if (valNum !== '') {
      const n = parseFloat(valNum);
      if (!isNaN(n)) {
        finalVal = n;
      }
    }

    row[col.id] = finalVal;
    saveNotesToStorage();
    renderNumberCell(cellDiv, finalVal, col);
    recalculateTableFooter(table, block, rowDataList);
  };

  const handleBlur = () => {
    // 次のフォーカス先がもう一つの入力フィールドであるかを時間差でチェック
    setTimeout(() => {
      if (document.activeElement !== inputNum && document.activeElement !== inputDen) {
        saveProgressValue();
      }
    }, 10);
  };

  inputNum.addEventListener('blur', handleBlur);
  inputDen.addEventListener('blur', handleBlur);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveProgressValue();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      isSaved = true;
      renderNumberCell(cellDiv, row[col.id], col);
    }
  };

  inputNum.addEventListener('keydown', handleKeyDown);
  inputDen.addEventListener('keydown', handleKeyDown);
}

function formatDatePropertyValueForDisplay(val, col = null) {
  const info = parseDatePropertyValue(val);
  if (!info) return '';

  const mode = col ? (col.dateDisplayMode || 'date') : 'date';

  if (mode === 'date') {
    const formatSingle = (item) => {
      if (!item || !item.date) return '';
      const dStr = item.date.replace(/-/g, '/');
      return item.time ? `${dStr} ${item.time}` : dStr;
    };
    if (info.isRange && info.end && info.end.date) {
      return `${formatSingle(info.start)} ~ ${formatSingle(info.end)}`;
    } else {
      return formatSingle(info.start);
    }
  }

  // 日付オブジェクトの生成
  const start = new Date(info.start.date + (info.start.time ? `T${info.start.time}` : 'T00:00'));
  let end = start;
  if (info.isRange && info.end && info.end.date) {
    end = new Date(info.end.date + (info.end.time ? `T${info.end.time}` : 'T23:59:59'));
  } else {
    end = new Date(info.start.date + 'T23:59:59');
  }

  const diffMs = end.getTime() - start.getTime();

  if (mode === 'duration-days') {
    const days = parseFloat((diffMs / (1000 * 60 * 60 * 24)).toFixed(1));
    return days > 0 ? `${days}日間` : '1日以内';
  }

  if (mode === 'remaining-days') {
    const now = new Date();
    const remainMs = end.getTime() - now.getTime();
    if (remainMs < 0) {
      const overDays = Math.ceil(Math.abs(remainMs) / (1000 * 60 * 60 * 24));
      return `⚠️ 期限切れ (${overDays}日超過)`;
    } else {
      const remainDays = Math.ceil(remainMs / (1000 * 60 * 60 * 24));
      return `⏳ 残り ${remainDays}日`;
    }
  }

  return val;
}

function showDatabaseDatePickerPopover(e, block, rowIndex, colId) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-date-picker-popover';
  popover.style.width = '240px';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  const col = block.properties.columns.find(c => c.id === colId);
  const val = block.properties.rows[rowIndex][colId] || '';
  const dateInfo = parseDatePropertyValue(val) || {
    start: { date: '', time: '' },
    end: null,
    isRange: false
  };

  // HTMLの構築
  popover.innerHTML = `
    <div style="font-size:10px; color:var(--text-muted); font-weight:600; padding:4px 6px; display:flex; justify-content:space-between; align-items:center;">
      <span>日時を設定</span>
      <button class="btn-clear-all-filters" id="btn-clear-date" style="font-size:9px;">クリア</button>
    </div>
    
    <!-- 開始日時 -->
    <div style="padding:6px;">
      <label style="font-size:9px; color:var(--text-muted); font-weight:700; display:block; margin-bottom:2px;">開始</label>
      <input type="date" id="start-date-input" class="db-filter-val-input" style="width:100%; margin-bottom:4px;" value="${dateInfo.start.date}">
      
      <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
        <input type="checkbox" id="start-time-toggle" style="cursor:pointer;" ${dateInfo.start.time ? 'checked' : ''}>
        <span style="font-size:10px; color:var(--text-secondary);">時間を含める</span>
      </div>
      <input type="time" id="start-time-input" class="db-filter-val-input" style="width:100%; margin-top:4px; display:${dateInfo.start.time ? 'block' : 'none'};" value="${dateInfo.start.time}">
    </div>

    <div class="db-popover-divider" style="margin:4px 0;"></div>

    <!-- 期間（終了日）設定 -->
    <div style="padding:6px;">
      <div style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="range-toggle" style="cursor:pointer;" ${dateInfo.isRange ? 'checked' : ''}>
        <span style="font-size:10px; color:var(--text-secondary); font-weight:700;">終了日を追加（期間）</span>
      </div>
      
      <div id="end-datetime-section" style="margin-top:6px; display:${dateInfo.isRange ? 'block' : 'none'};">
        <label style="font-size:9px; color:var(--text-muted); font-weight:700; display:block; margin-bottom:2px;">終了</label>
        <input type="date" id="end-date-input" class="db-filter-val-input" style="width:100%; margin-bottom:4px;" value="${dateInfo.end && dateInfo.end.date ? dateInfo.end.date : ''}">
        
        <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
          <input type="checkbox" id="end-time-toggle" style="cursor:pointer;" ${dateInfo.end && dateInfo.end.time ? 'checked' : ''}>
          <span style="font-size:10px; color:var(--text-secondary);">時間を含める</span>
        </div>
        <input type="time" id="end-time-input" class="db-filter-val-input" style="width:100%; margin-top:4px; display:${dateInfo.end && dateInfo.end.time ? 'block' : 'none'};" value="${dateInfo.end && dateInfo.end.time ? dateInfo.end.time : ''}">
      </div>
    </div>

    <div class="db-popover-divider" style="margin:6px 0 4px 0;"></div>
    <button class="db-filter-apply-btn" id="btn-save-date" style="margin-top:4px; padding:4px 0;">完了</button>
  `;

  // イベント設定
  const startTimeToggle = popover.querySelector('#start-time-toggle');
  const startTimeInput = popover.querySelector('#start-time-input');
  startTimeToggle.addEventListener('change', () => {
    startTimeInput.style.display = startTimeToggle.checked ? 'block' : 'none';
    if (!startTimeToggle.checked) startTimeInput.value = '';
  });

  const rangeToggle = popover.querySelector('#range-toggle');
  const endDatetimeSection = popover.querySelector('#end-datetime-section');
  rangeToggle.addEventListener('change', () => {
    endDatetimeSection.style.display = rangeToggle.checked ? 'block' : 'none';
  });

  const endTimeToggle = popover.querySelector('#end-time-toggle');
  const endTimeInput = popover.querySelector('#end-time-input');
  endTimeToggle.addEventListener('change', () => {
    endTimeInput.style.display = endTimeToggle.checked ? 'block' : 'none';
    if (!endTimeToggle.checked) endTimeInput.value = '';
  });

  // 保存処理
  popover.querySelector('#btn-save-date').addEventListener('click', (evt) => {
    evt.stopPropagation();
    const startDate = popover.querySelector('#start-date-input').value;
    const startTime = startTimeToggle.checked ? popover.querySelector('#start-time-input').value : '';
    const isRange = rangeToggle.checked;
    const endDate = isRange ? popover.querySelector('#end-date-input').value : '';
    const endTime = isRange && endTimeToggle.checked ? popover.querySelector('#end-time-input').value : '';

    if (!startDate) {
      alert('開始日を入力してください。');
      return;
    }

    let finalVal = startDate;
    if (startTime) finalVal += ` ${startTime}`;

    if (isRange && endDate) {
      finalVal += ` ~ ${endDate}`;
      if (endTime) finalVal += ` ${endTime}`;
    }

    block.properties.rows[rowIndex][colId] = finalVal;
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  // クリア処理
  popover.querySelector('#btn-clear-date').addEventListener('click', (evt) => {
    evt.stopPropagation();
    block.properties.rows[rowIndex][colId] = '';
    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  document.body.appendChild(popover);
}

function showCalendarOptionsPopover(e, block, view) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover db-cal-options-popover';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;
  popover.style.width = '200px';

  view.calColIds = view.calColIds || [];
  const columns = block.properties.columns || [];
  // タイトル以外の列を「追加可能なプロパティ」としてすべてテーブルと100%連動して抽出
  const addableCols = columns.filter(c => c.id !== 'col-title');

  popover.innerHTML = `
    <div style="font-size:10px; color:var(--text-muted); font-weight:700; padding:4px 6px; border-bottom:1px solid var(--border-light);">カレンダー表示オプション</div>
    <div style="padding:8px; display:flex; flex-direction:column; gap:8px; max-height: 280px; overflow-y: auto;">
      
      <!-- タイトル表示トグル -->
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:11px; color:var(--text-primary);">タイトルを表示</span>
        <input type="checkbox" id="cal-show-title" style="cursor:pointer;" ${view.calShowTitle ? 'checked' : ''}>
      </div>

      <!-- 時間表示トグル -->
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:11px; color:var(--text-primary);">時間を表示</span>
        <input type="checkbox" id="cal-show-time" style="cursor:pointer;" ${view.calShowTime ? 'checked' : ''}>
      </div>

      <div class="db-popover-divider" style="margin:4px 0;"></div>
      <div style="font-size:9px; color:var(--text-muted); font-weight:700; margin-bottom:2px;">プロパティを追加</div>

      <div id="cal-properties-list" style="display:flex; flex-direction:column; gap:6px;">
        ${addableCols.map(c => {
    const isChecked = view.calColIds.includes(c.id);
    let typeIcon = 'fa-regular fa-file-lines';
    if (c.type === 'number') typeIcon = 'fa-solid fa-hashtag';
    if (c.type === 'select') typeIcon = 'fa-solid fa-list-ul';
    if (c.type === 'status') typeIcon = 'fa-solid fa-circle-check';
    if (c.type === 'checkbox') typeIcon = 'fa-regular fa-square-check';
    if (c.type === 'date') typeIcon = 'fa-regular fa-calendar';

    return `
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:10px; color:var(--text-secondary); display:flex; align-items:center; gap:4px;">
                <i class="${typeIcon}" style="font-size:9px; color:var(--accent-primary);"></i>
                ${escapeHTML(c.name)}
              </span>
              <input type="checkbox" class="cal-prop-check" data-col-id="${c.id}" style="cursor:pointer;" ${isChecked ? 'checked' : ''}>
            </div>
          `;
  }).join('')}
        ${addableCols.length === 0 ? '<div style="font-size:10px; color:var(--text-muted); text-align:center; padding:4px 0;">追加できる列がありません</div>' : ''}
      </div>

    </div>
    <div class="db-popover-divider" style="margin:4px 0 2px 0;"></div>
    <button id="btn-save-cal-options" class="db-filter-apply-btn" style="margin-top:4px; padding:4px 0;">完了</button>
  `;

  const showTitleCheck = popover.querySelector('#cal-show-title');
  const showTimeCheck = popover.querySelector('#cal-show-time');

  popover.querySelector('#btn-save-cal-options').addEventListener('click', (evt) => {
    evt.stopPropagation();
    view.calShowTitle = showTitleCheck.checked;
    view.calShowTime = showTimeCheck.checked;

    // チェックされている列IDを集約して保存！
    const propChecks = popover.querySelectorAll('.cal-prop-check');
    view.calColIds = [];
    propChecks.forEach(chk => {
      if (chk.checked) {
        view.calColIds.push(chk.getAttribute('data-col-id'));
      }
    });

    popover.remove();
    saveNotesToStorage();
    renderEditor();
  });

  document.body.appendChild(popover);
}

function renderCalendarViewDOM(block, rowDataList) {
  const container = document.createElement('div');
  container.className = 'db-calendar-view';
  container.style = 'padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 600px; overflow-x: auto;';

  // 1. カレンダーステートの初期化
  block.properties.calendarYear = block.properties.calendarYear || new Date().getFullYear();
  block.properties.calendarMonth = block.properties.calendarMonth || (new Date().getMonth() + 1);

  const year = block.properties.calendarYear;
  const month = block.properties.calendarMonth;

  // ビューの取得と表示設定の初期化
  const views = block.properties.views || [];
  const activeViewId = block.properties.activeViewId || views[0]?.id;
  const activeView = views.find(v => v.id === activeViewId) || views[0];

  if (activeView) {
    if (activeView.calShowTitle === undefined) activeView.calShowTitle = true;
    if (activeView.calShowTime === undefined) activeView.calShowTime = true;

    // calColIds（表示プロパティ配列）の初期化 ＆ 旧設定からのマイグレーション
    if (!activeView.calColIds) {
      activeView.calColIds = [];
      if (activeView.calShowTags && activeView.calTagColId) {
        activeView.calColIds.push(activeView.calTagColId);
      }
    }
  }

  // 2. カレンダーヘッダー（年月・ボタン）の構築
  const header = document.createElement('div');
  header.className = 'db-calendar-header';
  header.style = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: rgba(0,0,0,0.15); border-radius: 8px; border: 1px solid var(--border-light);';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn-secondary';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.style.padding = '4px 8px; font-size:11px;';
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    block.properties.calendarMonth--;
    if (block.properties.calendarMonth < 1) {
      block.properties.calendarMonth = 12;
      block.properties.calendarYear--;
    }
    saveNotesToStorage();
    renderEditor();
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn-secondary';
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.style.padding = '4px 8px; font-size:11px;';
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    block.properties.calendarMonth++;
    if (block.properties.calendarMonth > 12) {
      block.properties.calendarMonth = 1;
      block.properties.calendarYear++;
    }
    saveNotesToStorage();
    renderEditor();
  });

  const title = document.createElement('span');
  title.style = 'font-size: 13px; font-weight: 700; color: #fff; letter-spacing: 0.5px;';
  title.textContent = `${year}年 ${month}月`;

  // 左側のナビゲーショングループ
  const headerLeft = document.createElement('div');
  headerLeft.style = 'display: flex; align-items: center; gap: 10px;';
  headerLeft.appendChild(prevBtn);
  headerLeft.appendChild(title);
  headerLeft.appendChild(nextBtn);
  header.appendChild(headerLeft);

  // 右側のオプションボタン
  const headerRight = document.createElement('div');
  headerRight.style = 'display: flex; align-items: center; gap: 8px;';

  const optBtn = document.createElement('button');
  optBtn.className = 'btn-secondary';
  optBtn.innerHTML = '<i class="fa-solid fa-sliders"></i> 表示オプション';
  optBtn.style.padding = '4px 8px; font-size:11px;';
  optBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showCalendarOptionsPopover(e, block, activeView);
  });
  headerRight.appendChild(optBtn);
  header.appendChild(headerRight);

  container.appendChild(header);

  // 3. カレンダーグリッドの作成
  const gridContainer = document.createElement('div');
  gridContainer.style = 'display: flex; flex-direction: column; width: 100%; border: 1px solid var(--border-light); border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.1);';

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const headerRow = document.createElement('div');
  headerRow.style = 'display: grid; grid-template-columns: repeat(7, 1fr); width: 100%; border-bottom: 1.5px solid var(--border-light); background: rgba(255,255,255,0.02);';
  weekdays.forEach((day, idx) => {
    const dayEl = document.createElement('div');
    dayEl.style = `text-align: center; font-size: 11px; font-weight: 700; padding: 8px 0; border-right: ${idx < 6 ? '1px solid var(--border-light)' : 'none'}; color: ${idx === 0 ? '#f87171' : (idx === 6 ? '#60a5fa' : 'var(--text-secondary)')};`;
    dayEl.textContent = day;
    headerRow.appendChild(dayEl);
  });
  gridContainer.appendChild(headerRow);

  // 日付の計算
  const firstDayIndex = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const prevLastDate = new Date(year, month - 1, 0).getDate();

  const days = [];
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    days.push({ day: prevLastDate - i, isCurrentMonth: false, monthOffset: -1 });
  }
  for (let i = 1; i <= lastDate; i++) {
    days.push({ day: i, isCurrentMonth: true, monthOffset: 0 });
  }
  const totalCells = Math.ceil(days.length / 7) * 7;
  const nextMonthDaysCount = totalCells - days.length;
  for (let i = 1; i <= nextMonthDaysCount; i++) {
    days.push({ day: i, isCurrentMonth: false, monthOffset: 1 });
  }

  const dateCol = block.properties.columns.find(c => c.type === 'date');
  const titleCol = block.properties.columns.find(c => c.id === 'col-title') || block.properties.columns[0];

  // 日付リストを7日ずつの週配列に分割
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // 週ごとに構築
  weeks.forEach(week => {
    const weekRow = document.createElement('div');
    weekRow.className = 'db-calendar-week-row';

    // この週の開始日時と終了日時を取得
    const firstDay = week[0];
    const lastDay = week[6];
    const weekStartDate = new Date(year, month - 1 + firstDay.monthOffset, firstDay.day);
    weekStartDate.setHours(0, 0, 0, 0);
    const weekEndDate = new Date(year, month - 1 + lastDay.monthOffset, lastDay.day);
    weekEndDate.setHours(23, 59, 59, 999);

    // 1. 背景の日付セルと日付ラベルを配置
    week.forEach((d, dayIdx) => {
      const cell = document.createElement('div');
      cell.className = 'db-calendar-bg-cell';
      if (!d.isCurrentMonth) {
        cell.className += ' other-month';
      }
      cell.style.gridColumn = `${dayIdx + 1}`;
      if (dayIdx === 6) {
        cell.style.borderRight = 'none';
      }

      const targetDate = new Date(year, month - 1 + d.monthOffset, d.day);

      // 日付ラベルの配置
      const label = document.createElement('div');
      label.className = 'db-calendar-day-label';
      label.style.color = d.isCurrentMonth
        ? (targetDate.getDay() === 0 ? '#fca5a5' : (targetDate.getDay() === 6 ? '#93c5fd' : 'var(--text-secondary)'))
        : 'var(--text-muted)';
      label.textContent = d.day;
      label.style.gridColumn = `${dayIdx + 1}`;

      weekRow.appendChild(cell);
      weekRow.appendChild(label);
    });

    // 2. この週に重なるイベントを抽出
    const weekEvents = [];
    if (dateCol) {
      rowDataList.forEach(row => {
        const val = row[dateCol.id];
        if (!val) return;

        const dateInfo = parseDatePropertyValue(val);
        if (!dateInfo || !dateInfo.start.date) return;

        const startD = new Date(dateInfo.start.date);
        startD.setHours(0, 0, 0, 0);

        let endD = new Date(startD);
        if (dateInfo.isRange && dateInfo.end && dateInfo.end.date) {
          endD = new Date(dateInfo.end.date);
        }
        endD.setHours(23, 59, 59, 999);

        // 重なり判定
        if (startD.getTime() <= weekEndDate.getTime() && endD.getTime() >= weekStartDate.getTime()) {
          // 週の中でのスパン範囲（曜日 0〜6）を求める
          let startIdx = 0;
          if (startD.getTime() > weekStartDate.getTime()) {
            startIdx = startD.getDay();
          }

          let endIdx = 6;
          if (endD.getTime() < weekEndDate.getTime()) {
            endIdx = endD.getDay();
          }

          weekEvents.push({
            row,
            startD,
            endD,
            startIdx,
            endIdx,
            dateInfo
          });
        }
      });
    }

    // 開始曜日順にソート
    weekEvents.sort((a, b) => a.startIdx - b.startIdx);

    // 重複を避けるためのレーン割り当て（パック処理）
    const lanes = [];
    weekEvents.forEach(evt => {
      let assignedLane = 0;
      while (true) {
        if (lanes[assignedLane] === undefined || lanes[assignedLane] < evt.startIdx) {
          lanes[assignedLane] = evt.endIdx;
          break;
        }
        assignedLane++;
      }
      evt.lane = assignedLane;
    });

    // 3. 前面に予定バーを配置
    weekEvents.forEach(evt => {
      const bar = document.createElement('div');
      bar.className = 'db-calendar-event-bar';

      // タイトルの決定
      const rowTitle = evt.row[titleCol.id] || '無題';

      // バーのカラーテーマ決定
      let barColorClass = 'db-calendar-bar-primary';
      const selectCol = block.properties.columns.find(c => c.type === 'select' || c.type === 'status');
      if (selectCol) {
        const val = evt.row[selectCol.id];
        if (val) {
          let tagColor = '';
          if (selectCol.type === 'status') {
            tagColor = getStatusOptionColor(selectCol, val) || 'gray';
          } else {
            tagColor = getTagColor(selectCol, val) || 'gray';
          }

          if (tagColor === 'red') barColorClass = 'db-calendar-bar-danger';
          else if (tagColor === 'green') barColorClass = 'db-calendar-bar-success';
          else if (tagColor === 'yellow' || tagColor === 'orange') barColorClass = 'db-calendar-bar-warning';
          else if (tagColor === 'blue') barColorClass = 'db-calendar-bar-info';
        }
      }
      bar.className += ' ' + barColorClass;

      // grid配置: カラムは曜日範囲、行は割り当てレーン (2行目以降)
      bar.style.gridColumn = `${evt.startIdx + 1} / ${evt.endIdx + 2}`;
      bar.style.gridRow = `${evt.lane + 2}`;

      // バーの中身の構築
      let badgeContent = '';

      // 1. 追加プロパティの動的ループ描画
      if (activeView.calColIds && activeView.calColIds.length > 0) {
        activeView.calColIds.forEach(colId => {
          const col = block.properties.columns.find(c => c.id === colId);
          const val = evt.row[colId];
          if (col && val !== undefined && val !== null && val !== '') {
            if (col.type === 'status') {
              const optName = getStatusOptionName(col, val) || val;
              const optColor = getStatusOptionColor(col, val) || 'gray';
              badgeContent += `<span class="db-select-badge db-tag-${optColor}" style="font-size:8px; padding: 0px 2.5px; border-radius: 2px; line-height: 1.1; scale: 0.95; white-space: nowrap;">${escapeHTML(optName)}</span>`;
            } else if (col.type === 'select') {
              badgeContent += `<span class="db-select-badge db-tag-${getTagColor(col, val)}" style="font-size:8px; padding: 0px 2.5px; border-radius: 2px; line-height: 1.1; scale: 0.95; white-space: nowrap;">${escapeHTML(val)}</span>`;
            } else if (col.type === 'checkbox') {
              if (val === true) {
                badgeContent += `<span style="font-size:8px; color:var(--accent-primary); font-weight:bold; white-space: nowrap;">[✓]</span>`;
              } else {
                badgeContent += `<span style="font-size:8px; opacity:0.5; white-space: nowrap;">[ ]</span>`;
              }
            } else if (col.type === 'date') {
              const displayDateStr = formatDatePropertyValueForDisplay(val, col);
              if (displayDateStr) {
                badgeContent += `<span class="db-select-badge" style="font-size:8px; padding: 0.5px 3.5px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 3px; color: #c084fc; line-height: 1.1; white-space: nowrap; scale: 0.95; display: inline-block;">${escapeHTML(displayDateStr)}</span>`;
              }
            } else {
              let displayVal = String(val);
              if (col.type === 'number') {
                displayVal = formatNumberValue(val, col);
              }
              badgeContent += `<span style="font-size:8px; padding: 0px 2px; background:rgba(255,255,255,0.06); border-radius: 2px; color:var(--text-secondary); line-height: 1.1; white-space: nowrap;">${escapeHTML(displayVal)}</span>`;
            }
          }
        });
      }

      // 1.5 日付の表示モード反映テキストの追加
      if (dateCol) {
        const rawDateVal = evt.row[dateCol.id];
        if (dateCol.displayMode && dateCol.displayMode !== 'date') {
          const displayDateStr = formatDatePropertyValueForDisplay(rawDateVal, dateCol);
          if (displayDateStr) {
            badgeContent += `<span style="font-size: 8px; padding: 0.5px 3.5px; background: rgba(0, 0, 0, 0.28); border-radius: 4px; color: #a78bfa; font-weight: bold; white-space: nowrap; scale: 0.95; display: inline-block;">${escapeHTML(displayDateStr)}</span>`;
          }
        }
      }

      // 2. 時間表示
      if (activeView.calShowTime && evt.dateInfo && evt.dateInfo.start.time) {
        badgeContent += `<span style="opacity: 0.8; font-size: 8px; font-weight: 500; white-space: nowrap;">${evt.dateInfo.start.time}</span>`;
      }

      // 3. タイトル表示
      if (activeView.calShowTitle) {
        badgeContent += `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(rowTitle)}</span>`;
      } else {
        if (!activeView.calShowTime && (!activeView.calColIds || activeView.calColIds.length === 0)) {
          badgeContent += `<span>●</span>`;
        }
      }

      // 2. 時間表示
      if (activeView.calShowTime && evt.dateInfo && evt.dateInfo.start.time) {
        badgeContent += `<span style="opacity: 0.8; font-size: 8px; font-weight: 500; white-space: nowrap;">${evt.dateInfo.start.time}</span>`;
      }

      // 3. タイトル表示
      if (activeView.calShowTitle) {
        badgeContent += `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(rowTitle)}</span>`;
      } else {
        if (!activeView.calShowTime && (!activeView.calColIds || activeView.calColIds.length === 0)) {
          badgeContent += `<span>●</span>`;
        }
      }

      bar.innerHTML = badgeContent;
      bar.title = `${rowTitle} (${formatDatePropertyValueForDisplay(evt.row[dateCol.id], dateCol)})`;

      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        showDatabaseDatePickerPopover(e, block, block.properties.rows.indexOf(evt.row), dateCol.id);
      });

      weekRow.appendChild(bar);
    });

    gridContainer.appendChild(weekRow);
  });

  container.appendChild(gridContainer);
  return container;
}

function renderChartViewDOM(block, rowDataList) {
  const container = document.createElement('div');
  container.className = 'db-chart-view';
  container.style = 'padding: 16px; display: flex; flex-direction: column; gap: 16px; min-height: 380px;';

  const views = block.properties.views || [];
  const activeViewId = block.properties.activeViewId || views[0]?.id;
  let activeView = views.find(v => v.id === activeViewId) || views[0];

  // 🚨 ビューが一切ない場合の完全安全ガード（かつデータベースのプロパティを自動自己修復）
  if (!activeView) {
    activeView = {
      id: generateId(),
      name: 'デフォルトグラフ',
      type: 'chart',
      layout: 'chart-bar',
      chartTimeRange: 'all',
      chartDateGroup: 'month',
      chartRenderType: 'split',
      chartTagMode: 'all',
      chartSelectedTag: '',
      chartSelectedTags: [],
      filters: []
    };
    block.properties.views = [activeView];
    block.properties.activeViewId = activeView.id;
  } else {
    activeView.chartTimeRange = activeView.chartTimeRange || 'all';
    activeView.chartDateGroup = activeView.chartDateGroup || 'month';
    activeView.chartRenderType = activeView.chartRenderType || 'split'; // 🆕 表示形式のデフォルト値
    activeView.chartTagMode = activeView.chartTagMode || 'all'; // 🆕 'all' or 'single'
    activeView.chartSelectedTag = activeView.chartSelectedTag !== undefined ? activeView.chartSelectedTag : ''; // 🆕 選択された単一 of タグ文字列
    activeView.chartSelectedTags = activeView.chartSelectedTags || (activeView.chartSelectedTag ? [activeView.chartSelectedTag] : []);
    activeView.filters = activeView.filters || [];
  }

  // 軸 of グラフの自動インテリジェント適合・復元（軸設定のインライン化）
  const dateCol = block.properties.columns.find(c => c.type === 'date');
  const nonDateCols = block.properties.columns.filter(c => c.type !== 'date');
  const tagCol = nonDateCols.find(c => c.type === 'select' || c.type === 'status')
    || nonDateCols.find(c => c.type === 'text')
    || nonDateCols[0] || block.properties.columns[0];
  const numberCol = block.properties.columns.find(c => c.type === 'number') || dateCol || block.properties.columns[0];

  // グループの欄から日付はなくすため、X軸には常に非日付列（カテゴリ列）を優先的にセットする
  if (!activeView.chartXColId || !nonDateCols.some(c => c.id === activeView.chartXColId)) {
    activeView.chartXColId = tagCol ? tagCol.id : null;
  }

  // Y軸（集計値）の初期適合
  if (!activeView.chartYColId || !['y-minutes', 'y-hours', 'y-days', 'y-number'].includes(activeView.chartYColId)) {
    activeView.chartYColId = dateCol ? 'y-hours' : (numberCol ? 'y-number' : 'y-hours');
  }

  const xCol = block.properties.columns.find(c => c.id === activeView.chartXColId);

  // 固定キーから、対象となる列(yCol)と換算単位(yUnit)を動的に判定
  const dateCols = block.properties.columns.filter(c => c.type === 'date');
  const numberCols = block.properties.columns.filter(c => c.type === 'number');
  const dateColObj = dateCols[0] || null;
  const numberColObj = numberCols[0] || null;

  let yCol = null;
  let yUnit = 'hours';

  if (activeView.chartYColId === 'y-minutes') {
    yCol = dateColObj;
    yUnit = 'minutes';
  } else if (activeView.chartYColId === 'y-hours') {
    yCol = dateColObj;
    yUnit = 'hours';
  } else if (activeView.chartYColId === 'y-days') {
    yCol = dateColObj;
    yUnit = 'days';
  } else if (activeView.chartYColId === 'y-number') {
    yCol = numberColObj;
    yUnit = 'number';
  }

  // 1. クイック設定ヘッダーの描画（集計タグ列や対象タグ値セレクトは＆フィルターに一本化したため削除）
  const controlHeader = document.createElement('div');
  controlHeader.style = 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 8px 12px; background: rgba(0,0,0,0.15); border-radius: 8px; border: 1px solid var(--border-light);';

  const headerLeft = document.createElement('div');
  headerLeft.style = 'display: flex; align-items: center; gap: 14px; flex-wrap: wrap;';

  // A. 期間フィルターセレクト
  const timeRangeLabel = document.createElement('label');
  timeRangeLabel.style = 'font-size: 10px; color: var(--text-secondary); font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer;';
  timeRangeLabel.innerHTML = '<i class="fa-regular fa-calendar" style="color:var(--accent-primary);"></i> 期間';

  const timeRangeSelect = document.createElement('select');
  timeRangeSelect.className = 'db-filter-val-select';
  timeRangeSelect.style.fontSize = '11px';
  timeRangeSelect.style.padding = '2px 6px';
  timeRangeSelect.innerHTML = `
    <option value="all" ${activeView.chartTimeRange === 'all' ? 'selected' : ''}>全期間</option>
    <option value="week" ${activeView.chartTimeRange === 'week' ? 'selected' : ''}>今週</option>
    <option value="month" ${activeView.chartTimeRange === 'month' ? 'selected' : ''}>今月</option>
    <option value="year" ${activeView.chartTimeRange === 'year' ? 'selected' : ''}>今年</option>
  `;
  timeRangeSelect.addEventListener('change', () => {
    activeView.chartTimeRange = timeRangeSelect.value;

    // X軸が日付列の場合、選択された期間フィルターに基づいて、集計単位をインテリジェントに自動切替
    if (xCol && xCol.type === 'date') {
      if (activeView.chartTimeRange === 'week' || activeView.chartTimeRange === 'month') {
        activeView.chartDateGroup = 'day'; // 今週・今月は「日別」
      } else if (activeView.chartTimeRange === 'year' || activeView.chartTimeRange === 'all') {
        activeView.chartDateGroup = 'month'; // 今年・全期間は「月別」
      }
    }

    saveNotesToStorage();
    renderEditor();
  });
  timeRangeLabel.appendChild(timeRangeSelect);
  headerLeft.appendChild(timeRangeLabel);

  // B. 表示形式（合計・分割）セレクトの追加 🆕
  const renderTypeLabel = document.createElement('label');
  renderTypeLabel.style = 'font-size: 10px; color: var(--text-secondary); font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer;';
  renderTypeLabel.innerHTML = '<i class="fa-solid fa-chart-pie" style="color:var(--accent-primary);"></i> 表示形式';

  const renderTypeSelect = document.createElement('select');
  renderTypeSelect.className = 'db-filter-val-select';
  renderTypeSelect.style.fontSize = '11px';
  renderTypeSelect.style.padding = '2px 6px';
  renderTypeSelect.innerHTML = `
    <option value="split" ${activeView.chartRenderType === 'split' ? 'selected' : ''}>分割表示</option>
    <option value="total" ${activeView.chartRenderType === 'total' ? 'selected' : ''}>合計表示</option>
  `;
  renderTypeSelect.addEventListener('change', () => {
    activeView.chartRenderType = renderTypeSelect.value;
    saveNotesToStorage();
    renderEditor();
  });
  renderTypeLabel.appendChild(renderTypeSelect);
  headerLeft.appendChild(renderTypeLabel);

  // C. グループ（横軸）セレクトの追加
  const xColLabel = document.createElement('label');
  xColLabel.style = 'font-size: 10px; color: var(--text-secondary); font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer;';
  xColLabel.innerHTML = '<i class="fa-solid fa-list-ul" style="color:var(--accent-secondary);"></i> グループ';

  const xColSelect = document.createElement('select');
  xColSelect.className = 'db-filter-val-select';
  xColSelect.style.fontSize = '11px';
  xColSelect.style.padding = '2px 6px';

  // 日付以外のすべての列プロパティを横軸（グループ）の選択肢として提供
  const xOptions = block.properties.columns.filter(c => c.type !== 'date');

  xColSelect.innerHTML = xOptions.map(c => `
    <option value="${c.id}" ${activeView.chartXColId === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>
  `).join('');

  xColSelect.addEventListener('change', () => {
    activeView.chartXColId = xColSelect.value;
    saveNotesToStorage();
    renderEditor();
  });
  xColLabel.appendChild(xColSelect);
  headerLeft.appendChild(xColLabel);

  // 🆕 表示対象（全セレクトタグ・セレクトタグ指定トグルタブ ＆ プルダウンセレクト）の新設
  const tagFilterWrapper = document.createElement('div');
  tagFilterWrapper.style = 'display: flex; align-items: center; gap: 8px;';

  const tabContainer = document.createElement('div');
  tabContainer.className = 'chart-tab-container';
  tabContainer.style = 'display: flex; background: rgba(255,255,255,0.06); padding: 2px; border-radius: 6px; border: 1px solid var(--border-light);';

  const tabAll = document.createElement('button');
  tabAll.style = `padding: 2px 8px; font-size: 11px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; background: ${activeView.chartTagMode === 'all' ? 'var(--accent-primary)' : 'transparent'}; color: ${activeView.chartTagMode === 'all' ? '#fff' : 'var(--text-secondary)'}; transition: all 0.2s ease;`;
  tabAll.textContent = '全セレクトタグ';
  tabAll.addEventListener('click', (e) => {
    e.stopPropagation();
    activeView.chartTagMode = 'all';
    saveNotesToStorage();
    renderEditor();
  });

  const tabSelect = document.createElement('button');
  tabSelect.style = `padding: 2px 8px; font-size: 11px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; background: ${activeView.chartTagMode === 'single' ? 'var(--accent-primary)' : 'transparent'}; color: ${activeView.chartTagMode === 'single' ? '#fff' : 'var(--text-secondary)'}; transition: all 0.2s ease;`;
  tabSelect.textContent = 'セレクトタグ指定';
  tabSelect.addEventListener('click', (e) => {
    e.stopPropagation();
    activeView.chartTagMode = 'single';
    saveNotesToStorage();
    renderEditor();
  });

  tabContainer.appendChild(tabAll);
  tabContainer.appendChild(tabSelect);
  tagFilterWrapper.appendChild(tabContainer);

  if (activeView.chartTagMode === 'single') {
    // データベース内のユニークなタグ（値）を抽出
    const uniqueTags = new Set();

    // X軸が「セレクトタグ」または「ステータス」列の場合、定義されているすべての選択肢オプションを自動挿入
    if (xCol) {
      if (xCol.type === 'select' && xCol.options && Array.isArray(xCol.options)) {
        xCol.options.forEach(opt => {
          if (opt) {
            const name = typeof opt === 'string' ? opt : (opt.name || opt.id || '');
            if (name) uniqueTags.add(name.trim());
          }
        });
      } else if (xCol.type === 'status' && xCol.options && Array.isArray(xCol.options)) {
        xCol.options.forEach(opt => {
          if (opt) {
            const name = typeof opt === 'string' ? opt : (opt.name || opt.id || '');
            if (name) uniqueTags.add(name.trim());
          }
        });
      }
    }

    const rows = rowDataList || [];
    rows.forEach(row => {
      if (xCol) {
        const rawTag = row[xCol.id];
        let tagVal = '選択なし';
        if (xCol.type === 'status') {
          tagVal = getStatusOptionName(xCol, rawTag) || '未着手';
        } else if (xCol.type === 'select') {
          tagVal = String(rawTag || '選択なし').trim();
        } else {
          tagVal = String(rawTag || '名称未設定').trim();
        }
        uniqueTags.add(tagVal);
      }
    });

    const tagList = Array.from(uniqueTags);

    // 複数選択用プロパティの初期化・同期
    activeView.chartSelectedTags = activeView.chartSelectedTags || [];
    if (activeView.chartSelectedTags.length === 0 && activeView.chartSelectedTag) {
      activeView.chartSelectedTags = [activeView.chartSelectedTag];
    }
    if (activeView.chartSelectedTags.length === 0 && tagList.length > 0) {
      activeView.chartSelectedTags = [tagList[0]];
    }

    const selectBtn = document.createElement('button');
    selectBtn.className = 'db-filter-val-select';
    selectBtn.style = 'font-size: 11px; padding: 3px 8px; background: rgba(255,255,255,0.06); color: var(--text-primary); border: 1px solid var(--border-light); border-radius: 6px; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; gap: 6px; position: relative; font-weight: 600;';

    const updateBtnLabel = () => {
      const selectedCount = activeView.chartSelectedTags.filter(t => uniqueTags.has(t)).length;
      if (selectedCount === 0) {
        selectBtn.innerHTML = 'タグ未指定 <i class="fa-solid fa-chevron-down" style="font-size:9px; opacity:0.7;"></i>';
      } else if (selectedCount === tagList.length) {
        selectBtn.innerHTML = '全タグ指定中 <i class="fa-solid fa-chevron-down" style="font-size:9px; opacity:0.7;"></i>';
      } else {
        selectBtn.innerHTML = `タグ指定 (${selectedCount}) <i class="fa-solid fa-chevron-down" style="font-size:9px; opacity:0.7;"></i>`;
      }
    };
    updateBtnLabel();

    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const existingPopover = document.getElementById('db-chart-multi-tag-popover');
      if (existingPopover) {
        existingPopover.remove();
        return;
      }

      const popover = document.createElement('div');
      popover.id = 'db-chart-multi-tag-popover';
      popover.style = 'position: fixed; z-index: 9999; background: rgba(20, 24, 38, 0.96); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); padding: 6px; min-width: 170px; max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;';

      const rect = selectBtn.getBoundingClientRect();
      popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
      popover.style.left = `${rect.left + window.scrollX}px`;

      if (tagList.length === 0) {
        const noTag = document.createElement('div');
        noTag.style = 'font-size: 11px; padding: 6px 10px; color: var(--text-muted); text-align: center;';
        noTag.textContent = 'タグなし';
        popover.appendChild(noTag);
      } else {
        tagList.forEach(tag => {
          const label = document.createElement('label');
          label.style = 'display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 5px; font-size: 11px; color: var(--text-primary); cursor: pointer; transition: background 0.15s ease; user-select: none;';

          label.addEventListener('mouseenter', () => {
            label.style.background = 'rgba(255,255,255,0.08)';
          });
          label.addEventListener('mouseleave', () => {
            label.style.background = 'transparent';
          });

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.style = 'cursor: pointer; width: 13px; height: 13px; accent-color: var(--accent-primary); margin: 0;';
          checkbox.checked = activeView.chartSelectedTags.includes(tag);

          checkbox.addEventListener('change', (evt) => {
            evt.stopPropagation();
            if (checkbox.checked) {
              if (!activeView.chartSelectedTags.includes(tag)) {
                activeView.chartSelectedTags.push(tag);
              }
            } else {
              activeView.chartSelectedTags = activeView.chartSelectedTags.filter(t => t !== tag);
            }
            activeView.chartSelectedTag = activeView.chartSelectedTags[0] || '';
            saveNotesToStorage();
            updateBtnLabel();
          });

          label.appendChild(checkbox);

          const span = document.createElement('span');
          span.textContent = tag;
          span.style = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
          label.appendChild(span);

          popover.appendChild(label);
        });
      }

      document.body.appendChild(popover);

      const closePopover = (evt) => {
        if (!popover.contains(evt.target) && evt.target !== selectBtn) {
          popover.remove();
          document.removeEventListener('click', closePopover);
          renderEditor(); // 閉じた瞬間に再描画してグラフを動的に更新！
        }
      };

      setTimeout(() => {
        document.addEventListener('click', closePopover);
      }, 0);
    });

    tagFilterWrapper.appendChild(selectBtn);
  }

  headerLeft.appendChild(tagFilterWrapper);

  // C. 集計値（縦軸）セレクトの追加
  const yColLabel = document.createElement('label');
  yColLabel.style = 'font-size: 10px; color: var(--text-secondary); font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer;';
  yColLabel.innerHTML = '<i class="fa-solid fa-calculator" style="color:#10b981;"></i> 集計値';

  const yColSelect = document.createElement('select');
  yColSelect.className = 'db-filter-val-select';
  yColSelect.style.fontSize = '11px';
  yColSelect.style.padding = '2px 6px';

  // 常に「分」「時間」「日数」「数値」の4つの固定オプションを表示
  const hasDateCol = block.properties.columns.some(c => c.type === 'date');
  const hasNumCol = block.properties.columns.some(c => c.type === 'number');

  yColSelect.innerHTML = `
    <option value="y-minutes" ${activeView.chartYColId === 'y-minutes' ? 'selected' : ''} ${!hasDateCol ? 'disabled style="color:var(--text-muted);"' : ''}>分</option>
    <option value="y-hours" ${activeView.chartYColId === 'y-hours' ? 'selected' : ''} ${!hasDateCol ? 'disabled style="color:var(--text-muted);"' : ''}>時間</option>
    <option value="y-days" ${activeView.chartYColId === 'y-days' ? 'selected' : ''} ${!hasDateCol ? 'disabled style="color:var(--text-muted);"' : ''}>日数</option>
    <option value="y-number" ${activeView.chartYColId === 'y-number' ? 'selected' : ''} ${!hasNumCol ? 'disabled style="color:var(--text-muted);"' : ''}>数値</option>
  `;

  yColSelect.addEventListener('change', () => {
    activeView.chartYColId = yColSelect.value;
    saveNotesToStorage();
    renderEditor();
  });
  yColLabel.appendChild(yColSelect);
  headerLeft.appendChild(yColLabel);

  // D. X軸が日付列かつ分割表示の場合のみ「日付グループ化」セレクトを表示
  if (xCol && xCol.type === 'date' && activeView.chartRenderType !== 'total') {
    const dateGroupLabel = document.createElement('label');
    dateGroupLabel.style = 'font-size: 10px; color: var(--text-secondary); font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer;';
    dateGroupLabel.innerHTML = '<i class="fa-solid fa-cubes" style="color:#60a5fa;"></i> 集計単位';

    const dateGroupSelect = document.createElement('select');
    dateGroupSelect.className = 'db-filter-val-select';
    dateGroupSelect.style.fontSize = '11px';
    dateGroupSelect.style.padding = '2px 6px';
    dateGroupSelect.innerHTML = `
      <option value="day" ${activeView.chartDateGroup === 'day' ? 'selected' : ''}>日別</option>
      <option value="month" ${activeView.chartDateGroup === 'month' ? 'selected' : ''}>月別</option>
      <option value="year" ${activeView.chartDateGroup === 'year' ? 'selected' : ''}>年別</option>
    `;
    dateGroupSelect.addEventListener('change', () => {
      activeView.chartDateGroup = dateGroupSelect.value;
      saveNotesToStorage();
      renderEditor();
    });
    dateGroupLabel.appendChild(dateGroupSelect);
    headerLeft.appendChild(dateGroupLabel);
  }

  controlHeader.appendChild(headerLeft);

  container.appendChild(controlHeader);

  // 1.5 適用中フィルター条件の動的「＆」表示
  if (activeView.filters && activeView.filters.length > 0) {
    const filterLabels = [];
    activeView.filters.forEach(filter => {
      const col = block.properties.columns.find(c => c.id === filter.columnId);
      if (col && filter.value !== undefined && filter.value !== '') {
        let displayVal = filter.value;
        if (col.type === 'status') {
          displayVal = getStatusOptionName(col, filter.value);
        }
        filterLabels.push(`「${escapeHTML(col.name)}」＝「${escapeHTML(displayVal)}」`);
      }
    });
    if (filterLabels.length > 0) {
      const filterLabelDiv = document.createElement('div');
      filterLabelDiv.style = 'font-size: 11px; color: var(--accent-primary); font-weight: 600; padding: 6px 10px; background: rgba(139, 92, 246, 0.08); border-radius: 6px; border: 1px dashed rgba(139, 92, 246, 0.35); display: flex; align-items: center; gap: 6px;';
      filterLabelDiv.innerHTML = `<i class="fa-solid fa-filter"></i> 適用中の条件: ${filterLabels.join(' & ')}`;
      container.appendChild(filterLabelDiv);
    }
  }

  if (!xCol || !yCol) {
    const noData = document.createElement('div');
    noData.className = 'no-data-msg';
    noData.style = 'padding: 40px; text-align: center; border: 1px dashed var(--border-light); border-radius:8px;';
    noData.innerHTML = `
        <i class="fa-solid fa-chart-line" style="font-size: 32px; color: var(--text-muted); margin-bottom: 12px; display: block;"></i>
        集計表示に必要な列プロパティがデータベースに見つかりません。`;
    container.appendChild(noData);
    return container;
  }

  // 1.8 データベースのタグカラーをグラフカラーにマッピングするヘルパー
  const getActualColorCode = (colorName) => {
    const colorMap = {
      red: '#ef4444',
      blue: '#3b82f6',
      green: '#10b981',
      yellow: '#fbbf24',
      purple: '#8b5cf6',
      pink: '#ec4899',
      gray: '#6b7280',
      orange: '#f97316',
      brown: '#78350f',
      teal: '#14b8a6'
    };
    return colorMap[colorName] || '#6b7280';
  };

  const getTagColorForGraph = (col, tagName) => {
    if (!col) return 'var(--accent-secondary)';
    const options = col.options || [];
    const found = options.find(opt => opt.name === tagName || opt.id === tagName);
    let colorName = found ? found.color : getTagColor(tagName);
    return getActualColorCode(colorName);
  };

  // 2. データのフィルタリング（期間のみ。＆フィルターはすでに visibleRows としてフィルタリング済み）
  let filteredRows = rowDataList || [];
  const now = new Date();

  // 期間フィルターの計算
  const getWeekRange = () => {
    const start = new Date();
    const first = start.getDate() - start.getDay();
    start.setDate(first);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  if (activeView.chartTimeRange === 'week') {
    const range = getWeekRange();
    filteredRows = filteredRows.filter(row => {
      const dateCols = block.properties.columns.filter(c => c.type === 'date');
      const targetFilterCol = (xCol && xCol.type === 'date') ? xCol : (dateCols.length > 0 ? dateCols[0] : null);
      if (!targetFilterCol) return true;
      const val = row[targetFilterCol.id];
      const parsed = parseDatePropertyValue(val);
      if (!parsed || !parsed.start.date) return false;
      const d = new Date(parsed.start.date);
      return d.getTime() >= range.start.getTime() && d.getTime() <= range.end.getTime();
    });
  } else if (activeView.chartTimeRange === 'month') {
    filteredRows = filteredRows.filter(row => {
      const dateCols = block.properties.columns.filter(c => c.type === 'date');
      const targetFilterCol = (xCol && xCol.type === 'date') ? xCol : (dateCols.length > 0 ? dateCols[0] : null);
      if (!targetFilterCol) return true;
      const val = row[targetFilterCol.id];
      const parsed = parseDatePropertyValue(val);
      if (!parsed || !parsed.start.date) return false;
      const d = new Date(parsed.start.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  } else if (activeView.chartTimeRange === 'year') {
    filteredRows = filteredRows.filter(row => {
      const dateCols = block.properties.columns.filter(c => c.type === 'date');
      const targetFilterCol = (xCol && xCol.type === 'date') ? xCol : (dateCols.length > 0 ? dateCols[0] : null);
      if (!targetFilterCol) return true;
      const val = row[targetFilterCol.id];
      const parsed = parseDatePropertyValue(val);
      if (!parsed || !parsed.start.date) return false;
      const d = new Date(parsed.start.date);
      return d.getFullYear() === now.getFullYear();
    });
  }

  // 3. データの集計
  const getXLabel = (row, col) => {
    if (!col) return '名称未設定';
    // 合計表示かつX軸が日付列の場合、期間全体の合計値として単一のラベルに集約（具体的な数字・範囲を表記）
    if (activeView.chartRenderType === 'total' && col.type === 'date') {
      if (activeView.chartTimeRange === 'week') {
        const range = getWeekRange();
        const startM = range.start.getMonth() + 1;
        const startD = range.start.getDate();
        const endM = range.end.getMonth() + 1;
        const endD = range.end.getDate();
        return `今週の合計 (${startM}/${startD}〜${endM}/${endD})`;
      } else if (activeView.chartTimeRange === 'month') {
        const currentM = now.getMonth() + 1;
        return `${currentM}月の合計`;
      } else if (activeView.chartTimeRange === 'year') {
        const currentY = now.getFullYear();
        return `${currentY}年の合計`;
      } else {
        // 全期間の最小・最大年を算出
        const dateCols = block.properties.columns.filter(c => c.type === 'date');
        let minYear = now.getFullYear();
        let maxYear = now.getFullYear();
        if (dateCols.length > 0) {
          rowDataList.forEach(r => {
            const val = r[dateCols[0].id];
            const parsed = parseDatePropertyValue(val);
            if (parsed && parsed.start.date) {
              const y = new Date(parsed.start.date).getFullYear();
              if (y < minYear) minYear = y;
              if (y > maxYear) maxYear = y;
            }
          });
        }
        if (minYear === maxYear) {
          return `${minYear}年の合計`;
        }
        return `全期間の合計 (${minYear}年〜${maxYear}年)`;
      }
    }

    const rawVal = row[col.id];
    if (col.type === 'status') {
      return getStatusOptionName(col, rawVal) || '未着手';
    } else if (col.type === 'date') {
      const dateInfo = parseDatePropertyValue(rawVal);
      if (dateInfo && dateInfo.start.date) {
        const d = new Date(dateInfo.start.date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        if (activeView.chartDateGroup === 'year') {
          return `${y}年`;
        } else if (activeView.chartDateGroup === 'day') {
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}/${m}/${day}`;
        } else {
          return `${y}/${m}`; // 月別
        }
      }
      return '日付なし';
    } else if (col.type === 'select') {
      return String(rawVal || '選択なし').trim();
    }
    return String(rawVal || '名称未設定').trim();
  };

  const getYValue = (row, col, yUnit = 'hours') => {
    if (yUnit === 'number') {
      const numCol = col || block.properties.columns.find(c => c.type === 'number');
      if (!numCol) return 0;
      const rawVal = row[numCol.id];
      if (numCol.type === 'number') {
        return parseFloat(rawVal) || 0;
      } else if (numCol.type === 'checkbox') {
        return rawVal === true ? 1 : 0;
      } else {
        const strVal = String(rawVal || '').trim();
        if (!strVal) return 0;
        const numMatch = strVal.match(/[-+]?[0-9]*\.?[0-9]+/);
        return numMatch ? parseFloat(numMatch[0]) : 1;
      }
    }

    if (!col) return 0;
    const rawVal = row[col.id];
    if (col.type === 'number') {
      return parseFloat(rawVal) || 0;
    } else if (col.type === 'date') {
      // 日付（期間）の場合、開始〜終了の差分を算出
      const dateInfo = parseDatePropertyValue(rawVal);
      if (dateInfo && dateInfo.start.date) {
        const start = new Date(dateInfo.start.date + (dateInfo.start.time ? `T${dateInfo.start.time}` : 'T00:00'));
        if (dateInfo.isRange && dateInfo.end && dateInfo.end.date) {
          const end = new Date(dateInfo.end.date + (dateInfo.end.time ? `T${dateInfo.end.time}` : 'T23:59'));
          const diffMs = end.getTime() - start.getTime();
          if (diffMs > 0) {
            if (yUnit === 'days') {
              return parseFloat((diffMs / (1000 * 60 * 60 * 24)).toFixed(1));
            } else if (yUnit === 'minutes') {
              return parseFloat((diffMs / (1000 * 60)).toFixed(1));
            } else {
              return parseFloat((diffMs / (1000 * 60 * 60)).toFixed(1));
            }
          }
        } else {
          // 単一日で時間指定がある場合は、時間換算なら1h、日数換算なら1h/24h=約0.04日、分換算なら60分
          // 時間指定がない場合は、時間換算ならデフォルト8h、日数換算なら1.0日、分換算なら480分
          if (yUnit === 'days') {
            return dateInfo.start.time ? parseFloat((1.0 / 24).toFixed(2)) : 1.0;
          } else if (yUnit === 'minutes') {
            return dateInfo.start.time ? 60.0 : 480.0;
          } else {
            return dateInfo.start.time ? 1.0 : 8.0;
          }
        }
      }
      return 0;
    } else if (col.type === 'checkbox') {
      return rawVal === true ? 1 : 0;
    } else {
      const strVal = String(rawVal || '').trim();
      if (!strVal) return 0;
      const numMatch = strVal.match(/[-+]?[0-9]*\.?[0-9]+/);
      return numMatch ? parseFloat(numMatch[0]) : 1;
    }
  };

  const aggregatedData = {};

  // 表示形式が分割（split）の場合、選択されている期間（今週・今月・今年・全期間）に合わせて、
  // X軸のすべての時系列キーを漏れなく事前生成して空オブジェクト {} で初期化（ゼロ補完）する
  if (activeView.chartRenderType === 'split') {
    if (activeView.chartTimeRange === 'week') {
      // 今週：日曜日〜土曜日の7日間分
      const range = getWeekRange();
      for (let i = 0; i < 7; i++) {
        const d = new Date(range.start);
        d.setDate(range.start.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const key = `${y}/${m}/${day}`;
        aggregatedData[key] = {};
      }
    } else if (activeView.chartTimeRange === 'month') {
      // 今月：当月1日〜月末日までのカレンダー日数分すべて
      const year = now.getFullYear();
      const month = now.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(year, month, i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const key = `${y}/${m}/${day}`;
        aggregatedData[key] = {};
      }
    } else if (activeView.chartTimeRange === 'year') {
      // 今年：当年1月〜12月の12ヶ月分すべて
      const year = now.getFullYear();
      for (let i = 0; i < 12; i++) {
        const m = String(i + 1).padStart(2, '0');
        const key = `${year}/${m}`;
        aggregatedData[key] = {};
      }
    } else if (activeView.chartTimeRange === 'all') {
      // 全期間：データに存在する最小年から最大年までの年単位
      const dateCols = block.properties.columns.filter(c => c.type === 'date');
      let minYear = now.getFullYear();
      let maxYear = now.getFullYear();
      if (dateCols.length > 0) {
        rowDataList.forEach(row => {
          const val = row[dateCols[0].id];
          const parsed = parseDatePropertyValue(val);
          if (parsed && parsed.start.date) {
            const y = new Date(parsed.start.date).getFullYear();
            if (y < minYear) minYear = y;
            if (y > maxYear) maxYear = y;
          }
        });
      }
      for (let y = minYear; y <= maxYear; y++) {
        const key = `${y}年`;
        aggregatedData[key] = {};
      }
    }
  }

  filteredRows.forEach(row => {
    // 1. 日付列から時系列キーを特定
    const dateCols = block.properties.columns.filter(c => c.type === 'date');
    const dateCol = dateCols[0] || null;
    let dateKey = '日付なし';

    if (dateCol) {
      const rawDateVal = row[dateCol.id];
      const dateInfo = parseDatePropertyValue(rawDateVal);
      if (dateInfo && dateInfo.start.date) {
        const d = new Date(dateInfo.start.date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');

        if (activeView.chartTimeRange === 'year') {
          dateKey = `${y}/${m}`;
        } else if (activeView.chartTimeRange === 'all') {
          dateKey = `${y}年`;
        } else {
          const day = String(d.getDate()).padStart(2, '0');
          dateKey = `${y}/${m}/${day}`;
        }
      }
    }

    // 2. グループ（タグ列）の値を取得
    let tagVal = '選択なし';
    if (xCol) {
      const rawTag = row[xCol.id];
      if (xCol.type === 'status') {
        tagVal = getStatusOptionName(xCol, rawTag) || '未着手';
      } else if (xCol.type === 'select') {
        tagVal = String(rawTag || '選択なし').trim();
      } else {
        tagVal = String(rawTag || '名称未設定').trim();
      }
    }

    // 2.5 表示対象タグのフィルタリング (タグ指定モード時)
    if (activeView.chartTagMode === 'single') {
      const selectedTags = activeView.chartSelectedTags || (activeView.chartSelectedTag ? [activeView.chartSelectedTag] : []);
      if (selectedTags.length > 0 && !selectedTags.includes(tagVal)) {
        return;
      }
    }

    // 3. 集計値の取得
    const val = getYValue(row, yCol, yUnit);

    // 4. 集計
    if (activeView.chartRenderType === 'split') {
      if (aggregatedData[dateKey] !== undefined) {
        aggregatedData[dateKey][tagVal] = (aggregatedData[dateKey][tagVal] || 0) + val;
      }
    } else {
      // 合計表示（total）の場合は、X軸は「今週の合計」などになり、その中にタグごとの積み上げを描画する
      const totalKey = getXLabel(row, xCol);
      aggregatedData[totalKey] = aggregatedData[totalKey] || {};
      aggregatedData[totalKey][tagVal] = (aggregatedData[totalKey][tagVal] || 0) + val;
    }
  });

  // chartDataの定義：総和valueと、タグ別のtagsを持つようにマッピング！
  const chartData = Object.entries(aggregatedData).map(([label, tagObj]) => {
    const total = Object.values(tagObj).reduce((a, b) => {
      const num = parseFloat(b);
      return a + (isNaN(num) ? 0 : num);
    }, 0);
    return {
      label,
      value: total,
      tags: tagObj
    };
  });

  // X軸が日付列（または分割表示時）の場合、時系列順（昇順）にソートする
  if (activeView.chartRenderType === 'split') {
    chartData.sort((a, b) => a.label.localeCompare(b.label));

    // 分割表示（split）の場合、X軸のラベルを無駄な文字列を省いた直感的な数字（日にち、月名、曜日）に加工する
    chartData.forEach(item => {
      if (activeView.chartTimeRange === 'week') {
        // YYYY/MM/DD ➔ 例: 24日(日)
        const parsed = new Date(item.label);
        if (!isNaN(parsed.getTime())) {
          const dateNum = parsed.getDate();
          const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][parsed.getDay()];
          item.label = `${dateNum}日(${dayOfWeek})`;
        }
      } else if (activeView.chartTimeRange === 'month') {
        // YYYY/MM/DD ➔ 例: 15日
        const parsed = new Date(item.label);
        if (!isNaN(parsed.getTime())) {
          item.label = `${parsed.getDate()}日`;
        }
      } else if (activeView.chartTimeRange === 'year') {
        // YYYY/MM ➔ 例: 5月
        const parts = item.label.split('/');
        if (parts.length === 2) {
          const m = parseInt(parts[1], 10);
          item.label = `${m}月`;
        }
      }
    });
  }

  if (chartData.length === 0 || filteredRows.length === 0) {
    const noData = document.createElement('div');
    noData.className = 'no-data-msg';
    noData.style = 'padding: 40px; text-align: center; border: 1px dashed var(--border-light); border-radius:8px;';
    noData.textContent = '集計可能なデータがありません。条件を変更するか、データを入力してください。';
    container.appendChild(noData);
    return container;
  }

  // 4. SVG 描画領域の構築
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '320');
  svg.style.background = 'rgba(13,17,28,0.2)';
  svg.style.borderRadius = '10px';
  svg.style.border = '1px solid var(--border-light)';
  svg.style.boxShadow = 'var(--shadow-card)';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="dbBarGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent-secondary)" />
      <stop offset="100%" stop-color="var(--accent-primary)" />
    </linearGradient>
    <linearGradient id="dbBarGradientHover" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f472b6" />
      <stop offset="100%" stop-color="var(--accent-primary)" />
    </linearGradient>
    <linearGradient id="dbAreaGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.35" />
      <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0.0" />
    </linearGradient>
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  `;
  svg.appendChild(defs);

  const paddingLeft = 50;
  const paddingTop = 30;
  const graphHeight = 250;

  // 1項目あたり最小30pxを確保して横幅を動的に拡張（今月など項目数が多い時のつぶれ防止）
  const minItemWidth = 30;
  const itemCount = chartData.length;
  const graphWidth = Math.max(500, itemCount * minItemWidth);
  const svgWidth = graphWidth + paddingLeft + 30; // 左右余白込みの総幅

  svg.setAttribute('viewBox', `0 0 ${svgWidth} 320`);
  if (graphWidth > 500) {
    svg.style.width = `${svgWidth}px`;
    svg.style.flex = 'none';
  } else {
    svg.style.width = '100%';
  }

  const maxVal = Math.max(10, ...chartData.map(d => d.value));

  const formatChartValue = (val, col, currentUnit = yUnit) => {
    if (currentUnit === 'number') {
      return col ? formatNumberValue(val, col) : (typeof val === 'number' ? val.toLocaleString('ja-JP') : val);
    }
    if (currentUnit === 'days') return val.toFixed(1) + '日';
    if (currentUnit === 'minutes') return val.toFixed(1) + '分';
    return val.toFixed(1) + 'h';
  };

  if (activeView.layout === 'chart-bar') {
    const barWidth = Math.min(40, (graphWidth - (chartData.length * 10)) / chartData.length);
    const gap = (graphWidth - (barWidth * chartData.length)) / (chartData.length + 1);

    [0, 0.5, 1].forEach(ratio => {
      const y = paddingTop + (1 - ratio) * graphHeight;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', paddingLeft);
      line.setAttribute('y1', y);
      line.setAttribute('x2', paddingLeft + graphWidth);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.05)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const axisText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      axisText.setAttribute('x', paddingLeft - 8);
      axisText.setAttribute('y', y + 4);
      axisText.setAttribute('fill', 'var(--text-primary)');
      axisText.setAttribute('font-size', '10px');
      axisText.setAttribute('font-weight', '600');
      axisText.setAttribute('text-anchor', 'end');
      axisText.textContent = formatChartValue(ratio * maxVal, yCol);
      svg.appendChild(axisText);
    });

    chartData.forEach((d, idx) => {
      const x = paddingLeft + gap + idx * (barWidth + gap);

      // X軸の縦グリッド点線補助線を追加
      const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      vLine.setAttribute('x1', x + barWidth / 2);
      vLine.setAttribute('y1', paddingTop);
      vLine.setAttribute('x2', x + barWidth / 2);
      vLine.setAttribute('y2', paddingTop + graphHeight);
      vLine.setAttribute('stroke', 'rgba(255,255,255,0.05)');
      vLine.setAttribute('stroke-dasharray', '2,2');
      vLine.setAttribute('stroke-width', '1');
      svg.appendChild(vLine);

      // タグごとの積み上げ rect を描画する
      let currentY = paddingTop + graphHeight;
      const sortedTags = Object.entries(d.tags).sort((a, b) => b[1] - a[1]);

      sortedTags.forEach(([tagName, tagVal], tagIdx) => {
        if (tagVal <= 0) return;
        const segmentHeight = (tagVal / maxVal) * graphHeight;
        currentY -= segmentHeight;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', currentY);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', Math.max(1.5, segmentHeight));

        const color = getTagColorForGraph(xCol, tagName);
        rect.setAttribute('fill', color);
        rect.setAttribute('rx', '2');
        rect.setAttribute('ry', '2');
        rect.style.transition = 'var(--transition-smooth)';

        rect.addEventListener('mouseenter', () => {
          rect.setAttribute('filter', 'url(#neonGlow)');
        });
        rect.addEventListener('mouseleave', () => {
          rect.removeAttribute('filter');
        });

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${d.label}\n🏷️ ${tagName}: ${formatChartValue(tagVal, yCol)}`;
        rect.appendChild(title);
        svg.appendChild(rect);
      });

      const y = currentY; // 総計ラベル位置合わせ用

      if (d.value > 0) {
        const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        valText.setAttribute('x', x + barWidth / 2);
        valText.setAttribute('y', y - 4);
        valText.setAttribute('fill', '#fff');
        valText.setAttribute('font-size', '9px');
        valText.setAttribute('font-weight', '700');
        valText.setAttribute('text-anchor', 'middle');
        valText.textContent = formatChartValue(d.value, yCol);
        svg.appendChild(valText);
      }

      const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelText.setAttribute('x', x + barWidth / 2);
      labelText.setAttribute('y', paddingTop + graphHeight + 16);
      labelText.setAttribute('fill', 'var(--text-secondary)');
      labelText.setAttribute('font-size', '10px');
      labelText.setAttribute('font-weight', '600');
      labelText.setAttribute('text-anchor', 'middle');
      const displayLabel = d.label.length > 8 ? d.label.substring(0, 7) + '..' : d.label;
      labelText.textContent = displayLabel;
      svg.appendChild(labelText);
    });
  }
  else if (activeView.layout === 'chart-line') {
    const pointsCount = chartData.length;
    const gap = graphWidth / Math.max(1, pointsCount - 1);

    [0, 0.5, 1].forEach(ratio => {
      const y = paddingTop + (1 - ratio) * graphHeight;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', paddingLeft);
      line.setAttribute('y1', y);
      line.setAttribute('x2', paddingLeft + graphWidth);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.05)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const axisText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      axisText.setAttribute('x', paddingLeft - 8);
      axisText.setAttribute('y', y + 4);
      axisText.setAttribute('fill', 'var(--text-primary)');
      axisText.setAttribute('font-size', '10px');
      axisText.setAttribute('font-weight', '600');
      axisText.setAttribute('text-anchor', 'end');
      axisText.textContent = formatChartValue(ratio * maxVal, yCol);
      svg.appendChild(axisText);
    });

    const coords = chartData.map((d, idx) => {
      const x = paddingLeft + idx * gap;
      const y = paddingTop + graphHeight - (d.value / maxVal) * graphHeight;
      return { x, y };
    });

    if (coords.length > 0) {
      let pathD = `M ${coords[0].x} ${coords[0].y}`;
      let areaD = `M ${coords[0].x} ${paddingTop + graphHeight} L ${coords[0].x} ${coords[0].y}`;

      for (let i = 0; i < coords.length - 1; i++) {
        const cpX1 = coords[i].x + (coords[i + 1].x - coords[i].x) / 2;
        const cpY1 = coords[i].y;
        const cpX2 = coords[i].x + (coords[i + 1].x - coords[i].x) / 2;
        const cpY2 = coords[i + 1].y;

        pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${coords[i + 1].x} ${coords[i + 1].y}`;
        areaD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${coords[i + 1].x} ${coords[i + 1].y}`;
      }

      areaD += ` L ${coords[coords.length - 1].x} ${paddingTop + graphHeight} Z`;

      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      areaPath.setAttribute('d', areaD);
      areaPath.setAttribute('fill', 'url(#dbAreaGradient)');
      svg.appendChild(areaPath);

      const trendLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      trendLine.setAttribute('d', pathD);
      trendLine.setAttribute('fill', 'none');
      trendLine.setAttribute('stroke', 'var(--accent-primary)');
      trendLine.setAttribute('stroke-width', '3');
      trendLine.setAttribute('filter', 'url(#neonGlow)');
      svg.appendChild(trendLine);

      chartData.forEach((d, idx) => {
        const c = coords[idx];

        // X軸 of 折れ線グラフ：縦グリッド点線補助線を追加
        const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        vLine.setAttribute('x1', c.x);
        vLine.setAttribute('y1', paddingTop);
        vLine.setAttribute('x2', c.x);
        vLine.setAttribute('y2', paddingTop + graphHeight);
        vLine.setAttribute('stroke', 'rgba(255,255,255,0.05)');
        vLine.setAttribute('stroke-dasharray', '2,2');
        vLine.setAttribute('stroke-width', '1');
        svg.appendChild(vLine);

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', c.x);
        circle.setAttribute('cy', c.y);
        circle.setAttribute('r', '5');

        // 当日最も実行値が大きいタグの色を取得して円に適用
        let maxTag = null;
        let maxTagVal = -1;
        Object.entries(d.tags).forEach(([tagName, tagVal]) => {
          if (tagVal > maxTagVal) {
            maxTagVal = tagVal;
            maxTag = tagName;
          }
        });
        const color = maxTag ? getTagColorForGraph(xCol, maxTag) : 'var(--accent-secondary)';
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '1.5');
        circle.style.transition = 'transform 0.15s ease';

        circle.addEventListener('mouseenter', () => {
          circle.setAttribute('r', '7');
        });
        circle.style.cursor = 'pointer';
        circle.addEventListener('mouseleave', () => {
          circle.setAttribute('r', '5');
        });

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        let tooltipText = `${d.label} の総計: ${formatChartValue(d.value, yCol)}`;
        Object.entries(d.tags).forEach(([tagName, tagVal]) => {
          if (tagVal > 0) {
            tooltipText += `\n🏷️ ${tagName}: ${formatChartValue(tagVal, yCol)}`;
          }
        });
        title.textContent = tooltipText;
        circle.appendChild(title);
        svg.appendChild(circle);

        const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelText.setAttribute('x', c.x);
        labelText.setAttribute('y', paddingTop + graphHeight + 16);
        labelText.setAttribute('fill', 'var(--text-secondary)');
        labelText.setAttribute('font-size', '10px');
        labelText.setAttribute('font-weight', '600');
        labelText.setAttribute('text-anchor', 'middle');
        const displayLabel = d.label.length > 8 ? d.label.substring(0, 7) + '..' : d.label;
        labelText.textContent = displayLabel;
        svg.appendChild(labelText);
      });
    }
  }
  else if (activeView.layout === 'chart-donut') {
    // ドーナツグラフの場合は、時系列ではなく「タグ別」の総集計データを構築する
    const tagTotals = {};
    chartData.forEach(item => {
      Object.entries(item.tags).forEach(([tagName, tagVal]) => {
        tagTotals[tagName] = (tagTotals[tagName] || 0) + tagVal;
      });
    });

    const donutData = Object.entries(tagTotals).map(([label, value]) => ({ label, value }));
    const totalSum = donutData.reduce((a, b) => a + b.value, 0);
    const centerX = 200;
    const centerY = 160;
    const outerRadius = 80;
    const innerRadius = 55;

    // ドーナツグラフ의 凡例の数に合わせてSVGの高さを自動拡張
    const svgHeight = Math.max(320, 80 + donutData.length * 40 + 20);
    svg.setAttribute('height', svgHeight.toString());

    let accumulatedAngle = -Math.PI / 2;
    const legends = [];

    donutData.forEach((d, idx) => {
      const color = getTagColorForGraph(xCol, d.label);
      const percentage = totalSum > 0 ? d.value / totalSum : 0;
      const angle = percentage * Math.PI * 2;

      if (percentage > 0) {
        const x1_o = centerX + outerRadius * Math.cos(accumulatedAngle);
        const y1_o = centerY + outerRadius * Math.sin(accumulatedAngle);
        const x1_i = centerX + innerRadius * Math.cos(accumulatedAngle);
        const y1_i = centerY + innerRadius * Math.sin(accumulatedAngle);

        const nextAngle = accumulatedAngle + angle;
        const x2_o = centerX + outerRadius * Math.cos(nextAngle);
        const y2_o = centerY + outerRadius * Math.sin(nextAngle);
        const x2_i = centerX + innerRadius * Math.cos(nextAngle);
        const y2_i = centerY + innerRadius * Math.sin(nextAngle);

        const largeArcFlag = angle > Math.PI ? 1 : 0;

        const pathD = `
          M ${x1_o} ${y1_o}
          A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2_o} ${y2_o}
          L ${x2_i} ${y2_i}
          A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1_i} ${y1_i}
          Z
        `;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', color);
        path.style.transition = 'var(--transition-smooth)';

        path.addEventListener('mouseenter', () => {
          path.setAttribute('filter', 'url(#neonGlow)');
        });
        path.addEventListener('mouseleave', () => {
          path.removeAttribute('filter');
        });

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${d.label}: ${formatChartValue(d.value, yCol)} (${(percentage * 100).toFixed(1)}%)`;
        path.appendChild(title);
        svg.appendChild(path);

        accumulatedAngle = nextAngle;
      }

      legends.push({
        label: d.label,
        value: d.value,
        percentage: (percentage * 100).toFixed(1),
        color
      });
    });

    const centerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    centerText.setAttribute('x', centerX);
    centerText.setAttribute('y', centerY - 8);
    centerText.setAttribute('fill', 'var(--text-secondary)');
    centerText.setAttribute('font-size', '20px');
    centerText.setAttribute('font-weight', '600');
    centerText.setAttribute('text-anchor', 'middle');
    centerText.textContent = '合計';
    svg.appendChild(centerText);

    const sumValText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sumValText.setAttribute('x', centerX);
    sumValText.setAttribute('y', centerY + 20);
    sumValText.setAttribute('fill', '#fff');
    sumValText.setAttribute('font-size', '26px');
    sumValText.setAttribute('font-weight', '800');
    sumValText.setAttribute('text-anchor', 'middle');
    sumValText.textContent = formatChartValue(totalSum, yCol);
    svg.appendChild(sumValText);

    const legendX = 350;
    const legendYStart = 80;

    legends.forEach((leg, legIdx) => {
      const legY = legendYStart + legIdx * 40;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', legendX);
      rect.setAttribute('y', legY - 16);
      rect.setAttribute('width', '24');
      rect.setAttribute('height', '24');
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', leg.color);
      svg.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', legendX + 36);
      text.setAttribute('y', legY + 4);
      text.setAttribute('fill', 'var(--text-primary)');
      text.setAttribute('font-size', '22px');
      text.setAttribute('font-weight', '600');

      const displayLabel = leg.label.length > 15 ? leg.label.substring(0, 14) + '..' : leg.label;
      text.textContent = displayLabel;
      svg.appendChild(text);

      const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valText.setAttribute('x', legendX + 260);
      valText.setAttribute('y', legY + 4);
      valText.setAttribute('fill', 'var(--text-secondary)');
      valText.setAttribute('font-size', '20px');
      valText.setAttribute('text-anchor', 'end');
      valText.textContent = `${leg.percentage}% (${formatChartValue(leg.value, yCol)})`;
      svg.appendChild(valText);
    });
  }

  // グラフ（SVG）専用の横スクロール可能なラッパーコンテナを導入
  const svgWrapper = document.createElement('div');
  svgWrapper.className = 'db-chart-svg-wrapper';
  svgWrapper.style = 'width: 100%; overflow-x: auto; padding-bottom: 8px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent;';
  svgWrapper.appendChild(svg);
  container.appendChild(svgWrapper);

  // 棒グラフ・折れ線グラフの分割表示時（ドーナツ以外）に、動的「タグ凡例 (Legend)」コンテナを HTML 要素として追加
  if (activeView.layout !== 'chart-donut') {
    const uniqueTags = new Set();
    chartData.forEach(d => {
      Object.entries(d.tags).forEach(([tagName, tagVal]) => {
        if (tagVal > 0) {
          uniqueTags.add(tagName);
        }
      });
    });

    if (uniqueTags.size > 0) {
      const legendContainer = document.createElement('div');
      legendContainer.style = 'display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-top: 12px; padding: 10px 14px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-light);';

      uniqueTags.forEach(tagName => {
        const color = getTagColorForGraph(xCol, tagName);

        const item = document.createElement('div');
        item.style = 'display: flex; align-items: center; gap: 6px; font-size: 11px;';

        const dot = document.createElement('span');
        dot.style = `display: inline-block; width: 10px; height: 10px; border-radius: 3px; background-color: ${color}; box-shadow: 0 0 6px ${color}80;`;

        const label = document.createElement('span');
        label.style = 'color: var(--text-primary); font-weight: 600;';
        label.textContent = tagName;

        item.appendChild(dot);
        item.appendChild(label);
        legendContainer.appendChild(item);
      });
      container.appendChild(legendContainer);
    }
  }

  // 分割表示のグラフの下に分割した日数等を表記する
  if (activeView.chartRenderType === 'split') {
    const infoFooter = document.createElement('div');
    infoFooter.style = 'margin-top: 8px; text-align: center; font-size: 11px; color: var(--text-secondary); font-weight: 600; background: rgba(255,255,255,0.05); padding: 5px 12px; border-radius: 20px; display: inline-block; border: 1px solid var(--border-light);';

    let infoText = '';
    const splitCount = chartData.length;
    if (xCol && xCol.type === 'date') {
      if (activeView.chartTimeRange === 'week') {
        infoText = `📅 今週の分割表示: 計 ${splitCount} 日間`;
      } else if (activeView.chartTimeRange === 'month') {
        infoText = `📅 今月の分割表示: 計 ${splitCount} 日間`;
      } else if (activeView.chartTimeRange === 'year') {
        infoText = `📅 今年の分割表示: 計 ${splitCount} ヶ月間`;
      } else if (activeView.chartTimeRange === 'all') {
        infoText = `📅 全期間の分割表示: 計 ${splitCount} 年間`;
      }
    } else {
      infoText = `📊 グループ数: ${splitCount} 分割`;
    }

    infoFooter.textContent = infoText;

    const footerWrapper = document.createElement('div');
    footerWrapper.style = 'display: flex; justify-content: center; width: 100%; margin-top: 4px;';
    footerWrapper.appendChild(infoFooter);
    container.appendChild(footerWrapper);
  }

  return container;
}

window.setupBlockBulkActionEvents = setupBlockBulkActionEvents;

function findDOMPositionByWikiOffset(container, wikiOffset) {
  let currentWikiLength = 0;

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.length;
      if (currentWikiLength + len >= wikiOffset) {
        return { node: node, offset: wikiOffset - currentWikiLength };
      }
      currentWikiLength += len;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('wiki-link')) {
      const target = node.getAttribute('data-target') || node.textContent;
      const isJp = node.getAttribute('data-bracket') === 'jp';
      const openLen = 2; // 「「 または [[
      const closeLen = 2; // 」」 または ]]
      const totalWikiLen = openLen + target.length + closeLen;

      if (currentWikiLength + totalWikiLen >= wikiOffset) {
        if (wikiOffset - currentWikiLength < totalWikiLen / 2) {
          return { node: node.parentNode, offset: Array.from(node.parentNode.childNodes).indexOf(node) };
        } else {
          return { node: node.parentNode, offset: Array.from(node.parentNode.childNodes).indexOf(node) + 1 };
        }
      }
      currentWikiLength += totalWikiLen;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        const res = traverse(node.childNodes[i]);
        if (res) return res;
      }
    }
    return null;
  }

  return traverse(container);
}

// CSV parsing RFC4180 compliant helper
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i+1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  return lines;
}

// Export database block rows to CSV file (UTF-8 BOM)
function exportToCSV(block) {
  const columns = block.properties.columns || [];
  const rows = block.properties.rows || [];

  const headers = columns.map(col => col.name);
  const csvLines = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')];

  rows.forEach(row => {
    const line = columns.map(col => {
      let val = row[col.id];
      if (val === undefined || val === null) val = '';
      if (col.type === 'checkbox') val = val ? 'ON' : 'OFF';
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csvLines.push(line.join(','));
  });

  const csvContent = csvLines.join('\n');
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${block.properties.tableName || 'database'}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Import rows from CSV file and automatically create missing columns
function importFromCSV(block, file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const data = parseCSV(text);
    if (data.length < 2) {
      showToast('有効なCSVデータが見つかりません。');
      return;
    }

    const headers = data[0].map(h => h.trim());
    const csvRows = data.slice(1);

    const columns = block.properties.columns || [];
    const colMap = {};

    columns.forEach(col => {
      colMap[col.name.toLowerCase()] = col.id;
    });

    headers.forEach(header => {
      const lower = header.toLowerCase();
      if (!colMap[lower]) {
        const newColId = 'col-' + generateId();
        columns.push({
          id: newColId,
          name: header,
          type: 'text',
          width: 130
        });
        colMap[lower] = newColId;
      }
    });

    csvRows.forEach(csvRow => {
      if (csvRow.length === 0 || (csvRow.length === 1 && csvRow[0] === '')) return;
      const newRow = {};
      
      columns.forEach(col => {
        if (col.type === 'status') {
          const defaultOpt = col.options && col.options.length > 0 ? col.options[0].name : '未着手';
          newRow[col.id] = defaultOpt;
        } else if (col.type === 'checkbox') {
          newRow[col.id] = false;
        } else {
          newRow[col.id] = '';
        }
      });

      headers.forEach((header, idx) => {
        const colId = colMap[header.toLowerCase()];
        if (colId && csvRow[idx] !== undefined) {
          const col = columns.find(c => c.id === colId);
          let val = csvRow[idx];
          if (col) {
            if (col.type === 'checkbox') {
              val = (val === 'ON' || val === 'true' || val === '1' || val === true);
            }
          }
          newRow[col.id] = val;
        }
      });

      block.properties.rows.push(newRow);
    });

    saveNotesToStorage();
    renderEditor();
    showToast('CSVデータをインポートしました。');
  };
  reader.readAsText(file);
}
