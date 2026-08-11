import {
  state,
  historyState,
  pushHistory,
  undo,
  redo,
  getActiveNormalNotes,
  getActiveNote,
  cleanDeadWikiLinksAndTags,
  saveNotesToStorage,
  saveCustomTagColorsToStorage,
  saveLogsToStorage,
  createNotidianSnapshot,
  applyNotidianSnapshot,
  initStorage
} from './state.js';

import {
  generateId,
  escapeHTML,
  showToast,
  formatMS,
  getFormattedTime,
  getFormattedTimeFromMs
} from './utils.js';

import {
  parseWikiLinks,
  serializeHtmlToWikiText,
  handleWikiLinkTrigger,
  closeLinkMenu,
  selectLinkMenuItem,
  navigateLinkMenu,
  initLinkMenuSearchEvents,
  initFloatingToolbar // 追加
} from './wikilinks.js';

import {
  createDatabaseDOM,
  insertPomodoroStartToActiveTable,
  insertPomodoroLogToActiveNoteDb,
  recalculateTableFooter,
  showDeleteConfirmPopover
} from './database.js';

import {
  sets,
  schedule,
  presets,
  timerVolume,
  loadPomodoroData,
  savePomodoroData,
  addSet,
  deleteSet,
  addSchedule,
  deleteSchedule,
  savePreset,
  loadPreset,
  deletePreset,
  renderPomodoro,
  startTimer,
  pauseTimer,
  stopTimer,
  beepSound,
  endAlertSound,
  drawCirclePizza,
  isRunning,
  isPaused,
  setTimerVolume
} from './pomodoro.js';

import {
  renderEditor,
  createBlockDOM,
  focusBlock,
  setupDragSelection,
  initSlashMenuSortable,
  uncolumn,
  showLinkEditPopover,
  toggleSplitView,
  exportAllData,
  triggerImportData
} from './editor.js';

import { MindMap } from './mindmap.js';
import { initDropboxSync } from './sync.js';

let mindMapInstance = null;

function initMobileDataActions() {
  if (document.querySelector('.mobile-data-actions')) return;

  const actions = document.createElement('div');
  actions.className = 'mobile-data-actions';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'mobile-data-action-btn mobile-export-btn';
  exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i><span>書き出し</span>';
  exportBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    exportAllData();
  });
  actions.appendChild(exportBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'mobile-data-action-btn mobile-import-btn';
  importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i><span>読み込み</span>';
  importBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    triggerImportData();
  });
  actions.appendChild(importBtn);

  document.body.appendChild(actions);
}

// ==========================================
// SHARED GLOBAL API HUB (Notidian)
// ==========================================
window.Notidian = {
  // state
  state,
  saveNotesToStorage,
  saveLogsToStorage,
  createNotidianSnapshot,
  applyNotidianSnapshot,
  undo,
  redo,

  // utils
  generateId,
  escapeHTML,
  showToast,

  // editor
  renderEditor,
  createBlockDOM,
  setupDragSelection,
  initSlashMenuSortable,
  uncolumn,
  exportAllData,
  triggerImportData,

  // database
  createDatabaseDOM,
  recalculateTableFooter,
  insertPomodoroStartToActiveTable,
  insertPomodoroLogToActiveNoteDb,

  // wikilinks
  parseWikiLinks,
  serializeHtmlToWikiText,
  handleWikiLinkTrigger,

  // pomodoro
  loadPomodoroData,
  savePomodoroData,
  renderPomodoro,
  startTimer,
  pauseTimer,
  stopTimer,
  beepSound,
  endAlertSound,
  drawCirclePizza,
  setTimerVolume,
  initDropboxSync,

  // app
  navigateToNote,
  getNoteTagStyles,
  renderNoteList,
  deleteNote,
  updateBacklinks,
  renderNoteLinksPanel,
  updateTimerTargetTableSelect,
  overwriteTemplateFromActiveDaily,
  renderNoteTags,
  renderAnalytics,
  updateExistingTagsDatalist,
  toggleSplitView
};

// ==========================================
// NAVIGATION HISTORY CONTROL
// ==========================================
function navigateToNote(noteId, pushToHistory = true) {
  if (!noteId) return;

  // Clear selections
  if (window.clearBlockSelection) window.clearBlockSelection();

  const paneState = state.panes[state.activePaneIndex];
  if (paneState) {
    if (pushToHistory) {
      if (paneState.historyIndex < paneState.noteHistory.length - 1) {
        paneState.noteHistory = paneState.noteHistory.slice(0, paneState.historyIndex + 1);
      }
      if (paneState.noteHistory[paneState.historyIndex] !== noteId) {
        paneState.noteHistory.push(noteId);
        paneState.historyIndex = paneState.noteHistory.length - 1;
      }
    }
    paneState.activeNoteId = noteId;

    state.activeNoteId = noteId;
    state.noteHistory = paneState.noteHistory;
    state.historyIndex = paneState.historyIndex;
  }

  localStorage.setItem('notidian_active_note_id', state.panes[0].activeNoteId || '');
  localStorage.setItem('notidian_right_active_note_id', state.panes[1].activeNoteId || '');
  localStorage.setItem('notidian_active_pane_index', state.activePaneIndex);
  localStorage.setItem('notidian_is_split', state.isSplit);

  renderNoteList();
  renderEditor();
  updateHistoryButtons();

  if (mindMapInstance) {
    mindMapInstance.updateData();
  }
}

function updateHistoryButtons() {
  const backBtn = document.getElementById('btn-history-back');
  const forwardBtn = document.getElementById('btn-history-forward');

  if (backBtn && forwardBtn) {
    backBtn.disabled = state.historyIndex <= 0;
    forwardBtn.disabled = state.historyIndex >= state.noteHistory.length - 1;
  }
}

// Intercept WikiLink and ExternalLink clicks
document.addEventListener('mousedown', (e) => {
  const wikiLinkEl = e.target.closest('.wiki-link');
  if (wikiLinkEl) {
    // 現在アクティブにフォーカスが当たって編集中の要素内にリンクがあるか確認する
    const activeEditable = document.activeElement;
    const isEditingThisBlock = activeEditable && 
                               activeEditable.isContentEditable && 
                               activeEditable.contains(wikiLinkEl);

    if (isEditingThisBlock && !e.ctrlKey && !e.metaKey) {
      // 通常クリックはエディタの編集挙動に任せるため、preventDefaultせずスルーする
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const targetTitle = wikiLinkEl.getAttribute('data-target');
    openOrCreateNoteByTitle(targetTitle);
    return;
  }

  const extLinkEl = e.target.closest('.external-link');
  if (extLinkEl) {
    const blockContentEl = extLinkEl.closest('.block-content');
    const blockId = blockContentEl ? blockContentEl.getAttribute('data-id') : null;
    const isEditingThisBlock = blockId && state.activeFocusedBlockId === blockId;

    if (isEditingThisBlock) {
      e.preventDefault();
      e.stopPropagation();
      showLinkEditPopover(extLinkEl);
    } else {
      e.preventDefault();
      e.stopPropagation();
      const href = extLinkEl.getAttribute('href');
      if (href) {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }
  }
});

function openOrCreateNoteByTitle(title) {
  let note = state.notes.find(n => n.title.toLowerCase() === title.toLowerCase());

  if (!note) {
    const activeNote = getActiveNote();
    const parentFolderId = activeNote ? activeNote.folderId : null;

    note = {
      id: 'note-' + generateId(),
      title: title,
      folderId: parentFolderId,
      updatedAt: Date.now(),
      blocks: [
        { id: generateId(), type: 'p', content: '' }
      ]
    };
    state.notes.push(note);
    saveNotesToStorage();
    renderNoteList();
  }

  navigateToNote(note.id);
}

// ==========================================
// NOTES MANAGEMENT & SIDEBAR
// ==========================================
const noteListContainer = document.getElementById('note-list');
const searchInput = document.getElementById('search-notes');
const noteTitleInput = document.getElementById('note-title-input');


let oldNoteTitle = '';
if (noteTitleInput) {
  noteTitleInput.addEventListener('focus', () => {
    const note = getActiveNote();
    if (note) {
      oldNoteTitle = note.title;
    }
  });

  noteTitleInput.addEventListener('blur', () => {
    const note = getActiveNote();
    if (!note) return;

    const newTitle = noteTitleInput.value.trim();
    if (newTitle === '') {
      noteTitleInput.value = note.title;
      return;
    }

    if (newTitle !== oldNoteTitle) {
      // WikiLink update
      const updateLinkTargets = (blocksArr) => {
        blocksArr.forEach(b => {
          if (b.content) {
            b.content = b.content.replace(/\[\[(.*?)\]\]/g, (m, target) => {
              if (target.trim().toLowerCase() === oldNoteTitle.toLowerCase()) {
                return `[[${newTitle}]]`;
              }
              return m;
            }).replace(/「「(.*?)」」/g, (m, target) => {
              if (target.trim().toLowerCase() === oldNoteTitle.toLowerCase()) {
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

      note.title = newTitle;
      note.updatedAt = Date.now();

      saveNotesToStorage();
      renderNoteList();
      renderEditor();
    }
  });

  noteTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      noteTitleInput.blur();
    }
  });
}

// ==========================================
// BACKLINKS & OUTGOING LINKS
// ==========================================
export function updateBacklinks(panel = null, activeNote = null) {
  // 1. 下部リンクパネルの更新
  if (!panel) {
    panel = document.getElementById('backlinks-panel-content');
    if (!panel) {
      panel = document.getElementById('note-links-panel');
    }
  }
  if (!panel) return;
  panel.innerHTML = '';

  if (!activeNote) {
    activeNote = getActiveNote();
  }
  if (!activeNote) {
    panel.innerHTML = '<div class="no-links-msg">ノートが選択されていません。</div>';
    return;
  }

  const currentTitle = activeNote.title.toLowerCase();

  const searchBlocksForTitle = (blocksArray, targetTitle) => {
    for (let b of blocksArray) {
      if (b.content) {
        const contentLower = b.content.toLowerCase();
        if (contentLower.includes(`[[${targetTitle}]]`) || contentLower.includes(`「「${targetTitle}」」`)) {
          return true;
        }
      }
      if (b.type === 'database' && b.properties && b.properties.rows) {
        for (let row of b.properties.rows) {
          for (let key in row) {
            const val = String(row[key] || '').toLowerCase();
            if (val.includes(`[[${targetTitle}]]`) || val.includes(`「「${targetTitle}」」`)) {
              return true;
            }
          }
        }
      }
      if (b.children && searchBlocksForTitle(b.children, targetTitle)) {
        return true;
      }
    }
    return false;
  };

  const referrersMap = new Map();
  getActiveNormalNotes().forEach(note => {
    if (note.id === activeNote.id) return;
    if (searchBlocksForTitle(note.blocks, currentTitle)) {
      referrersMap.set(note.id, note);
    }
  });
  const referrers = Array.from(referrersMap.values());

  const outgoing = extractOutgoingLinks(activeNote);

  // Left Column
  const backCol = document.createElement('div');
  backCol.className = 'links-panel-col';
  backCol.innerHTML = `<div class="links-panel-header"><i class="fa-solid fa-arrow-left"></i> 戻りリンク <span class="links-count">(${referrers.length})</span></div>`;
  const backBody = document.createElement('div');
  backBody.className = 'links-panel-body';

  if (referrers.length === 0) {
    backBody.innerHTML = '<div class="no-links-msg">参照している他のノートはありません。</div>';
  } else {
    referrers.forEach(note => {
      const badge = document.createElement('span');
      badge.className = 'note-link-badge';
      badge.innerHTML = `<i class="fa-regular fa-file-lines"></i> ${escapeHTML(note.title)}`;
      badge.addEventListener('click', () => navigateToNote(note.id));
      backBody.appendChild(badge);
    });
  }
  backCol.appendChild(backBody);

  // Right Column
  const outCol = document.createElement('div');
  outCol.className = 'links-panel-col';
  outCol.innerHTML = `<div class="links-panel-header">進みリンク <i class="fa-solid fa-arrow-right"></i> <span class="links-count">(${outgoing.length})</span></div>`;
  const outBody = document.createElement('div');
  outBody.className = 'links-panel-body';

  if (outgoing.length === 0) {
    outBody.innerHTML = '<div class="no-links-msg">このノートからリンクしている先はありません。</div>';
  } else {
    outgoing.forEach(note => {
      const badge = document.createElement('span');
      badge.className = 'note-link-badge';
      badge.innerHTML = `<i class="fa-regular fa-file-lines"></i> ${escapeHTML(note.title)}`;
      badge.addEventListener('click', () => navigateToNote(note.id));
      outBody.appendChild(badge);
    });
  }
  outCol.appendChild(outBody);

  panel.appendChild(backCol);
  panel.appendChild(outCol);
}

function extractOutgoingLinks(note) {
  const linksMap = new Map();

  const checkTextForLinks = (text) => {
    text.replace(/\[\[(.*?)\]\]/g, (m, target) => {
      const tName = target.trim();
      const targetNote = state.notes.find(n => n.title.toLowerCase() === tName.toLowerCase());
      if (targetNote && targetNote.id !== note.id) {
        linksMap.set(targetNote.id, targetNote);
      }
    }).replace(/「「(.*?)」」/g, (m, target) => {
      const tName = target.trim();
      const targetNote = state.notes.find(n => n.title.toLowerCase() === tName.toLowerCase());
      if (targetNote && targetNote.id !== note.id) {
        linksMap.set(targetNote.id, targetNote);
      }
    });
  };

  const searchBlocks = (blocksArray) => {
    blocksArray.forEach(b => {
      if (b.content) {
        checkTextForLinks(b.content);
      }
      if (b.type === 'database' && b.properties && b.properties.rows) {
        b.properties.rows.forEach(row => {
          for (let key in row) {
            const val = String(row[key] || '');
            if (val) {
              checkTextForLinks(val);
            }
          }
        });
      }
      if (b.children) searchBlocks(b.children);
    });
  };
  if (note.blocks) searchBlocks(note.blocks);
  return Array.from(linksMap.values());
}

export function renderNoteLinksPanel() {
  updateBacklinks();
}

export function renderNoteList() {
  if (!noteListContainer) return;
  noteListContainer.innerHTML = '';
  const searchVal = String(searchInput && searchInput.value || '').toLowerCase().trim();

  // 有効な実在する通常ノートのみを一覧表示
  const normalNotes = getActiveNormalNotes();

  // 検索中かどうかの判定
  if (searchVal !== '') {
    // 検索中ステータスヘッダー（決定＆解除ボタン付き）の動的追加
    const searchHeader = document.createElement('div');
    searchHeader.className = 'sidebar-search-status-header';
    searchHeader.style = 'display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; margin-bottom: 12px; background: rgba(236, 72, 153, 0.06); border: 1px solid rgba(236, 72, 153, 0.2); border-radius: 8px; font-size: 11px; color: var(--text-secondary); box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
    searchHeader.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <span><i class="fa-solid fa-filter" style="color:var(--accent-secondary, #ec4899);"></i> 検索中: "<strong>${escapeHTML(searchVal)}</strong>"</span>
        <button class="btn-clear-search-link" style="background:none; border:none; color:var(--text-muted, #6b7280); cursor:pointer; font-weight:500; font-size:11px; padding:2px 6px; border-radius:4px; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='none'" title="検索をキャンセルしてリセット">
          <i class="fa-solid fa-rotate-left"></i> 解除
        </button>
      </div>
      <button class="btn-confirm-note" style="width: 100%; background: var(--accent-secondary, #ec4899); border: none; color: white; cursor: pointer; font-weight: 700; font-size: 11px; padding: 6px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s; box-shadow: 0 2px 4px rgba(236, 72, 153, 0.25);" onmouseover="this.style.opacity='0.9'; this.style.transform='translateY(-0.5px)'" onmouseout="this.style.opacity='1'; this.style.transform='none'">
        <i class="fa-solid fa-check"></i> このノートに決定
      </button>
    `;
    searchHeader.querySelector('.btn-clear-search-link').addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) clearBtn.style.display = 'none';
        renderNoteList();
      }
    });
    searchHeader.querySelector('.btn-confirm-note').addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) clearBtn.style.display = 'none';
        renderNoteList();
      }
    });
    noteListContainer.appendChild(searchHeader);

    renderSearchTree(normalNotes, searchVal);
  } else {
    renderNormalTree(normalNotes);
  }

  // サイドバーのタグ一覧を再描画
  renderSidebarTags();
}

export function deleteNote(noteId, e) {
  showDeleteConfirmPopover(e, 'このノートを削除しますか？', () => {
    state.notes = state.notes.filter(n => n.id !== noteId);

    // データ完全性クリーンアップ（古いリンクをプレーンテキスト化 ＆ 空タグ抹消）を実行！
    cleanDeadWikiLinksAndTags();

    // 削除状態を即座にストレージへ保存する
    saveNotesToStorage();

    if (state.activeNoteId === noteId) {
      const nextNoteId = state.notes.length > 0 ? state.notes[0].id : null;
      navigateToNote(nextNoteId);
    } else {
      renderNoteList();
      renderEditor();
    }
  });
}

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
  let preview = document.getElementById('sidebar-path-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'sidebar-path-preview';
    preview.style = 'position: fixed; bottom: 12px; left: 12px; z-index: 1000; background: rgba(0,0,0,0.85); color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 11px; border: 1px solid var(--border-light); font-weight:600; box-shadow: 0 4px 12px rgba(0,0,0,0.4); pointer-events:none; transition: opacity 0.2s ease;';
    document.body.appendChild(preview);
  }
  preview.textContent = text;
  preview.style.opacity = '1';
}

function hideSidebarPathPreview() {
  const preview = document.getElementById('sidebar-path-preview');
  if (preview) {
    preview.style.opacity = '0';
  }
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

  // テンプレート状態に応じたトグルの付与
  const templateToggle = document.createElement('button');
  templateToggle.className = `btn-template-star ${note.isTemplate ? 'active' : ''}`;
  templateToggle.innerHTML = `<i class="fa-solid fa-cubes"></i>`;
  templateToggle.title = note.isTemplate ? 'テンプレートから解除' : 'テンプレートに登録';

  templateToggle.style.background = 'none';
  templateToggle.style.border = 'none';
  templateToggle.style.cursor = 'pointer';
  templateToggle.style.padding = '2px 4px';
  templateToggle.style.fontSize = '11px';
  templateToggle.style.opacity = note.isTemplate ? '1' : '0';
  templateToggle.style.transition = 'all 0.15s ease';
  templateToggle.style.color = note.isTemplate ? 'var(--accent-secondary, #ec4899)' : 'var(--text-muted, #6b7280)';

  // ホバー時の透過度連動
  li.addEventListener('mouseenter', () => {
    if (!note.isTemplate) templateToggle.style.opacity = '0.7';
  });
  li.addEventListener('mouseleave', () => {
    if (!note.isTemplate) templateToggle.style.opacity = '0';
  });
  templateToggle.addEventListener('mouseenter', () => {
    templateToggle.style.opacity = '1';
    templateToggle.style.color = 'var(--accent-secondary, #ec4899)';
    templateToggle.style.transform = 'scale(1.2)';
  });
  templateToggle.addEventListener('mouseleave', () => {
    templateToggle.style.transform = 'none';
    if (!note.isTemplate) {
      templateToggle.style.opacity = '0.7';
      templateToggle.style.color = 'var(--text-muted, #6b7280)';
    }
  });

  templateToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    note.isTemplate = !note.isTemplate;
    if (!note.isTemplate) {
      note.isDailyDefault = false; // テンプレート解除時はデイリー規定も解除
    }
    saveNotesToStorage();
    renderNoteList();
    renderEditor();

    // テンプレート管理ポップオーバーが開いていれば更新
    const pop = document.querySelector('.templates-popover');
    if (pop) {
      pop.remove();
      showTemplatesPopover(e);
    }
  });

  li.appendChild(icon);
  li.appendChild(titleSpan);
  li.appendChild(favStar);
  li.appendChild(templateToggle);
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
// TAGS SYSTEM
// ==========================================
const sidebarTagsContainer = document.getElementById('sidebar-tags-list');

function hexToRgba(hex, alpha) {
  let c = hex.substring(1);
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getNoteTagStyles(tag) {
  const cleanTag = tag.trim();
  
  // カスタムカラーが存在する場合は動的にRGBAカラーを算出
  if (state.customTagColors && state.customTagColors[cleanTag]) {
    const hex = state.customTagColors[cleanTag];
    return {
      bg: hexToRgba(hex, 0.12),
      fg: hex,
      border: hexToRgba(hex, 0.25)
    };
  }

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
  const tagLower = cleanTag.toLowerCase();
  for (let i = 0; i < tagLower.length; i++) {
    hash = tagLower.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function renderSidebarTags() {
  if (!sidebarTagsContainer) return;
  sidebarTagsContainer.innerHTML = '';

  const tagCounts = {};
  getActiveNormalNotes().forEach(note => {
    if (note.tags && Array.isArray(note.tags)) {
      note.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });

  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  if (sortedTags.length === 0) {
    sidebarTagsContainer.innerHTML = '<div class="no-data-msg">タグがありません。</div>';
    return;
  }

  sortedTags.forEach(([tag, count]) => {
    const el = document.createElement('div');
    el.className = 'sidebar-tag-item';
    
    const currentSearch = searchInput ? searchInput.value.trim() : '';
    const isActive = currentSearch === '#' + tag || currentSearch === '＃' + tag;
    
    const tagStyles = getNoteTagStyles(tag);
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'space-between';
    el.style.padding = '5px 10px';
    el.style.borderRadius = '8px';
    el.style.margin = '4px 0';
    el.style.cursor = 'pointer';
    el.style.transition = 'all 0.2s';
    
    if (isActive) {
      el.style.background = tagStyles.bg;
      el.style.border = `1px solid ${tagStyles.border}`;
      el.style.boxShadow = `0 0 6px ${tagStyles.border}`;
    } else {
      el.style.background = 'transparent';
      el.style.border = '1px solid transparent';
    }

    el.innerHTML = `
      <span class="tag-name" style="color: ${tagStyles.fg}; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
        <i class="fa-solid fa-tag"></i> ${escapeHTML(tag)}
      </span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="color" class="tag-color-input" value="${tagStyles.fg}" data-tag="${escapeHTML(tag)}" title="タグの色を変更">
        <span class="tag-count" style="font-size: 10px; background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 10px; color: var(--text-muted); font-weight: 600;">
          ${count}
        </span>
      </div>
    `;

    // カラーピッカーの処理
    const colorInput = el.querySelector('.tag-color-input');
    if (colorInput) {
      // タグフィルタリング発発防止
      colorInput.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      colorInput.addEventListener('change', (e) => {
        const newColor = e.target.value;
        state.customTagColors[tag] = newColor;
        saveCustomTagColorsToStorage();
        
        // 再描画
        renderSidebarTags();
        renderEditor();
        if (mindMapInstance) {
          mindMapInstance.updateData();
        }
      });
    }

    el.addEventListener('mouseenter', () => {
      if (!isActive) {
        el.style.background = 'rgba(255,255,255,0.03)';
        el.style.borderColor = 'var(--border-light)';
      }
    });
    el.addEventListener('mouseleave', () => {
      if (!isActive) {
        el.style.background = 'transparent';
        el.style.borderColor = 'transparent';
      }
    });

    el.addEventListener('click', () => {
      if (searchInput) {
        if (searchInput.value === '#' + tag) {
          searchInput.value = '';
          const clearBtn = document.getElementById('clear-search-btn');
          if (clearBtn) clearBtn.style.display = 'none';
        } else {
          searchInput.value = '#' + tag;
          const clearBtn = document.getElementById('clear-search-btn');
          if (clearBtn) clearBtn.style.display = 'block';
        }
        renderNoteList();
      }
    });
    sidebarTagsContainer.appendChild(el);
  });
}

export function updateExistingTagsDatalist() {
  const datalist = document.getElementById('existing-tags-datalist');
  if (!datalist) return;
  datalist.innerHTML = '';

  const uniqueTags = new Set();
  getActiveNormalNotes().forEach(note => {
    if (note.tags && Array.isArray(note.tags)) {
      note.tags.forEach(t => uniqueTags.add(t));
    }
  });

  uniqueTags.forEach(tag => {
    const option = document.createElement('option');
    option.value = tag;
    datalist.appendChild(option);
  });
}

export function renderNoteTags(tagsPanel = null, note = null) {
  if (!tagsPanel) {
    tagsPanel = document.getElementById('note-tags-panel');
  }
  if (!tagsPanel) return;

  // タグ補完用の datalist を最新化
  updateExistingTagsDatalist();

  tagsPanel.innerHTML = '';
  if (!note) {
    note = getActiveNote();
  }
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
      renderNoteTags(tagsPanel, note);
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
      renderNoteTags(tagsPanel, note);
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

// ==========================================
// DAILY NOTES & TEMPLATES
// ==========================================
function createDailyNote() {
  const today = new Date();
  const title = today.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' デイリー';

  let note = state.notes.find(n => n.title === title);
  if (note) {
    navigateToNote(note.id);
    return;
  }

  // Load daily templates
  let dailyTemplate = state.notes.find(n => n.isDailyDefault && n.isTemplate);
  if (!dailyTemplate) {
    dailyTemplate = state.notes.find(n => n.isTemplate);
  }

  const blocks = dailyTemplate ? JSON.parse(JSON.stringify(dailyTemplate.blocks)) : [{ id: generateId(), type: 'p', content: '' }];
  const templateSourceId = dailyTemplate ? dailyTemplate.id : null;

  // Deep ID regenerate for new instances
  const regenIds = (blocksArr) => {
    blocksArr.forEach(b => {
      b.id = generateId();
      if (b.children) regenIds(b.children);
    });
  };
  regenIds(blocks);

  const newNote = {
    id: 'note-' + generateId(),
    title: title,
    folderId: state.dailyFolderId || null,
    templateSourceId,
    updatedAt: Date.now(),
    blocks: blocks
  };

  state.notes.push(newNote);
  saveNotesToStorage();
  navigateToNote(newNote.id);
}

function createTemplateFromActiveNote() {
  const activeNote = getActiveNote();
  if (!activeNote) {
    showToast('現在開いているノートがありません。');
    return;
  }

  const templateTitle = prompt('登録するテンプレート名を入力してください：', `${activeNote.title} のテンプレート`);
  if (!templateTitle) return;

  const newTemplate = {
    id: 'template-' + generateId(),
    title: templateTitle,
    folderId: null,
    updatedAt: Date.now(),
    isTemplate: true,
    isDailyDefault: false,
    blocks: JSON.parse(JSON.stringify(activeNote.blocks))
  };

  state.notes.push(newTemplate);
  saveNotesToStorage();
  renderNoteList();

  showToast(`テンプレート「${templateTitle}」を登録しました。`);
}

function createNoteFromTemplate(templateId) {
  const template = state.notes.find(n => n.id === templateId && n.isTemplate);
  if (!template) return;

  const newNote = {
    id: 'note-' + generateId(),
    title: `${template.title} から作成`,
    folderId: null,
    updatedAt: Date.now(),
    isTemplate: false,
    templateSourceId: template.id,
    blocks: JSON.parse(JSON.stringify(template.blocks))
  };

  state.notes.push(newNote);
  saveNotesToStorage();
  navigateToNote(newNote.id);
}

function showTemplatesPopover(e) {
  const existing = document.querySelectorAll('.db-floating-popover');
  existing.forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'db-floating-popover templates-popover';
  popover.style.left = `${e.clientX - 100}px`;
  popover.style.top = `${e.clientY + 12}px`;
  popover.style.width = '240px';

  const header = document.createElement('div');
  header.className = 'templates-popover-header';
  header.innerHTML = `<strong>テンプレート管理</strong>`;
  popover.appendChild(header);

  // 現在のノートを新規テンプレートとして登録するボタン
  const createBtn = document.createElement('button');
  createBtn.className = 'btn-popover-create-template';
  createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 今のノートから作成';
  createBtn.addEventListener('click', () => {
    popover.remove();
    createTemplateFromActiveNote();
  });
  popover.appendChild(createBtn);

  const divider = document.createElement('div');
  divider.className = 'db-popover-divider';
  popover.appendChild(divider);

  const templates = state.notes.filter(n => n.isTemplate);
  if (templates.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'no-data-msg';
    emptyMsg.textContent = 'テンプレートはありません。';
    popover.appendChild(emptyMsg);
  } else {
    templates.forEach(tpl => {
      const item = document.createElement('div');
      item.className = 'template-popover-item';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'template-item-title';
      titleSpan.textContent = tpl.title;
      titleSpan.title = 'テンプレートから新規ページ作成';
      titleSpan.addEventListener('click', () => {
        popover.remove();
        createNoteFromTemplate(tpl.id);
      });
      item.appendChild(titleSpan);

      // デイリーデフォルト（星マーク）
      const starBtn = document.createElement('button');
      starBtn.className = `btn-template-star ${tpl.isDailyDefault ? 'active' : ''}`;
      starBtn.innerHTML = `<i class="fa-${tpl.isDailyDefault ? 'solid' : 'regular'} fa-star"></i>`;
      starBtn.title = tpl.isDailyDefault ? 'デイリーのデフォルトです' : 'デイリーのデフォルトに設定';
      starBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();

        // 全てのテンプレートのデフォルトフラグをリセット
        templates.forEach(t => t.isDailyDefault = false);
        tpl.isDailyDefault = !tpl.isDailyDefault;

        saveNotesToStorage();
        popover.remove();
        showToast(`デイリーのデフォルトを「${tpl.title}」に設定しました。`);
      });
      item.appendChild(starBtn);

      // テンプレート削除
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-template-del';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      delBtn.title = '削除';
      delBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (confirm(`テンプレート「${tpl.title}」を削除してもよろしいですか？`)) {
          state.notes = state.notes.filter(n => n.id !== tpl.id);
          saveNotesToStorage();
          popover.remove();
          renderNoteList();
        }
      });
      item.appendChild(delBtn);

      popover.appendChild(item);
    });
  }

  // デイリーフォルダー設定セクションの描画
  const dailySection = document.createElement('div');
  dailySection.className = 'daily-folder-popover-section';
  dailySection.style.padding = '8px 10px';
  dailySection.style.marginTop = '4px';
  dailySection.style.borderTop = '1px solid var(--border-color, #e5e7eb)';

  const dailyLabel = document.createElement('label');
  dailyLabel.style = 'font-size: 10px; color: var(--text-muted); font-weight: 700; display: block; margin-bottom: 4px;';
  dailyLabel.innerHTML = '<i class="fa-regular fa-folder"></i> デイリー自動格納フォルダ';
  dailySection.appendChild(dailyLabel);

  const selectEl = document.createElement('select');
  selectEl.className = 'daily-folder-popover-select';
  selectEl.style = 'width: 100%; padding: 4px; font-size: 11px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;';
  selectEl.innerHTML = '<option value="">ルート階層 (フォルダなし)</option>';

  const addFolderOptions = (foldersList, parentId, depth) => {
    const currentFolders = foldersList.filter(f => f.parentId === parentId);
    currentFolders.sort((a, b) => b.sortIndex - a.sortIndex);
    currentFolders.forEach(folder => {
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = '\u00A0\u00A0'.repeat(depth) + folder.name;
      selectEl.appendChild(opt);
      addFolderOptions(foldersList, folder.id, depth + 1);
    });
  };
  addFolderOptions(state.folders, null, 0);

  selectEl.value = state.dailyFolderId || '';

  selectEl.addEventListener('change', (evt) => {
    state.dailyFolderId = evt.target.value || null;
    saveNotesToStorage();
  });

  dailySection.appendChild(selectEl);
  popover.appendChild(dailySection);

  document.body.appendChild(popover);

  // Auto close listener
  const closePop = (evt) => {
    if (!popover.contains(evt.target) && evt.target !== templatesBtn) {
      popover.remove();
      document.removeEventListener('click', closePop);
    }
  };
  setTimeout(() => document.addEventListener('click', closePop), 10);
}

export function overwriteTemplateFromActiveDaily() {
  const note = getActiveNote();
  if (!note || !note.templateSourceId) return;

  const template = state.notes.find(t => t.id === note.templateSourceId && t.isTemplate);
  if (!template) {
    showToast('元のテンプレートが見つかりません。');
    return;
  }

  if (confirm(`現在のブロック構成でテンプレート「${template.title}」を上書き更新しますか？`)) {
    const blocksCopy = JSON.parse(JSON.stringify(note.blocks));
    // Regenerate unique IDs
    const regenIds = (blocksArr) => {
      blocksArr.forEach(b => {
        b.id = generateId();
        if (b.children) regenIds(b.children);
      });
    };
    regenIds(blocksCopy);

    template.blocks = blocksCopy;
    template.updatedAt = Date.now();
    saveNotesToStorage();
    showToast('テンプレートを上書き更新しました！');
  }
}

// Copy focus table logs to clipboard in TSV format for Excel
export function copyFocusTableToExcel() {
  if (state.focusLogs.length === 0) {
    showToast('コピーするデータがありません。');
    return;
  }

  // 1. ヘッダー行を作成
  const headers = ['日付', 'タスク名', '時間(分)', 'ステータス'];
  const tsvLines = [headers.join('\t')];

  // 2. 日付の降順でソート（表示順に合わせる）
  const sortedLogs = [...state.focusLogs].sort((a, b) => b.timestamp - a.timestamp);

  // 3. データ行を作成
  sortedLogs.forEach(log => {
    const row = [
      log.date || '',
      log.taskName || '名称未設定タスク',
      `${log.duration}分`,
      log.status || ''
    ];
    
    // Excel用にエスケープ処理
    const escapedRow = row.map(val => {
      let strVal = String(val);
      if (strVal.includes('\t') || strVal.includes('\n') || strVal.includes('\r') || strVal.includes('"')) {
        strVal = `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    });
    
    tsvLines.push(escapedRow.join('\t'));
  });

  const tsvContent = tsvLines.join('\n');
  navigator.clipboard.writeText(tsvContent).then(() => {
    showToast('作業時間データをExcel用にコピーしました。');
  }).catch(err => {
    console.error('コピーに失敗しました', err);
    showToast('コピーに失敗しました。');
  });
}

// グローバルスコープに公開してHTMLのonclickから呼び出せるようにする
window.copyFocusTableToExcel = copyFocusTableToExcel;

// ==========================================
// ANALYTICS & FOCUS TABLES
// ==========================================
const focusTableBody = document.getElementById('focus-table-body');
const taskBreakdownContainer = document.getElementById('task-breakdown');
const cumulativeChart = document.getElementById('cumulative-chart');

export function renderAnalytics() {
  renderFocusTable();
  renderSvgChart();
  renderTaskBreakdown();
}

function renderFocusTable() {
  if (!focusTableBody) return;
  focusTableBody.innerHTML = '';

  if (state.focusLogs.length === 0) {
    focusTableBody.innerHTML = `<tr><td colspan="6" class="no-data-msg">ログがありません。タスクを完了させて記録を作成しましょう！</td></tr>`;
    const selectAllChk = document.getElementById('focus-select-all');
    if (selectAllChk) selectAllChk.checked = false;
    updateFocusDeleteSelectedButton();
    return;
  }

  if (!state.selectedFocusLogIds) state.selectedFocusLogIds = [];

  const sort = state.focusLogSort || { column: 'date', direction: 'desc' };
  const sortedLogs = [...state.focusLogs].sort((a, b) => {
    let valA, valB;
    if (sort.column === 'date') {
      valA = a.timestamp || 0;
      valB = b.timestamp || 0;
    } else if (sort.column === 'taskName') {
      valA = String(a.taskName || '').toLowerCase();
      valB = String(b.taskName || '').toLowerCase();
    } else if (sort.column === 'duration') {
      valA = Number(a.duration || 0);
      valB = Number(b.duration || 0);
    } else if (sort.column === 'status') {
      valA = String(a.status || '').toLowerCase();
      valB = String(b.status || '').toLowerCase();
    } else {
      valA = a.timestamp || 0;
      valB = b.timestamp || 0;
    }

    if (valA === valB) return 0;
    if (valA < valB) return sort.direction === 'asc' ? -1 : 1;
    return sort.direction === 'asc' ? 1 : -1;
  });

  sortedLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', log.id);
    const isChecked = state.selectedFocusLogIds.includes(log.id);
    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" class="focus-row-select-check" data-log-id="${log.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer; margin: 0;">
      </td>
      <td>${escapeHTML(log.date)}</td>
      <td class="cell-editable" contenteditable="true" data-field="taskName">${escapeHTML(log.taskName)}</td>
      <td class="cell-editable" contenteditable="true" data-field="duration" style="text-align:center;">${log.duration}分</td>
      <td>
        <span style="color: ${log.status === '完了' ? 'var(--accent-green)' : 'var(--text-muted)'}; font-weight: 600;">
          ${escapeHTML(log.status)}
        </span>
      </td>
      <td style="text-align: center;">
        <button class="btn-clear-logs" data-log-id="${log.id}" title="削除">
          <i class="fa-solid fa-trash-can" style="font-size:10px;"></i>
        </button>
      </td>
    `;

    // Checkbox handler
    const chk = tr.querySelector('.focus-row-select-check');
    chk.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-log-id');
      if (e.target.checked) {
        if (!state.selectedFocusLogIds.includes(id)) {
          state.selectedFocusLogIds.push(id);
        }
      } else {
        state.selectedFocusLogIds = state.selectedFocusLogIds.filter(item => item !== id);
      }
      updateFocusSelectAllState();
      updateFocusDeleteSelectedButton();
    });

    // Delete handler
    tr.querySelector('.btn-clear-logs').addEventListener('click', (e) => {
      e.stopPropagation();
      const logId = e.currentTarget.getAttribute('data-log-id');
      deleteLog(logId);
    });

    const editableCells = tr.querySelectorAll('.cell-editable');
    editableCells.forEach(cell => {
      cell.addEventListener('blur', () => {
        const field = cell.getAttribute('data-field');
        let newVal = cell.textContent.trim();

        if (field === 'duration') {
          let parsedVal = parseInt(String(newVal).replace(/分/g, ''));
          if (isNaN(parsedVal) || parsedVal <= 0) {
            alert('時間は1以上の整数を入力してください。');
            cell.textContent = log.duration + '分';
            return;
          }
          newVal = parsedVal;
          cell.textContent = newVal + '分';
        }

        const logIdx = state.focusLogs.findIndex(l => l.id === log.id);
        if (logIdx !== -1) {
          state.focusLogs[logIdx][field] = newVal;
          saveLogsToStorage();
        }
      });

      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          cell.blur();
        }
      });
    });

    focusTableBody.appendChild(tr);
  });

  updateFocusSelectAllState();
  updateFocusDeleteSelectedButton();
  updateFocusTableSortIcons();
}

export function updateFocusSelectAllState() {
  const selectAllChk = document.getElementById('focus-select-all');
  if (!selectAllChk) return;
  const visibleLogIds = state.focusLogs.map(l => l.id);
  const isAllSelected = visibleLogIds.length > 0 && visibleLogIds.every(id => state.selectedFocusLogIds && state.selectedFocusLogIds.includes(id));
  selectAllChk.checked = isAllSelected;
}

export function updateFocusDeleteSelectedButton() {
  const delSelectedBtn = document.getElementById('btn-focus-delete-selected');
  if (!delSelectedBtn) return;
  const count = state.selectedFocusLogIds ? state.selectedFocusLogIds.length : 0;
  if (count > 0) {
    delSelectedBtn.style.display = 'inline-flex';
    delSelectedBtn.title = `選択した記録を削除 (${count}件)`;
  } else {
    delSelectedBtn.style.display = 'none';
  }
}

export function initFocusTableSort() {
  const headers = document.querySelectorAll('.focus-th-sortable');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      let dir = 'asc';
      if (state.focusLogSort && state.focusLogSort.column === col) {
        dir = state.focusLogSort.direction === 'asc' ? 'desc' : 'asc';
      }
      state.focusLogSort = { column: col, direction: dir };
      saveLogsToStorage();
    });
  });
}

export function updateFocusTableSortIcons() {
  const headers = document.querySelectorAll('.focus-th-sortable');
  const sort = state.focusLogSort || { column: 'date', direction: 'desc' };
  headers.forEach(th => {
    const col = th.getAttribute('data-col');
    const iconSpan = th.querySelector('.sort-icon');
    if (iconSpan) {
      if (sort.column === col) {
        iconSpan.innerHTML = sort.direction === 'asc' ? ' <i class="fa-solid fa-caret-up"></i>' : ' <i class="fa-solid fa-caret-down"></i>';
        th.classList.add('sorted');
      } else {
        iconSpan.innerHTML = '';
        th.classList.remove('sorted');
      }
    }
  });
}

function deleteLog(logId) {
  if (confirm('この記録を削除しますか？')) {
    state.focusLogs = state.focusLogs.filter(l => l.id !== logId);
    saveLogsToStorage();
  }
}

function renderSvgChart() {
  if (!cumulativeChart) return;
  cumulativeChart.innerHTML = '';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  const linearGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  linearGradient.setAttribute('id', 'barGradient');
  linearGradient.setAttribute('x1', '0');
  linearGradient.setAttribute('y1', '0');
  linearGradient.setAttribute('x2', '0');
  linearGradient.setAttribute('y2', '1');
  linearGradient.innerHTML = `
    <stop offset="0%" stop-color="var(--accent-secondary)" />
    <stop offset="100%" stop-color="var(--accent-primary)" />
  `;

  const hoverGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  hoverGradient.setAttribute('id', 'barGradientHover');
  hoverGradient.setAttribute('x1', '0');
  hoverGradient.setAttribute('y1', '0');
  hoverGradient.setAttribute('x2', '0');
  hoverGradient.setAttribute('y2', '1');
  hoverGradient.innerHTML = `
    <stop offset="0%" stop-color="#f472b6" />
    <stop offset="100%" stop-color="var(--accent-primary)" />
  `;

  defs.appendChild(linearGradient);
  defs.appendChild(hoverGradient);
  cumulativeChart.appendChild(defs);

  const today = new Date();
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last7Days.push({
      dateStr: d.toLocaleDateString('ja-JP'),
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      minutes: 0
    });
  }

  state.focusLogs.forEach(log => {
    const day = last7Days.find(d => d.dateStr === log.date);
    if (day) {
      day.minutes += Number(log.duration || 0);
    }
  });

  const maxMinutes = Math.max(60, ...last7Days.map(d => d.minutes));
  const chartHeight = 110;
  const chartWidth = 300;
  const paddingBottom = 25;
  const paddingLeft = 30;
  const paddingRight = 10;
  const paddingTop = 15;

  const graphHeight = chartHeight - paddingTop;
  const graphWidth = chartWidth - paddingLeft - paddingRight;
  const barWidth = 20;
  const gap = (graphWidth - (barWidth * 7)) / 6;

  const gridLines = [0, 0.5, 1];
  gridLines.forEach(ratio => {
    const y = chartHeight - paddingBottom - (ratio * graphHeight);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.className.baseVal = 'chart-grid-line';
    line.setAttribute('x1', paddingLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', chartWidth - paddingRight);
    line.setAttribute('y2', y);
    cumulativeChart.appendChild(line);

    const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    valText.className.baseVal = 'chart-text';
    valText.setAttribute('x', paddingLeft - 6);
    valText.setAttribute('y', y + 3);
    valText.style.textAnchor = 'end';
    valText.style.fontSize = '8px';
    const hours = ((ratio * maxMinutes) / 60).toFixed(1);
    valText.textContent = `${hours}h`;
    cumulativeChart.appendChild(valText);
  });

  last7Days.forEach((day, idx) => {
    const x = paddingLeft + idx * (barWidth + gap);
    const barHeight = (day.minutes / maxMinutes) * graphHeight;
    const y = chartHeight - paddingBottom - barHeight;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.className.baseVal = 'chart-bar';
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barWidth);
    rect.setAttribute('height', Math.max(2, barHeight));

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${day.dateStr}\n作業時間: ${day.minutes}分 (${(day.minutes / 60).toFixed(1)}時間)`;
    rect.appendChild(title);
    cumulativeChart.appendChild(rect);

    if (day.minutes > 0) {
      const barVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      barVal.className.baseVal = 'chart-value-text';
      barVal.setAttribute('x', x + barWidth / 2);
      barVal.setAttribute('y', y - 4);
      barVal.textContent = day.minutes >= 60 ? `${(day.minutes / 60).toFixed(1)}h` : `${day.minutes}m`;
      cumulativeChart.appendChild(barVal);
    }

    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.className.baseVal = 'chart-text';
    xLabel.setAttribute('x', x + barWidth / 2);
    xLabel.setAttribute('y', chartHeight - 8);
    xLabel.textContent = day.label;
    cumulativeChart.appendChild(xLabel);
  });
}

function renderTaskBreakdown() {
  if (!taskBreakdownContainer) return;
  taskBreakdownContainer.innerHTML = '';

  if (state.focusLogs.length === 0) {
    taskBreakdownContainer.innerHTML = `<div class="no-data-msg">記録がありません。</div>`;
    return;
  }

  const taskTotals = {};
  let grandTotalMinutes = 0;

  state.focusLogs.forEach(log => {
    const tName = log.taskName || '名称未設定タスク';
    taskTotals[tName] = (taskTotals[tName] || 0) + Number(log.duration || 0);
    grandTotalMinutes += Number(log.duration || 0);
  });

  const sortedTasks = Object.entries(taskTotals)
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  sortedTasks.forEach(task => {
    const percentage = grandTotalMinutes > 0 ? (task.minutes / grandTotalMinutes) * 100 : 0;
    const hours = (task.minutes / 60).toFixed(1);

    const row = document.createElement('div');
    row.className = 'task-progress-row';
    row.innerHTML = `
      <div class="task-progress-labels">
        <span class="task-progress-name" title="${escapeHTML(task.name)}">${escapeHTML(task.name)}</span>
        <span class="task-progress-val">${task.minutes}分 (${hours}h)</span>
      </div>
      <div class="task-progress-bar-bg">
        <div class="task-progress-bar-fill" style="width: 0%;"></div>
      </div>
    `;

    taskBreakdownContainer.appendChild(row);

    setTimeout(() => {
      const fillEl = row.querySelector('.task-progress-bar-fill');
      if (fillEl) fillEl.style.width = `${percentage}%`;
    }, 100);
  });
}

// Clear analytic logs handler
const btnClearAllLogs = document.querySelector('.btn-clear-logs[onclick="clearAllLogs()"]');
if (btnClearAllLogs) {
  // Re-bind to avoid inline js evaluation
  const newBtn = btnClearAllLogs.cloneNode(true);
  newBtn.onclick = null;
  newBtn.addEventListener('click', () => {
    if (confirm('すべてのタイマー記録を消去してもよろしいですか？（この操作は取り消せません）')) {
      state.focusLogs = [];
      saveLogsToStorage();
    }
  });
  btnClearAllLogs.replaceWith(newBtn);
}

// Setup Focus Table select-all and delete-selected events
const focusSelectAll = document.getElementById('focus-select-all');
if (focusSelectAll) {
  focusSelectAll.addEventListener('change', (e) => {
    const checked = e.target.checked;
    if (!state.selectedFocusLogIds) state.selectedFocusLogIds = [];
    if (checked) {
      state.selectedFocusLogIds = state.focusLogs.map(l => l.id);
    } else {
      state.selectedFocusLogIds = [];
    }
    // テーブル内のチェックボックスと同期
    document.querySelectorAll('.focus-row-select-check').forEach(chk => {
      chk.checked = checked;
    });
    updateFocusDeleteSelectedButton();
  });
}

const btnFocusDeleteSelected = document.getElementById('btn-focus-delete-selected');
if (btnFocusDeleteSelected) {
  btnFocusDeleteSelected.addEventListener('click', () => {
    const count = state.selectedFocusLogIds ? state.selectedFocusLogIds.length : 0;
    if (count === 0) return;
    if (confirm(`選択した ${count} 件の記録を削除しますか？`)) {
      state.focusLogs = state.focusLogs.filter(l => !state.selectedFocusLogIds.includes(l.id));
      state.selectedFocusLogIds = [];
      saveLogsToStorage();
      if (focusSelectAll) focusSelectAll.checked = false;
      updateFocusDeleteSelectedButton();
    }
  });
}

// ==========================================
// RIGHT PANEL TAB CONTROLS
// ==========================================
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabTarget = btn.getAttribute('data-tab');

    tabButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const targetContent = document.getElementById(tabTarget);
    if (targetContent) targetContent.classList.add('active');

    if (tabTarget === 'tab-analytics') {
      renderAnalytics();
    } else if (tabTarget === 'tab-backlinks') {
      updateBacklinks();
    }
  });
});

// ==========================================
// POMODORO AUTO DUAL SYNC FUNCTIONS
// ==========================================
let timerTargetTableName = localStorage.getItem('timer_target_table_name') || '';

export function updateTimerTargetTableSelect() {
  const select = document.getElementById('timerTargetTableSelect');
  if (!select) return;

  select.innerHTML = '';

  const activeNote = getActiveNote();
  if (!activeNote) {
    select.innerHTML = '<option value="">ノートなし</option>';
    return;
  }

  const dbBlocks = [];
  const collect = (blocksArr) => {
    blocksArr.forEach(b => {
      if (b.type === 'database') {
        dbBlocks.push(b);
      }
      if (b.children && b.children.length > 0) {
        collect(b.children);
      }
    });
  };
  collect(activeNote.blocks);

  if (dbBlocks.length === 0) {
    select.innerHTML = '<option value="">テーブルなし (自動挿入)</option>';
    return;
  }

  dbBlocks.forEach(db => {
    const name = db.properties.tableName || 'データベース';
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (timerTargetTableName === name) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  if (select.value) {
    timerTargetTableName = select.value;
    localStorage.setItem('timer_target_table_name', timerTargetTableName);
  }
}

export function changeTargetTable() {
  const select = document.getElementById('timerTargetTableSelect');
  if (select) {
    timerTargetTableName = select.value;
    localStorage.setItem('timer_target_table_name', timerTargetTableName);
  }
}

// Re-bind target select change event
const timerTargetSelect = document.getElementById('timerTargetTableSelect');
if (timerTargetSelect) {
  timerTargetSelect.addEventListener('change', () => {
    timerTargetTableName = timerTargetSelect.value;
    localStorage.setItem('timer_target_table_name', timerTargetTableName);
  });
}

// ==========================================
// INITIALIZATION CALL
// ==========================================
function initApp() {
  initStorage();
  initLinkMenuSearchEvents();
  initFloatingToolbar(); // 追加
  initSlashMenuSortable();
  setupDragSelection();
  initMobileDataActions();

  // Initialize MindMap
  mindMapInstance = new MindMap();
  window.Notidian.mindMapInstance = mindMapInstance;

  // Re-bind standard events
  if (window.setupBlockBulkActionEvents) window.setupBlockBulkActionEvents();
  if (window.setupBlockCopyPasteShortcuts) window.setupBlockCopyPasteShortcuts();

  // Sidebar actions event registration
  const newNoteBtn = document.getElementById('new-note-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');
  const dailyNoteBtn = document.getElementById('daily-note-btn');
  const templatesBtn = document.getElementById('templates-btn');
  const noteTitleInput = document.getElementById('note-title-input');

  if (newNoteBtn) {
    newNoteBtn.addEventListener('click', () => {
      const newNote = {
        id: 'note-' + generateId(),
        title: '新規ノート',
        updatedAt: Date.now(),
        blocks: [
          { id: generateId(), type: 'p', content: '' }
        ]
      };
      state.notes.push(newNote);
      saveNotesToStorage();
      navigateToNote(newNote.id);

      setTimeout(() => {
        if (noteTitleInput) {
          noteTitleInput.focus();
          noteTitleInput.select();
        }
      }, 100);
    });
  }

  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => {
      const newFolder = {
        id: 'folder-' + generateId(),
        name: '新規フォルダ',
        parentId: null,
        sortIndex: Date.now(),
        updatedAt: Date.now()
      };
      state.folders.push(newFolder);
      saveNotesToStorage();
      renderNoteList();
      showToast(`新規フォルダを作成しました`);
    });
  }

  if (dailyNoteBtn) {
    dailyNoteBtn.addEventListener('click', () => {
      createDailyNote();
    });
  }

  if (templatesBtn) {
    templatesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTemplatesPopover(e);
    });
  }

  // Accordion Toggles
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('open');
    });
  });

  // Pomodoro toggler
  const pomodoroToggle = document.getElementById('pomodoro-toggle');
  if (pomodoroToggle) {
    pomodoroToggle.addEventListener('click', () => {
      pomodoroToggle.classList.toggle('collapsed');
    });
  }

  // Volume Slider
  const volumeSlider = document.getElementById('volumeSlider');
  if (volumeSlider) {
    volumeSlider.value = timerVolume;
    volumeSlider.addEventListener('input', (evt) => {
      setTimerVolume(parseFloat(evt.target.value));
    });
  }

  // Note Manager Load
  renderNoteList();
  renderEditor();
  updateTimerTargetTableSelect();
  initDropboxSync();

  // Search input clear triggers
  const clearSearchBtn = document.getElementById('clear-search-btn');
  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      renderNoteList();
    });

    searchInput.addEventListener('input', () => {
      if (searchInput.value) {
        clearSearchBtn.style.display = 'block';
      } else {
        clearSearchBtn.style.display = 'none';
      }
      renderNoteList(); // Also trigger live search
    });
  }

  // Editor bottom click appends paragraph
  const blockCanvas = document.getElementById('block-canvas');
  if (blockCanvas) {
    let canvasMouseDownX = 0;
    let canvasMouseDownY = 0;

    blockCanvas.addEventListener('mousedown', (e) => {
      canvasMouseDownX = e.clientX;
      canvasMouseDownY = e.clientY;
    });

    blockCanvas.addEventListener('click', (e) => {
      const deltaX = Math.abs(e.clientX - canvasMouseDownX);
      const deltaY = Math.abs(e.clientY - canvasMouseDownY);
      if (deltaX >= 5 || deltaY >= 5) {
        return;
      }

      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) {
        return;
      }

      if (e.target === blockCanvas) {
        const note = getActiveNote();
        if (!note) return;

        if (state.selectedBlockIds && state.selectedBlockIds.length > 0) {
          if (window.clearBlockSelection) window.clearBlockSelection();
          return;
        }

        // クリックされたY座標に基づいて最も近いブロックを探す
        const clickY = e.clientY;
        const wrappers = Array.from(blockCanvas.querySelectorAll('.block-wrapper'));
        
        let closestWrapper = null;
        let isBelowLastBlock = true;

        wrappers.forEach(wrapper => {
          const rect = wrapper.getBoundingClientRect();
          // クリックされた位置がブロックの縦範囲内である場合
          if (clickY >= rect.top && clickY <= rect.bottom) {
            closestWrapper = wrapper;
            isBelowLastBlock = false;
          }
          
          // 最後のブロックの底より上かどうか
          if (clickY < rect.bottom) {
            isBelowLastBlock = false;
          }
        });

        // 特定のブロックの高さ範囲内ならそのブロックにフォーカス
        if (closestWrapper) {
          const content = closestWrapper.querySelector('.block-content');
          if (content) {
            focusBlock(content);
            return;
          }
        }

        // 最後のブロックより上で、隙間をクリックした場合は最も近いブロックにフォーカス
        if (!isBelowLastBlock && wrappers.length > 0) {
          let bestWrapper = null;
          let bestDist = Infinity;
          wrappers.forEach(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            const dist = Math.abs(clickY - (rect.top + rect.height / 2));
            if (dist < bestDist) {
              bestDist = dist;
              bestWrapper = wrapper;
            }
          });
          if (bestWrapper) {
            const content = bestWrapper.querySelector('.block-content');
            if (content) {
              focusBlock(content);
              return;
            }
          }
        }

        // 最後のブロックより下（本当に最下部の余白）をクリックした場合は従来の新規作成・フォーカス処理
        const lastBlock = note.blocks[note.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'p' && (!lastBlock.content || lastBlock.content.trim() === '')) {
          const el = document.querySelector(`.block-content[data-id="${lastBlock.id}"]`);
          if (el) focusBlock(el);
          return;
        }

        pushHistory();
        const newBlock = { id: generateId(), type: 'p', content: '' };
        note.blocks.push(newBlock);
        saveNotesToStorage();
        renderEditor();

        setTimeout(() => {
          const el = document.querySelector(`.block-content[data-id="${newBlock.id}"]`);
          if (el) focusBlock(el);
        }, 50);
      }
    });
  }

  // Sidebar dragover and drops
  if (noteListContainer) {
    noteListContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.target === noteListContainer || e.target.classList.contains('no-data-msg')) {
        state.dropTargetSidebarId = null;
        showSidebarPathPreview(`移動先: 最上位 (ルート階層)`);
      }
    });

    noteListContainer.addEventListener('drop', (e) => {
      if (e.target === noteListContainer || e.target.classList.contains('no-data-msg')) {
        e.preventDefault();
        hideSidebarPathPreview();

        const draggedId = state.draggedSidebarId;
        const draggedType = state.draggedSidebarType;

        if (!draggedId) return;

        if (draggedType === 'note') {
          const note = state.notes.find(n => n.id === draggedId);
          if (note) {
            note.folderId = null;
            note.updatedAt = Date.now();
          }
        } else if (draggedType === 'folder') {
          const folder = state.folders.find(f => f.id === draggedId);
          if (folder) {
            folder.parentId = null;
            folder.updatedAt = Date.now();
          }
        }
        saveNotesToStorage();
        renderNoteList();
      }
    });
  }

  // Focus and analytics init
  loadPomodoroData();
  renderPomodoro();
  initFocusTableSort();
  renderAnalytics();
  updateBacklinks();
  updateHistoryButtons();

  // Navigation history buttons click bindings
  const backBtn = document.getElementById('btn-history-back');
  const forwardBtn = document.getElementById('btn-history-forward');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (state.historyIndex > 0) {
        state.historyIndex--;
        const prevNoteId = state.noteHistory[state.historyIndex];
        navigateToNote(prevNoteId, false);
      }
    });
  }
  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      if (state.historyIndex < state.noteHistory.length - 1) {
        state.historyIndex++;
        const nextNoteId = state.noteHistory[state.historyIndex];
        navigateToNote(nextNoteId, false);
      }
    });
  }

  // IME input helpers
  window.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  window.addEventListener('compositionend', () => {
    state.isComposing = false;
  });

  // Global drag listeners
  const clearDragState = () => {
    state.draggedBlockId = null;
    state.draggedSidebarId = null;
    if (window.potentialDragStart !== undefined) window.potentialDragStart = false;
    if (window.isDragSelecting !== undefined) window.isDragSelecting = false;
  };
  window.addEventListener('mouseup', clearDragState);
  window.addEventListener('dragend', clearDragState);

  // Drag wheel scrolls
  window.addEventListener('wheel', (e) => {
    if (state.draggedBlockId || state.draggedSidebarId) {
      const editorArea = document.querySelector('.editor-area');
      if (editorArea) {
        editorArea.scrollTop += e.deltaY;
        editorArea.scrollLeft += e.deltaX;
      }
    }
  }, { passive: true });



  // Global keydown listeners for Undo / Redo
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });

  // Expose internal functions to window for index.html inline event handler attributes (onclick, onchange etc.)
  window.startTimer = startTimer;
  window.pauseTimer = pauseTimer;
  window.stopTimer = stopTimer;
  window.addSet = addSet;
  window.addSchedule = addSchedule;
  window.deleteSet = deleteSet;
  window.savePreset = savePreset;
  window.loadPreset = loadPreset;
  window.deletePreset = deletePreset;
  window.changeTargetTable = changeTargetTable;

  // --- サイドバー折りたたみ機能の初期化 ---
  const leftSidebar = document.querySelector('.sidebar-left');
  const rightSidebar = document.querySelector('.sidebar-right');
  const leftToggle = document.getElementById('sidebar-left-toggle');
  const rightToggle = document.getElementById('sidebar-right-toggle');
  const appContainer = document.querySelector('.app-container');

  // 保存されている状態の復元
  const isLeftCollapsed = localStorage.getItem('notidian_left_sidebar_collapsed') === 'true';
  const isRightCollapsed = localStorage.getItem('notidian_right_sidebar_collapsed') === 'true';

  if (isLeftCollapsed && leftSidebar && appContainer) {
    leftSidebar.classList.add('collapsed');
    appContainer.classList.add('left-collapsed');
    if (leftToggle) {
      leftToggle.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
      leftToggle.title = 'サイドバーを開く';
    }
  }

  if (isRightCollapsed && rightSidebar && appContainer) {
    rightSidebar.classList.add('collapsed');
    appContainer.classList.add('right-collapsed');
    if (rightToggle) {
      rightToggle.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
      rightToggle.title = 'サイドバーを開く';
    }
  }

  if (leftToggle && leftSidebar && appContainer) {
    leftToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = leftSidebar.classList.toggle('collapsed');
      appContainer.classList.toggle('left-collapsed', collapsed);
      localStorage.setItem('notidian_left_sidebar_collapsed', collapsed);
      
      leftToggle.innerHTML = collapsed 
        ? '<i class="fa-solid fa-chevron-right"></i>' 
        : '<i class="fa-solid fa-chevron-left"></i>';
      leftToggle.title = collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる';

      // サイドバー開閉時にポップオーバーを閉じる
      document.querySelectorAll('.db-floating-popover').forEach(p => p.remove());
    });
  }

  if (rightToggle && rightSidebar && appContainer) {
    rightToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = rightSidebar.classList.toggle('collapsed');
      appContainer.classList.toggle('right-collapsed', collapsed);
      localStorage.setItem('notidian_right_sidebar_collapsed', collapsed);

      rightToggle.innerHTML = collapsed 
        ? '<i class="fa-solid fa-chevron-left"></i>' 
        : '<i class="fa-solid fa-chevron-right"></i>';
      rightToggle.title = collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる';
      
      // サイドバー開閉時にポップオーバーを閉じる
      document.querySelectorAll('.db-floating-popover').forEach(p => p.remove());

      // マインドマップ等のリサイズイベントを発火してCanvasサイズを追従させる
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 300);
    });
  }

  // ウィンドウリサイズ時にもポップオーバーを閉じる
  window.addEventListener('resize', () => {
    document.querySelectorAll('.db-floating-popover').forEach(p => p.remove());
  });

  // --- 左右サイドバーのタブ切り替え機能 ---
  function initSidebarTabs() {
    // 1. 左サイドバーのタブ設定
    const leftTabBtns = document.querySelectorAll('#left-sidebar-tabs .sidebar-tab-btn');
    const leftTabContents = document.querySelectorAll('.sidebar-left .sidebar-tab-content');
    const savedLeftTab = localStorage.getItem('notidian_active_left_tab') || 'tab-notes';

    const switchLeftTab = (tabId) => {
      leftTabBtns.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      leftTabContents.forEach(content => {
        if (content.id === tabId) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
      localStorage.setItem('notidian_active_left_tab', tabId);
    };

    leftTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        switchLeftTab(tabId);
      });
    });
    switchLeftTab(savedLeftTab);

    // 2. 右サイドバーのタブ設定
    const rightTabBtns = document.querySelectorAll('#right-sidebar-tabs .sidebar-tab-btn');
    const rightTabContents = document.querySelectorAll('.sidebar-right .sidebar-tab-content');
    const savedRightTab = localStorage.getItem('notidian_active_right_tab') || 'tab-analytics';

    const switchRightTab = (tabId) => {
      rightTabBtns.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      rightTabContents.forEach(content => {
        if (content.id === tabId) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
      localStorage.setItem('notidian_active_right_tab', tabId);

      // 分析・マップタブへの切り替え時の処理
      if (tabId === 'tab-analytics') {
        if (typeof renderAnalytics === 'function') {
          renderAnalytics();
        }
      } else if (tabId === 'tab-mindmap') {
        if (mindMapInstance) {
          setTimeout(() => {
            mindMapInstance.resizeCanvas();
            mindMapInstance.triggerSimulation();
          }, 50);
        }
      }
    };

    rightTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        switchRightTab(tabId);
      });
    });
    switchRightTab(savedRightTab);
  }

  initSidebarTabs();
}

// Race Condition 対策を施した確実な初期化実行
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
