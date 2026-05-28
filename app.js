/* ==========================================
   Notidian Core Application Engine
   Combining Notion Blocks, Obsidian Links & Pomodoro
   ========================================== */

// Helper: Generate UUID/Unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Global Application State
const state = {
  notes: [],
  folders: [],
  collapsedFolders: [], // IDs of folders that are collapsed
  activeNoteId: null,
  focusLogs: [],
  draggedBlockId: null,
  draggedBlockType: null,
  dropTargetBlockId: null,
  dropLocation: null, // 'top' | 'bottom' | 'left' | 'right'
  activeFocusedBlockId: null,
  slashMenuOpen: false,
  slashMenuActiveIndex: 0,
  linkMenuOpen: false,
  linkMenuActiveIndex: 0,
  linkTriggerPos: null, // { index, type: '[[' | '「「' }
  noteHistory: [],
  historyIndex: -1,
  draggedSidebarId: null, // ID of note or folder being dragged in sidebar
  draggedSidebarType: null, // 'note' | 'folder'
  dropTargetSidebarId: null // ID of folder target being hovered
};

// ==========================================
// UNDO / REDO HISTORY ENGINE
// ==========================================
const historyState = {
  undoStack: [],
  redoStack: [],
  isApplying: false
};

function pushHistory() {
  if (historyState.isApplying) return;

  const stateCopy = JSON.stringify(state.notes);

  // 直近の履歴と同じなら重複保存しない
  if (historyState.undoStack.length > 0 && historyState.undoStack[historyState.undoStack.length - 1] === stateCopy) {
    return;
  }

  historyState.undoStack.push(stateCopy);

  // 履歴の上限は50世代とする
  if (historyState.undoStack.length > 50) {
    historyState.undoStack.shift();
  }

  // 新規操作なのでRedoスタックはクリア
  historyState.redoStack = [];
}

function undo() {
  if (historyState.undoStack.length <= 1) return; // 初期状態のみ、または空の場合は戻せない

  historyState.isApplying = true;

  // 現在の状態をRedoスタックへ移動
  const currentState = historyState.undoStack.pop();
  historyState.redoStack.push(currentState);

  // 1つ前の状態を適用
  const prevState = historyState.undoStack[historyState.undoStack.length - 1];
  state.notes = JSON.parse(prevState);

  // ローカルストレージに保存し、エディタを再描画
  localStorage.setItem('notidian_notes', JSON.stringify(state.notes));
  const saveStatus = document.getElementById('save-status');
  if (saveStatus) {
    saveStatus.innerHTML = '';
    saveStatus.style.opacity = '1';
    setTimeout(() => {
      saveStatus.style.opacity = '0.7';
    }, 1500);
  }
  renderNoteList();
  renderEditor();

  historyState.isApplying = false;
}

function redo() {
  if (historyState.redoStack.length === 0) return;

  historyState.isApplying = true;

  // Redoスタックから取り出して適用
  const nextState = historyState.redoStack.pop();
  historyState.undoStack.push(nextState);

  state.notes = JSON.parse(nextState);

  // ローカルストレージに保存し、エディタを再描画
  localStorage.setItem('notidian_notes', JSON.stringify(state.notes));
  const saveStatus = document.getElementById('save-status');
  if (saveStatus) {
    saveStatus.innerHTML = '';
    saveStatus.style.opacity = '1';
    setTimeout(() => {
      saveStatus.style.opacity = '0.7';
    }, 1500);
  }
  renderNoteList();
  renderEditor();

  historyState.isApplying = false;
}

// Initial Sample Notes
const sampleNotes = [
  {
    id: 'note-welcome',
    title: 'ようこそ Notidian へ 🚀',
    updatedAt: Date.now(),
    blocks: [
      { id: generateId(), type: 'h1', content: 'ようこそ！ Notion × Obsidian × Pomodoro' },
      { id: generateId(), type: 'p', content: 'Notidian（ノティディアン）は、**Notionの直感的なブロック編集・ドラッグカラム**と、**Obsidianの強力なローカル双方向リンク（Wikiリンク）**、そして**ポモドーロタイマー**を融合させた、ローカルファーストの先進的なノートアプリです。' },
      { id: generateId(), type: 'h2', content: '✨ 主な機能と使い方' },
      {
        id: generateId(),
        type: 'toggle',
        content: '💡 Notionスタイルのトグルリスト（クリックして開閉）',
        properties: { open: true },
        children: [
          { id: generateId(), type: 'p', content: 'トグルブロックの中には、他のテキストブロックやリスト、ToDoリストを自由にネストできます。' },
          { id: generateId(), type: 'todo', content: 'ドラッグ＆ドロップでこの中に他のブロックを移動することも可能です。', properties: { checked: true } }
        ]
      },
      {
        id: generateId(),
        type: 'columns',
        content: '',
        children: [
          {
            id: generateId(),
            type: 'column',
            children: [
              { id: generateId(), type: 'h2', content: '👈 左側のカラム' },
              { id: generateId(), type: 'p', content: 'ブロックをドラッグして、他のブロックの左右の端に近づけてドロップすると、このようにカラム（横並び列）を作ることができます！' }
            ]
          },
          {
            id: generateId(),
            type: 'column',
            children: [
              { id: generateId(), type: 'h2', content: '👉 右側のカラム' },
              { id: generateId(), type: 'todo', content: '列幅は自動調整され、Notionのように美しく並びます。', properties: { checked: false } }
            ]
          }
        ]
      },
      { id: generateId(), type: 'p', content: '次は、日本語入力でも瞬時にリンクできる双方向リンクについて学びましょう。右にあるリンクをクリックしてみてください： [[双方向リンクと和文カッコの機能]]' }
    ]
  },
  {
    id: 'note-links',
    title: '双方向リンクと和文カッコの機能',
    updatedAt: Date.now() - 10000,
    blocks: [
      { id: generateId(), type: 'h1', content: '双方向リンク（Wikiリンク）の革新' },
      { id: generateId(), type: 'p', content: 'Obsidianのように、ノート間で自由にリンクを作ることができます。本アプリは、日本語キーボードでの入力を劇的にスムーズにする機能を持っています。' },
      { id: generateId(), type: 'h2', content: '✍️ リンクの作り方' },
      { id: generateId(), type: 'bullet', content: '半角二重カッコ `[[` と入力すると、既存ノートの補完ポップアップが表示されます。' },
      { id: generateId(), type: 'bullet', content: 'さらに、日本語全角カッコ 「「「」」 でも作成できます！「「 と入力すると同様に補完が動き、入力後は [[ノート名]] または 「「ノート名」」 の両方が同じ双方向リンクとして認識されます。' },
      { id: generateId(), type: 'p', content: 'リンクの例： [[ようこそ Notidian へ 🚀]] や 「「ポモドーロと学習ログの連携」」' },
      { id: generateId(), type: 'h2', content: '🔴 存在しないノートへのリンク' },
      { id: generateId(), type: 'p', content: '存在しないノート名で [[新規アイデア]] や 「「未作成のタスクリスト」」 と書くと、ピンク色の破線リンクになります。これをクリックすると、**その名前のノートが自動的に新規作成され、そこに瞬時に移動**します！' },
      { id: generateId(), type: 'p', content: '右パネルの「バックリンク」タブを開くと、現在どのノートからこのノートがリンクされているか（参照元）を確認できます。' }
    ]
  },
  {
    id: 'note-pomodoro',
    title: 'ポモドーロと学習ログの連携',
    updatedAt: Date.now() - 20000,
    blocks: [
      { id: generateId(), type: 'h1', content: '⏱️ ポモドーロタイマーと学習分析の連携' },
      { id: generateId(), type: 'p', content: '左サイドバー下部には、ドラッグ順序入れ替え可能な本格的ポモドーロタイマーが統合されています！' },
      { id: generateId(), type: 'h2', content: '🔄 自動保存とグラフ化の流れ' },
      { id: generateId(), type: 'todo', content: 'タイマーのスケジュールで「追加」を押し、タスクを選択します。（テスト用に10秒のセットを作るのがおすすめです！）', properties: { checked: false } },
      { id: generateId(), type: 'todo', content: 'タイマーを「開始」します。作業時間が終了すると美しくチャイムが鳴り、自動的に右パネルの「ポモドーロ分析」データベーステーブルにタスク名と時間が記録されます。', properties: { checked: false } },
      { id: generateId(), type: 'todo', content: '保存されたタスク時間は、過去7日間の「累計集中時間」棒グラフ（SVG）や、タスク別の比率メーターとして動的に可視化されます！', properties: { checked: false } },
      { id: generateId(), type: 'p', content: '記録されたデータテーブルは、タスク名や時間をその場でダブルクリック（またはクリック）して編集・削除可能です。Notionのようなデータベース感覚で学習状況を維持できます。' }
    ]
  }
];

// ==========================================
// 1. DATA STORES / PERSISTENCE
// ==========================================

function initStorage() {
  // Load Focus Logs
  try {
    const savedLogs = localStorage.getItem('notidian_focus_logs');
    if (savedLogs) {
      state.focusLogs = JSON.parse(savedLogs);
    }
  } catch (e) {
    console.error("Failed to parse focus logs:", e);
    state.focusLogs = [];
  }

  if (!state.focusLogs || !Array.isArray(state.focusLogs)) {
    // Generate dummy logs for the past few days to make the SVG chart look amazing instantly!
    const today = new Date();
    const dummyLogs = [];
    const tasks = ['アプリ開発', 'ブログ執筆', '読書', 'デザイン調整'];
    for (let i = 5; i >= 1; i--) {
      const pastDate = new Date();
      pastDate.setDate(today.getDate() - i);
      const dateString = pastDate.toLocaleDateString('ja-JP');

      // Add random logs
      const numSessions = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < numSessions; j++) {
        dummyLogs.push({
          id: 'dummy-' + i + '-' + j,
          taskName: tasks[Math.floor(Math.random() * tasks.length)],
          date: dateString,
          timestamp: pastDate.getTime(),
          duration: Math.floor(Math.random() * 3) * 15 + 25, // 25, 40, 55 mins
          status: '完了'
        });
      }
    }
    state.focusLogs = dummyLogs;
    try {
      localStorage.setItem('notidian_focus_logs', JSON.stringify(dummyLogs));
    } catch (e) {
      console.error("Failed to save dummy logs:", e);
    }
  }

  // Load Notes
  try {
    const savedNotes = localStorage.getItem('notidian_notes');
    if (savedNotes) {
      state.notes = JSON.parse(savedNotes);
    }
  } catch (e) {
    console.error("Failed to parse notes:", e);
    state.notes = null;
  }

  if (!state.notes || !Array.isArray(state.notes) || state.notes.length === 0) {
    state.notes = sampleNotes;
    try {
      localStorage.setItem('notidian_notes', JSON.stringify(sampleNotes));
    } catch (e) {
      console.error("Failed to save sample notes:", e);
    }
  }

  // Load Active Note Id
  const savedActiveId = localStorage.getItem('notidian_active_note_id');
  if (savedActiveId && Array.isArray(state.notes) && state.notes.some(n => n.id === savedActiveId)) {
    state.activeNoteId = savedActiveId;
  } else if (Array.isArray(state.notes) && state.notes.length > 0) {
    state.activeNoteId = state.notes[0].id;
  }

  if (state.activeNoteId) {
    state.noteHistory = [state.activeNoteId];
    state.historyIndex = 0;
  }

  // Load Folders
  try {
    const savedFolders = localStorage.getItem('notidian_folders');
    if (savedFolders) {
      state.folders = JSON.parse(savedFolders);
    }
  } catch (e) {
    console.error("Failed to parse folders:", e);
    state.folders = [];
  }
  
  if (!state.folders || !Array.isArray(state.folders)) {
    state.folders = [];
  }

  // フォルダの並び（sortIndex）をマイグレーション
  state.folders.forEach((folder, idx) => {
    if (folder.sortIndex === undefined) {
      folder.sortIndex = folder.updatedAt || (Date.now() - idx * 1000);
    }
  });

  // Load Collapsed Folders
  try {
    const savedCollapsed = localStorage.getItem('notidian_collapsed_folders');
    if (savedCollapsed) {
      state.collapsedFolders = JSON.parse(savedCollapsed);
    }
  } catch (e) {
    console.error("Failed to parse collapsed folders:", e);
    state.collapsedFolders = [];
  }

  if (!state.collapsedFolders || !Array.isArray(state.collapsedFolders)) {
    state.collapsedFolders = [];
  }

  // Load Daily Folder Id
  state.dailyFolderId = localStorage.getItem('notidian_daily_folder_id') || null;

  // Notes properties migration & auto-repair
  state.notes.forEach((note, idx) => {
    if (note.folderId === undefined) note.folderId = null;
    if (note.isTemplate === undefined) note.isTemplate = false;
    if (note.templateSourceId === undefined) note.templateSourceId = null;
    if (note.isDailyDefault === undefined) note.isDailyDefault = false;
    if (note.isFavorite === undefined) note.isFavorite = false;
    if (note.sortIndex === undefined) {
      note.sortIndex = note.updatedAt || (Date.now() - idx * 1000);
    }

    // データベースブロックの修復 & マイグレーション
    if (note.blocks && Array.isArray(note.blocks)) {
      const repairBlocks = (blocksArr) => {
        blocksArr.forEach(b => {
          if (b.type === 'database') {
            b.properties = b.properties || {};
            b.properties.columns = b.properties.columns || [];
            b.properties.rows = b.properties.rows || [];
            b.properties.views = b.properties.views || [];
            
            // ビューの修復
            b.properties.views.forEach(v => {
              if (v.type === 'chart') {
                v.chartTimeRange = v.chartTimeRange || 'all';
                v.chartDateGroup = v.chartDateGroup || 'month';
                v.chartRenderType = v.chartRenderType || 'split';
                v.chartTagMode = v.chartTagMode || 'all';
                
                // 複数選択の古いプロパティ (chartSelectedTags) があれば、最初の要素を単一タグに移行
                if (v.chartSelectedTags && Array.isArray(v.chartSelectedTags)) {
                  v.chartSelectedTag = v.chartSelectedTags[0] || '';
                  delete v.chartSelectedTags;
                }
                
                if (v.chartSelectedTag === undefined) {
                  v.chartSelectedTag = '';
                }
              }
            });
          }
          if (b.children && Array.isArray(b.children)) {
            repairBlocks(b.children);
          }
        });
      };
      repairBlocks(note.blocks);
    }
  });

  // 初期の履歴状態を保存
  try {
    historyState.undoStack = [JSON.stringify(state.notes)];
  } catch (e) {
    console.error("Failed to save undo stack:", e);
    historyState.undoStack = [];
  }
}

function saveNotesToStorage() {
  pushHistory();
  localStorage.setItem('notidian_notes', JSON.stringify(state.notes));
  localStorage.setItem('notidian_folders', JSON.stringify(state.folders));
  localStorage.setItem('notidian_collapsed_folders', JSON.stringify(state.collapsedFolders));
  localStorage.setItem('notidian_daily_folder_id', state.dailyFolderId || '');
  const saveStatus = document.getElementById('save-status');
  if (saveStatus) {
    saveStatus.innerHTML = '';
    saveStatus.style.opacity = '1';
    setTimeout(() => {
      saveStatus.style.opacity = '0.7';
    }, 1500);
  }
}

function saveLogsToStorage() {
  localStorage.setItem('notidian_focus_logs', JSON.stringify(state.focusLogs));
  renderAnalytics();
}

// ==========================================
// 2. WIKILINKS PARSER & AUTOCOMPLETE
// ==========================================

// Regex for wiki links
const WIKI_LINK_REGEX = /\[\[(.*?)\]\]/g;
const JP_LINK_REGEX = /「「(.*?)」」/g;

function parseWikiLinks(htmlContent) {
  if (!htmlContent) return '';

  let parsed = htmlContent;

  // Helper to replace matching links
  const replaceLink = (match, noteTitle) => {
    const trimmedTitle = noteTitle.trim();
    if (!trimmedTitle) return match;

    const exists = state.notes.some(note => note.title.toLowerCase() === trimmedTitle.toLowerCase());
    const className = exists ? 'wiki-link' : 'wiki-link wiki-link-new';
    const tooltip = exists ? 'ノートを開く' : 'ノートを自動作成して開く';

    return `<span class="${className}" data-target="${escapeHTML(trimmedTitle)}" title="${tooltip}" contenteditable="false">${escapeHTML(noteTitle)}</span>`;
  };

  parsed = parsed.replace(WIKI_LINK_REGEX, replaceLink);
  parsed = parsed.replace(JP_LINK_REGEX, replaceLink);

  return parsed;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getActiveNote() {
  return state.notes.find(n => n.id === state.activeNoteId);
}

// ==========================================
// 3. RECUSIVE EDITOR RENDERER
// ==========================================

const blockCanvas = document.getElementById('block-canvas');

function renderEditor() {
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
        renderNoteList();
      });
      titleWrapper.replaceChild(newFavBtn, favBtn);
    } else {
      favBtn.onclick = (e) => {
        e.stopPropagation();
        note.isFavorite = !note.isFavorite;
        saveNotesToStorage();
        renderEditor();
        renderNoteList();
      };
    }
  }

  // Clear canvas
  blockCanvas.innerHTML = '';

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
  updateBacklinks();
  renderNoteLinksPanel();
  updateTimerTargetTableSelect();

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
          overwriteTemplateFromActiveDaily();
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
function createBlockDOM(block, parentBlock = null) {
  const blockWrapper = document.createElement('div');
  blockWrapper.className = `block-wrapper block-${block.type}-wrapper`;
  blockWrapper.setAttribute('data-id', block.id);

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
        if (nextEl) nextEl.focus();
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
  contentDiv.contentEditable = 'true';
  contentDiv.setAttribute('data-id', block.id);

  // Set placeholders based on block type
  let placeholder = '「/」または「￥」でコマンドを入力...';
  if (block.type === 'h1') placeholder = '見出し 1';
  if (block.type === 'h2') placeholder = '見出し 2';
  contentDiv.setAttribute('placeholder', placeholder);

  // Set rendered text (parse links if not active/focused)
  if (state.activeFocusedBlockId === block.id) {
    contentDiv.textContent = block.content;
  } else {
    contentDiv.innerHTML = parseWikiLinks(escapeHTML(block.content));
  }

  // Listeners
  contentDiv.addEventListener('focus', () => {
    state.activeFocusedBlockId = block.id;
    // When focused, show raw text with wiki links raw brackets so it is editable
    contentDiv.textContent = block.content;
    // Position cursor at end (or keep current if focused naturally)
  });

  contentDiv.addEventListener('blur', () => {
    // Save content to state
    const textVal = contentDiv.textContent;
    const oldContent = block.content;
    block.content = textVal;

    state.activeFocusedBlockId = null;

    // Reparse WikiLinks and render HTML
    contentDiv.innerHTML = parseWikiLinks(escapeHTML(block.content));

    if (oldContent !== textVal) {
      saveNotesToStorage();
      updateBacklinks();
    }
  });

  contentDiv.addEventListener('input', (e) => {
    block.content = contentDiv.textContent;

    // Check slash command trigger "/"
    handleSlashCommandTrigger(contentDiv, e);

    // Check WikiLink autocomplete trigger "[[" or "「「"
    handleWikiLinkTrigger(contentDiv, e);
  });

  contentDiv.addEventListener('keydown', (e) => {
    handleEditorKeydown(e, block, contentDiv);
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
    if (el) el.focus();
  }, 50);
}

function handleEditorKeydown(e, block, contentDiv) {
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
        if (nextEl) nextEl.focus();
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
      if (nextEl) nextEl.focus();
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
            el.focus();
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
              elToFocus.focus();
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
      allEditable[activeIdx - 1].focus();
    }
  }
  if (e.key === 'ArrowDown' && !state.slashMenuOpen && !state.linkMenuOpen) {
    const allEditable = Array.from(document.querySelectorAll('.block-content'));
    const activeIdx = allEditable.findIndex(el => el.getAttribute('data-id') === block.id);
    if (activeIdx < allEditable.length - 1) {
      e.preventDefault();
      allEditable[activeIdx + 1].focus();
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
              el.focus();
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
              el.focus();
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
function uncolumn(columnsBlockId) {
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

    // Only allow drag-start if clicking handle
    handle.addEventListener('mousedown', () => {
      wrapper.setAttribute('draggable', 'true');
    });
    handle.addEventListener('mouseup', () => {
      wrapper.removeAttribute('draggable');
    });

    wrapper.addEventListener('dragstart', (e) => {
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

      // Column triggers: Left 10% or Right 10% (ドラッグ中のブロックがカラムコンテナでない場合のみ)
      if (isLeftRightAllowed && xRatio < 0.1) {
        state.dropLocation = 'left';
        showDropIndicator('left', rect);
      } else if (isLeftRightAllowed && xRatio > 0.9) {
        state.dropLocation = 'right';
        showDropIndicator('right', rect);
      } else {
        // Vertical triggers
        // もしターゲットがトグルで、かつ isLeftRightAllowed が false（内側を意図）の場合
        if (found && found.block.type === 'toggle' && !isLeftRightAllowed && contentRect) {
          if (yRatio < 0.3) {
            state.dropLocation = 'top';
            showDropIndicator('top', rect);
          } else {
            state.dropLocation = 'inside';
            
            // インジケータはトグルのすぐ下、インデントされた位置に表示してネストされることを明示
            const indicator = document.getElementById('drop-indicator-bottom');
            if (indicator) {
              indicator.style.left = `${contentRect.left}px`;
              indicator.style.top = `${contentRect.bottom - 2}px`;
              indicator.style.width = `${contentRect.width}px`;
              indicator.style.display = 'block';
            }
          }
        } else {
          if (yRatio < 0.5) {
            state.dropLocation = 'top';
            showDropIndicator('top', rect);
          } else {
            state.dropLocation = 'bottom';
            showDropIndicator('bottom', rect);
          }
        }
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

    // Click trigger
    li.onmousedown = (e) => {
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

function selectSlashMenuItem() {
  const activeLi = slashMenuList.querySelectorAll('li')[state.slashMenuActiveIndex];
  const newType = activeLi.getAttribute('data-type');

  const note = getActiveNote();
  if (!note) return;

  const activeContentDiv = document.querySelector(`.block-content[data-id="${state.activeFocusedBlockId}"]`);
  if (!activeContentDiv) return;

  const found = findBlockAndParent(note.blocks, state.activeFocusedBlockId);
  if (!found) return;

  // Strip trigger from end of content
  let text = activeContentDiv.textContent;
  if (text.endsWith('/') || text.endsWith('／') || text.endsWith('\\') || text.endsWith('￥') || text.endsWith('¥')) {
    text = text.substring(0, text.length - 1);
  }

  // Update block type
  found.block.type = newType;
  found.block.content = text;

  // Add structural default properties
  if (newType === 'todo') found.block.properties = { checked: false };
  if (newType === 'toggle') found.block.properties = { open: true, children: [] };
  if (newType === 'callout') {
    found.block.properties = { emoji: '💡', color: 'purple' };
    found.block.content = 'ここに重要な注記やヒントを入力します。';
  }
  if (newType === 'divider') {
    found.block.content = '';
  }
  if (newType === 'database') {
    found.block.properties = {
      columns: [
        { id: 'col-title', name: 'タスク名', type: 'text', width: 220 },
        { id: 'col-status', name: 'ステータス', type: 'status', width: 120, options: [
          { id: 'opt-todo', name: '未着手', color: 'gray' },
          { id: 'opt-progress', name: '進行中', color: 'blue' },
          { id: 'opt-complete', name: '完了', color: 'green' }
        ] },
        { id: 'col-date', name: '日付', type: 'date', width: 140 },
        { id: 'col-number', name: '数値', type: 'number', width: 120, calc: 'sum' }
      ],
      rows: [
        { 'col-title': 'ダッシュボードの設計', 'col-status': '進行中', 'col-date': '2026-05-23', 'col-number': 8 },
        { 'col-title': '仕様書の作成', 'col-status': '未着手', 'col-date': '2026-05-24', 'col-number': 5 }
      ],
      views: [
        { id: 'view-all', name: 'すべて', filters: [] },
        { id: 'view-progress', name: '進行中', filters: [ { id: 'f-progress', columnId: 'col-status', value: '進行中' } ] },
        { id: 'view-complete', name: '完了', filters: [ { id: 'f-complete', columnId: 'col-status', value: '完了' } ] }
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
      el.focus();
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

// ==========================================
// 7. WIKILINKS AUTOCOMPLETE ENGINE (「「 & [[)
// ==========================================

const linkMenu = document.getElementById('link-menu');
const linkMenuList = document.getElementById('link-menu-list');

function handleWikiLinkTrigger(contentDiv, e) {
  const text = contentDiv.textContent;
  const cursorIdx = getCaretCharacterOffsetWithin(contentDiv);
  const leftText = text.substring(0, cursorIdx);

  // Search if we just typed [[ or 「「
  const openBracketIdx = leftText.lastIndexOf('[[');
  const openJpBracketIdx = leftText.lastIndexOf('「「');

  let triggerIdx = -1;
  let triggerType = '';

  if (openBracketIdx !== -1 && openBracketIdx >= openJpBracketIdx) {
    triggerIdx = openBracketIdx;
    triggerType = '[[';
  } else if (openJpBracketIdx !== -1 && openJpBracketIdx >= openBracketIdx) {
    triggerIdx = openJpBracketIdx;
    triggerType = '「「';
  }

  // Check if brackets are closed
  if (triggerIdx !== -1) {
    const searchString = leftText.substring(triggerIdx + 2);

    // If closed already, close popup
    if (searchString.includes(']]') || searchString.includes('」」')) {
      closeLinkMenu();
      return;
    }

    state.linkMenuOpen = true;
    state.linkTriggerPos = { index: triggerIdx, type: triggerType, search: searchString };

    // Position popup
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    linkMenu.style.left = `${rect.left}px`;
    linkMenu.style.top = `${rect.bottom + window.scrollY + 6}px`;
    linkMenu.style.display = 'block';

    renderLinkMenuList(searchString);
  } else {
    closeLinkMenu();
  }
}

function renderLinkMenuList(searchQuery) {
  linkMenuList.innerHTML = '';

  // Filter notes
  const filtered = state.notes.filter(n =>
    n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'no-match';
    li.style.color = 'var(--text-muted)';
    li.style.cursor = 'default';
    li.textContent = `「${searchQuery}」の新規ノートを作成`;
    li.onmousedown = (e) => {
      e.preventDefault();
      selectLinkMenuItem();
    };
    linkMenuList.appendChild(li);
  } else {
    filtered.forEach((note, idx) => {
      const li = document.createElement('li');
      li.textContent = note.title;
      li.setAttribute('data-title', note.title);
      if (idx === state.linkMenuActiveIndex) {
        li.className = 'active';
      }
      li.onmousedown = (e) => {
        e.preventDefault();
        state.linkMenuActiveIndex = idx;
        selectLinkMenuItem();
      };
      linkMenuList.appendChild(li);
    });
  }

  state.linkMenuActiveIndex = Math.min(state.linkMenuActiveIndex, Math.max(0, filtered.length - 1));
}

function navigateLinkMenu(dir) {
  const items = linkMenuList.querySelectorAll('li:not(.no-match)');
  if (items.length === 0) return;
  state.linkMenuActiveIndex = (state.linkMenuActiveIndex + dir + items.length) % items.length;

  // Update visual classes
  items.forEach((li, idx) => {
    if (idx === state.linkMenuActiveIndex) {
      li.classList.add('active');
      li.scrollIntoView({ block: 'nearest' });
    } else {
      li.classList.remove('active');
    }
  });
}

function selectLinkMenuItem() {
  const activeContentDiv = document.querySelector(`.block-content[data-id="${state.activeFocusedBlockId}"]`);
  if (!activeContentDiv) return;

  const activeLi = linkMenuList.querySelector('li.active');

  // If no match found, create link for search name
  let noteTitle = '';
  if (activeLi) {
    noteTitle = activeLi.getAttribute('data-title');
  } else {
    // Treat the typed search string as the link
    noteTitle = state.linkTriggerPos.search;
  }

  const completedLink = `[[${noteTitle}]]`;

  // Selection と Range を使用して、現在の入力箇所（トリガー開始位置からキャレットまで）を正確に置換する
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const endNode = range.endContainer;
    const endOffset = range.endOffset;

    // 「[[」または「「「」と検索文字を合わせた文字数分だけ左に戻る
    const backLength = 2 + state.linkTriggerPos.search.length;

    if (endNode.nodeType === Node.TEXT_NODE && endOffset >= backLength) {
      // 最も一般的なケース：同じテキストノード内で完結する場合
      range.setStart(endNode, endOffset - backLength);
    } else {
      // 複数のノードにまたがる、またはIMEで分裂した場合は、全体インデックスから計算
      const caretOffset = getCaretCharacterOffsetWithin(activeContentDiv);
      const startOffset = Math.max(0, caretOffset - backLength);
      const startPos = findDOMPosition(activeContentDiv, startOffset);
      if (startPos) {
        range.setStart(startPos.node, startPos.offset);
      }
    }

    // 範囲を削除して新しいリンクを挿入
    range.deleteContents();
    const newTextNode = document.createTextNode(completedLink);
    range.insertNode(newTextNode);

    // カーソルを挿入したテキストノードの直後に配置してアクティブ化
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(newTextNode);
    newRange.collapse(true);
    sel.addRange(newRange);
  }

  // 同期：ブロックの状態にも反映
  const note = getActiveNote();
  if (note) {
    const found = findBlockAndParent(note.blocks, state.activeFocusedBlockId);
    if (found) found.block.content = activeContentDiv.textContent;
  }

  closeLinkMenu();
  saveNotesToStorage();
}

function closeLinkMenu() {
  state.linkMenuOpen = false;
  linkMenu.style.display = 'none';
  state.linkTriggerPos = null;
  state.linkMenuActiveIndex = 0;
}

// Navigation History control functions
function navigateToNote(noteId, pushToHistory = true) {
  if (!noteId) return;

  if (pushToHistory) {
    // Truncate any forward history if we were in the middle of back navigation
    if (state.historyIndex < state.noteHistory.length - 1) {
      state.noteHistory = state.noteHistory.slice(0, state.historyIndex + 1);
    }
    // Avoid pushing consecutive duplicate history states
    if (state.noteHistory[state.historyIndex] !== noteId) {
      state.noteHistory.push(noteId);
      state.historyIndex = state.noteHistory.length - 1;
    }
  }

  state.activeNoteId = noteId;
  localStorage.setItem('notidian_active_note_id', noteId);

  renderNoteList();
  renderEditor();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const backBtn = document.getElementById('btn-history-back');
  const forwardBtn = document.getElementById('btn-history-forward');

  if (backBtn && forwardBtn) {
    backBtn.disabled = state.historyIndex <= 0;
    forwardBtn.disabled = state.historyIndex >= state.noteHistory.length - 1;
  }
}

// Intercept WikiLink clicks on mousedown to prevent focus shift & conversion to raw brackets
document.addEventListener('mousedown', (e) => {
  const wikiLinkEl = e.target.closest('.wiki-link');
  if (wikiLinkEl) {
    e.preventDefault();
    e.stopPropagation();
    const targetTitle = wikiLinkEl.getAttribute('data-target');
    openOrCreateNoteByTitle(targetTitle);
  }
});

function openOrCreateNoteByTitle(title) {
  let note = state.notes.find(n => n.title.toLowerCase() === title.toLowerCase());

  if (!note) {
    // Automatically create a new note (Obsidian-like!)
    note = {
      id: 'note-' + generateId(),
      title: title,
      updatedAt: Date.now(),
      blocks: [
        { id: generateId(), type: 'p', content: '' }
      ]
    };
    state.notes.push(note);
    saveNotesToStorage();
    renderNoteList();
  }

  // Switch note via History
  navigateToNote(note.id);
}

// ==========================================
// 8. NOTES MANAGEMENT & SIDEBAR
// ==========================================

const noteListContainer = document.getElementById('note-list');
const newNoteBtn = document.getElementById('new-note-btn');
const searchInput = document.getElementById('search-notes');
const noteTitleInput = document.getElementById('note-title-input');

function renderNoteList() {
  noteListContainer.innerHTML = '';
  const searchVal = String(searchInput && searchInput.value || '').toLowerCase().trim();

  // テンプレートを除外したノート一覧
  const normalNotes = state.notes.filter(n => !n.isTemplate);

  // 検索中かどうかの判定
  if (searchVal !== '') {
    renderSearchTree(normalNotes, searchVal);
  } else {
    renderNormalTree(normalNotes);
  }
}

function deleteNote(noteId) {
  if (confirm('このノートを削除してもよろしいですか？')) {
    state.notes = state.notes.filter(n => n.id !== noteId);
    if (state.activeNoteId === noteId) {
      const nextNoteId = state.notes.length > 0 ? state.notes[0].id : null;
      navigateToNote(nextNoteId);
    } else {
      saveNotesToStorage();
      renderNoteList();
      renderEditor();
    }
  }
}

// Create New Note
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

  // Focus title immediately
  setTimeout(() => {
    noteTitleInput.focus();
    noteTitleInput.select();
  }, 100);
});

// Title editing
let oldNoteTitle = '';

noteTitleInput.addEventListener('focus', () => {
  const note = getActiveNote();
  if (note) {
    oldNoteTitle = note.title;
  }
});

noteTitleInput.addEventListener('change', () => {
  const note = getActiveNote();
  if (note && oldNoteTitle && oldNoteTitle !== noteTitleInput.value) {
    const newTitle = noteTitleInput.value.trim() || '無題';
    renameWikiLinksInAllNotes(oldNoteTitle, newTitle);
    note.title = newTitle;
    note.updatedAt = Date.now();
    oldNoteTitle = newTitle;
    document.getElementById('breadcrumb-note-title').textContent = note.title;
    saveNotesToStorage();
    renderNoteList();
    updateBacklinks();
    renderNoteLinksPanel();
  }
});

noteTitleInput.addEventListener('input', () => {
  const note = getActiveNote();
  if (note) {
    note.title = noteTitleInput.value || '無題';
    note.updatedAt = Date.now();
    document.getElementById('breadcrumb-note-title').textContent = note.title;
    saveNotesToStorage();
    renderNoteList();
    updateBacklinks();
  }
});

// Search input
searchInput.addEventListener('input', () => {
  renderNoteList();
});

// ==========================================
// 9. BACKLINKS (動的抽出)
// ==========================================

function updateBacklinks() {
  // 右サイドバーのバックリンク廃止のため空関数化（ノート上部リンクパネルに統合完了）
}

function extractOutgoingLinks(note) {
  if (!note) return [];
  const linksSet = new Set();
  
  function scan(blocks) {
    blocks.forEach(b => {
      if (b.content) {
        // [[Title]] や 「「Title」」 にマッチする正規表現
        const wikiRegex = /\[\[([^\]]+)\]\]/g;
        const jpRegex = /「「([^」]+)」」/g;
        let match;
        
        while ((match = wikiRegex.exec(b.content)) !== null) {
          linksSet.add(match[1].trim().toLowerCase());
        }
        while ((match = jpRegex.exec(b.content)) !== null) {
          linksSet.add(match[1].trim().toLowerCase());
        }
      }
      if (b.children && b.children.length > 0) {
        scan(b.children);
      }
    });
  }
  
  scan(note.blocks);
  
  // 抽出されたタイトルを持つ、他の実在するノートを収集
  const outgoing = [];
  linksSet.forEach(titleLower => {
    const found = state.notes.find(n => n.title.toLowerCase() === titleLower);
    if (found && found.id !== note.id) {
      outgoing.push(found);
    }
  });
  
  return outgoing;
}

function renderNoteLinksPanel() {
  const panel = document.getElementById('note-links-panel');
  if (!panel) return;

  const activeNote = getActiveNote();
  if (!activeNote) {
    panel.innerHTML = '';
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  panel.innerHTML = '';

  const currentTitle = activeNote.title.toLowerCase();

  // 1. 戻りリンク（バックリンク）の収集
  const referrers = state.notes.filter(note => {
    if (note.id === activeNote.id) return false;
    return searchBlocksForTitle(note.blocks, currentTitle);
  });

  // 2. 進みリンク（アウトゴーイング）の収集
  const outgoing = extractOutgoingLinks(activeNote);

  // 左半分：戻りリンク（バックリンク）
  const backCol = document.createElement('div');
  backCol.className = 'links-panel-col';
  
  const backHeader = document.createElement('div');
  backHeader.className = 'links-panel-header';
  backHeader.innerHTML = '<i class="fa-solid fa-arrow-left"></i> 戻りリンク <span class="links-count">(' + referrers.length + ')</span>';
  backCol.appendChild(backHeader);

  const backBody = document.createElement('div');
  backBody.className = 'links-panel-body';
  
  if (referrers.length === 0) {
    backBody.innerHTML = '<div class="no-links-msg">参照している他のノートはありません。</div>';
  } else {
    referrers.forEach(note => {
      const badge = document.createElement('span');
      badge.className = 'note-link-badge';
      badge.innerHTML = '<i class="fa-regular fa-file-lines"></i> ' + escapeHTML(note.title);
      badge.addEventListener('click', () => {
        navigateToNote(note.id);
      });
      backBody.appendChild(badge);
    });
  }
  backCol.appendChild(backBody);

  // 右半分：進みリンク（アウトゴーイング）
  const outCol = document.createElement('div');
  outCol.className = 'links-panel-col';

  const outHeader = document.createElement('div');
  outHeader.className = 'links-panel-header';
  outHeader.innerHTML = '進みリンク <i class="fa-solid fa-arrow-right"></i> <span class="links-count">(' + outgoing.length + ')</span>';
  outCol.appendChild(outHeader);

  const outBody = document.createElement('div');
  outBody.className = 'links-panel-body';

  if (outgoing.length === 0) {
    outBody.innerHTML = '<div class="no-links-msg">このノートからリンクしている先はありません。</div>';
  } else {
    outgoing.forEach(note => {
      const badge = document.createElement('span');
      badge.className = 'note-link-badge';
      badge.innerHTML = '<i class="fa-regular fa-file-lines"></i> ' + escapeHTML(note.title);
      badge.addEventListener('click', () => {
        navigateToNote(note.id);
      });
      outBody.appendChild(badge);
    });
  }
  outCol.appendChild(outBody);

  panel.appendChild(backCol);
  panel.appendChild(outCol);
}

function searchBlocksForTitle(blocksArray, targetTitle) {
  for (let b of blocksArray) {
    // Scan leaf blocks content
    if (b.content) {
      const contentLower = b.content.toLowerCase();
      // Look for [[Title]] or 「「Title」」
      const wikiIdx = contentLower.indexOf(`[[${targetTitle}]]`);
      const jpIdx = contentLower.indexOf(`「「${targetTitle}」」`);
      if (wikiIdx !== -1 || jpIdx !== -1) return true;
    }

    // Scan children recursively
    if (b.children && b.children.length > 0) {
      if (searchBlocksForTitle(b.children, targetTitle)) return true;
    }
  }
  return false;
}

// ==========================================
// 10. INTEGRATED POMODORO TIMER
// ==========================================

let sets = [], schedule = [], presets = [];
let activePresetIdx = null;
let index = 0, isWork = true;
let raf = null;
let remaining = 0, duration = 1, endTime = 0;
let isRunning = false;
let lastSec = null;
let timerVolume = 0.5;

// Initialize Pomodoro Data
function loadPomodoroData() {
  try {
    sets = JSON.parse(localStorage.getItem("pomodoro_sets") || "[]");
  } catch (e) {
    console.error("Failed to parse pomodoro_sets:", e);
    sets = [];
  }
  try {
    schedule = JSON.parse(localStorage.getItem("pomodoro_schedule") || "[]");
  } catch (e) {
    console.error("Failed to parse pomodoro_schedule:", e);
    schedule = [];
  }
  try {
    presets = JSON.parse(localStorage.getItem("pomodoro_presets") || "[]");
  } catch (e) {
    console.error("Failed to parse pomodoro_presets:", e);
    presets = [];
  }
  
  timerVolume = parseFloat(localStorage.getItem("pomodoro_standalone_volume") || "0.5");

  // Prepopulate standard Pomodoro configurations if completely empty
  if (!Array.isArray(sets) || sets.length === 0) {
    sets = [
      { name: '作業セッション (25分)', work: 25 * 60 * 1000, rest: 5 * 60 * 1000 },
      { name: 'ショートブレイク (5分)', work: 5 * 60 * 1000, rest: 3 * 60 * 1000 },
      { name: 'テスト用 (10秒)', work: 10 * 1000, rest: 5 * 1000 }
    ];
    savePomodoroData();
  }

  if (!Array.isArray(schedule) || schedule.length === 0) {
    schedule = [sets[0]];
    savePomodoroData();
  }
}

function savePomodoroData() {
  localStorage.setItem("pomodoro_sets", JSON.stringify(sets));
  localStorage.setItem("pomodoro_schedule", JSON.stringify(schedule));
  localStorage.setItem("pomodoro_presets", JSON.stringify(presets));
  localStorage.setItem("pomodoro_standalone_volume", timerVolume);
}

// Sets Manager
function addSet() {
  const nameVal = document.getElementById("name").value.trim();
  let workMinVal = Math.max(0, Number(document.getElementById("workMin").value || 0));
  let workSecVal = Math.max(0, Number(document.getElementById("workSec").value || 0));
  let restMinVal = Math.max(0, Number(document.getElementById("restMin").value || 0));
  let restSecVal = Math.max(0, Number(document.getElementById("restSec").value || 0));

  // 秒が60以上の場合の繰り上げ処理
  if (workSecVal >= 60) {
    workMinVal += Math.floor(workSecVal / 60);
    workSecVal = workSecVal % 60;
  }
  if (restSecVal >= 60) {
    restMinVal += Math.floor(restSecVal / 60);
    restSecVal = restSecVal % 60;
  }

  const work = (workMinVal * 60 + workSecVal) * 1000;
  const rest = (restMinVal * 60 + restSecVal) * 1000;

  if (!nameVal || work <= 0) {
    alert('セット名と有効な作業時間を入力してください。');
    return;
  }

  sets.push({ name: nameVal, work, rest });

  // Clear inputs
  document.getElementById("name").value = '';
  document.getElementById("workMin").value = '25';
  document.getElementById("workSec").value = '0';
  document.getElementById("restMin").value = '5';
  document.getElementById("restSec").value = '0';

  savePomodoroData();
  renderPomodoro();
}

function deleteSet() {
  const setSel = document.getElementById("setSelect");
  const selectedIdx = setSel.value;
  if (selectedIdx === "" || !sets[selectedIdx]) return;

  sets.splice(selectedIdx, 1);
  savePomodoroData();
  renderPomodoro();
}

// Schedule Manager
function addSchedule() {
  const setSel = document.getElementById("setSelect");
  const selectedIdx = setSel.value;
  if (selectedIdx === "" || !sets[selectedIdx]) return;

  activePresetIdx = null; // スケジュール構成が変わったためプリセット選択状態を解除
  schedule.push(sets[selectedIdx]);
  savePomodoroData();
  renderPomodoro();

  // 描画後、再び選択状態を復元！
  const newSetSel = document.getElementById("setSelect");
  if (newSetSel && selectedIdx !== "") {
    newSetSel.value = selectedIdx;
  }
}

function deleteSchedule(i) {
  activePresetIdx = null; // スケジュール構成が変わったためプリセット選択状態を解除
  schedule.splice(i, 1);

  // Adjust index if out of bounds
  if (index >= schedule.length) {
    index = Math.max(0, schedule.length - 1);
  }

  savePomodoroData();
  renderPomodoro();
}

// Presets Manager
function savePreset() {
  const pName = document.getElementById("presetName").value.trim();
  if (!pName) {
    alert('プリセット名を入力してください。');
    return;
  }
  presets.push({ name: pName, schedule: JSON.parse(JSON.stringify(schedule)) });
  document.getElementById("presetName").value = '';
  activePresetIdx = presets.length - 1; // 登録された新規プリセットを選択状態にする
  savePomodoroData();
  renderPomodoro();
}

function loadPreset() {
  const pSel = document.getElementById("presetSelect");
  const selected = pSel.value;
  if (selected === "" || !presets[selected]) {
    activePresetIdx = null;
    return;
  }

  stopTimer(); // タイマー動作中であれば確実に停止して初期化

  schedule = JSON.parse(JSON.stringify(presets[selected].schedule));
  index = 0;
  isWork = true;
  activePresetIdx = selected; // ロードしたインデックスを保持
  savePomodoroData();
  renderPomodoro();
}

function deletePreset() {
  const pSel = document.getElementById("presetSelect");
  const selected = pSel.value;
  if (selected === "" || !presets[selected]) {
    alert('削除するプリセットを選択してください。');
    return;
  }

  if (confirm(`プリセット「${presets[selected].name}」を削除してもよろしいですか？`)) {
    presets.splice(selected, 1);
    activePresetIdx = null; // 削除されたのでアクティブ選択を解除
    savePomodoroData();
    renderPomodoro();
  }
}

function formatMS(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}分${sec}秒`;
}

// Render Pomodoro Widgets
function renderPomodoro() {
  // Populate select dropdowns
  const setSel = document.getElementById("setSelect");
  setSel.innerHTML = "";
  sets.forEach((s, i) => {
    const wMin = Math.floor(s.work / 60000);
    const wSec = Math.floor((s.work % 60000) / 1000);
    const rMin = Math.floor(s.rest / 60000);
    const rSec = Math.floor((s.rest % 60000) / 1000);
    
    const wStr = `${wMin}分${wSec}秒`;
    const rStr = `${rMin}分${rSec}秒`;

    setSel.innerHTML += `<option value="${i}">${escapeHTML(s.name)} (${wStr}/${rStr})</option>`;
  });
  if (sets.length === 0) setSel.innerHTML = `<option value="">セットなし</option>`;

  const pSel = document.getElementById("presetSelect");
  pSel.innerHTML = "";
  
  const defOpt = document.createElement('option');
  defOpt.value = "";
  defOpt.textContent = "プリセットを選択...";
  if (activePresetIdx === null || activePresetIdx === "") {
    defOpt.selected = true;
  }
  pSel.appendChild(defOpt);

  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    if (activePresetIdx !== null && String(activePresetIdx) === String(i)) {
      opt.selected = true;
    }
    pSel.appendChild(opt);
  });

  // Render Schedule Items
  const schedContainer = document.getElementById("schedule");
  schedContainer.innerHTML = "";

  if (schedule.length === 0) {
    schedContainer.innerHTML = '<div class="no-data-msg">スケジュールが空です</div>';

    // Empty timer displays
    document.getElementById("currentIndex").textContent = '0/0';
    document.getElementById("taskName").textContent = '未選択';
    document.getElementById("time").textContent = '00:00';
    drawCirclePizza(0);
    return;
  }

  schedule.forEach((s, i) => {
    const isActive = i === index;
    schedContainer.innerHTML += `
      <div class="scheduleItem ${isActive ? 'active' : ''}">
        <div class="scheduleMain">
          <div class="schedule-name">${i + 1}. ${escapeHTML(s.name)}</div>
          <div class="schedule-times">作業: ${formatMS(s.work)} / 休憩: ${formatMS(s.rest)}</div>
        </div>
        <button class="del" onclick="deleteSchedule(${i})">×</button>
      </div>`;
  });

  // Init sortable schedule reordering
  Sortable.create(schedContainer, {
    animation: 150,
    handle: '.scheduleMain',
    onEnd: (e) => {
      activePresetIdx = null; // 並び替えたためプリセット選択状態を解除
      const moved = schedule.splice(e.oldIndex, 1)[0];
      schedule.splice(e.newIndex, 0, moved);

      // Update active index if moved
      if (index === e.oldIndex) {
        index = e.newIndex;
      } else if (index > e.oldIndex && index <= e.newIndex) {
        index--;
      } else if (index < e.oldIndex && index >= e.newIndex) {
        index++;
      }

      savePomodoroData();
      renderPomodoro();
    }
  });

  // Update timer display states
  if (!isRunning && schedule[index]) {
    document.getElementById("currentIndex").textContent = `${index + 1}/${schedule.length}`;
    document.getElementById("taskName").textContent = `${index + 1}. ${schedule[index].name}`;
    const initialRem = isWork ? schedule[index].work : schedule[index].rest;
    const initialSec = Math.ceil(initialRem / 1000);
    document.getElementById("time").textContent = `${Math.floor(initialSec / 60)}:${String(initialSec % 60).padStart(2, '0')}`;
    drawCirclePizza(initialRem);
  }
}

// Timer loops & run controls
function startTimer() {
  if (schedule.length === 0) return;

  if (!isRunning) {
    isWork = false; // Will invert to true immediately inside run()
    run();
  } else {
    endTime = Date.now() + remaining;
    loop();
  }
  isRunning = true;
}

function run() {
  if (index >= schedule.length) {
    stopTimer();
    return;
  }

  const s = schedule[index];

  isWork = !isWork;
  duration = isWork ? s.work : s.rest;

  remaining = duration;
  endTime = Date.now() + duration;
  lastSec = Math.ceil(duration / 1000);

  document.getElementById("currentIndex").textContent = `${index + 1}/${schedule.length}`;
  document.getElementById("taskName").textContent = `${index + 1}. ${s.name} (${isWork ? '作業中' : '休憩中'})`;

  // タイマー開始時（作業セッションの開始時）に現在のテーブルに自動挿入
  if (isWork) {
    insertPomodoroStartToActiveTable(s.name, s.work);
  }

  renderPomodoro();
  loop();
}

function loop() {
  cancelAnimationFrame(raf);

  function frame() {
    const now = Date.now();
    remaining = endTime - now;

    if (remaining <= 0) {
      remaining = 0;

      if (lastSec !== 0) {
        beepSound();
        lastSec = 0;
      }

      document.getElementById("time").textContent = "0:00";
      drawCirclePizza(0);

      endAlertSound();

      // Trigger Focus Log Event if Work Session Completed
      if (isWork) {
        logFocusSession(schedule[index].name, schedule[index].work);
      }

      // Next phase transition
      isWork ? run() : (index++, isWork = false, run());
      return;
    }

    const sec = Math.ceil(remaining / 1000);

    if (sec !== lastSec) {
      if (sec === 3 || sec === 2 || sec === 1) {
        beepSound();
      }
      lastSec = sec;
    }

    document.getElementById("time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    drawCirclePizza(remaining);

    raf = requestAnimationFrame(frame);
  }

  frame();
}

function pauseTimer() {
  cancelAnimationFrame(raf);
}

function stopTimer() {
  cancelAnimationFrame(raf);
  isRunning = false;
  index = 0;
  isWork = true; // reset
  renderPomodoro();
}

function getFormattedTimeFromMs(ms) {
  const d = new Date(ms);
  const hrs = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
}

// Pomodoro Focus Completion Log
function logFocusSession(taskName, durationMs) {
  const durationMin = Math.ceil(durationMs / 60000);
  const todayString = new Date().toLocaleDateString('ja-JP');
  
  // 開始・終了時間の計算と明記
  const endMs = Date.now();
  const startMs = endMs - durationMs;
  const startStr = getFormattedTimeFromMs(startMs);
  const endStr = getFormattedTimeFromMs(endMs);
  const fullDateStr = `${todayString} ${startStr}~${endStr}`;

  const newLog = {
    id: generateId(),
    taskName: taskName || '未命名のタスク',
    date: fullDateStr,
    timestamp: endMs,
    duration: durationMin,
    status: '完了'
  };

  state.focusLogs.push(newLog);
  saveLogsToStorage();

  // 現在開いているページの最初に見つかったデータベースに自動挿入
  insertPomodoroLogToActiveNoteDb(newLog.taskName, newLog.duration);
}

// Audio beepers
function beepSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle'; // 三角波に変更し音圧を劇的向上！
    o.frequency.value = 600;
    g.gain.setValueAtTime(6.25 * timerVolume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.002, ctx.currentTime + 0.18);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (e) {
    console.error('AudioContext fail', e);
  }
}

function endAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle'; // 三角波に変更し音圧を劇的向上！
    o.frequency.value = 750;
    g.gain.setValueAtTime(8.75 * timerVolume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.002, ctx.currentTime + 1.5);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 1.5);
  } catch (e) {
    console.error('AudioContext fail', e);
  }
}

// Draw radial focus progress inside canvas
function drawCirclePizza(rem) {
  const canvas = document.getElementById("circle");
  const ctx = canvas.getContext("2d");

  let ratio = rem / duration;
  if (rem <= 0) ratio = 0;

  ctx.clearRect(0, 0, 130, 130);

  // Glow filter properties
  ctx.shadowBlur = 10;
  ctx.shadowColor = isWork ? "rgba(59, 130, 246, 0.4)" : "rgba(16, 185, 129, 0.4)";

  // Outer full circular arc (muted gray border track)
  ctx.beginPath();
  ctx.arc(65, 65, 55, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 8;
  ctx.stroke();

  // Progress circular arc
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * ratio;

  ctx.beginPath();
  ctx.arc(65, 65, 55, start, end);
  ctx.strokeStyle = isWork ? "#3b82f6" : "#10b981"; // Blue for focus, emerald green for break
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.stroke();

  // Reset shadow for further draws
  ctx.shadowBlur = 0;
}

// ==========================================
// 11. POMODORO TABLE & SVG CUMULATIVE GRAPH
// ==========================================

const focusTableBody = document.getElementById('focus-table-body');
const taskBreakdownContainer = document.getElementById('task-breakdown');
const cumulativeChart = document.getElementById('cumulative-chart');

function renderAnalytics() {
  renderFocusTable();
  renderSvgChart();
  renderTaskBreakdown();
}

// Notion style focus list Table View
function renderFocusTable() {
  focusTableBody.innerHTML = '';

  if (state.focusLogs.length === 0) {
    focusTableBody.innerHTML = `<tr><td colspan="5" class="no-data-msg">ログがありません。タスクを完了させて記録を作成しましょう！</td></tr>`;
    return;
  }

  // Render logs in reverse chronological order
  const sortedLogs = [...state.focusLogs].sort((a, b) => b.timestamp - a.timestamp);

  sortedLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', log.id);
    tr.innerHTML = `
      <td>${escapeHTML(log.date)}</td>
      <td class="cell-editable" contenteditable="true" data-field="taskName">${escapeHTML(log.taskName)}</td>
      <td class="cell-editable" contenteditable="true" data-field="duration" style="text-align:center;">${log.duration}分</td>
      <td>
        <span style="color: ${log.status === '完了' ? 'var(--accent-green)' : 'var(--text-muted)'}; font-weight: 600;">
          ${escapeHTML(log.status)}
        </span>
      </td>
      <td style="text-align: center;">
        <button class="btn-clear-logs" onclick="deleteLog('${log.id}')" title="削除">
          <i class="fa-solid fa-trash-can" style="font-size:10px;"></i>
        </button>
      </td>
    `;

    // Inline table editing listeners
    const editableCells = tr.querySelectorAll('.cell-editable');
    editableCells.forEach(cell => {
      cell.addEventListener('blur', () => {
        const field = cell.getAttribute('data-field');
        let newVal = cell.textContent.trim();

        // Validate values
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
}

function deleteLog(logId) {
  if (confirm('この記録を削除しますか？')) {
    state.focusLogs = state.focusLogs.filter(l => l.id !== logId);
    saveLogsToStorage();
  }
}

function clearAllLogs() {
  if (confirm('すべてのタイマー記録を消去してもよろしいですか？（この操作は取り消せません）')) {
    state.focusLogs = [];
    saveLogsToStorage();
  }
}

// Gorgeous SVG Cumulative Hours Chart
function renderSvgChart() {
  cumulativeChart.innerHTML = '';

  // 1. Define Linear Gradients inside SVG Defs
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

  // 2. Fetch last 7 days focus totals
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

  // Sum up totals
  state.focusLogs.forEach(log => {
    const day = last7Days.find(d => d.dateStr === log.date);
    if (day) {
      day.minutes += Number(log.duration || 0);
    }
  });

  // Calculate scaling
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

  // 3. Draw Grid Lines & Left Axis Labels
  const gridLines = [0, 0.5, 1];
  gridLines.forEach(ratio => {
    const y = chartHeight - paddingBottom - (ratio * graphHeight);

    // Draw horizontal track line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.className.baseVal = 'chart-grid-line';
    line.setAttribute('x1', paddingLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', chartWidth - paddingRight);
    line.setAttribute('y2', y);
    cumulativeChart.appendChild(line);

    // Axis values labels (hours)
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

  // 4. Draw Bars & X Axis Labels
  last7Days.forEach((day, idx) => {
    const x = paddingLeft + idx * (barWidth + gap);

    // Value scaling height
    const barHeight = (day.minutes / maxMinutes) * graphHeight;
    const y = chartHeight - paddingBottom - barHeight;

    // SVG rounded bar rect
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.className.baseVal = 'chart-bar';
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barWidth);
    rect.setAttribute('height', Math.max(2, barHeight));

    // Tooltip hover info
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${day.dateStr}\n集中時間: ${day.minutes}分 (${(day.minutes / 60).toFixed(1)}時間)`;
    rect.appendChild(title);
    cumulativeChart.appendChild(rect);

    // Value on top of bar (if greater than 0)
    if (day.minutes > 0) {
      const barVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      barVal.className.baseVal = 'chart-value-text';
      barVal.setAttribute('x', x + barWidth / 2);
      barVal.setAttribute('y', y - 4);
      barVal.textContent = day.minutes >= 60 ? `${(day.minutes / 60).toFixed(1)}h` : `${day.minutes}m`;
      cumulativeChart.appendChild(barVal);
    }

    // X Axis Label
    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.className.baseVal = 'chart-text';
    xLabel.setAttribute('x', x + barWidth / 2);
    xLabel.setAttribute('y', chartHeight - 8);
    xLabel.textContent = day.label;
    cumulativeChart.appendChild(xLabel);
  });
}

// Task focus hours breakdowns (horizontal progressive bars)
function renderTaskBreakdown() {
  taskBreakdownContainer.innerHTML = '';

  if (state.focusLogs.length === 0) {
    taskBreakdownContainer.innerHTML = `<div class="no-data-msg">記録がありません。</div>`;
    return;
  }

  // Calculate total minutes by task
  const taskTotals = {};
  let grandTotalMinutes = 0;

  state.focusLogs.forEach(log => {
    const tName = log.taskName || '名称未設定タスク';
    taskTotals[tName] = (taskTotals[tName] || 0) + Number(log.duration || 0);
    grandTotalMinutes += Number(log.duration || 0);
  });

  // Convert to sorted array
  const sortedTasks = Object.entries(taskTotals)
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // Render horizontal meter rows
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

    // Trigger visual progressive fill animation
    setTimeout(() => {
      const fillEl = row.querySelector('.task-progress-bar-fill');
      if (fillEl) fillEl.style.width = `${percentage}%`;
    }, 100);
  });
}

// ==========================================
// 12. TAB CONTROLS (RIGHT PANEL)
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

function getStatusClass(val) {
  // val が ID（opt-xxx）か値そのものかどちらでも動くようにフォールバック
  if (val === '進行中' || val === 'opt-progress') return 'progress';
  if (val === '完了' || val === 'opt-complete') return 'complete';
  return 'todo';
}

function getTagColor(val) {
  if (!val || val === '選択なし') return 'gray';
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'pink', 'gray'];
  let hash = 0;
  for (let i = 0; i < val.length; i++) {
    hash = val.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
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

function deleteDbRow(block, rowIndex) {
  if (confirm('この行を削除してもよろしいですか？')) {
    block.properties.rows.splice(rowIndex, 1);
    saveNotesToStorage();
    renderEditor();
  }
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

function recalculateTableFooter(table, block, visibleRows = null) {
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
    const startNextWidth = nextTh ? (nextCol ? nextCol.width : nextTh.getBoundingClientRect().width) : null;
    
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
function createDatabaseDOM(block) {
  const container = document.createElement('div');
  container.className = 'database-container';

  block.properties = block.properties || { columns: [], rows: [] };
  
  // 1. ビュー（インデックスタブ）の初期化 ＆ レンダリング
  if (!block.properties.views || block.properties.views.length === 0) {
    block.properties.views = [
      { id: 'view-all', name: 'すべて', filters: [] },
      { id: 'view-progress', name: '進行中', filters: [ { id: 'f-progress', columnId: 'col-status', value: '進行中' } ] },
      { id: 'view-complete', name: '完了', filters: [ { id: 'f-complete', columnId: 'col-status', value: '完了' } ] }
    ];
    block.properties.activeViewId = 'view-all';
  }
  
  const views = block.properties.views;
  
  // 互換性：もし古い filter プロパティがある場合は、自動的に filters 配列へ移行する
  views.forEach(v => {
    if (v.filter && (!v.filters || v.filters.length === 0)) {
      v.filters = [ { id: 'f-' + generateId(), columnId: v.filter.columnId, value: v.filter.value } ];
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
    updateTimerTargetTableSelect();
  });
  dbTitleRow.appendChild(dbTitleInput);
  container.appendChild(dbTitleRow);
  
  const tabBar = document.createElement('div');
  tabBar.className = 'db-views-tab-bar';
  
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
      if (block.properties.activeViewId !== view.id) {
        block.properties.activeViewId = view.id;
        saveNotesToStorage();
        renderEditor();
      }
    });
    
    tabBar.appendChild(tab);
  });
  
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
  Sortable.create(tabBar, {
    animation: 150,
    draggable: '.db-view-tab',
    filter: '.db-view-tab-input, button', // 入力フィールドや削除ボタンでのドラッグを防ぐ
    preventOnFilter: false,
    onEnd: (evt) => {
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
  
  // データベースを削除ボタン
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
  
  // AND フィルター詳細表示
  if (activeView.filters && activeView.filters.length > 0) {
    const filterLabels = [];
    activeView.filters.forEach(filter => {
      const col = block.properties.columns.find(c => c.id === filter.columnId);
      if (col && filter.value !== undefined && filter.value !== '') {
        // ステータスの場合はバッジ名を表示
        let displayVal = filter.value;
        if (col.type === 'status') {
          displayVal = getStatusOptionName(col, filter.value);
        }
        filterLabels.push(`「${escapeHTML(col.name)}」＝「${escapeHTML(displayVal)}」`);
      }
    });
    if (filterLabels.length > 0) {
      const filterLabelSpan = document.createElement('span');
      filterLabelSpan.style.fontSize = '11px';
      filterLabelSpan.style.color = 'var(--accent-primary)';
      filterLabelSpan.style.fontWeight = '600';
      filterLabelSpan.style.marginRight = '8px';
      filterLabelSpan.innerHTML = `<i class="fa-solid fa-filter"></i> ${filterLabels.join(' & ')}`;
      toolbar.appendChild(filterLabelSpan);
    }
  }
  
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
          return val === filterVal;
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
            startOfWeek.setHours(0,0,0,0);
            
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23,59,59,999);
            
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
  
  // 削除用・一括選択用制御列のth（一括チェックは廃止してコンパクト化）
  const leftColWidth = block.properties.leftColWidth || 34;
  const controlTh = document.createElement('th');
  controlTh.className = 'db-row-controls-header';
  controlTh.style.width = `${leftColWidth}px`;
  controlTh.style.minWidth = `${leftColWidth}px`;
  controlTh.style.maxWidth = `${leftColWidth}px`;
  
  // 左端列幅リサイザーの追加
  const leftResizer = document.createElement('div');
  leftResizer.className = 'db-column-resizer';
  setupDbColumnResizer(leftResizer, 'left-col', controlTh, table, block, rowDataList);
  controlTh.appendChild(leftResizer);
  
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
      deleteDbRow(block, actualIndex);
    });
    controlsWrapper.appendChild(delBtn);
    
    controlTd.appendChild(controlsWrapper);
    tr.appendChild(controlTd);
    columns.forEach(col => {
      const td = document.createElement('td');
      const val = row[col.id] !== undefined ? row[col.id] : '';
      
      // 列幅の適用
      td.style.width = `${col.width}px`;
      td.style.minWidth = `${col.width}px`;
      td.style.maxWidth = `${col.width}px`;
      
      if (col.type === 'status') {
        const badge = document.createElement('span');
        const optName = getStatusOptionName(col, val) || '未着手';
        const optColor = getStatusOptionColor(col, val) || 'gray';
        
        badge.className = `db-select-badge db-tag-${optColor}`;
        badge.textContent = optName;
        badge.style.cursor = 'pointer';
        
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          showStatusSelectPopover(e, block, actualIndex, col.id);
        });
        
        td.appendChild(badge);
      } else if (col.type === 'select') {
        const badge = document.createElement('span');
        badge.className = `db-select-badge db-tag-${getTagColor(val)}`;
        badge.textContent = val || '選択なし';
        badge.style.cursor = 'pointer';
        
        badge.addEventListener('click', (e) => {
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
        cellDiv.contentEditable = 'true';
        
        if (col.type === 'number') {
          cellDiv.style.textAlign = 'right';
          cellDiv.textContent = val !== '' ? formatNumberValue(val, col) : '';
          
          // フォーカスON時はプレーンな数値に
          cellDiv.addEventListener('focus', () => {
            cellDiv.textContent = row[col.id] !== undefined ? row[col.id] : '';
          });
        } else {
          cellDiv.textContent = val;
        }
        
        cellDiv.addEventListener('blur', () => {
          let newVal = cellDiv.textContent.trim();
          if (col.type === 'number') {
            const parsed = parseFloat(newVal);
            newVal = isNaN(parsed) ? '' : parsed;
            cellDiv.textContent = newVal !== '' ? formatNumberValue(newVal, col) : '';
          }
          row[col.id] = newVal;
          saveNotesToStorage();
          recalculateTableFooter(table, block, rowDataList);
        });
        
        cellDiv.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
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
          // セレクトタグのドロップダウン
          const select = document.createElement('select');
          select.className = 'db-filter-val-select';
          select.style.width = '100%';
          
          const tagOptions = col.options || [];
          tagOptions.forEach(opt => {
            const isSel = filter.value === opt;
            select.innerHTML += `<option value="${opt}" ${isSel ? 'selected' : ''}>${escapeHTML(opt)}</option>`;
          });

          if (tagOptions.length === 0) {
            select.innerHTML = '<option value="">タグ未登録</option>';
            filter.value = '';
          } else if (!filter.value || !tagOptions.includes(filter.value)) {
            filter.value = tagOptions[0];
          }

          select.addEventListener('change', () => {
            filter.value = select.value;
          });

          valContainer.appendChild(select);
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
      const colors = ['gray', 'red', 'blue', 'green', 'yellow', 'purple', 'pink'];
      const curIdx = colors.indexOf(opt.color || 'gray');
      opt.color = colors[(curIdx + 1) % colors.length];
      saveNotesToStorage();
      renderEditor();
      showStatusSelectPopover(e, block, rowIndex, colId); // リロード
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
        if (confirm(`ステータス「${opt.name}」を削除してもよろしいですか？`)) {
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
        }
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
  popover.className = 'db-floating-popover';
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY + 12}px`;

  const currentVal = block.properties.rows[rowIndex][colId] || '';

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = `db-popover-item ${currentVal === opt ? 'active' : ''}`;
    item.innerHTML = `<span class="db-select-badge db-tag-${getTagColor(opt)}">${escapeHTML(opt)}</span>`;
    
    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      block.properties.rows[rowIndex][colId] = opt;
      popover.remove();
      saveNotesToStorage();
      renderEditor();
    });
    popover.appendChild(item);
  });

  const divider = document.createElement('div');
  divider.className = 'db-popover-divider';
  popover.appendChild(divider);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'db-popover-input';
  input.placeholder = '+ 新規タグ作成...';
  
  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      evt.stopPropagation();
      const val = input.value.trim();
      if (val && !options.includes(val)) {
        options.push(val);
        block.properties.rows[rowIndex][colId] = val;
        
        const col = block.properties.columns.find(c => c.id === colId);
        if (col) col.options = options;

        popover.remove();
        saveNotesToStorage();
        renderEditor();
      }
    }
  });

  popover.appendChild(input);
  document.body.appendChild(popover);
  
  setTimeout(() => input.focus(), 50);
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
  if (
    !e.target.closest('.db-floating-popover') &&
    !e.target.closest('.db-header-content') &&
    !e.target.closest('.db-select-badge') &&
    !e.target.closest('.db-status-todo') &&
    !e.target.closest('.db-status-progress') &&
    !e.target.closest('.db-status-complete') &&
    !e.target.closest('.db-calc-cell') &&
    !e.target.closest('.db-view-tab') &&
    !e.target.closest('.btn-db-toolbar')
  ) {
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

function deleteFolder(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;

  if (confirm(`フォルダ「${folder.name}」を削除してもよろしいですか？\n※フォルダ内のノートや子フォルダは、ルート階層（フォルダなし）へ移動します。`)) {
    state.folders.forEach(f => {
      if (f.parentId === folderId) f.parentId = null;
    });

    state.notes.forEach(n => {
      if (n.folderId === folderId) n.folderId = null;
    });

    state.folders = state.folders.filter(f => f.id !== folderId);
    state.collapsedFolders = state.collapsedFolders.filter(id => id !== folderId);

    saveNotesToStorage();
    renderNoteList();
  }
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
    deleteFolder(folder.id);
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
    deleteNote(note.id);
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
      deleteNote(note.id);
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
  const matchedNotes = normalNotes.filter(n => n.title.toLowerCase().includes(searchVal));
  const matchedFolders = state.folders.filter(f => f.name.toLowerCase().includes(searchVal));

  const visibleFolderIds = new Set();
  
  matchedFolders.forEach(f => {
    visibleFolderIds.add(f.id);
    let parentId = f.parentId;
    while (parentId) {
      visibleFolderIds.add(parentId);
      const parent = state.folders.find(x => x.id === parentId);
      parentId = parent ? parent.parentId : null;
    }
  });

  matchedNotes.forEach(n => {
    let parentId = n.folderId;
    while (parentId) {
      visibleFolderIds.add(parentId);
      const parent = state.folders.find(x => x.id === parentId);
      parentId = parent ? parent.parentId : null;
    }
  });

  const rootFolders = state.folders.filter(f => !f.parentId && visibleFolderIds.has(f.id));
  const rootNotes = matchedNotes.filter(n => !n.folderId);

  rootFolders.sort((a, b) => b.updatedAt - a.updatedAt);
  rootNotes.sort((a, b) => b.updatedAt - a.updatedAt);

  if (rootFolders.length === 0 && rootNotes.length === 0) {
    noteListContainer.innerHTML = '<div class="no-data-msg">一致するノート・フォルダなし</div>';
    return;
  }

  rootFolders.forEach(folder => {
    noteListContainer.appendChild(createSearchFolderDOM(folder, normalNotes, matchedNotes, visibleFolderIds, searchVal, 0));
  });

  rootNotes.forEach(note => {
    noteListContainer.appendChild(createSearchNoteDOM(note, searchVal, 0));
  });
}

function renderNormalTree(normalNotes) {
  // --- 1. お気に入り（Starred）セクションの描画 ---
  const favoriteNotes = normalNotes.filter(n => n.isFavorite);
  if (favoriteNotes.length > 0) {
    const favHeader = document.createElement('div');
    favHeader.className = 'folder-header favorite-section-header';
    favHeader.style.paddingLeft = '6px';
    favHeader.style.display = 'flex';
    favHeader.style.alignItems = 'center';
    favHeader.style.gap = '6px';
    favHeader.style.marginTop = '8px';
    favHeader.style.marginBottom = '4px';

    const starIcon = document.createElement('i');
    starIcon.className = 'fa-solid fa-star folder-icon';
    starIcon.style.color = '#fff9c4'; // プレミアムなゴールド

    const titleSpan = document.createElement('span');
    titleSpan.className = 'folder-name';
    titleSpan.textContent = 'お気に入り';

    favHeader.appendChild(starIcon);
    favHeader.appendChild(titleSpan);
    noteListContainer.appendChild(favHeader);

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
      favUl.appendChild(li);
    });
    noteListContainer.appendChild(favUl);
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
    // 範囲選択
    const start = Math.min(lastSelectedRowIndex, rowIndex);
    const end = Math.max(lastSelectedRowIndex, rowIndex);
    
    for (let i = start; i <= end; i++) {
      const targetRow = rowDataList[i];
      if (isChecked) {
        if (!tableSelection.selectedRows.includes(targetRow)) {
          tableSelection.selectedRows.push(targetRow);
        }
      } else {
        tableSelection.selectedRows = tableSelection.selectedRows.filter(r => r !== targetRow);
      }
    }
    
    // DOM上のチェックボックスのチェック状態を同期
    const tableEl = document.querySelector(`.block-wrapper[data-id="${block.id}"] table`);
    if (tableEl) {
      const trs = tableEl.querySelectorAll('.db-data-row');
      for (let i = start; i <= end; i++) {
        const tr = trs[i];
        if (tr) {
          const check = tr.querySelector('.db-row-select-check');
          if (check) check.checked = isChecked;
        }
      }
    }
  } else {
    // 通常の単一選択
    if (isChecked) {
      if (!tableSelection.selectedRows.includes(row)) {
        tableSelection.selectedRows.push(row);
      }
    } else {
      tableSelection.selectedRows = tableSelection.selectedRows.filter(r => r !== row);
    }
    lastSelectedRowIndex = rowIndex;
  }
  
  updateBulkActionBar(block, rowDataList);
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
  container.innerHTML = '';

  // --- 1. 一括削除 ---
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-bulk-action btn-bulk-danger';
  delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 一括削除';
  delBtn.addEventListener('click', () => {
    if (confirm(`選択された ${count} 行を削除してもよろしいですか？`)) {
      pushHistory();
      block.properties.rows = block.properties.rows.filter(r => !tableSelection.selectedRows.includes(r));
      saveNotesToStorage();
      clearTableSelection();
      renderEditor();
    }
  });
  container.appendChild(delBtn);

  // --- 2. プロパティ動的一括変更 ---
  const propChangeWrapper = document.createElement('div');
  propChangeWrapper.className = 'bulk-prop-change-wrapper';
  propChangeWrapper.style.display = 'flex';
  propChangeWrapper.style.alignItems = 'center';
  propChangeWrapper.style.gap = '6px';
  propChangeWrapper.innerHTML = `<span style="font-size:11px; color:var(--text-secondary); font-weight:500;"><i class="fa-solid fa-pen-to-square"></i> 変更:</span>`;

  const propSelect = document.createElement('select');
  propSelect.className = 'bulk-action-select';
  
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '列を選択...';
  propSelect.appendChild(defaultOpt);

  const columns = block.properties.columns || [];
  columns.forEach(col => {
    const o = document.createElement('option');
    o.value = col.id;
    o.textContent = col.name;
    propSelect.appendChild(o);
  });

  const valueInputContainer = document.createElement('span');
  valueInputContainer.className = 'bulk-prop-val-container';
  valueInputContainer.style.display = 'flex';
  valueInputContainer.style.alignItems = 'center';
  valueInputContainer.style.gap = '6px';

  propSelect.addEventListener('change', () => {
    valueInputContainer.innerHTML = '';
    const colId = propSelect.value;
    if (!colId) return;

    const col = columns.find(c => c.id === colId);
    if (!col) return;

    if (col.type === 'status') {
      const select = document.createElement('select');
      select.className = 'bulk-action-select';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'ステータスを選択...';
      select.appendChild(def);

      const opts = col.options || [];
      opts.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        select.appendChild(opt);
      });

      const newOpt = document.createElement('option');
      newOpt.value = '__CREATE_NEW__';
      newOpt.textContent = '+ 新規ステータス作成...';
      newOpt.style.color = 'var(--accent-primary)';
      newOpt.style.fontWeight = 'bold';
      select.appendChild(newOpt);

      select.addEventListener('change', () => {
        const val = select.value;
        if (!val) return;

        if (val === '__CREATE_NEW__') {
          const newName = prompt('新しく作成するステータス名を入力してください：');
          if (!newName || !newName.trim()) {
            select.value = '';
            return;
          }
          
          const trimmedName = newName.trim();
          let existing = opts.find(o => o.name === trimmedName);
          let newId;
          if (existing) {
            newId = existing.id;
          } else {
            newId = 'opt-' + generateId();
            const colors = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            if (!col.options) col.options = [];
            col.options.push({ id: newId, name: trimmedName, color: randomColor });
          }
          
          applyBulkPropertyChange(block, colId, newId);
        } else {
          applyBulkPropertyChange(block, colId, val);
        }
      });
      valueInputContainer.appendChild(select);
    } 
    else if (col.type === 'select') {
      const select = document.createElement('select');
      select.className = 'bulk-action-select';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'タグを選択...';
      select.appendChild(def);

      const opts = col.options || [];
      opts.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        select.appendChild(opt);
      });

      const newOpt = document.createElement('option');
      newOpt.value = '__CREATE_NEW__';
      newOpt.textContent = '+ 新規タグ作成...';
      newOpt.style.color = 'var(--accent-primary)';
      newOpt.style.fontWeight = 'bold';
      select.appendChild(newOpt);

      select.addEventListener('change', () => {
        const val = select.value;
        if (!val) return;

        if (val === '__CREATE_NEW__') {
          const newName = prompt('新しく作成するタグ名を入力してください：');
          if (!newName || !newName.trim()) {
            select.value = '';
            return;
          }

          const trimmedName = newName.trim();
          if (!col.options) col.options = [];
          if (!col.options.includes(trimmedName)) {
            col.options.push(trimmedName);
          }

          applyBulkPropertyChange(block, colId, trimmedName);
        } else {
          applyBulkPropertyChange(block, colId, val);
        }
      });
      valueInputContainer.appendChild(select);
    }
    else if (col.type === 'date') {
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'bulk-action-date-input';
      
      input.addEventListener('change', () => {
        const val = input.value;
        if (val) applyBulkPropertyChange(block, colId, val);
      });
      valueInputContainer.appendChild(input);
    }
    else if (col.type === 'checkbox') {
      const select = document.createElement('select');
      select.className = 'bulk-action-select';
      select.innerHTML = `
        <option value="">選択してください...</option>
        <option value="true">ON (チェックあり)</option>
        <option value="false">OFF (チェックなし)</option>
      `;
      select.addEventListener('change', () => {
        const val = select.value;
        if (val !== '') {
          applyBulkPropertyChange(block, colId, val === 'true');
        }
      });
      valueInputContainer.appendChild(select);
    }
    else if (col.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'bulk-action-date-input';
      input.style.width = '70px';
      input.placeholder = '数値';

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
  });

  propChangeWrapper.appendChild(propSelect);
  propChangeWrapper.appendChild(valueInputContainer);
  container.appendChild(propChangeWrapper);

  bar.style.display = 'flex';
}

// ==========================================
// 16. NOTE TEMPLATE ENGINE & DAILY AUTO-CREATOR
// ==========================================

function createTemplateFromActiveNote() {
  const activeNote = getActiveNote();
  if (!activeNote) {
    alert('現在開いているノートがありません。');
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
    blocks: structuredClone(activeNote.blocks)
  };

  state.notes.push(newTemplate);
  saveNotesToStorage();
  
  alert(`テンプレート「${templateTitle}」を登録しました。`);
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
    blocks: structuredClone(template.blocks)
  };

  state.notes.push(newNote);
  saveNotesToStorage();
  navigateToNote(newNote.id);
}

function createDailyNote() {
  const today = new Date();
  const titleStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

  // すでに今日のデイリーがある場合はそれを開く
  let existing = state.notes.find(n => n.title === titleStr && !n.isTemplate);
  if (existing) {
    navigateToNote(existing.id);
    return;
  }

  // デフォルトデイリーテンプレートを探す
  const defaultTemplate = state.notes.find(n => n.isTemplate && n.isDailyDefault);

  const newNote = {
    id: 'note-' + generateId(),
    title: titleStr,
    folderId: state.dailyFolderId || null,
    updatedAt: Date.now(),
    isTemplate: false,
    templateSourceId: defaultTemplate ? defaultTemplate.id : null,
    blocks: defaultTemplate ? structuredClone(defaultTemplate.blocks) : [
      { id: generateId(), type: 'p', content: '今日の作業ログやメモを記入しましょう。' }
    ]
  };

  state.notes.push(newNote);
  saveNotesToStorage();
  navigateToNote(newNote.id);
}

function overwriteTemplateFromActiveDaily() {
  const activeNote = getActiveNote();
  if (!activeNote || !activeNote.templateSourceId) return;

  const template = state.notes.find(n => n.id === activeNote.templateSourceId && n.isTemplate);
  if (!template) {
    alert('元のテンプレートが見つかりません。');
    return;
  }

  if (confirm(`現在のページ「${activeNote.title}」のブロック構成で、元のテンプレート「${template.title}」を上書き更新しますか？\n（次回からこの構成で新規ページが自動作成されます）`)) {
    pushHistory();
    template.blocks = structuredClone(activeNote.blocks);
    template.updatedAt = Date.now();
    saveNotesToStorage();
    alert(`テンプレート「${template.title}」を正常に更新しました！`);
    renderEditor();
  }
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
        alert(`デイリーのデフォルトテンプレートを「${tpl.title}」に設定しました。`);
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
}

// ==========================================
// 13. INITIALIZATION CALL
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  initStorage();

  // Accordion Toggles
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('open');
    });
  });

  // ポモドーロタイマーセクション自体のトグル（畳み込みバグ修正）
  const pomodoroToggle = document.getElementById('pomodoro-toggle');
  if (pomodoroToggle) {
    pomodoroToggle.addEventListener('click', () => {
      pomodoroToggle.classList.toggle('collapsed');
    });
  }

  // Volume Slider の初期化とイベントバインド
  const volumeSlider = document.getElementById('volumeSlider');
  if (volumeSlider) {
    volumeSlider.value = timerVolume;
    volumeSlider.addEventListener('input', (evt) => {
      timerVolume = parseFloat(evt.target.value);
      savePomodoroData();
    });
  }

  // Note Manager
  renderNoteList();
  renderEditor();
  updateTimerTargetTableSelect();

  // メモの下段の枠外をクリックしたら行追加
  if (blockCanvas) {
    blockCanvas.addEventListener('click', (e) => {
      if (e.target === blockCanvas) {
        const note = getActiveNote();
        if (!note) return;

        // すでに最後のブロックが空の段落であれば、新しく追加せずそこにフォーカスする
        const lastBlock = note.blocks[note.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'p' && (!lastBlock.content || lastBlock.content.trim() === '')) {
          const el = document.querySelector(`.block-content[data-id="${lastBlock.id}"]`);
          if (el) el.focus();
          return;
        }

        // 新規ブロックを追加
        pushHistory();
        const newBlock = { id: generateId(), type: 'p', content: '' };
        note.blocks.push(newBlock);
        saveNotesToStorage();
        renderEditor();

        // 追加された新規ブロックにフォーカスを当てる
        setTimeout(() => {
          const el = document.querySelector(`.block-content[data-id="${newBlock.id}"]`);
          if (el) el.focus();
        }, 50);
      }
    });
  }

  // Sidebar actions init
  const newFolderBtn = document.getElementById('new-folder-btn');
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => {
      const newFolder = {
        id: 'folder-' + generateId(),
        name: '新規フォルダ',
        parentId: null,
        updatedAt: Date.now()
      };
      state.folders.push(newFolder);
      saveNotesToStorage();
      renderNoteList();
    });
  }

  const dailyNoteBtn = document.getElementById('daily-note-btn');
  if (dailyNoteBtn) {
    dailyNoteBtn.addEventListener('click', () => {
      createDailyNote();
    });
  }

  const templatesBtn = document.getElementById('templates-btn');
  if (templatesBtn) {
    templatesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTemplatesPopover(e);
    });
  }

  // Sidebar drag & drop root listeners
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

  // Pomodoro
  loadPomodoroData();
  renderPomodoro();

  // Analytics & Backlinks
  renderAnalytics();
  updateBacklinks();

  // History Navigation Button Listeners
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

  updateHistoryButtons();

  // Global keydown listener for Undo / Redo
  window.addEventListener('keydown', (e) => {
    // Ctrl + Z (Undo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    // Ctrl + Y (Redo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });
});

// ==========================================
// 17. POMODORO DUAL SYNC ACTIONS
// ==========================================

let timerTargetTableName = localStorage.getItem('timer_target_table_name') || '';

function updateTimerTargetTableSelect() {
  const select = document.getElementById('timerTargetTableSelect');
  if (!select) return;

  select.innerHTML = '';

  const activeNote = getActiveNote();
  if (!activeNote) {
    select.innerHTML = '<option value="">ノートなし</option>';
    return;
  }

  // アクティブノートからすべてのデータベースブロックを再帰的に収集
  const dbBlocks = [];
  function collect(blocksArr) {
    blocksArr.forEach(b => {
      if (b.type === 'database') {
        dbBlocks.push(b);
      }
      if (b.children && b.children.length > 0) {
        collect(b.children);
      }
    });
  }
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

  // 現在選択されている名前のテーブルがなければ、最初のテーブルをデフォルトにする
  if (select.value) {
    timerTargetTableName = select.value;
    localStorage.setItem('timer_target_table_name', timerTargetTableName);
  }
}

function changeTargetTable() {
  const select = document.getElementById('timerTargetTableSelect');
  if (select) {
    timerTargetTableName = select.value;
    localStorage.setItem('timer_target_table_name', timerTargetTableName);
  }
}

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

function getFormattedTime() {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
}

function insertPomodoroStartToActiveTable(taskName, durationMs) {
  const activeNote = getActiveNote();
  if (!activeNote) return;

  const dbBlock = findTargetDatabaseBlock(activeNote.blocks, timerTargetTableName);
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
      if (!col.options.includes(taskName || '作業セッション')) {
        col.options.push(taskName || '作業セッション');
      }
      newRow[col.id] = taskName || '作業セッション';
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

function insertPomodoroLogToActiveNoteDb(taskName, durationMin) {
  const activeNote = getActiveNote();
  if (!activeNote) return;

  const dbBlock = findTargetDatabaseBlock(activeNote.blocks, timerTargetTableName);
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
      if (!col.options.includes(taskName || '作業セッション')) {
        col.options.push(taskName || '作業セッション');
      }
      targetRow[col.id] = taskName || '作業セッション';
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
        if (!col.options.includes(taskName || '作業セッション')) {
          col.options.push(taskName || '作業セッション');
        }
        newRow[col.id] = taskName || '作業セッション';
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
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  
  const format = col ? (col.numberFormat || 'plain') : 'plain';
  if (format === 'currency') {
    return '¥' + num.toLocaleString('ja-JP');
  } else if (format === 'percent') {
    return num + '%';
  } else if (format === 'custom' && col.customUnit) {
    return num.toLocaleString('ja-JP') + col.customUnit;
  }
  return num.toLocaleString('ja-JP'); // デフォルトも3桁カンマ区切りにして美しく
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
            tagColor = getTagColor(val) || 'gray';
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
              badgeContent += `<span class="db-select-badge db-tag-${getTagColor(val)}" style="font-size:8px; padding: 0px 2.5px; border-radius: 2px; line-height: 1.1; scale: 0.95; white-space: nowrap;">${escapeHTML(val)}</span>`;
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
      filters: []
    };
    block.properties.views = [activeView];
    block.properties.activeViewId = activeView.id;
  } else {
    activeView.chartTimeRange = activeView.chartTimeRange || 'all';
    activeView.chartDateGroup = activeView.chartDateGroup || 'month';
    activeView.chartRenderType = activeView.chartRenderType || 'split'; // 🆕 表示形式のデフォルト値
    activeView.chartTagMode = activeView.chartTagMode || 'all'; // 🆕 'all' or 'single'
    activeView.chartSelectedTag = activeView.chartSelectedTag !== undefined ? activeView.chartSelectedTag : ''; // 🆕 選択された単一のタグ文字列
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
  xColLabel.innerHTML = '<i class="fa-solid fa-tags" style="color:var(--accent-secondary);"></i> グループ';
  
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

  // 🆕 表示対象（全タグ・タグ指定トグルタブ ＆ プルダウンセレクト）の新設
  const tagFilterWrapper = document.createElement('div');
  tagFilterWrapper.style = 'display: flex; align-items: center; gap: 8px;';

  const tabContainer = document.createElement('div');
  tabContainer.className = 'chart-tab-container';
  tabContainer.style = 'display: flex; background: rgba(255,255,255,0.06); padding: 2px; border-radius: 6px; border: 1px solid var(--border-light);';

  const tabAll = document.createElement('button');
  tabAll.style = `padding: 2px 8px; font-size: 11px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; background: ${activeView.chartTagMode === 'all' ? 'var(--accent-primary)' : 'transparent'}; color: ${activeView.chartTagMode === 'all' ? '#fff' : 'var(--text-secondary)'}; transition: all 0.2s ease;`;
  tabAll.textContent = '全タグ';
  tabAll.addEventListener('click', (e) => {
    e.stopPropagation();
    activeView.chartTagMode = 'all';
    saveNotesToStorage();
    renderEditor();
  });

  const tabSelect = document.createElement('button');
  tabSelect.style = `padding: 2px 8px; font-size: 11px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; background: ${activeView.chartTagMode === 'single' ? 'var(--accent-primary)' : 'transparent'}; color: ${activeView.chartTagMode === 'single' ? '#fff' : 'var(--text-secondary)'}; transition: all 0.2s ease;`;
  tabSelect.textContent = 'タグ指定';
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

    // 初期値が空、またはタグ一覧に存在しない場合、最初のタグ名に設定
    if (!activeView.chartSelectedTag || !uniqueTags.has(activeView.chartSelectedTag)) {
      activeView.chartSelectedTag = tagList[0] || '';
    }

    const selectEl = document.createElement('select');
    selectEl.className = 'db-filter-val-select';
    selectEl.style.fontSize = '11px';
    selectEl.style.padding = '2px 6px';
    
    if (tagList.length === 0) {
      selectEl.innerHTML = '<option value="">タグなし</option>';
      selectEl.disabled = true;
    } else {
      selectEl.innerHTML = tagList.map(tag => `
        <option value="${escapeHTML(tag)}" ${activeView.chartSelectedTag === tag ? 'selected' : ''}>${escapeHTML(tag)}</option>
      `).join('');
    }

    selectEl.addEventListener('change', (e) => {
      e.stopPropagation();
      activeView.chartSelectedTag = selectEl.value;
      saveNotesToStorage();
      renderEditor();
    });

    tagFilterWrapper.appendChild(selectEl);
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

  // 右側の「フィルターを追加」ボタン（軸設定ボタンの代わり）
  const headerRight = document.createElement('div');
  const filterBtn = document.createElement('button');
  filterBtn.className = 'btn-secondary';
  filterBtn.innerHTML = '<i class="fa-solid fa-filter"></i> フィルターを追加';
  filterBtn.style.padding = '4px 8px; font-size:11px;';
  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showFilterConfigPopover(e, block, activeView);
  });
  headerRight.appendChild(filterBtn);
  controlHeader.appendChild(headerRight);

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
    start.setHours(0,0,0,0);
    
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23,59,59,999);
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

    // 2.5 表示対象タグのフィルタリング (単一タグ指定モード時のみ)
    if (activeView.chartTagMode === 'single' && activeView.chartSelectedTag !== undefined) {
      if (tagVal !== activeView.chartSelectedTag) {
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
    const total = Object.values(tagObj).reduce((a, b) => a + b, 0);
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
    centerText.setAttribute('y', centerY - 4);
    centerText.setAttribute('fill', 'var(--text-secondary)');
    centerText.setAttribute('font-size', '10px');
    centerText.setAttribute('font-weight', '600');
    centerText.setAttribute('text-anchor', 'middle');
    centerText.textContent = '合計';
    svg.appendChild(centerText);

    const sumValText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sumValText.setAttribute('x', centerX);
    sumValText.setAttribute('y', centerY + 14);
    sumValText.setAttribute('fill', '#fff');
    sumValText.setAttribute('font-size', '13px');
    sumValText.setAttribute('font-weight', '800');
    sumValText.setAttribute('text-anchor', 'middle');
    sumValText.textContent = formatChartValue(totalSum, yCol);
    svg.appendChild(sumValText);

    const legendX = 350;
    const legendYStart = 80;
    
    legends.forEach((leg, legIdx) => {
      const legY = legendYStart + legIdx * 22;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', legendX);
      rect.setAttribute('y', legY - 8);
      rect.setAttribute('width', '12');
      rect.setAttribute('height', '12');
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', leg.color);
      svg.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', legendX + 20);
      text.setAttribute('y', legY + 2);
      text.setAttribute('fill', 'var(--text-primary)');
      text.setAttribute('font-size', '11px');
      text.setAttribute('font-weight', '600');
      
      const displayLabel = leg.label.length > 15 ? leg.label.substring(0, 14) + '..' : leg.label;
      text.textContent = displayLabel;
      svg.appendChild(text);

      const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valText.setAttribute('x', legendX + 150);
      valText.setAttribute('y', legY + 2);
      valText.setAttribute('fill', 'var(--text-secondary)');
      valText.setAttribute('font-size', '10px');
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



