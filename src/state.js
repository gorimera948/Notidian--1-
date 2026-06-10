// state.js - Application State & History Management

import { isSameContent, generateId } from './utils.js';

export const state = {
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
  dropTargetSidebarId: null, // ID of folder target being hovered
  collapsedFavorites: false,
  selectedBlockIds: [],
  copiedRowData: null,
  copiedBlocksData: null,
  lastActiveEditTarget: null,
  lastSelectedBlockId: null,
  isComposing: false,
  customTagColors: {},

  // スプリットペイン関連
  isSplit: false,
  activePaneIndex: 0,
  panes: [
    { activeNoteId: null, noteHistory: [], historyIndex: -1 },
    { activeNoteId: null, noteHistory: [], historyIndex: -1 }
  ]
};

export const historyState = {
  undoStack: [],
  redoStack: [],
  isApplying: false
};

export function pushHistory() {
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

export function undo() {
  // アンドゥ実行前に、現在編集中（フォーカスされている）要素があればその変更を同期的に強制適用してから blur させる
  if (document.activeElement && (document.activeElement.classList.contains('block-content') || document.activeElement.classList.contains('db-cell-edit'))) {
    const el = document.activeElement;
    
    // 履歴適用フラグをあらかじめ立てておくことで、blurによる非同期イベントの自動保存が履歴破壊することを防ぐ
    historyState.isApplying = true;

    try {
      const activeNote = getActiveNote();
      if (activeNote) {
        if (el.classList.contains('block-content') && state.activeFocusedBlockId) {
          if (window.Notidian && typeof window.Notidian.findBlockAndParent === 'function' && typeof window.Notidian.serializeHtmlToWikiText === 'function') {
            const found = window.Notidian.findBlockAndParent(activeNote.blocks, state.activeFocusedBlockId);
            if (found && found.block) {
              found.block.content = window.Notidian.serializeHtmlToWikiText(el);
            }
          }
        } else if (el.classList.contains('db-cell-edit')) {
          const tr = el.closest('tr');
          const td = el.closest('td');
          const dbContainer = el.closest('.database-container');
          const blockWrapper = dbContainer ? dbContainer.closest('.block-wrapper') : null;
          const blockId = blockWrapper ? blockWrapper.getAttribute('data-id') : null;
          
          if (blockId && window.Notidian && typeof window.Notidian.findBlockAndParent === 'function' && typeof window.Notidian.serializeHtmlToWikiText === 'function') {
            const found = window.Notidian.findBlockAndParent(activeNote.blocks, blockId);
            if (found && found.block && found.block.properties && found.block.properties.rows) {
              const rowIdx = Array.from(tr.parentNode.children).indexOf(tr);
              const colId = td.getAttribute('data-col-id');
              const row = found.block.properties.rows[rowIdx];
              if (row && colId) {
                const col = found.block.properties.columns.find(c => c.id === colId);
                if (col) {
                  let newVal;
                  if (col.type === 'text' || !col.type) {
                    newVal = window.Notidian.serializeHtmlToWikiText(el).trim();
                  } else {
                    newVal = el.textContent.trim();
                    if (col.type === 'number') {
                      const parsed = parseFloat(newVal);
                      newVal = isNaN(parsed) ? '' : parsed;
                    }
                  }
                  row[colId] = newVal;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Failed to sync active element before undo:", e);
    }

    if (typeof el.blur === 'function') {
      el.blur();
    }
    
    // 一旦解除して、次の pushHistory で確実に今の状態を保存させる
    historyState.isApplying = false;
  }

  // 現在の状態を確実にヒストリへ追加して同期
  pushHistory();

  // 戻そうとする状態が、現在の状態と「コンテンツ的に同じ」である間は、無駄な履歴（ミリ秒の更新など）なのでスタックから削除（pop）し続ける
  const currentNotes = state.notes;
  while (historyState.undoStack.length > 1) {
    const prevStateStr = historyState.undoStack[historyState.undoStack.length - 1];
    try {
      const prevState = JSON.parse(prevStateStr);
      if (!isSameContent(currentNotes, prevState)) {
        break;
      }
    } catch (e) {
      break;
    }
    historyState.undoStack.pop(); // コンテンツが同じなら無駄な履歴なのでスタックから捨てる
  }

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
  if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
    window.Notidian.renderNoteList();
  }
  if (window.Notidian && typeof window.Notidian.renderEditor === 'function') {
    window.Notidian.renderEditor();
  }

  historyState.isApplying = false;
}

export function redo() {
  if (historyState.redoStack.length === 0) return;

  historyState.isApplying = true;

  // Redoスタックから取り出して適用
  const nextState = historyState.redoStack.pop();
  historyState.undoStack.push(nextState);

  state.notes = JSON.parse(nextState);

  // ローカルストレージに保存し、エディタを再描画
  localStorage.setItem('notidian_notes', JSON.stringify(state.notes));
  if (window.Notidian && typeof window.Notidian.renderNoteList === 'function') {
    window.Notidian.renderNoteList();
  }
  if (window.Notidian && typeof window.Notidian.renderEditor === 'function') {
    window.Notidian.renderEditor();
  }

  historyState.isApplying = false;
}

export function getActiveNormalNotes() {
  return state.notes.filter(note => !note.isTemplate);
}

export function getActiveNote() {
  return state.notes.find(n => n.id === state.activeNoteId);
}

export function cleanDeadWikiLinksAndTags() {
  // 1. 親フォルダが存在しないゾンビノートをデータベースから完全に物理抹消！
  state.notes = state.notes.filter(note =>
    !note.folderId || state.folders.some(f => f.id === note.folderId)
  );

  const activeNotes = getActiveNormalNotes();

  activeNotes.forEach(note => {
    // ノートに付いているタグ配列から、空のタグや無効なタグを自動除外
    if (note.tags && Array.isArray(note.tags)) {
      note.tags = note.tags.filter(t => t && String(t).trim() !== '');
    }
  });

  // サイドバーの既存タグ候補（datalist）を最新の綺麗な状態に完全再構築
  if (window.Notidian && typeof window.Notidian.updateExistingTagsDatalist === 'function') {
    window.Notidian.updateExistingTagsDatalist();
  }
}

export function saveNotesToStorage() {
  cleanDeadWikiLinksAndTags();
  pushHistory();
  localStorage.setItem('notidian_notes', JSON.stringify(state.notes));
  localStorage.setItem('notidian_folders', JSON.stringify(state.folders));
  localStorage.setItem('notidian_collapsed_folders', JSON.stringify(state.collapsedFolders));
  localStorage.setItem('notidian_daily_folder_id', state.dailyFolderId || '');

  if (window.Notidian && window.Notidian.mindMapInstance) {
    window.Notidian.mindMapInstance.updateData();
  }
}

export function saveCustomTagColorsToStorage() {
  localStorage.setItem('notidian_custom_tag_colors', JSON.stringify(state.customTagColors));
  if (window.Notidian && window.Notidian.mindMapInstance) {
    window.Notidian.mindMapInstance.updateData();
  }
}

export function saveLogsToStorage() {
  localStorage.setItem('notidian_focus_logs', JSON.stringify(state.focusLogs));
  if (window.Notidian && typeof window.Notidian.renderAnalytics === 'function') {
    window.Notidian.renderAnalytics();
  }
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
      { id: generateId(), type: 'bullet', content: '半角二重カッコ `[[` と入力すると、既存ノート of 補完ポップアップが表示されます。' },
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

export function initStorage() {
  state.collapsedFavorites = localStorage.getItem('notidian_collapsed_favorites') === 'true';
  state.collapsedEmptyNotes = localStorage.getItem('notidian_collapsed_empty_notes') === 'true';

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
    // Generate dummy logs
    const today = new Date();
    const dummyLogs = [];
    const tasks = ['アプリ開発', 'ブログ執筆', '読書', 'デザイン調整'];
    for (let i = 5; i >= 1; i--) {
      const pastDate = new Date();
      pastDate.setDate(today.getDate() - i);
      const dateString = pastDate.toLocaleDateString('ja-JP');

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

  // Load Split Pane State
  // 常にデフォルトは1画面（非分割）とする
  state.isSplit = false;
  state.activePaneIndex = 0;

  // Load Active Note Id
  const savedActiveId = localStorage.getItem('notidian_active_note_id');
  let firstNoteId = null;
  if (savedActiveId && Array.isArray(state.notes) && state.notes.some(n => n.id === savedActiveId)) {
    firstNoteId = savedActiveId;
  } else if (Array.isArray(state.notes) && state.notes.length > 0) {
    firstNoteId = state.notes[0].id;
  }
  state.activeNoteId = firstNoteId;

  // Initialize panes
  state.panes = [
    { activeNoteId: firstNoteId, noteHistory: firstNoteId ? [firstNoteId] : [], historyIndex: firstNoteId ? 0 : -1 },
    { activeNoteId: null, noteHistory: [], historyIndex: -1 }
  ];

  // Restore right pane if saved
  const savedRightActiveId = localStorage.getItem('notidian_right_active_note_id');
  if (savedRightActiveId && Array.isArray(state.notes) && state.notes.some(n => n.id === savedRightActiveId)) {
    state.panes[1].activeNoteId = savedRightActiveId;
    state.panes[1].noteHistory = [savedRightActiveId];
    state.panes[1].historyIndex = 0;
  } else if (firstNoteId && state.isSplit) {
    state.panes[1].activeNoteId = firstNoteId;
    state.panes[1].noteHistory = [firstNoteId];
    state.panes[1].historyIndex = 0;
  }

  // Set the global activeNoteId to correspond to the active pane
  const currentActivePane = state.panes[state.activePaneIndex];
  if (currentActivePane && currentActivePane.activeNoteId) {
    state.activeNoteId = currentActivePane.activeNoteId;
    state.noteHistory = currentActivePane.noteHistory;
    state.historyIndex = currentActivePane.historyIndex;
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
    if (note.tags === undefined) note.tags = [];

    if (note.sortIndex === undefined) {
      note.sortIndex = note.updatedAt || (Date.now() - idx * 1000);
    }

    if (note.blocks && Array.isArray(note.blocks)) {
      const repairBlocks = (blocksArr) => {
        blocksArr.forEach(b => {
          if (b.type === 'database') {
            b.properties = b.properties || {};
            b.properties.columns = b.properties.columns || [];
            b.properties.rows = b.properties.rows || [];
            b.properties.views = b.properties.views || [];

            b.properties.views.forEach(v => {
              if (v.type === 'chart') {
                v.chartTimeRange = v.chartTimeRange || 'all';
                v.chartDateGroup = v.chartDateGroup || 'month';
                v.chartRenderType = v.chartRenderType || 'split';
                v.chartTagMode = v.chartTagMode || 'all';

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

  // Load Custom Tag Colors
  try {
    const savedColors = localStorage.getItem('notidian_custom_tag_colors');
    state.customTagColors = savedColors ? JSON.parse(savedColors) : {};
  } catch (e) {
    console.error("Failed to parse custom tag colors:", e);
    state.customTagColors = {};
  }

  cleanDeadWikiLinksAndTags();

  // 初期の履歴状態を保存
  try {
    historyState.undoStack = [JSON.stringify(state.notes)];
  } catch (e) {
    console.error("Failed to save undo stack:", e);
    historyState.undoStack = [];
  }
}
