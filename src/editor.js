import { state, getActiveNote, saveNotesToStorage, pushHistory, undo, redo } from './state.js';
import { generateId, escapeHTML } from './utils.js';
import { parseWikiLinks, serializeHtmlToWikiText, handleWikiLinkTrigger, closeLinkMenu, selectLinkMenuItem, navigateLinkMenu } from './wikilinks.js';
import { createDatabaseDOM } from './database.js';

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

const blockCanvas = document.getElementById('block-canvas');

export function renderEditor() {
  const note = getActiveNote();
  if (!note) {
    blockCanvas.innerHTML = '<div class="no-data-msg">ノートがありません。「＋」ボタンを押して新規作成してください。</div>';
    document.getElementById('note-title-input').value = '';
    document.getElementById('breadcrumb-note-title').textContent = 'ノートなし';
    return;
  }

  // Update title inputs
  document.getElementById('note-title-input').value = note.title;
  document.getElementById('breadcrumb-note-title').textContent = note.title;

  // お気に入り（星マーク）ボタンの動的生成と更新
  const titleWrapper = document.querySelector('.note-title-wrapper');
  if (titleWrapper) {
    let favBtn = titleWrapper.querySelector('.btn-favorite-toggle');
    if (!favBtn) {
      favBtn = document.createElement('button');
      favBtn.className = 'btn-favorite-toggle';
      titleWrapper.appendChild(favBtn);
    }
    favBtn.className = `btn-favorite-toggle ${note.isFavorite ? 'active' : ''}`;
    favBtn.innerHTML = `<i class="fa-${note.isFavorite ? 'solid' : 'regular'} fa-star"></i>`;
    favBtn.title = note.isFavorite ? 'お気に入りから外す' : 'お気に入りに追加';

    // 重複リスナーを避けるためクローン置換（モック環境等へのフォールバック対応）
    const newFavBtn = favBtn.cloneNode ? favBtn.cloneNode(true) : favBtn;
    if (newFavBtn !== favBtn) {
      newFavBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        note.isFavorite = !note.isFavorite;
        saveNotesToStorage();
        renderEditor();
        if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
          window.Notidian.renderNoteList();
        }
      });
      titleWrapper.replaceChild(newFavBtn, favBtn);
    } else {
      favBtn.onclick = (e) => {
        e.stopPropagation();
        note.isFavorite = !note.isFavorite;
        saveNotesToStorage();
        renderEditor();
        if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
          window.Notidian.renderNoteList();
        }
      };
    }

    // ノート削除ボタンの動的生成と更新
    let deleteBtn = titleWrapper.querySelector('.btn-note-delete');
    if (!deleteBtn) {
      deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-note-delete';
      deleteBtn.style = 'position: absolute; top: 42px; right: 74px; z-index: 10; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 6px; border-radius: 6px; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
      deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      deleteBtn.title = '現在のノートを削除';
      titleWrapper.appendChild(deleteBtn);
    }

    deleteBtn.onmouseenter = () => {
      deleteBtn.style.color = '#ef4444';
      deleteBtn.style.background = 'rgba(239, 68, 68, 0.1)';
    };
    deleteBtn.onmouseleave = () => {
      deleteBtn.style.color = 'var(--text-muted)';
      deleteBtn.style.background = 'transparent';
    };

    const newDeleteBtn = deleteBtn.cloneNode ? deleteBtn.cloneNode(true) : deleteBtn;
    if (newDeleteBtn !== deleteBtn) {
      newDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.Notidian && typeof window.Notidian.deleteNote === 'function') {
          window.Notidian.deleteNote(note.id, e);
        }
      });
      titleWrapper.replaceChild(newDeleteBtn, deleteBtn);
    } else {
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.Notidian && typeof window.Notidian.deleteNote === 'function') {
          window.Notidian.deleteNote(note.id, e);
        }
      };
    }
  }

  // Clear canvas
  blockCanvas.innerHTML = '';

  // タグ表示のレンダリング
  if (window.Notidian && typeof window.Notidian.renderNoteTags === 'function') {
    window.Notidian.renderNoteTags();
  }

  // Render top-level blocks
  if (note.blocks.length === 0) {
    // Add default paragraph if empty
    note.blocks.push({ id: generateId(), type: 'p', content: '' });
  }

  note.blocks.forEach(block => {
    const blockEl = createBlockDOM(block, null);
    blockCanvas.appendChild(blockEl);
  });

  // Setup drop indicator coordinates
  setupDragDropListeners();
  if (window.Notidian && typeof window.Notidian.updateBacklinks === 'function') {
    window.Notidian.updateBacklinks();
  }
  if (window.Notidian && typeof window.Notidian.renderNoteLinksPanel === 'function') {
    window.Notidian.renderNoteLinksPanel();
  }
  if (window.Notidian && typeof window.Notidian.updateTimerTargetTableSelect === 'function') {
    window.Notidian.updateTimerTargetTableSelect();
  }

  // Update template overwrite button
  const toolbarLeft = document.querySelector('.toolbar-left');
  if (toolbarLeft) {
    const oldBtn = toolbarLeft.querySelector('.btn-overwrite-template');
    if (oldBtn) oldBtn.remove();

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

    // カラム全体のコンテナ（columns）にはホバーコントロール（アイコン）を表示せず、
    // 列内の各ブロック（文字）にのみ表示することで、アイコンの重なりを完全に解消します。
    // （カラムの解除は右クリックから簡単に行えます）

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

  // Left Hover Controls
  const controls = createBlockControls(block.id, block.type);
  blockWrapper.appendChild(controls);

  // Structural details based on block type
  if (block.type === 'toggle') {
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
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        const offset = range.startOffset;
        const beforeText = text.substring(0, offset);

        const match = beforeText.match(/(?:「「|\[\[)([^「「\[\[\]\]」」]+)$/);
        if (match) {
          e.preventDefault();
          const keyword = match[1];
          const trimmedKeyword = keyword.trim();
          if (!trimmedKeyword) return;

          // トリガーされたカッコの種類を特定
          const triggerType = beforeText.substring(offset - keyword.length - 2, offset - keyword.length);
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
          span.setAttribute('contenteditable', 'false');
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
    const note = getActiveNote();
    const found = findBlockAndParent(note.blocks, block.id);
    if (!found) return;

    // トグルブロックの本体でEnterを押した場合は、自動的にトグルの子要素（内側）に新しいブロックを挿入する
    if (block.type === 'toggle') {
      block.children = block.children || [];
      const newBlock = { id: generateId(), type: 'p', content: '' };
      block.children.unshift(newBlock); // 子要素の先頭に追加

      // 自動でトグルを展開する
      block.properties = block.properties || {};
      block.properties.open = true;

      saveNotesToStorage();
      renderEditor();

      // 新しい子要素にフォーカスを当てる
      setTimeout(() => {
        const nextEl = document.querySelector(`.block-content[data-id="${newBlock.id}"]`);
        if (nextEl) focusBlock(nextEl);
      }, 50);
      return;
    }

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

    wrapper.addEventListener('dragstart', (e) => {
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
          // clientX がトグルの見出しテキストの開始位置より右側にある場合、
          // トグル自体の左右へのカラム化（トグルの隣に並べる）は制限し、上下ドロップ（内側へのネストなど）として扱う
          if (e.clientX > contentRect.left - 10) {
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
        // トグルブロック内のネスト（inside）処理
        const isToggleInside = found && found.block.type === 'toggle' && !isLeftRightAllowed && contentRect;

        if (isToggleInside) {
          if (y < rect.height * 0.3) {
            resolvedLocation = 'top';
          } else {
            resolvedLocation = 'inside';
          }
        } else {
          if (y < rect.height * 0.5) {
            resolvedLocation = 'top';
          } else {
            resolvedLocation = 'bottom';
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

function renderSlashMenuList() {
  const items = slashMenuList.querySelectorAll('li');
  items.forEach((li, idx) => {
    if (idx === state.slashMenuActiveIndex) {
      li.classList.add('active');
      li.scrollIntoView({ block: 'nearest' });
    } else {
      li.classList.remove('active');
    }

    // Click trigger (ドラッグハンドルやブロックアイコン操作時は決定をスルーして並び替え可能にする)
    li.onmousedown = (e) => {
      if (e.target.closest('.drag-handle') || e.target.tagName.toLowerCase() === 'i') {
        return; // 並び替えドラッグを優先するため決定処理を実行しない
      }
      e.preventDefault();
      state.slashMenuActiveIndex = idx;
      selectSlashMenuItem();
    };
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
        {
          id: 'col-tags', name: 'セレクトタグ', type: 'select', width: 140, options: [
            { id: 'opt-tag-dev', name: '開発', color: 'purple' },
            { id: 'opt-tag-design', name: 'デザイン', color: 'pink' },
            { id: 'opt-tag-doc', name: '資料作成', color: 'yellow' }
          ]
        },
        { id: 'col-date', name: '日付', type: 'date', width: 140 },
        { id: 'col-number', name: '数値', type: 'number', width: 120, calc: 'sum' }
      ],
      rows: [
        { 'col-title': 'ダッシュボードの設計', 'col-status': '進行中', 'col-tags': '開発', 'col-date': '2026-05-29', 'col-number': 8 },
        { 'col-title': '仕様書の作成', 'col-status': '未着手', 'col-tags': '資料作成', 'col-date': '2026-05-30', 'col-number': 5 }
      ],
      views: [
        { id: 'view-all', name: 'すべて', filters: [] },
        { id: 'view-progress', name: '進行中', filters: [{ id: 'f-progress', columnId: 'col-status', value: '進行中' }] },
        { id: 'view-complete', name: '完了', filters: [{ id: 'f-complete', columnId: 'col-status', value: '完了' }] }
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
function handleBlockPaste(e, activeBlock, contentDiv, directText = null, directOffset = null) {
  const clipboardText = directText !== null ? directText : (e ? e.clipboardData.getData('text/plain') : '');
  if (!clipboardText) return;

  // 改行が含まれていない場合はブラウザ標準の貼り付けに任せる（手動指示の時は実行）
  if (directText === null && !clipboardText.includes('\n') && !clipboardText.includes('\r')) {
    return;
  }

  if (e) e.preventDefault();
  pushHistory();

  const lines = clipboardText.split(/\r?\n/).filter(line => line !== null);
  if (lines.length === 0) return;

  const note = getActiveNote();
  if (!note) return;

  const found = findBlockAndParent(note.blocks, activeBlock.id);
  if (!found) return;

  // 現在のカーソル位置でテキストを分割
  let prefix = '';
  let suffix = '';

  if (directOffset !== null) {
    const fullText = activeBlock.content;
    prefix = fullText.substring(0, directOffset);
    suffix = fullText.substring(directOffset);
  } else {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const offset = getCaretCharacterOffsetWithin(contentDiv);
      const fullText = serializeHtmlToWikiText(contentDiv);

      prefix = fullText.substring(0, offset);
      suffix = fullText.substring(offset);
    } else {
      prefix = activeBlock.content;
      suffix = '';
    }
  }

  // 1行目の処理：現在のブロックのカーソルの前に1行目のテキストを挿入
  activeBlock.content = prefix + lines[0];

  // 2行目以降の新規ブロックの作成と挿入
  const newBlocks = [];
  for (let i = 1; i < lines.length; i++) {
    // 見出しやデータベースは段落(p)にフォールバック、その他は元のタイプを継承
    const newType = (activeBlock.type === 'h1' || activeBlock.type === 'h2' || activeBlock.type === 'database') ? 'p' : activeBlock.type;
    const blockContent = lines[i];

    const newB = { id: generateId(), type: newType, content: blockContent };
    if (newType === 'todo') newB.properties = { checked: false };
    if (newType === 'toggle') newB.properties = { open: true, children: [] };
    if (newType === 'callout') newB.properties = { emoji: '💡' };

    newBlocks.push(newB);
  }

  // 最後の行の末尾に、元のブロックの「カーソルより後ろ」のテキストを結合
  if (newBlocks.length > 0) {
    newBlocks[newBlocks.length - 1].content += suffix;
  } else {
    activeBlock.content += suffix;
  }

  // 親の配列に新しいブロックを挿入
  found.parentArray.splice(found.index + 1, 0, ...newBlocks);

  saveNotesToStorage();
  renderEditor();

  // 貼り付け完了後、最後の行が貼り付けられたブロックの末尾にカーソルを移動
  const targetBlockId = newBlocks.length > 0 ? newBlocks[newBlocks.length - 1].id : activeBlock.id;
  const targetContent = newBlocks.length > 0 ? lines[lines.length - 1] : lines[0];
  const focusOffset = (newBlocks.length > 0 ? targetContent.length : (prefix.length + targetContent.length));

  setTimeout(() => {
    const el = document.querySelector(`.block-content[data-id="${targetBlockId}"]`);
    if (el) {
      focusBlock(el);
      try {
        const range = document.createRange();
        const sel = window.getSelection();
        const startPos = findDOMPosition(el, focusOffset);
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
  }, 50);
}

export function setupBlockCopyPasteShortcuts() {
  window.addEventListener('keydown', (e) => {
    const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
    const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';

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
    chip.style.background = 'var(--bg-secondary, #1f2937)';
    chip.style.border = '1px solid var(--border-color, #374151)';
    chip.style.color = 'var(--accent-secondary, #ec4899)';
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
    tagEl.style.fontSize = '11px';
    tagEl.style.padding = '3px 8px';
    tagEl.style.borderRadius = '12px';
    tagEl.style.background = 'var(--bg-secondary, #1f2937)';
    tagEl.style.border = '1px solid var(--border-color, #374151)';
    tagEl.style.color = 'var(--text-secondary, #d1d5db)';
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

  // SortableJSの適用
  new Sortable(list, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    onEnd: function () {
      const items = Array.from(list.querySelectorAll('li'));
      const order = items.map(li => li.getAttribute('data-type'));
      localStorage.setItem('notidian_slash_menu_order', JSON.stringify(order));

      // 並べ替え後にアクティブインデックスがズレるのを修正
      const activeIdx = items.findIndex(li => li.classList.contains('active'));
      if (activeIdx !== -1) {
        state.slashMenuActiveIndex = activeIdx;
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

function getCharacterOffsetWithin(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
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

  function findNodeInClone(origParent, origNode, cloneParent) {
    if (origParent === origNode) return cloneParent;
    
    const path = [];
    let temp = origNode;
    while (temp && temp !== origParent) {
      const parent = temp.parentNode;
      if (!parent) return null;
      const index = Array.from(parent.childNodes).indexOf(temp);
      path.unshift(index);
      temp = parent;
    }
    
    let current = cloneParent;
    for (let i = 0; i < path.length; i++) {
      if (!current.childNodes || current.childNodes.length <= path[i]) {
        return null;
      }
      current = current.childNodes[path[i]];
    }
    return current;
  }

  function getWikiTextBefore(element, node, offset) {
    const clone = element.cloneNode(true);
    const targetNode = findNodeInClone(element, node, clone);
    if (!targetNode) {
      return serializeHtmlToWikiText(element);
    }
    
    try {
      const range = document.createRange();
      const safeOffset = Math.min(offset, targetNode.nodeType === Node.TEXT_NODE ? targetNode.length : targetNode.childNodes.length);
      range.setStart(targetNode, safeOffset);
      range.setEndAfter(clone.lastChild || clone);
      range.deleteContents();
    } catch (e) {
      console.error("Failed to delete contents in clone before:", e);
      const textOffset = getCharacterOffsetWithin(element, node, offset);
      return serializeHtmlToWikiText(element).substring(0, textOffset);
    }
    return serializeHtmlToWikiText(clone);
  }

  function getWikiTextAfter(element, node, offset) {
    const clone = element.cloneNode(true);
    const targetNode = findNodeInClone(element, node, clone);
    if (!targetNode) {
      return '';
    }
    
    try {
      const range = document.createRange();
      range.setStartBefore(clone.firstChild || clone);
      const safeOffset = Math.min(offset, targetNode.nodeType === Node.TEXT_NODE ? targetNode.length : targetNode.childNodes.length);
      range.setEnd(targetNode, safeOffset);
      range.deleteContents();
    } catch (e) {
      console.error("Failed to delete contents in clone after:", e);
      const textOffset = getCharacterOffsetWithin(element, node, offset);
      return serializeHtmlToWikiText(element).substring(textOffset);
    }
    return serializeHtmlToWikiText(clone);
  }

  function getMultipleBlockSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const canvas = document.getElementById('block-canvas');
    if (!canvas || !canvas.contains(range.commonAncestorContainer)) return null;

    const startEl = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentNode.closest('.block-content') : range.startContainer.closest('.block-content');
    const endEl = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentNode.closest('.block-content') : range.endContainer.closest('.block-content');

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

    const firstText = getWikiTextBefore(firstEl, firstRangeContainer, firstRangeOffset);
    const lastText = getWikiTextAfter(lastEl, lastRangeContainer, lastRangeOffset);

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
            setCaretPosition(el, res.mergeOffset);
          }
        }, 50);
      }
      return;
    }

    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      const res = deleteMultipleBlockSelection(selInfo);
      if (res) {
        setTimeout(() => {
          const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
          if (el) {
            focusBlock(el);
            setCaretPosition(el, res.mergeOffset);
          }
        }, 50);
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
              setCaretPosition(el, res.mergeOffset + 1);
            }
          }, 50);
        }
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'x') {
      e.preventDefault();
      const selectedText = selInfo.selection.toString();
      navigator.clipboard.writeText(selectedText).then(() => {
        const res = deleteMultipleBlockSelection(selInfo);
        if (res) {
          setTimeout(() => {
            const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
            if (el) {
              focusBlock(el);
              setCaretPosition(el, res.mergeOffset);
            }
          }, 50);
        }
      }).catch(err => {
        console.error("Failed to copy cut text: ", err);
      });
      return;
    }
  }, true);

  window.addEventListener('paste', (e) => {
    const selInfo = getMultipleBlockSelectionRange();
    if (!selInfo) return;

    e.preventDefault();
    const clipboardText = e.clipboardData.getData('text/plain');
    if (!clipboardText) return;

    const res = deleteMultipleBlockSelection(selInfo);
    if (!res) return;

    setTimeout(() => {
      const el = document.querySelector(`.block-content[data-id="${res.targetBlockId}"]`);
      if (!el) return;

      focusBlock(el);
      setCaretPosition(el, res.mergeOffset);

      if (clipboardText.includes('\n') || clipboardText.includes('\r')) {
        const note = getActiveNote();
        const found = findBlockAndParent(note.blocks, res.targetBlockId);
        if (found) {
          handleBlockPaste(null, found.block, el, clipboardText, res.mergeOffset);
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
              setCaretPosition(newEl, res.mergeOffset + clipboardText.length);
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


