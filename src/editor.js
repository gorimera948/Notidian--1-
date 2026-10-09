import { state, getActiveNote, saveNotesToStorage, pushHistory, undo, redo, historyState, createNotidianSnapshot, applyNotidianSnapshot } from './state.js';
import { generateId, escapeHTML } from './utils.js';
import { parseWikiLinks, serializeHtmlToWikiText, handleWikiLinkTrigger, closeLinkMenu, selectLinkMenuItem, navigateLinkMenu, checkAndInsertPairBrackets } from './wikilinks.js';
import { createDatabaseDOM, removeBlocksRecursively, updateBulkActionBar, updateBlockBulkActionBar } from './database.js';
import { createDropboxSyncControls } from './sync.js';

function renderNoteList() {
  if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
    window.Notidian.renderNoteList();
  }
}

function updateBacklinks() {
  if (window.Notidian && typeof window.Notidian.updateBacklinks === 'function') {
    window.Notidian.updateBacklinks();
  }
}

export function focusBlock(el) {
  if (!el) return;
  // 非表示要素（データベース、画像、区切り線等のプレースホルダー）はフォーカス不可のためスキップ
  if (el.style.display === 'none' || window.getComputedStyle(el).display === 'none') {
    return;
  }
  const allEditable = document.querySelectorAll('.block-content[contenteditable="true"]');
  allEditable.forEach(activeEl => {
    if (activeEl !== el) {
      activeEl.blur();
      activeEl.removeAttribute('contenteditable');
    }
  });
  el.contentEditable = 'true';
  el.focus();
  const blockId = el.getAttribute('data-id');
  if (blockId) {
    state.activeFocusedBlockId = blockId;
  }
}

let dragThreshold = 5;
let mouseDownX = 0;
let mouseDownY = 0;
let mouseDownTarget = null;

if (typeof window !== 'undefined') {
  document.addEventListener('mouseup', (e) => {
    if (!mouseDownTarget) return;
    const deltaX = Math.abs(e.clientX - mouseDownX);
    const deltaY = Math.abs(e.clientY - mouseDownY);
    if (deltaX < dragThreshold && deltaY < dragThreshold) {
      focusBlock(mouseDownTarget);
    }
    mouseDownTarget = null;
  });
}

// 3. RECUSIVE EDITOR RENDERER
// ==========================================

// 画面分割の切り替え
export function toggleSplitView() {
  state.isSplit = !state.isSplit;
  localStorage.setItem('notidian_is_split', state.isSplit);

  if (state.isSplit) {
    // 分割時、現在アクティブなペインのノートを右ペインにコピーして開く
    const activeId = state.panes[state.activePaneIndex].activeNoteId || state.activeNoteId;
    if (activeId) {
      state.panes[1].activeNoteId = activeId;
      state.panes[1].noteHistory = [activeId];
      state.panes[1].historyIndex = 0;
      localStorage.setItem('notidian_right_active_note_id', activeId);
    }
  } else {
    // 分割解除時、アクティブだったペインのノートを全体の activeNoteId にする
    const activePane = state.panes[state.activePaneIndex];
    if (activePane && activePane.activeNoteId) {
      state.activeNoteId = activePane.activeNoteId;
      state.noteHistory = activePane.noteHistory;
      state.historyIndex = activePane.historyIndex;
      localStorage.setItem('notidian_active_note_id', state.activeNoteId);
    }
  }

  if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
    window.Notidian.renderNoteList();
  }
  renderEditor();
  
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 200);
}

function updateWikiLinksAcrossNotes(oldTitle, newTitle) {
  const updateLinkTargets = (blocksArr) => {
    blocksArr.forEach(b => {
      if (b.content) {
        b.content = b.content.replace(/\[\[(.*?)\]\]/g, (m, target) => {
          if (target.trim().toLowerCase() === oldTitle.toLowerCase()) {
            return `[[${newTitle}]]`;
          }
          return m;
        }).replace(/「「(.*?)」」/g, (m, target) => {
          if (target.trim().toLowerCase() === oldTitle.toLowerCase()) {
            return `「「${newTitle}」」`;
          }
          return m;
        });
      }
      if (b.children) updateLinkTargets(b.children);
    });
  };

  state.notes.forEach(n => {
    if (n.blocks) updateLinkTargets(n.blocks);
  });
}

export function renderEditor() {
  const editorArea = document.querySelector('.editor-area');
  if (!editorArea) return;

  // --- スクロール位置の保存 ---
  const savedPaneScrolls = [];
  document.querySelectorAll('.editor-pane').forEach((paneEl, idx) => {
    savedPaneScrolls[idx] = paneEl.scrollTop;
  });

  const savedDbScrolls = {};
  document.querySelectorAll('.block-database-wrapper').forEach(blockWrapper => {
    const blockId = blockWrapper.getAttribute('data-id');
    const scrollContainers = blockWrapper.querySelectorAll('.database-container > div, .db-group-subtable');
    scrollContainers.forEach((container, cIdx) => {
      if (container.style.overflowY === 'auto' || container.classList.contains('db-group-subtable')) {
        const key = `${blockId}-${cIdx}`;
        savedDbScrolls[key] = {
          top: container.scrollTop,
          left: container.scrollLeft
        };
      }
    });
  });

  const paneCount = state.isSplit ? 2 : 1;
  editorArea.classList.toggle('split-view', state.isSplit);

  // ペインの数合わせ
  let paneEls = Array.from(editorArea.querySelectorAll('.editor-pane'));
  while (paneEls.length > paneCount) {
    paneEls.pop().remove();
  }
  while (paneEls.length < paneCount) {
    const paneIndex = paneEls.length;
    const newPane = document.createElement('div');
    newPane.className = `editor-pane ${paneIndex === state.activePaneIndex ? 'active-pane' : ''}`;
    newPane.setAttribute('data-pane-index', paneIndex);

    // ペインをアクティブにする処理
    newPane.addEventListener('mousedown', () => {
      if (state.activePaneIndex !== paneIndex) {
        state.activePaneIndex = paneIndex;
        localStorage.setItem('notidian_active_pane_index', paneIndex);

        const paneState = state.panes[paneIndex];
        if (paneState) {
          state.activeNoteId = paneState.activeNoteId;
          state.noteHistory = paneState.noteHistory || [];
          state.historyIndex = paneState.historyIndex !== undefined ? paneState.historyIndex : -1;
          localStorage.setItem('notidian_active_note_id', state.activeNoteId || '');
        }

        document.querySelectorAll('.editor-pane').forEach((el, idx) => {
          el.classList.toggle('active-pane', idx === paneIndex);
        });

        if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
          window.Notidian.renderNoteList();
        }
        if (window.Notidian && typeof window.Notidian.updateBacklinks === 'function') {
          window.Notidian.updateBacklinks();
        }
      }
    });

    editorArea.appendChild(newPane);
    paneEls.push(newPane);
  }

  // 元々あった editor-container を削除する（古いものが残らないように）
  const oldContainer = editorArea.querySelector(':scope > .editor-container');
  if (oldContainer) oldContainer.remove();

  paneEls.forEach((paneEl, paneIndex) => {
    paneEl.classList.toggle('active-pane', paneIndex === state.activePaneIndex);

    const paneState = state.panes[paneIndex];
    const noteId = paneState ? paneState.activeNoteId : null;
    const note = state.notes.find(n => n.id === noteId);

    paneEl.innerHTML = '';

    if (!note) {
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'editor-container';
      emptyContainer.style = 'display:flex; align-items:center; justify-content:center; height:100%;';
      emptyContainer.innerHTML = `
        <div class="no-data-msg">
          ${paneIndex === 1 ? '右ペインが未選択です。サイドバーまたは左ペインからWikiリンク等をクリックして開くか、新規ノートを作成してください。' : 'ノートがありません。「＋」ボタンを押して新規作成してください。'}
        </div>
      `;
      paneEl.appendChild(emptyContainer);
      return;
    }

    const container = document.createElement('div');
    container.className = 'editor-container';

    // ツールバー
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';

    const toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'toolbar-left';

    const historyControls = document.createElement('div');
    historyControls.className = 'history-controls';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-history';
    backBtn.title = '戻る';
    backBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    backBtn.disabled = (paneState.historyIndex <= 0);
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (paneState.historyIndex > 0) {
        paneState.historyIndex--;
        paneState.activeNoteId = paneState.noteHistory[paneState.historyIndex];
        if (paneIndex === state.activePaneIndex) {
          state.activeNoteId = paneState.activeNoteId;
          state.noteHistory = paneState.noteHistory;
          state.historyIndex = paneState.historyIndex;
          localStorage.setItem('notidian_active_note_id', state.activeNoteId || '');
        }
        renderEditor();
        if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
          window.Notidian.renderNoteList();
        }
      }
    });

    const forwardBtn = document.createElement('button');
    forwardBtn.className = 'btn-history';
    forwardBtn.title = '進む';
    forwardBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    forwardBtn.disabled = (paneState.historyIndex >= paneState.noteHistory.length - 1);
    forwardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (paneState.historyIndex < paneState.noteHistory.length - 1) {
        paneState.historyIndex++;
        paneState.activeNoteId = paneState.noteHistory[paneState.historyIndex];
        if (paneIndex === state.activePaneIndex) {
          state.activeNoteId = paneState.activeNoteId;
          state.noteHistory = paneState.noteHistory;
          state.historyIndex = paneState.historyIndex;
          localStorage.setItem('notidian_active_note_id', state.activeNoteId || '');
        }
        renderEditor();
        if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
          window.Notidian.renderNoteList();
        }
      }
    });

    historyControls.appendChild(backBtn);
    historyControls.appendChild(forwardBtn);
    toolbarLeft.appendChild(historyControls);

    const indicator = document.createElement('div');
    indicator.className = 'active-note-indicator';
    indicator.innerHTML = `<i class="fa-regular fa-file-lines"></i> <span class="breadcrumb-note-title">${escapeHTML(note.title)}</span>`;
    toolbarLeft.appendChild(indicator);
    toolbar.appendChild(toolbarLeft);

    // テンプレート上書きボタン
    if (note.templateSourceId) {
      const template = state.notes.find(t => t.id === note.templateSourceId && t.isTemplate);
      if (template) {
        const overwriteBtn = document.createElement('button');
        overwriteBtn.className = 'btn-overwrite-template';
        overwriteBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> 「${escapeHTML(template.title)}」に上書き`;
        overwriteBtn.title = '現在のブロック構成でテンプレートを上書き更新します';
        overwriteBtn.addEventListener('click', () => {
          if (window.Notidian && typeof window.Notidian.overwriteTemplateFromActiveDaily === 'function') {
            window.Notidian.overwriteTemplateFromActiveDaily();
          }
        });
        toolbarLeft.appendChild(overwriteBtn);
      }
    }

    const toolbarRight = document.createElement('div');
    toolbarRight.className = 'editor-actions';

    // 書き出しボタン
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-secondary btn-export-data';
    exportBtn.style = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; margin-right: 6px;';
    exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i> <span>書き出し</span>';
    exportBtn.title = 'すべてのデータをJSONファイルとしてエクスポートします';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportAllData();
    });
    toolbarRight.appendChild(exportBtn);

    // 読み込みボタン
    const importBtn = document.createElement('button');
    importBtn.className = 'btn-secondary btn-import-data';
    importBtn.style = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; margin-right: 6px;';
    importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> <span>読み込み</span>';
    importBtn.title = 'JSONファイルからデータをインポートし、現在のデータを上書きします';
    importBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerImportData();
    });
    toolbarRight.appendChild(importBtn);

    toolbarRight.appendChild(createDropboxSyncControls());

    const splitBtn = document.createElement('button');
    splitBtn.className = 'btn-secondary';
    splitBtn.style = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;';
    splitBtn.innerHTML = state.isSplit 
      ? '<i class="fa-solid fa-square"></i> <span>分割解除</span>' 
      : '<i class="fa-solid fa-table-columns"></i> <span>左右に分割</span>';
    splitBtn.title = state.isSplit ? '画面分割を解除する' : '画面を左右に分割する';
    splitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSplitView();
    });
    toolbarRight.appendChild(splitBtn);
    toolbar.appendChild(toolbarRight);

    container.appendChild(toolbar);

    // タイトル
    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'note-title-wrapper';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'note-title-input';
    titleInput.placeholder = '無題';
    titleInput.value = note.title;

    let oldTitle = note.title;
    titleInput.addEventListener('focus', () => {
      oldTitle = note.title;
    });

    titleInput.addEventListener('blur', () => {
      const newTitle = titleInput.value.trim();
      if (newTitle === '') {
        titleInput.value = note.title;
        return;
      }
      if (newTitle !== oldTitle) {
        updateWikiLinksAcrossNotes(oldTitle, newTitle);
        note.title = newTitle;
        note.updatedAt = Date.now();
        saveNotesToStorage();
        if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
          window.Notidian.renderNoteList();
        }
        renderEditor();
      }
    });

    titleInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        titleInput.blur();
      }
    });

    titleWrapper.appendChild(titleInput);

    const titleActions = document.createElement('div');
    titleActions.className = 'note-title-actions';
    titleActions.style = 'display: flex; align-items: center; gap: 8px; flex-shrink: 0;';

    // 音声入力ボタン
    const micBtn = document.createElement('button');
    micBtn.className = `btn-mic-toggle ${activeMicButton ? 'recording' : ''}`;
    micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    micBtn.title = activeMicButton ? '音声文字起こし中... (クリックで停止)' : '音声文字起こしを開始';
    micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSpeechRecognition(micBtn);
    });
    titleActions.appendChild(micBtn);

    // 再描画時に音声認識が動いている場合、新しいボタン参照を保持する
    if (activeMicButton) {
      activeMicButton = micBtn;
    }

    const favBtn = document.createElement('button');
    favBtn.className = `btn-favorite-toggle ${note.isFavorite ? 'active' : ''}`;
    favBtn.innerHTML = `<i class="fa-${note.isFavorite ? 'solid' : 'regular'} fa-star"></i>`;
    favBtn.title = note.isFavorite ? 'お気に入りから外す' : 'お気に入りに追加';
    favBtn.style.position = 'relative';
    favBtn.style.top = 'auto';
    favBtn.style.right = 'auto';
    favBtn.style.zIndex = 'auto';
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      note.isFavorite = !note.isFavorite;
      saveNotesToStorage();
      renderEditor();
      if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
        window.Notidian.renderNoteList();
      }
    });
    titleActions.appendChild(favBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-note-delete';
    deleteBtn.style = 'position: relative; top: auto; right: auto; z-index: auto; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 6px; border-radius: 6px; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    deleteBtn.title = '現在のノートを削除';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.Notidian && typeof window.Notidian.deleteNote === 'function') {
        window.Notidian.deleteNote(note.id, e);
      }
    });
    titleActions.appendChild(deleteBtn);

    titleWrapper.appendChild(titleActions);

    container.appendChild(titleWrapper);

    // タグ表示
    const tagsPanel = document.createElement('div');
    tagsPanel.className = 'note-tags-panel';
    tagsPanel.style = 'display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 54px 16px 54px; padding: 0;';
    container.appendChild(tagsPanel);
    if (window.Notidian && typeof window.Notidian.renderNoteTags === 'function') {
      window.Notidian.renderNoteTags(tagsPanel, note);
    }

    // リンク表示
    const linksPanel = document.createElement('div');
    linksPanel.className = 'note-links-panel';
    container.appendChild(linksPanel);
    if (window.Notidian && typeof window.Notidian.updateBacklinks === 'function') {
      window.Notidian.updateBacklinks(linksPanel, note);
    }

    // キャンバス
    const canvas = document.createElement('div');
    canvas.id = 'block-canvas';
    canvas.className = 'block-canvas';

    if (note.blocks.length === 0) {
      note.blocks.push({ id: generateId(), type: 'p', content: '' });
    }

    note.blocks.forEach(block => {
      const blockEl = createBlockDOM(block, null);
      canvas.appendChild(blockEl);
    });

    container.appendChild(canvas);
    paneEl.appendChild(container);

    // --- スクロール位置の復元 ---
    if (savedPaneScrolls[paneIndex] !== undefined) {
      paneEl.scrollTop = savedPaneScrolls[paneIndex];
    }

    paneEl.querySelectorAll('.block-database-wrapper').forEach(blockWrapper => {
      const blockId = blockWrapper.getAttribute('data-id');
      const scrollContainers = blockWrapper.querySelectorAll('.database-container > div, .db-group-subtable');
      scrollContainers.forEach((container, cIdx) => {
        if (container.style.overflowY === 'auto' || container.classList.contains('db-group-subtable')) {
          const key = `${blockId}-${cIdx}`;
          if (savedDbScrolls[key]) {
            container.scrollTop = savedDbScrolls[key].top;
            container.scrollLeft = savedDbScrolls[key].left;
          }
        }
      });
    });
  });

  setupDragDropListeners();
  updateBlockBulkActionBar();

  if (window.tableSelection && window.tableSelection.blockId) {
    const activeNote = getActiveNote();
    if (activeNote) {
      const found = findBlockAndParent(activeNote.blocks, window.tableSelection.blockId);
      if (found && found.block) {
        const rows = found.block.properties?.rows || [];
        updateBulkActionBar(found.block, rows);
      } else {
        if (typeof window.clearTableSelection === 'function') window.clearTableSelection();
      }
    }
  } else {
    const bar = document.getElementById('db-bulk-action-bar');
    if (bar) bar.style.display = 'none';
  }
}

// カラム幅のドラッグリサイズを設定する関数
function setupColumnResizer(resizerEl, leftCol, rightCol, containerEl, columnsBlock) {
  resizerEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizerEl.classList.add('resizing');

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const containerWidth = containerEl.getBoundingClientRect().width;

    const gapCount = columnsBlock.children.length - 1;
    const totalGapWidth = gapCount * 16;
    const usableWidth = containerWidth - totalGapWidth;

    const startLeftPercent = leftCol.properties?.width || (100 / columnsBlock.children.length);
    const startRightPercent = rightCol.properties?.width || (100 / columnsBlock.children.length);
    const totalPercent = startLeftPercent + startRightPercent;

    function onMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / usableWidth) * 100;

      let newLeftPercent = startLeftPercent + deltaPercent;
      let newRightPercent = startRightPercent - deltaPercent;

      const minPercent = 10;
      if (newLeftPercent < minPercent) {
        newLeftPercent = minPercent;
        newRightPercent = totalPercent - minPercent;
      } else if (newRightPercent < minPercent) {
        newRightPercent = minPercent;
        newLeftPercent = totalPercent - minPercent;
      }

      const leftColDOM = containerEl.querySelector(`[data-id="${leftCol.id}"]`);
      const rightColDOM = containerEl.querySelector(`[data-id="${rightCol.id}"]`);
      const count = columnsBlock.children.length;

      if (leftColDOM) {
        leftColDOM.style.width = `calc(${newLeftPercent}% - ${(count - 1) * 16}px / ${count})`;
      }
      if (rightColDOM) {
        rightColDOM.style.width = `calc(${newRightPercent}% - ${(count - 1) * 16}px / ${count})`;
      }

      leftCol.properties = leftCol.properties || {};
      leftCol.properties.width = newLeftPercent;

      rightCol.properties = rightCol.properties || {};
      rightCol.properties.width = newRightPercent;
    }

    function onMouseUp() {
      resizerEl.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      saveNotesToStorage();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// Recursive function to create Block DOM
export function createBlockDOM(block, parentBlock = null) {
  const blockWrapper = document.createElement('div');
  blockWrapper.className = `block-wrapper block-${block.type}-wrapper`;
  blockWrapper.setAttribute('data-id', block.id);

  blockWrapper.addEventListener('click', (e) => {
    const isDatabase = e.target.closest('.database-container');
    if (isDatabase) return;

    const isCheckbox = e.target.closest('.block-select-check');
    const isInput = e.target.closest('input:not(.block-select-check), button, select');

    if (isInput) return;

    const activeContent = e.target.closest('.block-content');
    if (activeContent && activeContent.contentEditable === 'true' && e.shiftKey && !isCheckbox) {
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.handleBlockClick === 'function') {
        window.handleBlockClick(e, block.id);
      }
      return;
    }

    state.lastSelectedBlockId = block.id;

    const isEditTarget = e.target.closest('.block-content');
    if (isEditTarget && !isCheckbox) {
      const hasBlockSelection = state.selectedBlockIds && state.selectedBlockIds.length > 0;
      const hasTableSelection = window.tableSelection && window.tableSelection.selectedRows && window.tableSelection.selectedRows.length > 0;
      if (hasBlockSelection || hasTableSelection) {
        if (typeof window.clearBlockSelection === 'function') window.clearBlockSelection();
        if (typeof window.clearTableSelection === 'function') window.clearTableSelection();
      }
    }
  });

  // If container block (columns, column, toggle), we render their layout
  if (block.type === 'columns') {
    blockWrapper.classList.add('columns-container');

    // カラム全体の左外側に一括操作用のコントロール（ドラッグハンドル）を表示します。
    // カラム内部 of 各ブロックは、レイアウト崩れを防ぐためCSSでコントロールを非表示にしています。
    const controls = createBlockControls(block.id, block.type);
    blockWrapper.appendChild(controls);

    const columnsWrapper = document.createElement('div');
    columnsWrapper.className = 'columns-container';
    columnsWrapper.style.width = '100%';
    columnsWrapper.style.display = 'flex';
    columnsWrapper.style.alignItems = 'flex-start'; // 隣の列の高さに連動させない
    columnsWrapper.style.gap = '16px';
    columnsWrapper.style.position = 'relative';

    const children = block.children || [];
    const count = children.length;

    children.forEach((column, index) => {
      const columnEl = createBlockDOM(column, block);

      let colWidth = column.properties?.width;
      if (colWidth === undefined) {
        colWidth = 100 / count;
        column.properties = column.properties || {};
        column.properties.width = colWidth;
      }

      columnEl.style.flex = 'none';
      columnEl.style.width = `calc(${colWidth}% - ${(count - 1) * 16}px / ${count})`;

      columnsWrapper.appendChild(columnEl);

      // カラムの間にリサイザーを挿入（最後以外のカラムの後ろ）
      if (index < count - 1) {
        const resizer = document.createElement('div');
        resizer.className = 'column-resizer';
        resizer.setAttribute('contenteditable', 'false');

        setupColumnResizer(resizer, column, children[index + 1], columnsWrapper, block);

        columnsWrapper.appendChild(resizer);
      }
    });

    // カラムブロック全体を右クリックで解除できるようにする
    blockWrapper.addEventListener('contextmenu', (e) => {
      // テキスト編集中などの場合はブラウザ標準メニューを優先するため無視
      if (e.target.closest('.block-content') && document.activeElement === e.target) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (confirm('このカラムを解除して1列に戻しますか？')) {
        uncolumn(block.id);
      }
    });

    blockWrapper.appendChild(columnsWrapper);
    return blockWrapper;
  }

  if (block.type === 'column') {
    blockWrapper.className = 'column-block';
    blockWrapper.setAttribute('data-id', block.id);

    if (block.children && block.children.length > 0) {
      block.children.forEach(child => {
        const childEl = createBlockDOM(child, block);
        blockWrapper.appendChild(childEl);
      });
    } else {
      // DOM上だけでプレースホルダーをレンダリングする（データを書き換えない）
      const placeholderDiv = document.createElement('div');
      placeholderDiv.className = 'block-content block-p placeholder-only';
      placeholderDiv.style.opacity = '0.4';
      placeholderDiv.textContent = 'ここにブロックをドロップ';
      blockWrapper.appendChild(placeholderDiv);
    }
    return blockWrapper;
  }

  if (block.type === 'image') {
    blockWrapper.classList.add('image-block-wrapper');

    const container = document.createElement('div');
    container.className = 'image-block-container';
    
    // 画像サイズ（パーセンテージ）を適用
    let widthVal = block.properties?.width;
    if (widthVal === undefined) {
      // 既存の size プロパティからの移行
      const size = block.properties?.size || '100';
      widthVal = size === '30' ? 30 : (size === '50' ? 50 : 100);
      block.properties = block.properties || {};
      block.properties.width = widthVal;
    }
    
    container.style = `position: relative; width: ${widthVal}%; max-width: 100%; margin: 8px 0; border-radius: 8px; overflow: visible; transition: width 0.2s ease;`;

    const url = block.properties?.url || '';

    if (!url) {
      // Image uploader UI
      const uploader = document.createElement('div');
      uploader.className = 'image-uploader';
      uploader.style = 'border: 2px dashed var(--border-light); border-radius: 8px; padding: 20px; text-align: center; background: rgba(0,0,0,0.2); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;';
      uploader.innerHTML = `
        <i class="fa-regular fa-image" style="font-size: 24px; color: var(--accent-primary);"></i>
        <span style="font-size: 12px; color: var(--text-secondary);">クリックして画像ファイルを選択、またはURLを入力</span>
        <input type="text" placeholder="画像のURLを入力してEnterキーを押す..." class="image-url-input" style="width: 80%; padding: 4px 8px; font-size: 11px; margin-top: 8px; text-align: center;" onclick="event.stopPropagation()">
      `;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';

      fileInput.addEventListener('change', (evt) => {
        const file = evt.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            block.properties = block.properties || {};
            block.properties.url = e.target.result;
            saveNotesToStorage();
            renderEditor();
          };
          reader.onerror = (err) => {
            console.error('Failed to insert image:', err);
            showToast('画像の読み込みに失敗しました');
          };
          reader.readAsDataURL(file);
        }
      });

      uploader.addEventListener('mousedown', (evt) => {
        evt.stopPropagation();
      });

      uploader.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.target.closest('.image-url-input')) return;
        fileInput.click();
      });

      const urlInput = uploader.querySelector('.image-url-input');
      urlInput.addEventListener('mousedown', (evt) => {
        evt.stopPropagation();
      });
      urlInput.addEventListener('click', (evt) => {
        evt.stopPropagation();
      });
      urlInput.addEventListener('keydown', (evt) => {
        evt.stopPropagation();
        if (evt.key === 'Enter') {
          evt.preventDefault();
          const val = urlInput.value.trim();
          if (val) {
            block.properties = block.properties || {};
            block.properties.url = val;
            saveNotesToStorage();
            renderEditor();
          }
        }
      });

      container.appendChild(uploader);
      container.appendChild(fileInput);
    } else {
      // Render image with controls
      const img = document.createElement('img');
      img.src = url;
      img.style = 'width: 100%; display: block; height: auto; border-radius: 6px; cursor: zoom-in;';
      img.title = 'クリックして拡大';
      img.addEventListener('click', (evt) => {
        evt.stopPropagation();
        showImageLightbox(url);
      });
      container.appendChild(img);

      // リサイズハンドルの作成
      const resizer = document.createElement('div');
      resizer.className = 'image-resizer';
      
      // リサイズドラッグ処理
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const startX = e.clientX;
        const startWidth = container.getBoundingClientRect().width;
        const parentWidth = blockWrapper.getBoundingClientRect().width;

        const onMouseMove = (moveEvent) => {
          const deltaX = moveEvent.clientX - startX;
          let newWidth = startWidth + deltaX;
          let newWidthPercent = (newWidth / parentWidth) * 100;

          // 10% から 100% の範囲に制限
          newWidthPercent = Math.max(10, Math.min(100, newWidthPercent));
          container.style.width = `${newWidthPercent}%`;
          
          block.properties = block.properties || {};
          block.properties.width = Math.round(newWidthPercent);
        };

        const onMouseUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          
          saveNotesToStorage();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      container.appendChild(resizer);

      const imgControls = document.createElement('div');
      imgControls.className = 'image-block-controls';
      imgControls.style = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s ease; z-index: 100;';

      // Width buttons
      const size30Btn = document.createElement('button');
      size30Btn.className = 'btn-icon-secondary';
      size30Btn.style = 'background: rgba(13,17,28,0.85); color: #fff; border: 1px solid var(--border-light); border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;';
      size30Btn.textContent = '30%';
      size30Btn.addEventListener('click', () => {
        block.properties = block.properties || {};
        block.properties.width = 30;
        saveNotesToStorage();
        renderEditor();
      });
      imgControls.appendChild(size30Btn);

      const size50Btn = document.createElement('button');
      size50Btn.className = 'btn-icon-secondary';
      size50Btn.style = 'background: rgba(13,17,28,0.85); color: #fff; border: 1px solid var(--border-light); border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;';
      size50Btn.textContent = '50%';
      size50Btn.addEventListener('click', () => {
        block.properties = block.properties || {};
        block.properties.width = 50;
        saveNotesToStorage();
        renderEditor();
      });
      imgControls.appendChild(size50Btn);

      const size100Btn = document.createElement('button');
      size100Btn.className = 'btn-icon-secondary';
      size100Btn.style = 'background: rgba(13,17,28,0.85); color: #fff; border: 1px solid var(--border-light); border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;';
      size100Btn.textContent = '100%';
      size100Btn.addEventListener('click', () => {
        block.properties = block.properties || {};
        block.properties.width = 100;
        saveNotesToStorage();
        renderEditor();
      });
      imgControls.appendChild(size100Btn);

      const changeBtn = document.createElement('button');
      changeBtn.className = 'btn-icon-secondary';
      changeBtn.style = 'background: rgba(13,17,28,0.85); color: #fff; border: 1px solid var(--border-light); border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; display: flex; align-items: center; gap: 4px;';
      changeBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 変更';
      changeBtn.addEventListener('click', () => {
        block.properties = block.properties || {};
        block.properties.url = '';
        saveNotesToStorage();
        renderEditor();
      });
      imgControls.appendChild(changeBtn);

      container.appendChild(imgControls);

      container.addEventListener('mouseenter', () => {
        imgControls.style.opacity = '1';
      });
      container.addEventListener('mouseleave', () => {
        imgControls.style.opacity = '0';
      });
    }

    blockWrapper.appendChild(container);

    const controls = createBlockControls(block.id, block.type);
    blockWrapper.appendChild(controls);

    const contentEl = document.createElement('div');
    contentEl.className = 'block-content block-image-placeholder';
    contentEl.style.display = 'none';
    blockWrapper.appendChild(contentEl);

    return blockWrapper;
  }

  // Left Hover Controls
  const controls = createBlockControls(block.id, block.type);
  blockWrapper.appendChild(controls);

  // Structural details based on block type
  if (block.type === 'toggle') {
    // トグルの子要素が空または存在しない場合、最低でも1つの空段落を自動挿入する
    if (!block.children || block.children.length === 0) {
      block.children = [{ id: generateId(), type: 'p', content: '' }];
    }

    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'block-toggle-wrapper';
    toggleContainer.style.width = '100%';

    const triggerRow = document.createElement('div');
    triggerRow.className = 'toggle-trigger-row';

    const arrowBtn = document.createElement('button');
    arrowBtn.className = 'btn-toggle-arrow';
    if (block.properties && block.properties.open) {
      arrowBtn.classList.add('open');
    }
    arrowBtn.innerHTML = '<i class="fa-solid fa-caret-right"></i>';
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      block.properties = block.properties || {};
      block.properties.open = !block.properties.open;
      saveNotesToStorage();
      renderEditor();
    });

    const contentEl = createEditableContent(block);
    triggerRow.appendChild(arrowBtn);
    triggerRow.appendChild(contentEl);
    toggleContainer.appendChild(triggerRow);

    // Render nested children
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'toggle-children';
    if (block.properties && block.properties.open) {
      childrenDiv.style.display = 'flex';
    } else {
      childrenDiv.style.display = 'none';
    }

    if (block.children && block.children.length > 0) {
      block.children.forEach(child => {
        const childEl = createBlockDOM(child, block);
        childrenDiv.appendChild(childEl);
      });
    }
    toggleContainer.appendChild(childrenDiv);
    blockWrapper.appendChild(toggleContainer);
    return blockWrapper;
  }

  if (block.type === 'todo') {
    const todoRow = document.createElement('div');
    todoRow.className = 'todo-trigger-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-checkbox';
    checkbox.checked = block.properties?.checked || false;
    checkbox.addEventListener('change', () => {
      block.properties = block.properties || {};
      block.properties.checked = checkbox.checked;
      const contentEl = todoRow.querySelector('.block-content');
      if (checkbox.checked) {
        contentEl.classList.add('completed');
      } else {
        contentEl.classList.remove('completed');
      }
      saveNotesToStorage();
    });

    const contentEl = createEditableContent(block);
    if (checkbox.checked) {
      contentEl.classList.add('completed');
    }

    todoRow.appendChild(checkbox);
    todoRow.appendChild(contentEl);
    blockWrapper.appendChild(todoRow);
    return blockWrapper;
  }

  if (block.type === 'bullet') {
    const bulletRow = document.createElement('div');
    bulletRow.className = 'bullet-trigger-row';

    const dot = document.createElement('div');
    dot.className = 'bullet-dot';

    const contentEl = createEditableContent(block);
    bulletRow.appendChild(dot);
    bulletRow.appendChild(contentEl);
    blockWrapper.appendChild(bulletRow);
    return blockWrapper;
  }

  if (block.type === 'callout') {
    const container = document.createElement('div');
    container.className = 'block-callout-container';

    const emojiEl = document.createElement('span');
    emojiEl.className = 'callout-emoji-wrapper';
    emojiEl.textContent = block.properties?.emoji || '💡';
    emojiEl.contentEditable = 'true';

    emojiEl.addEventListener('blur', () => {
      block.properties = block.properties || {};
      block.properties.emoji = emojiEl.textContent.trim() || '💡';
      saveNotesToStorage();
    });
    emojiEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        emojiEl.blur();
        const nextEl = container.querySelector('.block-content');
        if (nextEl) focusBlock(nextEl);
      }
    });

    const contentEl = createEditableContent(block);

    container.appendChild(emojiEl);
    container.appendChild(contentEl);
    blockWrapper.appendChild(container);
    return blockWrapper;
  }

  if (block.type === 'divider') {
    const container = document.createElement('div');
    container.className = 'block-divider-container';

    const line = document.createElement('hr');
    line.className = 'block-divider-line';

    container.appendChild(line);
    blockWrapper.appendChild(container);

    // プレースホルダー（DOM整合性のため）
    const contentEl = document.createElement('div');
    contentEl.className = 'block-content block-divider';
    contentEl.style.display = 'none';
    blockWrapper.appendChild(contentEl);

    return blockWrapper;
  }

  if (block.type === 'database') {
    const container = document.createElement('div');
    container.className = 'database-container';

    const tableEl = createDatabaseDOM(block);
    container.appendChild(tableEl);

    blockWrapper.appendChild(container);

    // プレースホルダー（DOM整合性のため）
    const contentEl = document.createElement('div');
    contentEl.className = 'block-content block-database';
    contentEl.style.display = 'none';
    blockWrapper.appendChild(contentEl);

    return blockWrapper;
  }

  // Normal Leaf Block: Paragraph, H1, H2, Code
  const contentEl = createEditableContent(block);
  blockWrapper.appendChild(contentEl);

  return blockWrapper;
}

// Generate Block Controls (Drag + Add buttons)
function createBlockControls(blockId, blockType = null) {
  const div = document.createElement('div');
  div.className = 'block-controls';
  div.setAttribute('contenteditable', 'false');

  // 一括選択用チェックボックス
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'block-select-check';
  check.title = 'ブロックを一括選択';
  check.style = 'cursor:pointer; margin: 0 4px 0 0; width:11px; height:11px; display:inline-block; accent-color: var(--accent-primary);';
  check.checked = state.selectedBlockIds && state.selectedBlockIds.includes(blockId);

  check.addEventListener('click', (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      check.checked = !check.checked;
      handleBlockClick(e, blockId);
    }
  });

  check.addEventListener('change', (e) => {
    e.stopPropagation();
    const checked = e.target.checked;
    if (!state.selectedBlockIds) state.selectedBlockIds = [];

    if (checked) {
      if (!state.selectedBlockIds.includes(blockId)) {
        state.selectedBlockIds.push(blockId);
      }
      const wrapper = document.querySelector(`.block-wrapper[data-id="${blockId}"]`);
      if (wrapper) wrapper.classList.add('selected');
    } else {
      state.selectedBlockIds = state.selectedBlockIds.filter(id => id !== blockId);
      const wrapper = document.querySelector(`.block-wrapper[data-id="${blockId}"]`);
      if (wrapper) wrapper.classList.remove('selected');
    }

    updateBlockBulkActionBar();

    // 通常クリックして選択した時に前回の選択IDを更新する
    state.lastSelectedBlockId = blockId;
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-block';
  addBtn.title = 'ブロックを追加';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addBtn.addEventListener('click', (e) => {
    insertBlockBelow(blockId);
  });

  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.setAttribute('draggable', 'true');
  dragHandle.title = 'ドラッグして並べ替え / 列作成';
  dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';

  div.appendChild(check);
  div.appendChild(addBtn);
  div.appendChild(dragHandle);

  // カラム解除ボタン（columnsブロック用）
  if (blockType === 'columns') {
    const uncolumnBtn = document.createElement('button');
    uncolumnBtn.className = 'btn-uncolumn';
    uncolumnBtn.style.background = 'none';
    uncolumnBtn.style.border = 'none';
    uncolumnBtn.style.color = 'var(--text-muted)';
    uncolumnBtn.style.cursor = 'pointer';
    uncolumnBtn.style.fontSize = '11px';
    uncolumnBtn.style.width = '14px';
    uncolumnBtn.style.height = '20px';
    uncolumnBtn.style.display = 'flex';
    uncolumnBtn.style.alignItems = 'center';
    uncolumnBtn.style.justifyContent = 'center';
    uncolumnBtn.title = 'カラムを解除して元の配列に戻す';
    uncolumnBtn.innerHTML = '<i class="fa-solid fa-arrows-to-dot"></i>';

    uncolumnBtn.addEventListener('mouseenter', () => {
      uncolumnBtn.style.color = 'var(--accent-primary)';
    });
    uncolumnBtn.addEventListener('mouseleave', () => {
      uncolumnBtn.style.color = 'var(--text-muted)';
    });
    uncolumnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      uncolumn(blockId);
    });

    div.appendChild(uncolumnBtn);
  }

  return div;
}

// Create editable content div
function createEditableContent(block) {
  const contentDiv = document.createElement('div');
  contentDiv.className = `block-content block-${block.type}`;
  if (block.id === state.activeFocusedBlockId) {
    contentDiv.contentEditable = 'true';
  } else {
    contentDiv.removeAttribute('contenteditable');
  }
  contentDiv.setAttribute('data-id', block.id);

  // Set placeholders based on block type
  let placeholder = '「/」または「￥」でコマンドを入力...';
  if (block.type === 'h1') placeholder = '見出し 1';
  if (block.type === 'h2') placeholder = '見出し 2';
  contentDiv.setAttribute('placeholder', placeholder);

  // Set rendered text (always render parseWikiLinks)
  contentDiv.innerHTML = parseWikiLinks(escapeHTML(block.content));

  // Listeners
  contentDiv.addEventListener('mousedown', (e) => {
    if (contentDiv.contentEditable === 'true') return;
    if (e.button !== 0) return;

    // リンククリック時は即時編集フォーカスに入らないようにし、リンク遷移を優先する
    if (e.target.closest('.wiki-link') || e.target.closest('.external-link')) {
      return;
    }

    // ドラッグ選択開始時にも即座に編集可能にするため、マウスダウン時にフォーカスを当てる
    focusBlock(contentDiv);

    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    mouseDownTarget = contentDiv;
  });

  contentDiv.addEventListener('focus', () => {
    state.activeFocusedBlockId = block.id;
    state.lastActiveEditTarget = contentDiv;
  });

  contentDiv.addEventListener('blur', () => {
    // すでにDOMから取り除かれている古い要素なら、非同期の暴発によるデータ破壊を防ぐため無視する
    if (!document.body.contains(contentDiv)) return;
    if (historyState.isApplying) return;
    if (state.isPasting) return;

    // リンク編集ポップオーバーが開いている間は、この自動 blur 処理を一時スキップする
    if (document.getElementById('notidian-link-edit-popover')) {
      return;
    }

    // Save content to state (using HTML-to-WikiText serializer)
    const textVal = serializeHtmlToWikiText(contentDiv);
    const oldContent = block.content;
    block.content = textVal;

    state.activeFocusedBlockId = null;
    contentDiv.removeAttribute('contenteditable');

    // Re-render to ensure styling and link-new tags are updated correctly
    contentDiv.innerHTML = parseWikiLinks(escapeHTML(block.content));

    if (oldContent !== textVal) {
      saveNotesToStorage();
      updateBacklinks();
    }
  });

  contentDiv.addEventListener('input', (e) => {
    block.content = serializeHtmlToWikiText(contentDiv);

    // Check slash command trigger "/"
    handleSlashCommandTrigger(contentDiv, e);

    // Check WikiLink autocomplete trigger "[[" or "「「"
    handleWikiLinkTrigger(contentDiv, e);
  });

  contentDiv.addEventListener('keydown', (e) => {
    handleEditorKeydown(e, block, contentDiv);
  });

  contentDiv.addEventListener('paste', (e) => {
    handleBlockPaste(e, block, contentDiv);
  });

  return contentDiv;
}

// ==========================================
// 4. EDITOR KEYBOARD & BLOCK CONTROL LOGIC
// ==========================================

function findBlockAndParent(blocks, id, parent = null) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) {
      return { block: blocks[i], parentArray: blocks, index: i, parent };
    }
    if (blocks[i].children && blocks[i].children.length > 0) {
      const res = findBlockAndParent(blocks[i].children, id, blocks[i]);
      if (res) return res;
    }
  }
  return null;
}

function insertBlockBelow(activeBlockId) {
  const note = getActiveNote();
  if (!note) return;

  const found = findBlockAndParent(note.blocks, activeBlockId);
  if (!found) return;

  const newBlock = { id: generateId(), type: 'p', content: '' };
  found.parentArray.splice(found.index + 1, 0, newBlock);

  saveNotesToStorage();
  renderEditor();

  // Focus the new block
  setTimeout(() => {
    const el = document.querySelector(`.block-content[data-id="${newBlock.id}"]`);
    if (el) focusBlock(el);
  }, 50);
}

function handleEditorKeydown(e, block, contentDiv) {
  // Intercept Undo / Redo to prevent browser default conflicts
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.stopPropagation();
    undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    e.stopPropagation();
    redo();
    return;
  }

  // Slash menu navigation
  if (state.slashMenuOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSlashMenu(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSlashMenu(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectSlashMenuItem();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSlashMenu();
      return;
    }
  }

  // Wiki link menu navigation
  if (state.linkMenuOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateLinkMenu(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateLinkMenu(-1);
      return;
    }
    if (e.key === 'Enter') {
      if (e.isComposing || state.isComposing) return; // IME変換確定時はWikiLink確定処理を実行しない
      e.preventDefault();
      selectLinkMenuItem();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLinkMenu();
      return;
    }
  }

  // Regular keydowns
  if (e.key === 'Enter' && !e.shiftKey) {
    if (e.isComposing || state.isComposing) return; // IME変換確定時はWikiLink確定処理を実行しない

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
          e.preventDefault();
          const keyword = match[1];
          const trimmedKeyword = keyword.trim();
          if (!trimmedKeyword) return;

          // トリガーされたカッコの種類を特定
          const triggerType = beforeText.substring(beforeText.length - keyword.length - 2, beforeText.length - keyword.length);
          const isJp = triggerType === '「「';
          const closeBracket = isJp ? '」」' : ']]';

          // 🌟 存在しないノートの場合、裏で自動的に新規ノートを作成して「リンクが機能」するように実在化！
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

          // エディタのブロック内容を更新 (HTML-to-WikiTextシリアライザを使う)
          block.content = serializeHtmlToWikiText(contentDiv);
          saveNotesToStorage();
          return;
        }
      }
    }

    e.preventDefault();
    block.content = serializeHtmlToWikiText(contentDiv);
    const note = getActiveNote();
    const found = findBlockAndParent(note.blocks, block.id);
    if (!found) return;

    // Create a new block below
    // Notion behavior: if we press Enter inside H1/H2, the next block should default to paragraph (p)
    const newType = (block.type === 'h1' || block.type === 'h2') ? 'p' : block.type;
    const newBlock = { id: generateId(), type: newType, content: '' };

    // Copy toggle parent/state properties if relevant
    if (newType === 'todo') newBlock.properties = { checked: false };
    if (newType === 'toggle') newBlock.properties = { open: true };

    found.parentArray.splice(found.index + 1, 0, newBlock);
    saveNotesToStorage();
    renderEditor();

    // Focus next block
    setTimeout(() => {
      const nextEl = document.querySelector(`.block-content[data-id="${newBlock.id}"]`);
      if (nextEl) focusBlock(nextEl);
    }, 50);
  }

  if (e.key === 'Backspace') {
    // --- ハイライト（WikiLink）のバックスペース一括削除処理 ---
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      let offset = range.startOffset;
      let targetSpan = null;

      // 1. カーソルが WikiLink の内部にある場合
      let temp = node;
      while (temp && temp !== contentDiv) {
        if (temp.nodeType === Node.ELEMENT_NODE && temp.classList.contains('wiki-link')) {
          targetSpan = temp;
          break;
        }
        temp = temp.parentNode;
      }

      // 2. カーソルが WikiLink の直後にある場合
      if (!targetSpan) {
        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
          let prev = node.previousSibling;
          if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.classList.contains('wiki-link')) {
            targetSpan = prev;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
          let prev = node.childNodes[offset - 1];
          if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.classList.contains('wiki-link')) {
            targetSpan = prev;
          }
        }
      }

      if (targetSpan) {
        e.preventDefault();
        const parent = targetSpan.parentNode;
        let prevTextNode = targetSpan.previousSibling;

        if (!prevTextNode || prevTextNode.nodeType !== Node.TEXT_NODE) {
          prevTextNode = document.createTextNode('');
          parent.insertBefore(prevTextNode, targetSpan);
        }

        parent.removeChild(targetSpan);

        const newRange = document.createRange();
        newRange.setStart(prevTextNode, prevTextNode.length);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);

        block.content = serializeHtmlToWikiText(contentDiv);
        saveNotesToStorage();
        return;
      }
    }

    const text = contentDiv.textContent;
    if (text.length === 0) {
      e.preventDefault();
      const note = getActiveNote();
      const found = findBlockAndParent(note.blocks, block.id);
      if (!found) return;

      // If it's a special block (h1, h2, todo, toggle, bullet, code), change it back to paragraph first!
      if (block.type !== 'p') {
        block.type = 'p';
        saveNotesToStorage();
        renderEditor();
        setTimeout(() => {
          const el = document.querySelector(`.block-content[data-id="${block.id}"]`);
          if (el) {
            focusBlock(el);
            // Position cursor
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }, 50);
        return;
      }

      // If already paragraph and empty, delete it
      if (found.parentArray.length > 1 || found.parent) {
        // Find previous block to focus before deletion
        const allEditable = Array.from(document.querySelectorAll('.block-content'));
        const activeIdx = allEditable.findIndex(el => el.getAttribute('data-id') === block.id);
        const prevEl = allEditable[activeIdx - 1];

        // Delete from array
        found.parentArray.splice(found.index, 1);

        // Clean up empty columns/toggles
        cleanupEmptyBlocks(note.blocks);

        saveNotesToStorage();
        renderEditor();

        if (prevEl) {
          setTimeout(() => {
            const elToFocus = document.querySelector(`.block-content[data-id="${prevEl.getAttribute('data-id')}"]`);
            if (elToFocus) {
              focusBlock(elToFocus);
              // Cursor at end
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(elToFocus);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }, 50);
        }
      }
    }
  }

  // Focus navigation with Up/Down arrow keys
  if (e.key === 'ArrowUp' && !state.slashMenuOpen && !state.linkMenuOpen) {
    const allEditable = Array.from(document.querySelectorAll('.block-content'));
    const activeIdx = allEditable.findIndex(el => el.getAttribute('data-id') === block.id);
    if (activeIdx > 0) {
      e.preventDefault();
      focusBlock(allEditable[activeIdx - 1]);
    }
  }
  if (e.key === 'ArrowDown' && !state.slashMenuOpen && !state.linkMenuOpen) {
    const allEditable = Array.from(document.querySelectorAll('.block-content'));
    const activeIdx = allEditable.findIndex(el => el.getAttribute('data-id') === block.id);
    if (activeIdx < allEditable.length - 1) {
      e.preventDefault();
      focusBlock(allEditable[activeIdx + 1]);
    }
  }

  // Nest blocks under toggles with Tab / Shift+Tab
  if (e.key === 'Tab') {
    e.preventDefault();
    block.content = serializeHtmlToWikiText(contentDiv);
    const note = getActiveNote();
    if (!note) return;

    const found = findBlockAndParent(note.blocks, block.id);
    if (!found) return;

    if (e.shiftKey) {
      // Shift + Tab: Move block out of toggle children (Outdent)
      if (found.parent && found.parent.type === 'toggle') {
        const grandparent = findBlockAndParent(note.blocks, found.parent.id);
        if (grandparent) {
          // Remove from parent toggle
          found.parentArray.splice(found.index, 1);

          // Insert into grandparent's array, right after the parent toggle
          grandparent.parentArray.splice(grandparent.index + 1, 0, block);

          saveNotesToStorage();
          renderEditor();

          // Refocus the block
          setTimeout(() => {
            const el = document.querySelector(`.block-content[data-id="${block.id}"]`);
            if (el) {
              focusBlock(el);
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(el);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }, 50);
        }
      }
    } else {
      // Tab: Nest block inside the previous sibling if it's a toggle (Indent)
      if (found.index > 0) {
        const prevBlock = found.parentArray[found.index - 1];

        if (prevBlock.type === 'toggle') {
          // Remove from current parent array
          found.parentArray.splice(found.index, 1);

          // Move into previous sibling's children
          prevBlock.children = prevBlock.children || [];
          prevBlock.children.push(block);

          // Auto-expand toggle
          prevBlock.properties = prevBlock.properties || {};
          prevBlock.properties.open = true;

          saveNotesToStorage();
          renderEditor();

          // Refocus the block
          setTimeout(() => {
            const el = document.querySelector(`.block-content[data-id="${block.id}"]`);
            if (el) {
              focusBlock(el);
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(el);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }, 50);
        }
      }
    }
    return;
  }
}

// 幅の自動均等再配分
function reallocateColumnWidths(columnsBlock) {
  const count = columnsBlock.children.length;
  if (count === 0) return;
  const equalPercent = 100 / count;
  columnsBlock.children.forEach(col => {
    col.properties = col.properties || {};
    col.properties.width = equalPercent;
  });
}

// カラムを解除して中のブロックをフラットに並べる
export function uncolumn(columnsBlockId) {
  const note = getActiveNote();
  if (!note) return;

  const found = findBlockAndParent(note.blocks, columnsBlockId);
  if (!found || found.block.type !== 'columns') return;

  const flatBlocks = [];
  found.block.children.forEach(column => {
    if (column.children) {
      column.children.forEach(child => {
        flatBlocks.push(child);
      });
    }
  });

  // もし中身が完全に空だった場合は、ダミーの空段落を置いておく
  if (flatBlocks.length === 0) {
    flatBlocks.push({ id: generateId(), type: 'p', content: '' });
  }

  // 親の配列に、columnsブロックの代わりにフラットなブロックたちを直接差し込む
  found.parentArray.splice(found.index, 1, ...flatBlocks);

  saveNotesToStorage();
  renderEditor();
}

// Clean up columns or column nodes that become empty
function cleanupEmptyBlocks(blocksArray) {
  for (let i = blocksArray.length - 1; i >= 0; i--) {
    const b = blocksArray[i];
    if (b.type === 'columns') {
      const origCount = b.children ? b.children.length : 0;
      // Remove column container if it has no columns, or if all columns are empty
      if (!b.children || b.children.length === 0) {
        blocksArray.splice(i, 1);
        continue;
      }
      // Clean children columns
      cleanupEmptyBlocks(b.children);

      // If columns contain only 1 column, flat it back
      if (b.children.length === 1) {
        const col = b.children[0];
        blocksArray.splice(i, 1, ...col.children);
        continue;
      }

      // カラムの数が減った場合は幅を再割り当てする
      if (b.children.length !== origCount) {
        reallocateColumnWidths(b);
      }
    }
    if (b.type === 'column') {
      if (!b.children || b.children.length === 0) {
        blocksArray.splice(i, 1);
        continue;
      }

      // 自動平坦化：もし column の中に columns が入り込んでしまった場合、
      // columns ブロックを解除し、その中のすべてのカラムの子要素をフラットに引き出して
      // column の直下に展開する。
      for (let j = b.children.length - 1; j >= 0; j--) {
        const child = b.children[j];
        if (child.type === 'columns' && child.children) {
          const flatChildren = [];
          child.children.forEach(subCol => {
            if (subCol.children) {
              subCol.children.forEach(grandChild => {
                flatChildren.push(grandChild);
              });
            }
          });
          // columns ブロックをフラットな子要素に置き換える
          b.children.splice(j, 1, ...flatChildren);
        }
      }

      cleanupEmptyBlocks(b.children);
    }
    if (b.type === 'toggle') {
      if (b.children) {
        cleanupEmptyBlocks(b.children);
      }
    }
  }
}

// ==========================================
// 5. DRAG & DROP FOR COLUMNS & REORDERING
// ==========================================

function setupDragDropListeners() {
  const wrappers = document.querySelectorAll('.block-wrapper');

  wrappers.forEach(wrapper => {
    const handle = wrapper.querySelector('.drag-handle');
    if (!handle) return;

    // Only allow drag-start if hovering handle
    handle.addEventListener('mouseenter', () => {
      wrapper.setAttribute('draggable', 'true');
    });
    handle.addEventListener('mouseleave', () => {
      if (!wrapper.classList.contains('dragging')) {
        wrapper.removeAttribute('draggable');
      }
    });
    handle.addEventListener('mousedown', (e) => {
      // 入力カーソルがある状態でのドラッグによるフリーズ（グレー化）を防止するため、フォーカスを外し、選択範囲をクリアする
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      window.getSelection().removeAllRanges();
    });

    const content = wrapper.querySelector('.block-content');
    if (content) {
      content.addEventListener('mouseenter', () => {
        if (!wrapper.classList.contains('dragging')) {
          wrapper.removeAttribute('draggable');
        }
      });
      content.addEventListener('mousedown', () => {
        if (!wrapper.classList.contains('dragging')) {
          wrapper.removeAttribute('draggable');
        }
      });
    }

    wrapper.addEventListener('dragstart', (e) => {
      // データベース関連のドラッグターゲットの場合は、このイベントハンドラでの処理をスルーする。
      const isDbDrag = e.target.closest('.notion-db-table, .db-view-tab');
      if (isDbDrag) {
        return;
      }

      // ドラッグアイコン（.drag-handle）をドラッグしたときのみブロック移動を許可し、テキストのドラッグ選択からブロック移動が起きるのを防ぐ。
      const isDragHandle = e.target.closest('.drag-handle');
      if (!isDragHandle) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      const blockId = wrapper.getAttribute('data-id');
      state.draggedBlockId = blockId;

      // ドラッグ中のブロックのタイプを取得してキャッシュ
      const note = getActiveNote();
      if (note) {
        const found = findBlockAndParent(note.blocks, blockId);
        if (found) {
          state.draggedBlockType = found.block.type;
        }
      }

      wrapper.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', blockId);

      // Drag ghost spacing image/alpha
      setTimeout(() => {
        wrapper.style.opacity = '0.4';
      }, 0);
    });

    wrapper.addEventListener('dragend', () => {
      wrapper.classList.remove('dragging');
      wrapper.removeAttribute('draggable');
      wrapper.style.opacity = '1';
      state.draggedBlockId = null;
      state.draggedBlockType = null; // キャッシュリセット
      hideDropIndicators();
    });

    wrapper.addEventListener('dragover', (e) => {
      const isDbDrag = e.target.closest('.notion-db-table, .db-view-tab');
      if (isDbDrag) {
        return;
      }
      if (!state.draggedBlockId) {
        hideDropIndicators();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const targetId = wrapper.getAttribute('data-id');

      // Prevent dropping on itself or direct children (descendants)
      if (targetId === state.draggedBlockId || isDescendant(state.draggedBlockId, targetId)) {
        hideDropIndicators();
        return;
      }

      state.dropTargetBlockId = targetId;

      // Calculate where cursor is relative to target bounds
      const rect = wrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const xRatio = x / rect.width;
      const yRatio = y / rect.height;

      // ドラッグ中ブロックがカラム系コンテナの場合は左右のドロップ（カラムネスト）を制限
      const isDraggedContainer = state.draggedBlockType === 'columns' || state.draggedBlockType === 'column';

      // トグルブロック（toggle）に対するドロップの差別化判定
      const note = getActiveNote();
      const found = findBlockAndParent(note.blocks, targetId);

      let isLeftRightAllowed = !isDraggedContainer;
      let contentRect = null;

      if (found && found.block.type === 'toggle') {
        const contentEl = wrapper.querySelector('.block-content');
        if (contentEl) {
          contentRect = contentEl.getBoundingClientRect();
          // トグルの左端（30px以内）または右端（50px以内）へのドラッグ時はカラム化を許可する。
          // それ以外の中央付近へのドラッグのみ、トグル内へのネスト（inside）を優先するために制限する。
          const isAtLeftEdge = (e.clientX - rect.left) < 30;
          const isAtRightEdge = (rect.right - e.clientX) < 50;
          if (!isAtLeftEdge && !isAtRightEdge) {
            isLeftRightAllowed = false;
          }
        }
      }

      // 1. カラム作成（左右非対称の優先判定）
      let resolvedLocation = null;

      if (isLeftRightAllowed) {
        // 右端 80px 以内なら最優先で右カラム作成（極めて広く取り確実に起動！）
        if (rect.width - x < 80) {
          resolvedLocation = 'right';
        }
        // 左端 30px 以内なら最優先で左カラム作成（ドラッグハンドル12pxを避けつつ十分狙える広さに設定）
        // ただし、上下の隙間（6px以内）を狙って行並べ替えをしている時は誤判定を防ぐため除外
        else if (x < 30 && y >= 6 && rect.height - y >= 6) {
          resolvedLocation = 'left';
        }
      }

      // 2. 縦方向（行間）の判定（ガタつきをゼロにする）
      if (!resolvedLocation) {
        // トグルブロック内のネスト（inside）処理（トグルが開いている時のみ許可）
        const isToggleInside = found &&
                               found.block.type === 'toggle' &&
                               found.block.properties &&
                               found.block.properties.open &&
                               !isLeftRightAllowed &&
                               contentRect;

        if (isToggleInside) {
          if (y < rect.height * 0.3) {
            resolvedLocation = 'top';
          } else {
            resolvedLocation = 'inside';
          }
        } else {
          // 隣り合うブロック間での行間判定の重複（チラつき）を防ぐため、常に「そのブロックの上（top）」を判定する。
          // ただし、リストの「最後」のブロックに対してのみ、下半分（y >= rect.height * 0.5）で「下（bottom）」への挿入を許可する。
          const parentArray = found ? found.parentArray : null;
          const isLastInArray = parentArray && parentArray.indexOf(found.block) === parentArray.length - 1;

          if (isLastInArray && y >= rect.height * 0.5) {
            resolvedLocation = 'bottom';
          } else {
            resolvedLocation = 'top';
          }
        }
      }

      // 3. 確定した位置に基づいてインジケータを表示
      state.dropLocation = resolvedLocation;

      if (resolvedLocation === 'left') {
        showDropIndicator('left', rect);
      } else if (resolvedLocation === 'right') {
        showDropIndicator('right', rect);
      } else if (resolvedLocation === 'top') {
        showDropIndicator('top', rect);
      } else if (resolvedLocation === 'inside') {
        // インジケータはトグルのすぐ下、インデントされた位置に表示してネストされることを明示
        const indicator = document.getElementById('drop-indicator-bottom');
        if (indicator) {
          indicator.style.left = `${contentRect.left}px`;
          indicator.style.top = `${contentRect.bottom - 2}px`;
          indicator.style.width = `${contentRect.width}px`;
          indicator.style.display = 'block';
        }
      } else {
        showDropIndicator('bottom', rect);
      }
    });

    wrapper.addEventListener('drop', (e) => {
      const isDbDrag = e.target.closest('.notion-db-table, .db-view-tab');
      if (isDbDrag) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      hideDropIndicators();

      if (!state.draggedBlockId || !state.dropTargetBlockId) return;
      if (state.draggedBlockId === state.dropTargetBlockId) return;

      executeBlockDrop(state.draggedBlockId, state.dropTargetBlockId, state.dropLocation);
    });
  });

  // カラムブロック（.column-block）の余白へのドラッグ＆ドロップの監視を追加
  const columnBlocks = document.querySelectorAll('.column-block');
  columnBlocks.forEach(colBlock => {
    colBlock.addEventListener('dragover', (e) => {
      const isDbDrag = e.target.closest('.notion-db-table, .db-view-tab');
      if (isDbDrag) {
        return;
      }
      if (!state.draggedBlockId) {
        hideDropIndicators();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const colId = colBlock.getAttribute('data-id');

      // 自分自身や子孫へのドロップを防止
      if (colId === state.draggedBlockId || isDescendant(state.draggedBlockId, colId)) {
        hideDropIndicators();
        return;
      }

      // ドラッグ中のブロックがカラムコンテナの場合は column への左右ドロップを禁止
      if (state.draggedBlockType === 'columns' || state.draggedBlockType === 'column') {
        hideDropIndicators();
        return;
      }

      // カラムの中の最後の子ブロックをドロップ先（ターゲット）とする
      const childWrappers = Array.from(colBlock.querySelectorAll('.block-wrapper'));
      if (childWrappers.length > 0) {
        const lastChild = childWrappers[childWrappers.length - 1];
        const lastChildId = lastChild.getAttribute('data-id');

        state.dropTargetBlockId = lastChildId;
        state.dropLocation = 'right'; // カラム自体の余白へドロップした場合は右側カラム追加とする

        const rect = lastChild.getBoundingClientRect();
        showDropIndicator('right', rect);
      }
    });

    colBlock.addEventListener('drop', (e) => {
      const isDbDrag = e.target.closest('.notion-db-table, .db-view-tab');
      if (isDbDrag) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      hideDropIndicators();

      if (!state.draggedBlockId || !state.dropTargetBlockId) return;
      if (state.draggedBlockId === state.dropTargetBlockId) return;

      executeBlockDrop(state.draggedBlockId, state.dropTargetBlockId, state.dropLocation);
    });
  });
}



function isDescendant(parentBlockId, targetBlockId) {
  const note = getActiveNote();
  if (!note) return false;

  const parentResult = findBlockAndParent(note.blocks, parentBlockId);
  if (!parentResult || !parentResult.block.children) return false;

  // Search inside parent children
  const searchResult = findBlockAndParent(parentResult.block.children, targetBlockId);
  return searchResult !== null;
}

function showDropIndicator(location, rect) {
  hideDropIndicators();

  let indicator = null;
  if (location === 'left') {
    indicator = document.getElementById('drop-indicator-left');
    indicator.style.left = `${rect.left}px`;
    indicator.style.top = `${rect.top}px`;
    indicator.style.height = `${rect.height}px`;
  } else if (location === 'right') {
    indicator = document.getElementById('drop-indicator-right');
    indicator.style.left = `${rect.right - 4}px`;
    indicator.style.top = `${rect.top}px`;
    indicator.style.height = `${rect.height}px`;
  } else if (location === 'top') {
    indicator = document.getElementById('drop-indicator-top');
    indicator.style.left = `${rect.left}px`;
    indicator.style.top = `${rect.top}px`;
    indicator.style.width = `${rect.width}px`;
  } else if (location === 'bottom') {
    indicator = document.getElementById('drop-indicator-bottom');
    indicator.style.left = `${rect.left}px`;
    indicator.style.top = `${rect.bottom - 4}px`;
    indicator.style.width = `${rect.width}px`;
  }

  if (indicator) {
    indicator.style.display = 'block';
  }
}

function hideDropIndicators() {
  document.getElementById('drop-indicator-left').style.display = 'none';
  document.getElementById('drop-indicator-right').style.display = 'none';
  document.getElementById('drop-indicator-top').style.display = 'none';
  document.getElementById('drop-indicator-bottom').style.display = 'none';
}

// DRAG DROP STATE TRANSFORMATION: The core reordering & column creation engine
function executeBlockDrop(draggedId, targetId, location) {
  const note = getActiveNote();
  if (!note) return;

  // 1. Find and Extract Dragged Block
  const draggedInfo = findBlockAndParent(note.blocks, draggedId);
  if (!draggedInfo) return;
  const draggedBlock = draggedInfo.block;

  // Extract
  draggedInfo.parentArray.splice(draggedInfo.index, 1);

  // 2. Find Target Block after extraction
  const targetInfo = findBlockAndParent(note.blocks, targetId);
  if (!targetInfo) {
    // If target was lost, put dragged block back at the end
    note.blocks.push(draggedBlock);
    saveNotesToStorage();
    renderEditor();
    return;
  }

  const targetBlock = targetInfo.block;

  // 3. Drop Mutations
  if (location === 'left' || location === 'right') {
    // もしドラッグ中ブロックが columns または column の場合、カラムのネストを防ぐため強制的に bottom へフォールバック
    if (draggedBlock.type === 'columns' || draggedBlock.type === 'column') {
      location = 'bottom';
    }
  }

  if (location === 'top') {
    targetInfo.parentArray.splice(targetInfo.index, 0, draggedBlock);
  } else if (location === 'bottom') {
    targetInfo.parentArray.splice(targetInfo.index + 1, 0, draggedBlock);
  } else if (location === 'inside') {
    // ターゲットトグルの子要素の先頭にドラッグされたブロックを挿入
    targetBlock.children = targetBlock.children || [];
    targetBlock.children.unshift(draggedBlock);

    // トグルを自動的に展開
    targetBlock.properties = targetBlock.properties || {};
    targetBlock.properties.open = true;
  } else if (location === 'left' || location === 'right') {
    // Create or append Columns!
    // Case C: Target block is already a 'columns' container block
    if (targetBlock.type === 'columns') {
      const newColumn = {
        id: generateId(),
        type: 'column',
        children: [draggedBlock]
      };

      const insertIdx = location === 'left' ? 0 : targetBlock.children.length;
      targetBlock.children.splice(insertIdx, 0, newColumn);
      reallocateColumnWidths(targetBlock); // 自動均等配分
    }
    // Case A: Is the target block already inside a Column?
    else if (targetInfo.parent && targetInfo.parent.type === 'column') {
      const grandparent = findBlockAndParent(note.blocks, targetInfo.parent.id);
      if (grandparent && grandparent.parent && grandparent.parent.type === 'columns') {
        const columnsBlock = grandparent.parent;
        const targetColIndex = columnsBlock.children.findIndex(c => c.id === targetInfo.parent.id);

        // Add new column next to target's column
        const newColumn = {
          id: generateId(),
          type: 'column',
          children: [draggedBlock]
        };

        const insertIdx = location === 'left' ? targetColIndex : targetColIndex + 1;
        columnsBlock.children.splice(insertIdx, 0, newColumn);
        reallocateColumnWidths(columnsBlock); // 自動均等配分
      }
    } else {
      // Case B: Target is normal block. Wrap both target and dragged into a Columns container
      const newColumnsBlock = {
        id: generateId(),
        type: 'columns',
        content: '',
        children: []
      };

      const colTarget = {
        id: generateId(),
        type: 'column',
        children: [targetBlock]
      };

      const colDragged = {
        id: generateId(),
        type: 'column',
        children: [draggedBlock]
      };

      if (location === 'left') {
        newColumnsBlock.children = [colDragged, colTarget];
      } else {
        newColumnsBlock.children = [colTarget, colDragged];
      }
      reallocateColumnWidths(newColumnsBlock); // 自動均等配分

      // Replace target block with new columns block
      targetInfo.parentArray.splice(targetInfo.index, 1, newColumnsBlock);
    }
  }

  // Clean empty columns/toggles again
  cleanupEmptyBlocks(note.blocks);

  pushHistory();
  saveNotesToStorage();
  renderEditor();
}

// ==========================================
// 6. SLASH COMMANDS MENU (/)
// ==========================================

const slashMenu = document.getElementById('slash-menu');
const slashMenuList = slashMenu.querySelector('.slash-menu-list');

function handleSlashCommandTrigger(contentDiv, e) {
  const text = contentDiv.textContent;
  const activeBlockId = contentDiv.getAttribute('data-id');

  // Trigger slash menu if text ends with "/", "／", "\", "￥", or "¥"
  if (text.endsWith('/') || text.endsWith('／') || text.endsWith('\\') || text.endsWith('￥') || text.endsWith('¥')) {
    state.slashMenuOpen = true;
    state.slashMenuActiveIndex = 0;

    // Position menu below text
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    slashMenu.style.left = `${rect.left}px`;
    slashMenu.style.top = `${rect.bottom + window.scrollY + 6}px`;
    slashMenu.style.display = 'block';

    renderSlashMenuList();
  } else if (state.slashMenuOpen && !text.includes('/') && !text.includes('／') && !text.includes('\\') && !text.includes('￥') && !text.includes('¥')) {
    closeSlashMenu();
  }
}

function renderSlashMenuList(shouldScroll = true) {
  const items = slashMenuList.querySelectorAll('li');
  items.forEach((li, idx) => {
    if (idx === state.slashMenuActiveIndex) {
      li.classList.add('active');
      if (shouldScroll) {
        li.scrollIntoView({ block: 'nearest' });
      }
    } else {
      li.classList.remove('active');
    }

    // Click trigger (ドラッグハンドル操作時は決定をスルーして並び替え可能にする)
    const handleTrigger = (e) => {
      if (e.target.closest('.drag-handle')) {
        return; // 並び替えドラッグを優先するため決定処理を実行しない
      }
      e.preventDefault();
      state.slashMenuActiveIndex = idx;
      selectSlashMenuItem();
    };

    li.onmousedown = handleTrigger;
    li.onclick = handleTrigger;
  });
}

function navigateSlashMenu(dir) {
  const items = slashMenuList.querySelectorAll('li');
  state.slashMenuActiveIndex = (state.slashMenuActiveIndex + dir + items.length) % items.length;
  renderSlashMenuList();
}

export function setupDragSelection() {
  // 行をまたぐテキスト選択はブラウザ標準の挙動（contenteditable="false"）に任せるため、何もしません。
}

function selectSlashMenuItem() {
  const activeLi = slashMenuList.querySelectorAll('li')[state.slashMenuActiveIndex];
  const newType = activeLi.getAttribute('data-type');
  let focusAfterBlockId = null;

  const note = getActiveNote();
  if (!note) return;

  const activeBlockId = state.activeFocusedBlockId;
  const activeContentDiv = document.querySelector(`.block-content[data-id="${activeBlockId}"]`);
  if (!activeContentDiv) return;

  const found = findBlockAndParent(note.blocks, activeBlockId);
  if (!found) return;

  // IMEの未確定入力を強制的に確定反映させるため、一度フォーカスを外す（超重要）
  activeContentDiv.blur();

  // 入力中に混入したスラッシュや￥などのトリガー記号を一括で完全に削除する（IME確定ズレ対策）
  let text = activeContentDiv.textContent;
  text = text.replace(/[\/／\\￥¥]/g, '');

  // Update block type
  found.block.type = newType;
  found.block.content = text;

  // Add structural default properties
  if (newType === 'todo') found.block.properties = { checked: false };
  if (newType === 'toggle') found.block.properties = { open: true, children: [] };
  if (newType === 'callout') {
    found.block.properties = { emoji: '💡', color: 'purple' };
  }
  if (newType === 'divider') {
    found.block.content = '';
  }
  if (newType === 'image') {
    found.block.properties = { url: '', size: '100' };
    found.block.content = '';
    if (found.parent && found.parent.type === 'toggle' && !found.parentArray[found.index + 1]) {
      const nextBlock = { id: generateId(), type: 'p', content: '' };
      found.parentArray.splice(found.index + 1, 0, nextBlock);
      focusAfterBlockId = nextBlock.id;
    }
  }
  if (newType === 'database') {
    found.block.properties = {
      columns: [
        { id: 'col-title', name: 'タスク名', type: 'text', width: 220 },
        {
          id: 'col-status', name: 'ステータス', type: 'status', width: 120, options: [
            { id: 'opt-todo', name: '未着手', color: 'gray' },
            { id: 'opt-progress', name: '進行中', color: 'blue' },
            { id: 'opt-complete', name: '完了', color: 'green' }
          ]
        },
        { id: 'col-tags', name: 'セレクトタグ', type: 'select', width: 140, options: [] }
      ],
      rows: [],
      views: [
        { id: 'view-all', name: 'すべて', filters: [] }
      ],
      activeViewId: 'view-all',
      groupBy: null,
      collapsedGroups: []
    };
    found.block.content = '';
  }

  closeSlashMenu();
  saveNotesToStorage();
  renderEditor();

  // Focus back and place cursor at end
  setTimeout(() => {
    if (focusAfterBlockId) {
      const nextEl = document.querySelector(`.block-content[data-id="${focusAfterBlockId}"]`);
      if (nextEl) focusBlock(nextEl);
      return;
    }
    // データベース、画像、区切り線の場合は非表示DOMとなりフォーカスできないため、処理をスキップ（ブラウザフリーズ防止）
    if (newType === 'database' || newType === 'image' || newType === 'divider') {
      return;
    }
    const el = document.querySelector(`.block-content[data-id="${found.block.id}"]`);
    if (el) {
      focusBlock(el);
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 50);
}

function closeSlashMenu() {
  state.slashMenuOpen = false;
  slashMenu.style.display = 'none';
}



// 複数行テキストの貼り付け時に改行ごとにブロックを分割して1行ずつ展開する処理
// 構造化されたHTMLからNotidianのブロックデータをパースするヘルパー
function parseNotidianBlocksFromHtml(htmlText) {
  if (!htmlText) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const container = doc.querySelector('[data-notidian-blocks="true"]');
    if (!container) return null;

    const blockDivs = container.querySelectorAll('[data-block-type]');
    if (blockDivs.length === 0) return null;

    const blocks = [];
    blockDivs.forEach(div => {
      const type = div.getAttribute('data-block-type');
      const propertiesRaw = div.getAttribute('data-block-properties');
      let properties = undefined;
      if (propertiesRaw) {
        try {
          properties = JSON.parse(propertiesRaw);
        } catch (e) {
          console.error("Failed to parse block properties in paste:", e);
        }
      }
      const content = div.textContent;
      blocks.push({
        type: type,
        properties: properties,
        content: content
      });
    });

    return blocks;
  } catch (e) {
    console.error("Failed to parse HTML blocks from clipboard:", e);
    return null;
  }
}

function handleBlockPaste(e, activeBlock, contentDiv, directText = null, directOffset = null, directStructuredBlocks = null) {
  let structuredBlocks = directStructuredBlocks;
  let clipboardText = directText;

  if (e && !structuredBlocks) {
    const htmlText = e.clipboardData.getData('text/html');
    structuredBlocks = parseNotidianBlocksFromHtml(htmlText);
  }

  if (e && clipboardText === null) {
    clipboardText = e.clipboardData.getData('text/plain');
  }

  const isUrlPaste = clipboardText && /^https?:\/\/[^\s]+$/.test(clipboardText.trim());

  if (isUrlPaste) {
    const url = clipboardText.trim();
    const selection = window.getSelection();
    let selectedText = '';
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      selectedText = selection.toString().trim();
    }
    const label = selectedText || url;
    clipboardText = `[${label}](${url})`;
  }

  if (!structuredBlocks && !clipboardText) return;

  if (!structuredBlocks && directText === null && !isUrlPaste && !clipboardText.includes('\n') && !clipboardText.includes('\r')) {
    return;
  }

  if (e) e.preventDefault();
  pushHistory();

  const note = getActiveNote();
  if (!note) return;

  const found = findBlockAndParent(note.blocks, activeBlock.id);
  if (!found) return;

  state.isPasting = true;

  let prefix = '';
  let suffix = '';

  if (directOffset !== null) {
    const fullText = activeBlock.content;
    prefix = fullText.substring(0, directOffset);
    suffix = fullText.substring(directOffset);
  } else {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(contentDiv);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      const fragmentStart = preCaretRange.cloneContents();
      const tempDivStart = document.createElement('div');
      tempDivStart.appendChild(fragmentStart);
      prefix = serializeHtmlToWikiText(tempDivStart);

      const preCaretRangeEnd = range.cloneRange();
      preCaretRangeEnd.selectNodeContents(contentDiv);
      preCaretRangeEnd.setEnd(range.endContainer, range.endOffset);
      const fragmentEnd = preCaretRangeEnd.cloneContents();
      const tempDivEnd = document.createElement('div');
      tempDivEnd.appendChild(fragmentEnd);
      const endText = serializeHtmlToWikiText(tempDivEnd);

      const fullText = serializeHtmlToWikiText(contentDiv);
      suffix = fullText.substring(endText.length);
    } else {
      prefix = activeBlock.content;
      suffix = '';
    }
  }

  const newBlocks = [];
  let targetBlockId = activeBlock.id;
  let focusOffset = 0;

  if (structuredBlocks && structuredBlocks.length > 0) {
    activeBlock.content = prefix + structuredBlocks[0].content;

    for (let i = 1; i < structuredBlocks.length; i++) {
      const blockData = structuredBlocks[i];
      const newB = {
        id: generateId(),
        type: blockData.type,
        content: blockData.content,
        properties: blockData.properties ? JSON.parse(JSON.stringify(blockData.properties)) : undefined
      };
      newBlocks.push(newB);
    }

    if (newBlocks.length > 0) {
      newBlocks[newBlocks.length - 1].content += suffix;
      targetBlockId = newBlocks[newBlocks.length - 1].id;
      focusOffset = structuredBlocks[structuredBlocks.length - 1].content.length;
    } else {
      activeBlock.content += suffix;
      targetBlockId = activeBlock.id;
      focusOffset = prefix.length + structuredBlocks[0].content.length;
    }
  } else {
    const lines = clipboardText.split(/\r?\n/).filter(line => line !== null);
    if (lines.length === 0) {
      state.isPasting = false;
      return;
    }

    activeBlock.content = prefix + lines[0];

    for (let i = 1; i < lines.length; i++) {
      const newType = (activeBlock.type === 'h1' || activeBlock.type === 'h2' || activeBlock.type === 'database') ? 'p' : activeBlock.type;
      const blockContent = lines[i];

      const newB = { id: generateId(), type: newType, content: blockContent };
      if (newType === 'todo') newB.properties = { checked: false };
      if (newType === 'toggle') newB.properties = { open: true, children: [] };
      if (newType === 'callout') newB.properties = { emoji: '💡' };

      newBlocks.push(newB);
    }

    if (newBlocks.length > 0) {
      newBlocks[newBlocks.length - 1].content += suffix;
      targetBlockId = newBlocks[newBlocks.length - 1].id;
      focusOffset = lines[lines.length - 1].length;
    } else {
      activeBlock.content += suffix;
      targetBlockId = activeBlock.id;
      focusOffset = prefix.length + lines[0].length;
    }
  }

  found.parentArray.splice(found.index + 1, 0, ...newBlocks);

  saveNotesToStorage();
  renderEditor();

  setTimeout(() => {
    // 他のブロックに既にフォーカスが移動している場合は、強制カーソル移動をキャンセルする
    if (state.activeFocusedBlockId && state.activeFocusedBlockId !== activeBlock.id && state.activeFocusedBlockId !== targetBlockId) {
      state.isPasting = false;
      return;
    }
    const el = document.querySelector(`.block-content[data-id="${targetBlockId}"]`);
    if (el) {
      focusBlock(el);
      try {
        const range = document.createRange();
        const sel = window.getSelection();
        const startPos = findDOMPositionByWikiOffset(el, focusOffset);
        if (startPos) {
          range.setStart(startPos.node, startPos.offset);
        } else {
          range.selectNodeContents(el);
          range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {
        console.error("Failed to set cursor after paste:", e);
      }
    }
    state.isPasting = false;
  }, 50);
}

export function setupBlockCopyPasteShortcuts() {
  window.addEventListener('keydown', (e) => {
    const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
    const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
    const isDelete = e.key === 'Backspace' || e.key === 'Delete';

    if (window.tableSelection && window.tableSelection.selectedRows && window.tableSelection.selectedRows.length > 0) {
      if (isDelete) {
        const active = document.activeElement;
        const isEditable = active && (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable ||
          active.getAttribute('contenteditable') === 'true' ||
          active.closest('[contenteditable="true"]')
        );
        if (!isEditable) {
          e.preventDefault();
          const blockId = window.tableSelection.blockId;
          const activeNote = getActiveNote();
          if (activeNote && blockId) {
            const found = findBlockAndParent(activeNote.blocks, blockId);
            if (found && found.block && found.block.type === 'database') {
              pushHistory();
              const block = found.block;
              block.properties.rows = block.properties.rows.filter(r => !window.tableSelection.selectedRows.includes(r));
              saveNotesToStorage();
              if (typeof window.clearTableSelection === 'function') window.clearTableSelection();
              renderEditor();
              showToast(`選択した行を削除しました`);
            }
          }
          return;
        }
      }
    }

    if (state.selectedBlockIds && state.selectedBlockIds.length > 0) {
      const activeNote = getActiveNote();
      if (!activeNote) return;

      if (isCopy) {
        e.preventDefault();
        const blocksToCopy = [];

        const findBlocks = (blocksList) => {
          blocksList.forEach(b => {
            if (state.selectedBlockIds.includes(b.id)) {
              blocksToCopy.push(JSON.stringify(b));
            }
            if (b.properties && b.properties.children) {
              findBlocks(b.properties.children);
            }
          });
        };
        findBlocks(activeNote.blocks);

        state.copiedBlocksData = blocksToCopy;
        showToast(`${blocksToCopy.length}件のブロックをコピーしました`);
      }

      if (isPaste && state.copiedBlocksData && state.copiedBlocksData.length > 0) {
        e.preventDefault();
        pushHistory();

        const cloneAndReassignIds = (blockObj) => {
          const cloned = JSON.parse(JSON.stringify(blockObj));
          cloned.id = generateId();
          if (cloned.properties && cloned.properties.children) {
            cloned.properties.children = cloned.properties.children.map(child => cloneAndReassignIds(child));
          }
          return cloned;
        };

        const pastedBlocks = state.copiedBlocksData.map(jsonStr => {
          const originalBlock = JSON.parse(jsonStr);
          return cloneAndReassignIds(originalBlock);
        });

        let lastSelectedIndex = -1;
        state.selectedBlockIds.forEach(id => {
          const idx = activeNote.blocks.findIndex(b => b.id === id);
          if (idx > lastSelectedIndex) lastSelectedIndex = idx;
        });

        if (lastSelectedIndex !== -1) {
          activeNote.blocks.splice(lastSelectedIndex + 1, 0, ...pastedBlocks);
        } else {
          activeNote.blocks.push(...pastedBlocks);
        }

        saveNotesToStorage();
        clearBlockSelection();
        renderEditor();
        showToast(`${pastedBlocks.length}件のブロックを貼り付けました`);
      }

      if (isDelete) {
        const active = document.activeElement;
        const isEditable = active && (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable ||
          active.getAttribute('contenteditable') === 'true' ||
          active.closest('[contenteditable="true"]')
        );
        if (!isEditable) {
          e.preventDefault();
          pushHistory();
          activeNote.blocks = removeBlocksRecursively(activeNote.blocks, state.selectedBlockIds);
          saveNotesToStorage();
          clearBlockSelection();
          renderEditor();
          showToast('選択したブロックを削除しました');
        }
      }
    }
  });
}

function showToast(msg) {
  const existing = document.getElementById('notidian-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'notidian-toast';
  toast.style = 'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: rgba(13, 17, 28, 0.9); color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; border: 1px solid var(--accent-primary); box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 10000; animation: toastFade 2s forwards;';
  toast.textContent = msg;

  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes toastFade {
      0% { opacity: 0; bottom: 70px; }
      15% { opacity: 1; bottom: 80px; }
      85% { opacity: 1; }
      100% { opacity: 0; bottom: 85px; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// 【統合データ完全性エンジン】実在しないノートへの古いWikiリンクを自動解除（プレーンテキスト化）し、空のタグをクリーンアップ
function cleanDeadWikiLinksAndTags() {
  // 1. 親フォルダが存在しないゾンビノートをデータベースから完全に物理抹消！
  state.notes = state.notes.filter(note =>
    !note.folderId || state.folders.some(f => f.id === note.folderId)
  );

  const activeNotes = getActiveNormalNotes();

  // (実在しないノートへのWikiリンクは、ピンク色の破線リンクから新規ノート自動作成に移行するために維持すべきなので、
  // ここでの自動アンリンク置換処理は削除します)

  activeNotes.forEach(note => {
    // ノートに付いているタグ配列から、空のタグや無効なタグを自動除外
    if (note.tags && Array.isArray(note.tags)) {
      note.tags = note.tags.filter(t => t && String(t).trim() !== '');
    }
  });

  // サイドバーの既存タグ候補（datalist）を最新の綺麗な状態に完全再構築
  updateExistingTagsDatalist();
}

function updateExistingTagsDatalist() {
  const datalist = document.getElementById('existing-tags-datalist');
  if (!datalist) return;

  datalist.innerHTML = '';
  const allTags = new Set();
  getActiveNormalNotes().forEach(note => {
    if (note.tags && Array.isArray(note.tags)) {
      note.tags.forEach(t => {
        const trimmed = t.trim();
        if (trimmed) allTags.add(trimmed);
      });
    }
  });

  Array.from(allTags).sort().forEach(tag => {
    const option = document.createElement('option');
    option.value = tag;
    datalist.appendChild(option);
  });
}

function getNoteTagStyles(tag) {
  const colors = [
    { bg: 'rgba(239, 68, 68, 0.12)', fg: '#fca5a5', border: 'rgba(239, 68, 68, 0.25)' },   // red
    { bg: 'rgba(59, 130, 246, 0.12)', fg: '#93c5fd', border: 'rgba(59, 130, 246, 0.25)' },  // blue
    { bg: 'rgba(16, 185, 129, 0.12)', fg: '#a7f3d0', border: 'rgba(16, 185, 129, 0.25)' },  // green
    { bg: 'rgba(245, 158, 11, 0.12)', fg: '#fde68a', border: 'rgba(245, 158, 11, 0.25)' },   // yellow
    { bg: 'rgba(139, 92, 246, 0.12)', fg: '#ddd6fe', border: 'rgba(139, 92, 246, 0.25)' },  // purple
    { bg: 'rgba(236, 72, 153, 0.12)', fg: '#fbcfe8', border: 'rgba(236, 72, 153, 0.25)' },  // pink
    { bg: 'rgba(148, 163, 184, 0.12)', fg: '#cbd5e1', border: 'rgba(148, 163, 184, 0.25)' }   // gray
  ];
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function renderNoteTags() {
  const tagsPanel = document.getElementById('note-tags-panel');
  if (!tagsPanel) return;

  // タグ補完用の datalist を最新化
  updateExistingTagsDatalist();

  tagsPanel.innerHTML = '';
  const note = getActiveNote();
  if (!note) return;

  // マイグレーション：tagsプロパティがない場合は初期化
  if (!note.tags) {
    note.tags = [];
  }

  // 1. 既存のタグを描画
  note.tags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'note-tag-chip';
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '6px';
    chip.style.padding = '4px 10px';
    chip.style.borderRadius = '14px';
    const tagStyles = getNoteTagStyles(tag);
    chip.style.background = tagStyles.bg;
    chip.style.border = `1px solid ${tagStyles.border}`;
    chip.style.color = tagStyles.fg;
    chip.style.fontSize = '12px';
    chip.style.fontWeight = '500';

    const textSpan = document.createElement('span');
    textSpan.textContent = `#${tag}`;
    chip.appendChild(textSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-tag';
    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    deleteBtn.style.background = 'none';
    deleteBtn.style.border = 'none';
    deleteBtn.style.color = 'var(--text-muted)';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.padding = '0 2px';
    deleteBtn.style.fontSize = '10px';
    deleteBtn.style.display = 'flex';
    deleteBtn.style.alignItems = 'center';
    deleteBtn.style.justifyContent = 'center';
    deleteBtn.style.transition = 'color 0.2s';

    deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.color = '#ef4444');
    deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.color = 'var(--text-muted)');

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      note.tags.splice(idx, 1);
      saveNotesToStorage();
      renderNoteTags();
      renderNoteList(); // サイドバーの更新
    });

    chip.appendChild(deleteBtn);
    tagsPanel.appendChild(chip);
  });

  // 2. 「＋ タグを追加」ボタンまたは入力フォーム
  const addWrapper = document.createElement('div');
  addWrapper.style.display = 'inline-flex';
  addWrapper.style.alignItems = 'center';

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = '+ タグを追加';
  addInput.setAttribute('list', 'existing-tags-datalist');
  addInput.style.border = '1px dashed var(--border-color, #374151)';
  addInput.style.background = 'transparent';
  addInput.style.borderRadius = '14px';
  addInput.style.padding = '3px 10px';
  addInput.style.fontSize = '12px';
  addInput.style.color = 'var(--text-secondary)';
  addInput.style.outline = 'none';
  addInput.style.width = '85px';
  addInput.style.transition = 'all 0.2s';
  addInput.style.boxSizing = 'border-box';

  addInput.addEventListener('focus', () => {
    addInput.style.width = '120px';
    addInput.style.borderStyle = 'solid';
    addInput.style.borderColor = 'var(--accent-secondary, #ec4899)';
  });

  addInput.addEventListener('blur', () => {
    addInput.style.width = '85px';
    addInput.style.borderStyle = 'dashed';
    addInput.style.borderColor = 'var(--border-color)';

    // 入力値があれば追加
    const val = addInput.value.trim().replace(/^#/, ''); // 先頭の#は除去
    if (val && !note.tags.includes(val)) {
      note.tags.push(val);
      saveNotesToStorage();
      renderNoteTags();
      renderNoteList(); // サイドバーの更新
    }
    addInput.value = '';
  });

  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addInput.blur(); // blurイベントを発火させて処理
    }
  });

  addWrapper.appendChild(addInput);
  tagsPanel.appendChild(addWrapper);
}

function renderSidebarTags() {
  const tagsListContainer = document.getElementById('sidebar-tags-list');
  if (!tagsListContainer) return;

  tagsListContainer.innerHTML = '';

  // 全ノートから重複なしでタグを抽出
  const allTagsMap = {};
  getActiveNormalNotes().forEach(note => {
    if (note.tags && Array.isArray(note.tags)) {
      note.tags.forEach(tag => {
        const trimmed = tag.trim();
        if (trimmed) {
          allTagsMap[trimmed] = (allTagsMap[trimmed] || 0) + 1;
        }
      });
    }
  });

  const uniqueTags = Object.keys(allTagsMap).sort();

  if (uniqueTags.length === 0) {
    tagsListContainer.innerHTML = '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">タグなし</span>';
    return;
  }

  uniqueTags.forEach(tag => {
    const tagEl = document.createElement('span');
    tagEl.className = 'sidebar-tag-chip';

    // プレミアムなタグチップスタイル
    const tagStyles = getNoteTagStyles(tag);
    tagEl.style.fontSize = '11px';
    tagEl.style.padding = '3px 8px';
    tagEl.style.borderRadius = '12px';
    tagEl.style.background = tagStyles.bg;
    tagEl.style.border = `1px solid ${tagStyles.border}`;
    tagEl.style.color = tagStyles.fg;
    tagEl.style.cursor = 'pointer';
    tagEl.style.transition = 'all 0.2s';
    tagEl.style.display = 'inline-flex';
    tagEl.style.alignItems = 'center';
    tagEl.style.gap = '6px';

    const textSpan = document.createElement('span');
    textSpan.textContent = `#${tag} (${allTagsMap[tag]})`;
    tagEl.appendChild(textSpan);

    // 削除ボタンの生成
    const delBtn = document.createElement('span');
    delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.style.fontSize = '9px';
    delBtn.style.opacity = '0.5';
    delBtn.style.cursor = 'pointer';
    delBtn.style.transition = 'opacity 0.2s, color 0.2s';
    delBtn.style.display = 'flex';
    delBtn.style.alignItems = 'center';
    delBtn.style.justifyContent = 'center';
    delBtn.title = `タグ「${tag}」をすべてのノートから削除`;

    delBtn.addEventListener('mouseenter', () => {
      delBtn.style.opacity = '1';
      delBtn.style.color = '#ef4444';
    });
    delBtn.addEventListener('mouseleave', () => {
      delBtn.style.opacity = '0.5';
      delBtn.style.color = 'inherit';
    });

    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (confirm(`タグ「${tag}」をすべてのノートから完全に削除してもよろしいですか？`)) {
        // すべてのノートの tags 配列から一括削除
        state.notes.forEach(note => {
          if (note.tags && Array.isArray(note.tags)) {
            note.tags = note.tags.filter(t => t.trim() !== tag);
          }
        });

        saveNotesToStorage();
        renderNoteList();
        renderEditor();
      }
    });

    tagEl.appendChild(delBtn);

    // チップ全体のクリックで検索
    textSpan.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // イベントのバブリング（伝播）を完全に遮断

      if (searchInput) {
        searchInput.value = '#' + tag;
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) clearBtn.style.display = 'block';

        // 非同期（setTimeout）で実行することで、クリックイベントの処理が完全に終了した後に安全に再描画させる
        setTimeout(() => {
          searchInput.dispatchEvent(new Event('input'));
        }, 0);
      }
    });

    tagEl.addEventListener('mouseenter', () => {
      tagEl.style.borderColor = 'var(--accent-secondary, #ec4899)';
    });

    tagEl.addEventListener('mouseleave', () => {
      tagEl.style.borderColor = 'var(--border-color, #374151)';
    });

    tagsListContainer.appendChild(tagEl);
  });
}

function applySlashMenuOrder() {
  const orderStr = localStorage.getItem('notidian_slash_menu_order');
  if (!orderStr) return;

  try {
    const order = JSON.parse(orderStr);
    const list = document.querySelector('#slash-menu .slash-menu-list');
    if (!list) return;

    const items = Array.from(list.querySelectorAll('li'));
    items.sort((a, b) => {
      const typeA = a.getAttribute('data-type');
      const typeB = b.getAttribute('data-type');
      return order.indexOf(typeA) - order.indexOf(typeB);
    });

    list.innerHTML = '';
    items.forEach(item => list.appendChild(item));
  } catch (e) {
    console.error("Failed to apply slash menu order:", e);
  }
}

export function initSlashMenuSortable() {
  const list = document.querySelector('#slash-menu .slash-menu-list');
  if (!list) return;

  // 保存されている順序を適用
  applySlashMenuOrder();

  // SortableJSの適用 (Sortable.create に統一し、ドラッグ時のフォーカス干渉を防ぐガード処理を追加)
  Sortable.create(list, {
    animation: 0, // アニメーション中のDOM競合やトランジションバグを防ぐため0にする
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    onStart: function () {
      // ドラッグ開始時に、エディタの選択範囲を一時クリアして contenteditable との干渉によるフリーズを防止
      window.getSelection().removeAllRanges();
    },
    onEnd: function () {
      try {
        const items = Array.from(list.querySelectorAll('li'));
        const order = items.map(li => li.getAttribute('data-type'));
        localStorage.setItem('notidian_slash_menu_order', JSON.stringify(order));

        // 並べ替え後にアクティブインデックスがズレるのを修正
        const activeIdx = items.findIndex(li => li.classList.contains('active'));
        if (activeIdx !== -1) {
          state.slashMenuActiveIndex = activeIdx;
        }

        // SortableJS の内部クリーンアップ完了後に安全に同期するため、遅延実行する
        setTimeout(() => {
          try {
            // ドロップ完了後の十分な遅延の後に選択範囲をクリアしてブラウザのイベント無限ループを防止
            window.getSelection().removeAllRanges();
            renderSlashMenuList(false); // ドラッグ終了後のため、スクロールは行わない
          } catch (err) {
            console.error("Error in post-drag slash menu render:", err);
          }
        }, 100); // 遅延を十分に（100ms）確保してSortableJSのクリーンアップ完了を待つ
      } catch (e) {
        console.error("Error in slash menu drag end:", e);
      }
    }
  });
}

// ==========================================
// 19. CARET POSITION & DOM HELPERS
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

function getCharacterOffsetWithin(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

function getWikiOffsetWithin(element, targetNode, targetOffset) {
  if (element === targetNode) {
    let childLen = 0;
    for (let i = 0; i < targetOffset; i++) {
      const child = element.childNodes[i];
      if (child) {
        if (child.nodeType === Node.TEXT_NODE) {
          childLen += child.length;
        } else if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains('wiki-link')) {
          const target = child.getAttribute('data-target') || child.textContent;
          childLen += 4 + target.length;
        } else {
          childLen += child.textContent.length;
        }
      }
    }
    return childLen;
  }
  
  let currentWikiLength = 0;
  let found = false;

  function traverse(node) {
    if (found) return;

    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        currentWikiLength += targetOffset;
      } else {
        let childLen = 0;
        for (let i = 0; i < targetOffset; i++) {
          const child = node.childNodes[i];
          if (child) {
            if (child.nodeType === Node.TEXT_NODE) {
              childLen += child.length;
            } else if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains('wiki-link')) {
              const target = child.getAttribute('data-target') || child.textContent;
              childLen += 4 + target.length;
            } else {
              childLen += child.textContent.length;
            }
          }
        }
        currentWikiLength += childLen;
      }
      found = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      currentWikiLength += node.length;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('wiki-link')) {
      if (node.contains(targetNode)) {
        currentWikiLength += 2; // 「「 または [[ の2文字分
        for (let i = 0; i < node.childNodes.length; i++) {
          traverse(node.childNodes[i]);
          if (found) return;
        }
      } else {
        const target = node.getAttribute('data-target') || node.textContent;
        currentWikiLength += 4 + target.length; // 「「 と 」」
      }
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        traverse(node.childNodes[i]);
        if (found) return;
      }
    }
  }

  traverse(element);
  return found ? currentWikiLength : null;
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

export function setupMultipleBlockSelectionShortcuts() {
  function getAllBlocksFlat(blocks) {
    let flat = [];
    blocks.forEach(b => {
      flat.push(b);
      if (b.children && b.children.length > 0) {
        flat.push(...getAllBlocksFlat(b.children));
      }
    });
    return flat;
  }

  function removeBlockFromBlocks(blocks, id) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) {
        blocks.splice(i, 1);
        return true;
      }
      if (blocks[i].children && blocks[i].children.length > 0) {
        if (removeBlockFromBlocks(blocks[i].children, id)) {
          return true;
        }
      }
    }
    return false;
  }

  function getWikiTextBefore(element, node, offset, fallbackText = null) {
    const fullText = serializeHtmlToWikiText(element);
    const wikiOffset = getWikiOffsetWithin(element, node, offset);
    if (wikiOffset === null || wikiOffset === undefined) {
      return fallbackText !== null ? fallbackText : fullText;
    }
    return fullText.substring(0, wikiOffset);
  }

  function getWikiTextAfter(element, node, offset, fallbackText = '') {
    const fullText = serializeHtmlToWikiText(element);
    const wikiOffset = getWikiOffsetWithin(element, node, offset);
    if (wikiOffset === null || wikiOffset === undefined) {
      return fallbackText;
    }
    return fullText.substring(wikiOffset);
  }

  function getBlockContentFromContainer(container, offset, isStart) {
    if (!container) return null;
    if (container.nodeType === Node.TEXT_NODE) {
      return container.parentNode.closest('.block-content');
    }
    if (container.nodeType === Node.ELEMENT_NODE) {
      const el = container.closest('.block-content');
      if (el) return el;
    }
    if (container.childNodes && container.childNodes.length > 0) {
      let targetNode = null;
      if (isStart) {
        const idx = Math.min(offset, container.childNodes.length - 1);
        targetNode = container.childNodes[idx];
      } else {
        const idx = Math.max(0, Math.min(offset - 1, container.childNodes.length - 1));
        targetNode = container.childNodes[idx];
      }
      if (targetNode && targetNode.nodeType === Node.ELEMENT_NODE) {
        const el = targetNode.classList.contains('block-content') ? targetNode : targetNode.querySelector('.block-content');
        if (el) return el;
        const wrapperEl = targetNode.closest('.block-wrapper') || targetNode;
        const subEl = wrapperEl.querySelector('.block-content');
        if (subEl) return subEl;
      }
    }
    return null;
  }

  function getMultipleBlockSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const canvas = document.getElementById('block-canvas');
    if (!canvas || !canvas.contains(range.commonAncestorContainer)) return null;

    let startEl = getBlockContentFromContainer(range.startContainer, range.startOffset, true);
    let endEl = getBlockContentFromContainer(range.endContainer, range.endOffset, false);

    if (!startEl) {
      startEl = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentNode.closest('.block-content') : range.startContainer.closest('.block-content');
    }
    if (!endEl) {
      endEl = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentNode.closest('.block-content') : range.endContainer.closest('.block-content');
    }

    if (!startEl || !endEl) return null;

    if (startEl !== endEl) {
      return { range, startEl, endEl, selection: sel };
    }
    return null;
  }

  function deleteMultipleBlockSelection(selInfo) {
    const { range, startEl, endEl } = selInfo;
    const startId = startEl.getAttribute('data-id');
    const endId = endEl.getAttribute('data-id');

    const note = getActiveNote();
    if (!note) return null;

    const flatBlocks = getAllBlocksFlat(note.blocks);
    const startIdx = flatBlocks.findIndex(b => b.id === startId);
    const endIdx = flatBlocks.findIndex(b => b.id === endId);

    if (startIdx === -1 || endIdx === -1) return null;

    let firstEl = startEl;
    let lastEl = endEl;
    let firstIdx = startIdx;
    let lastIdx = endIdx;
    let firstRangeContainer = range.startContainer;
    let firstRangeOffset = range.startOffset;
    let lastRangeContainer = range.endContainer;
    let lastRangeOffset = range.endOffset;

    if (startIdx > endIdx) {
      firstEl = endEl;
      lastEl = startEl;
      firstIdx = endIdx;
      lastIdx = startIdx;
      firstRangeContainer = range.endContainer;
      firstRangeOffset = range.endOffset;
      lastRangeContainer = range.startContainer;
      lastRangeOffset = range.startOffset;
    }

    const firstBlock = flatBlocks[firstIdx];
    const lastBlock = flatBlocks[lastIdx];

    const firstText = getWikiTextBefore(firstEl, firstRangeContainer, firstRangeOffset, '');
    const lastText = getWikiTextAfter(lastEl, lastRangeContainer, lastRangeOffset, '');

    pushHistory();
    firstBlock.content = firstText + lastText;

    const idsToRemove = [];
    for (let i = firstIdx + 1; i <= lastIdx; i++) {
      idsToRemove.push(flatBlocks[i].id);
    }

    idsToRemove.forEach(id => {
      removeBlockFromBlocks(note.blocks, id);
    });

    cleanupEmptyBlocks(note.blocks);

    saveNotesToStorage();
    renderEditor();

    return {
      targetBlockId: firstBlock.id,
      mergeOffset: firstText.length
    };
  }

  function getMultipleBlockSelectionWikiText(selInfo) {
    const { range, startEl, endEl } = selInfo;
    const startId = startEl.getAttribute('data-id');
    const endId = endEl.getAttribute('data-id');

    const note = getActiveNote();
    if (!note) return '';

    const flatBlocks = getAllBlocksFlat(note.blocks);
    const startIdx = flatBlocks.findIndex(b => b.id === startId);
    const endIdx = flatBlocks.findIndex(b => b.id === endId);

    if (startIdx === -1 || endIdx === -1) return '';

    let firstEl = startEl;
    let lastEl = endEl;
    let firstIdx = startIdx;
    let lastIdx = endIdx;
    let firstRangeContainer = range.startContainer;
    let firstRangeOffset = range.startOffset;
    let lastRangeContainer = range.endContainer;
    let lastRangeOffset = range.endOffset;

    if (startIdx > endIdx) {
      firstEl = endEl;
      lastEl = startEl;
      firstIdx = endIdx;
      lastIdx = startIdx;
      firstRangeContainer = range.endContainer;
      firstRangeOffset = range.endOffset;
      lastRangeContainer = range.startContainer;
      lastRangeOffset = range.startOffset;
    }

    const copiedLines = [];
    for (let i = firstIdx; i <= lastIdx; i++) {
      const block = flatBlocks[i];
      const blockEl = document.querySelector(`.block-content[data-id="${block.id}"]`);
      if (!blockEl) continue;

      if (i === firstIdx) {
        const firstText = getWikiTextAfter(firstEl, firstRangeContainer, firstRangeOffset, serializeHtmlToWikiText(firstEl));
        copiedLines.push(firstText);
      } else if (i === lastIdx) {
        const lastText = getWikiTextBefore(lastEl, lastRangeContainer, lastRangeOffset, serializeHtmlToWikiText(lastEl));
        copiedLines.push(lastText);
      } else {
        copiedLines.push(serializeHtmlToWikiText(blockEl));
      }
    }

    return copiedLines.join('\n');
  }

  function getMultipleBlockSelectionData(selInfo) {
    const { range, startEl, endEl } = selInfo;
    const startId = startEl.getAttribute('data-id');
    const endId = endEl.getAttribute('data-id');

    const note = getActiveNote();
    if (!note) return null;

    const flatBlocks = getAllBlocksFlat(note.blocks);
    const startIdx = flatBlocks.findIndex(b => b.id === startId);
    const endIdx = flatBlocks.findIndex(b => b.id === endId);

    if (startIdx === -1 || endIdx === -1) return null;

    let firstEl = startEl;
    let lastEl = endEl;
    let firstIdx = startIdx;
    let lastIdx = endIdx;
    let firstRangeContainer = range.startContainer;
    let firstRangeOffset = range.startOffset;
    let lastRangeContainer = range.endContainer;
    let lastRangeOffset = range.endOffset;

    if (startIdx > endIdx) {
      firstEl = endEl;
      lastEl = startEl;
      firstIdx = endIdx;
      lastIdx = startIdx;
      firstRangeContainer = range.endContainer;
      firstRangeOffset = range.endOffset;
      lastRangeContainer = range.startContainer;
      lastRangeOffset = range.startOffset;
    }

    const copiedBlocks = [];
    for (let i = firstIdx; i <= lastIdx; i++) {
      const block = flatBlocks[i];
      const blockEl = document.querySelector(`.block-content[data-id="${block.id}"]`);
      if (!blockEl) continue;

      let content = '';
      if (i === firstIdx) {
        content = getWikiTextAfter(firstEl, firstRangeContainer, firstRangeOffset, serializeHtmlToWikiText(firstEl));
      } else if (i === lastIdx) {
        content = getWikiTextBefore(lastEl, lastRangeContainer, lastRangeOffset, serializeHtmlToWikiText(lastEl));
      } else {
        content = serializeHtmlToWikiText(blockEl);
      }

      copiedBlocks.push({
        type: block.type,
        properties: block.properties ? JSON.parse(JSON.stringify(block.properties)) : undefined,
        content: content
      });
    }

    return copiedBlocks;
  }

  function setCaretByWikiOffset(el, wikiOffset) {
    try {
      const range = document.createRange();
      const sel = window.getSelection();
      const startPos = findDOMPositionByWikiOffset(el, wikiOffset);
      if (startPos) {
        range.setStart(startPos.node, startPos.offset);
      } else {
        range.selectNodeContents(el);
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {
      console.error("Failed to set caret by wiki offset:", err);
      setCaretPosition(el, wikiOffset);
    }
  }

  window.addEventListener('keydown', (e) => {
    const selInfo = getMultipleBlockSelectionRange();
    if (!selInfo) return;

    const key = e.key;

    // IME入力（変換開始）時の競合を回避し、先に選択範囲を消去してフォーカスを渡す
    if (key === 'Process' || e.isComposing) {
      e.preventDefault();
      const res = deleteMultipleBlockSelection(selInfo);
      if (res) {
        setTimeout(() => {
          const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
          if (el) {
            focusBlock(el);
            setCaretByWikiOffset(el, res.mergeOffset);
          }
        }, 50);
      }
      return;
    }

    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      try {
        const res = deleteMultipleBlockSelection(selInfo);
        if (res) {
          setTimeout(() => {
            const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
            if (el) {
              focusBlock(el);
              setCaretByWikiOffset(el, res.mergeOffset);
            }
          }, 50);
        }
      } catch (err) {
        console.error("Failed to delete multiple block selection, running fallback:", err);
        try {
          selInfo.range.deleteContents();
        } catch (e2) {
          console.error("Fallback deleteContents failed:", e2);
        }
      }
      return;
    }

    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const res = deleteMultipleBlockSelection(selInfo);
      if (res) {
        const note = getActiveNote();
        const found = findBlockAndParent(note.blocks, res.targetBlockId);
        if (found) {
          const content = found.block.content;
          found.block.content = content.substring(0, res.mergeOffset) + key + content.substring(res.mergeOffset);
          saveNotesToStorage();
          renderEditor();

          setTimeout(() => {
            const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
            if (el) {
              focusBlock(el);
              setCaretByWikiOffset(el, res.mergeOffset + 1);
            }
          }, 50);
        }
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'c') {
      e.preventDefault();
      const copiedBlocks = getMultipleBlockSelectionData(selInfo);
      if (copiedBlocks) {
        const plainText = copiedBlocks.map(b => b.content).join('\n');
        const htmlText = `<div data-notidian-blocks="true">` + 
          copiedBlocks.map(b => {
            const props = b.properties ? JSON.stringify(b.properties) : '';
            return `<div data-block-type="${escapeHTML(b.type)}" data-block-properties="${escapeHTML(props)}">${escapeHTML(b.content)}</div>`;
          }).join('') + `</div>`;

        const blobText = new Blob([plainText], { type: 'text/plain' });
        const blobHtml = new Blob([htmlText], { type: 'text/html' });

        navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': blobText,
            'text/html': blobHtml
          })
        ]).then(() => {
          showToast(`${copiedBlocks.length}件のブロックをコピーしました`);
        }).catch(err => {
          console.error("Failed to copy structured multiple block selection: ", err);
          navigator.clipboard.writeText(plainText).then(() => {
            showToast(`${copiedBlocks.length}件のブロックをコピーしました（テキストのみ）`);
          }).catch(e => console.error(e));
        });
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'x') {
      e.preventDefault();
      const copiedBlocks = getMultipleBlockSelectionData(selInfo);
      if (copiedBlocks) {
        const plainText = copiedBlocks.map(b => b.content).join('\n');
        const htmlText = `<div data-notidian-blocks="true">` + 
          copiedBlocks.map(b => {
            const props = b.properties ? JSON.stringify(b.properties) : '';
            return `<div data-block-type="${escapeHTML(b.type)}" data-block-properties="${escapeHTML(props)}">${escapeHTML(b.content)}</div>`;
          }).join('') + `</div>`;

        const blobText = new Blob([plainText], { type: 'text/plain' });
        const blobHtml = new Blob([htmlText], { type: 'text/html' });

        navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': blobText,
            'text/html': blobHtml
          })
        ]).then(() => {
          showToast(`${copiedBlocks.length}件のブロックを切り取りました`);
          const res = deleteMultipleBlockSelection(selInfo);
          if (res) {
            setTimeout(() => {
              const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
              if (el) {
                focusBlock(el);
                setCaretByWikiOffset(el, res.mergeOffset);
              }
            }, 50);
          }
        }).catch(err => {
          console.error("Failed to copy cut text: ", err);
          navigator.clipboard.writeText(plainText).then(() => {
            showToast(`${copiedBlocks.length}件のブロックを切り取りました（テキストのみ）`);
            const res = deleteMultipleBlockSelection(selInfo);
            if (res) {
              setTimeout(() => {
                const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
                if (el) {
                  focusBlock(el);
                  setCaretByWikiOffset(el, res.mergeOffset);
                }
              }, 50);
            }
          }).catch(e => console.error(e));
        });
      }
      return;
    }
  }, true);

  window.addEventListener('paste', (e) => {
    const selInfo = getMultipleBlockSelectionRange();
    if (!selInfo) return;

    e.preventDefault();
    const clipboardText = e.clipboardData.getData('text/plain');
    const htmlText = e.clipboardData.getData('text/html');
    const structuredBlocks = parseNotidianBlocksFromHtml(htmlText);

    if (!structuredBlocks && !clipboardText) return;

    const res = deleteMultipleBlockSelection(selInfo);
    if (!res) return;

    setTimeout(() => {
      const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
      if (!el) return;

      focusBlock(el);
      setCaretByWikiOffset(el, res.mergeOffset);

      if (structuredBlocks || clipboardText.includes('\n') || clipboardText.includes('\r')) {
        const note = getActiveNote();
        const found = findBlockAndParent(note.blocks, res.targetBlockId);
        if (found) {
          handleBlockPaste(null, found.block, el, clipboardText, res.mergeOffset, structuredBlocks);
        }
      } else {
        const note = getActiveNote();
        const found = findBlockAndParent(note.blocks, res.targetBlockId);
        if (found) {
          const content = found.block.content;
          found.block.content = content.substring(0, res.mergeOffset) + clipboardText + content.substring(res.mergeOffset);
          saveNotesToStorage();
          renderEditor();

          setTimeout(() => {
            const newEl = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
            if (newEl) {
              focusBlock(newEl);
              setCaretByWikiOffset(newEl, res.mergeOffset + clipboardText.length);
            }
          }, 50);
        }
      }
    }, 50);
  }, true);
}

// Automatically setup selection shortcuts
if (typeof window !== 'undefined') {
  setupMultipleBlockSelectionShortcuts();
}

window.setupBlockCopyPasteShortcuts = setupBlockCopyPasteShortcuts;

// 外部リンクの編集用ポップオーバー
export function showLinkEditPopover(extLinkEl) {
  const existing = document.getElementById('notidian-link-edit-popover');
  if (existing) existing.remove();

  const rect = extLinkEl.getBoundingClientRect();
  const label = extLinkEl.textContent || '';
  const url = extLinkEl.getAttribute('href') || '';
  
  const popover = document.createElement('div');
  popover.id = 'notidian-link-edit-popover';
  popover.className = 'link-edit-popover';
  popover.style.position = 'fixed';
  popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 310, rect.left))}px`;
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;

  popover.innerHTML = `
    <div class="link-popover-row">
      <span class="link-popover-label">テキスト</span>
      <input type="text" class="link-popover-input link-label-input" value="${escapeHTML(label)}" placeholder="表示名">
    </div>
    <div class="link-popover-row">
      <span class="link-popover-label">リンク先</span>
      <input type="text" class="link-popover-input link-url-input" value="${escapeHTML(url)}" placeholder="https://...">
    </div>
    <div class="link-popover-actions">
      <button class="link-popover-btn btn-apply-link">適用</button>
      <button class="link-popover-btn btn-open-link" title="新しいタブで開く"><i class="fa-solid fa-up-right-from-square"></i> 開く</button>
    </div>
  `;

  popover.addEventListener('mousedown', (e) => e.stopPropagation());
  popover.addEventListener('click', (e) => e.stopPropagation());

  const labelInput = popover.querySelector('.link-label-input');
  const urlInput = popover.querySelector('.link-url-input');
  const applyBtn = popover.querySelector('.btn-apply-link');
  const openBtn = popover.querySelector('.btn-open-link');

  const updateAndSave = (newLabel, newUrl) => {
    const contentDiv = extLinkEl.closest('.block-content');
    if (!contentDiv) return;

    const blockId = contentDiv.getAttribute('data-id');
    const note = getActiveNote();
    if (!note) return;

    const found = findBlockAndParent(note.blocks, blockId);
    if (!found) return;

    // 1. DOM要素の直接更新
    extLinkEl.textContent = newLabel;
    extLinkEl.setAttribute('href', newUrl);
    extLinkEl.setAttribute('title', newUrl);

    // 2. メモリ上へ保存
    pushHistory();
    const textVal = serializeHtmlToWikiText(contentDiv);
    const oldContent = found.block.content;
    found.block.content = textVal;
    
    // 3. ポップオーバーを先に消去してblur抑制を解除
    popover.remove();
    document.removeEventListener('mousedown', closePopoverOnOutsideClick);

    // 4. フォーカスを解除し、手動で正式な blur を実行して再描画
    state.activeFocusedBlockId = null;
    contentDiv.removeAttribute('contenteditable');
    contentDiv.innerHTML = parseWikiLinks(escapeHTML(found.block.content));

    if (oldContent !== textVal) {
      saveNotesToStorage();
      updateBacklinks();
    }
  };

  const handleApply = () => {
    const newLabel = labelInput.value.trim() || 'リンク';
    let newUrl = urlInput.value.trim();
    if (!newUrl) return;

    if (!/^https?:\/\//i.test(newUrl)) {
      newUrl = 'https://' + newUrl;
    }

    updateAndSave(newLabel, newUrl);
  };

  applyBtn.addEventListener('click', handleApply);
  [labelInput, urlInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      }
    });
  });

  openBtn.addEventListener('click', () => {
    const newUrl = urlInput.value.trim();
    if (newUrl) {
      let finalUrl = newUrl;
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl;
      }
      window.open(finalUrl, '_blank', 'noopener,noreferrer');
    }
  });

  const closePopoverOnOutsideClick = (e) => {
    if (!popover.contains(e.target) && e.target !== extLinkEl) {
      popover.remove();
      document.removeEventListener('mousedown', closePopoverOnOutsideClick);

      // キャンセル時もエディタを正式に blur 状態に更新・再描画する
      const contentDiv = extLinkEl.closest('.block-content');
      if (contentDiv) {
        const blockId = contentDiv.getAttribute('data-id');
        const note = getActiveNote();
        if (note) {
          const found = findBlockAndParent(note.blocks, blockId);
          if (found) {
            state.activeFocusedBlockId = null;
            contentDiv.removeAttribute('contenteditable');
            const textVal = serializeHtmlToWikiText(contentDiv);
            const oldContent = found.block.content;
            found.block.content = textVal;
            contentDiv.innerHTML = parseWikiLinks(escapeHTML(found.block.content));
            if (oldContent !== textVal) {
              saveNotesToStorage();
              updateBacklinks();
            }
          }
        }
      }
    }
  };

  document.body.appendChild(popover);
  setTimeout(() => {
    document.addEventListener('mousedown', closePopoverOnOutsideClick);
    labelInput.focus();
    labelInput.select();
  }, 10);
}

// ==========================================
// 10. SPEECH TO TEXT & DATA SYNC (EXPORT/IMPORT) FUNCTIONS
// ==========================================

let recognitionInstance = null;
let activeMicButton = null;

function getSpeechRecognitionInstance() {
  if (recognitionInstance) return recognitionInstance;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    if (activeMicButton) {
      activeMicButton.classList.add('recording');
      activeMicButton.title = '音声文字起こし中... (クリックで停止)';
      activeMicButton.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    }
  };

  recognition.onresult = (event) => {
    let resultText = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        resultText += event.results[i][0].transcript;
      }
    }
    if (resultText) {
      insertSpeechText(resultText);
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error !== 'aborted') {
      let msg = '音声認識エラーが発生しました: ' + event.error;
      if (event.error === 'not-allowed') {
        msg = 'マイクの使用が許可されていません。ブラウザのアドレスバーの左側（鍵マークや設定アイコン）から、マイクのアクセス許可を有効にしてください。\n\n※file:// スキーム（ローカルのHTMLファイルを直接ダブルクリックで開いた場合）では、ブラウザのセキュリティ制限によりマイクが使用できません。npm run dev または npx vite で起動したWebサーバー（http://localhost:5173 など）経由でアクセスしてください。';
      } else if (event.error === 'no-speech') {
        msg = '音声が検出されませんでした。マイクが正しく接続されているか確認し、もう一度お話しください。';
      } else if (event.error === 'network') {
        msg = 'ネットワークエラーが発生しました。音声認識の実行にはインターネット接続が必要です。';
      }
      alert(msg);
    }
    stopSpeechRecognition();
  };

  recognition.onend = () => {
    stopSpeechRecognition();
  };

  recognitionInstance = recognition;
  return recognitionInstance;
}

export function stopSpeechRecognition() {
  if (recognitionInstance) {
    try {
      recognitionInstance.stop();
    } catch (e) {
      // 停止時エラーは無視
    }
  }
  if (activeMicButton) {
    activeMicButton.classList.remove('recording');
    activeMicButton.title = '音声文字起こしを開始';
    activeMicButton.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    activeMicButton = null;
  }
}

function toggleSpeechRecognition(micBtn) {
  const recognition = getSpeechRecognitionInstance();
  if (!recognition) {
    alert('このブラウザは音声認識に対応していません。ChromeやSafariなどをお試しください。');
    return;
  }

  if (activeMicButton) {
    stopSpeechRecognition();
    return;
  }

  activeMicButton = micBtn;

  try {
    recognition.start();
  } catch (e) {
    console.error('Failed to start speech recognition:', e);
    try {
      recognition.stop();
      setTimeout(() => {
        recognition.start();
      }, 200);
    } catch (err) {
      alert('音声認識の開始に失敗しました: ' + e.message);
    }
  }
}

function insertSpeechText(text) {
  const activeNote = getActiveNote();
  if (!activeNote) return;

  // フォーカスがある要素、または最後にフォーカスされていた要素を取得
  let targetEl = document.activeElement;
  if (!targetEl || !targetEl.classList.contains('block-content')) {
    if (state.lastActiveEditTarget && document.body.contains(state.lastActiveEditTarget)) {
      targetEl = state.lastActiveEditTarget;
    } else {
      targetEl = null;
    }
  }

  if (targetEl) {
    targetEl.focus();
    
    // カーソル位置（セレクション）にテキストを挿入
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // inputイベントを発火させデータを同期
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      
      const blockId = targetEl.getAttribute('data-id');
      const found = findBlockAndParent(activeNote.blocks, blockId);
      if (found && found.block) {
        found.block.content = serializeHtmlToWikiText(targetEl);
        saveNotesToStorage();
      }
    } else {
      targetEl.textContent += text;
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      const blockId = targetEl.getAttribute('data-id');
      const found = findBlockAndParent(activeNote.blocks, blockId);
      if (found && found.block) {
        found.block.content = serializeHtmlToWikiText(targetEl);
        saveNotesToStorage();
      }
    }
  } else {
    // フォーカスされているブロックがない場合はノートの末尾に追加
    const newBlock = { id: generateId(), type: 'p', content: text };
    activeNote.blocks.push(newBlock);
    saveNotesToStorage();
    renderEditor();
    
    setTimeout(() => {
      const newEl = document.querySelector(`.block-content[data-id="${newBlock.id}"]`);
      if (newEl) {
        focusBlock(newEl);
      }
    }, 50);
  }
}

function showExportBackupModal(jsonStr, filename) {
  const old = document.querySelector('.export-backup-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.className = 'export-backup-overlay';

  const modal = document.createElement('div');
  modal.className = 'export-backup-modal';

  const title = document.createElement('h3');
  title.innerHTML = '<i class="fa-solid fa-file-export"></i> 書き出しデータ';
  modal.appendChild(title);

  const desc = document.createElement('p');
  desc.textContent = 'ダウンロードが始まらない場合は、下のボタンでJSONをコピーできます。';
  modal.appendChild(desc);

  const meta = document.createElement('div');
  meta.className = 'export-backup-meta';
  meta.textContent = `${filename} / ${(jsonStr.length / 1024).toFixed(1)} KB`;
  modal.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'export-backup-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn-secondary';
  copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i><span>JSONをコピー</span>';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(jsonStr);
      showToast('バックアップJSONをコピーしました');
    } catch (err) {
      textarea.hidden = false;
      textarea.focus();
      textarea.select();
      showToast('コピーできない場合はテキストを選択してください');
    }
  });
  actions.appendChild(copyBtn);

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn-secondary';
  retryBtn.innerHTML = '<i class="fa-solid fa-download"></i><span>再ダウンロード</span>';
  retryBtn.addEventListener('click', () => downloadBackupJSON(jsonStr, filename));
  actions.appendChild(retryBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-secondary';
  closeBtn.textContent = '閉じる';
  closeBtn.addEventListener('click', () => overlay.remove());
  actions.appendChild(closeBtn);

  modal.appendChild(actions);

  const textarea = document.createElement('textarea');
  textarea.className = 'export-backup-textarea';
  textarea.value = jsonStr;
  textarea.hidden = true;
  modal.appendChild(textarea);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function downloadBackupJSON(jsonStr, filename) {
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportAllData() {
  const data = createNotidianSnapshot();
  const jsonStr = JSON.stringify(data, null, 2);
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${date}`;
  const filename = `notidian_backup_${dateStr}.json`;

  downloadBackupJSON(jsonStr, filename);
  showExportBackupModal(jsonStr, filename);

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(jsonStr).catch(() => {});
  }
}

function cleanJSONText(text) {
  if (!text) return '';
  
  // スマホの自動修正による全角記号を半角に変換
  let cleaned = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .replace(/｛/g, '{')
    .replace(/｝/g, '}')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/　/g, ' ');

  // コピペ時に前後に余計なテキスト（説明文など）が混入した場合、最初の{または[から最後の}または]までを切り出す
  const startBrace = cleaned.indexOf('{');
  const startBracket = cleaned.indexOf('[');
  let start = -1;
  if (startBrace !== -1 && startBracket !== -1) {
    start = Math.min(startBrace, startBracket);
  } else {
    start = startBrace !== -1 ? startBrace : startBracket;
  }
  
  let end = -1;
  if (start !== -1) {
    const endBrace = cleaned.lastIndexOf('}');
    const endBracket = cleaned.lastIndexOf(']');
    end = Math.max(endBrace, endBracket);
  }
  
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  } else {
    cleaned = cleaned.trim();
  }
  
  return cleaned;
}

function processImportedJSON(jsonText) {
  try {
    const cleanedText = cleanJSONText(jsonText);
    const data = JSON.parse(cleanedText);
    const importData = data && data.data && Array.isArray(data.data.notes) ? data.data : data;
    if (!importData || !Array.isArray(importData.notes)) {
      alert('不正なバックアップファイルです。有効な Notidian バックアップ JSON を選択してください。');
      return false;
    }

    if (confirm('データをインポートすると、現在のすべてのノートや設定が上書きされます。よろしいですか？')) {
      applyNotidianSnapshot(data, { resetActive: true, source: 'manual-import' });
      alert('データのインポートが完了しました。');
      window.location.reload();
      return true;
    }
  } catch (err) {
    alert('ファイルの読み込み・解析に失敗しました: ' + err.message);
  }
  return false;
}

export function triggerImportData() {
  const overlay = document.createElement('div');
  overlay.style = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(8, 10, 16, 0.75);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
    padding: 20px 12px;
    box-sizing: border-box;
  `;

  const modal = document.createElement('div');
  modal.style = `
    width: 100%;
    max-width: 480px;
    margin: auto;
    background: #0f1322;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    box-shadow: var(--shadow-glow), var(--shadow-card);
    padding: 20px;
    color: var(--text-primary);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
    gap: 16px;
    transform: scale(0.95);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
  `;

  const title = document.createElement('h3');
  title.style = `
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-light);
    padding-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
  `;
  title.innerHTML = '<i class="fa-solid fa-file-import" style="color: var(--accent-primary);"></i> データのインポート';

  const desc = document.createElement('p');
  desc.innerText = 'JSONファイルの選択、またはテキストデータの直接貼り付けにより、バックアップデータをインポートします。';
  desc.style = `
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
    box-sizing: border-box;
  `;

  // Option 1: File Upload (Direct input to prevent iOS sandboxing limitations)
  const fileSection = document.createElement('div');
  fileSection.style = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-sizing: border-box;
  `;

  const fileLabel = document.createElement('label');
  fileLabel.innerText = '方法1: バックアップファイルを選択';
  fileLabel.style = `
    font-size: 11px;
    font-weight: bold;
    color: var(--accent-primary);
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.style = `
    padding: 8px;
    display: block;
    cursor: pointer;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
    border-radius: 8px;
    box-sizing: border-box;
    width: 100%;
  `;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (processImportedJSON(evt.target.result)) {
        closeModal();
      }
    };
    reader.readAsText(file);
  });

  fileSection.appendChild(fileLabel);
  fileSection.appendChild(fileInput);

  // Option 2: Direct Paste
  const pasteSection = document.createElement('div');
  pasteSection.style = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-sizing: border-box;
  `;

  const pasteLabel = document.createElement('label');
  pasteLabel.innerText = '方法2: JSONデータを直接貼り付ける';
  pasteLabel.style = `
    font-size: 11px;
    font-weight: bold;
    color: var(--accent-primary);
  `;

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'ここに JSON データ（{"notes": [...]} など）を貼り付けてください...';
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('spellcheck', 'false');
  textarea.style = `
    width: 100%;
    height: 100px;
    background: #080a10;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 10px;
    color: #e2e8f0;
    font-family: var(--font-code);
    font-size: 11px;
    resize: none;
    outline: none;
    transition: var(--transition-smooth);
    box-sizing: border-box;
  `;
  textarea.addEventListener('focus', () => {
    textarea.style.borderColor = 'var(--accent-primary)';
    textarea.style.boxShadow = '0 0 10px rgba(139, 92, 246, 0.15)';
  });
  textarea.addEventListener('blur', () => {
    textarea.style.borderColor = 'rgba(255, 255, 255, 0.08)';
    textarea.style.boxShadow = 'none';
  });

  const pasteBtn = document.createElement('button');
  pasteBtn.className = 'btn-primary';
  pasteBtn.style = `
    padding: 10px;
    cursor: pointer;
    font-size: 13px;
    background: var(--accent-primary);
    border: none;
    color: white;
    font-weight: 500;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: var(--transition-smooth);
    box-sizing: border-box;
    width: 100%;
  `;
  pasteBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> 貼り付けたデータからインポート';
  pasteBtn.addEventListener('click', () => {
    const val = textarea.value.trim();
    if (!val) {
      alert('データが入力されていません。');
      return;
    }
    if (processImportedJSON(val)) {
      closeModal();
    }
  });

  pasteSection.appendChild(pasteLabel);
  pasteSection.appendChild(textarea);
  pasteSection.appendChild(pasteBtn);

  // Footer / Cancel
  const footer = document.createElement('div');
  footer.style = `
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid var(--border-light);
    padding-top: 12px;
  `;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.innerText = 'キャンセル';
  cancelBtn.style = `
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--text-secondary);
    border-radius: 8px;
    transition: var(--transition-smooth);
  `;
  cancelBtn.addEventListener('click', () => closeModal());
  footer.appendChild(cancelBtn);

  modal.appendChild(title);
  modal.appendChild(desc);
  modal.appendChild(fileSection);
  modal.appendChild(pasteSection);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    modal.style.transform = 'scale(1)';
  });

  const closeModal = () => {
    overlay.style.opacity = '0';
    modal.style.transform = 'scale(0.95)';
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    }, 250);
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function showImageLightbox(url) {
  const overlay = document.createElement('div');
  overlay.style = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(8, 10, 16, 0.85);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: zoom-out;
  `;

  const img = document.createElement('img');
  img.src = url;
  img.style = `
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    transform: scale(0.95);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  `;

  overlay.appendChild(img);
  document.body.appendChild(overlay);

  // Trigger transition
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    img.style.transform = 'scale(1)';
  });

  const closeLightbox = () => {
    overlay.style.opacity = '0';
    img.style.transform = 'scale(0.95)';
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    }, 250);
  };

  overlay.addEventListener('click', closeLightbox);
  
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}
