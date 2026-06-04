// wikilinks.js - WikiLinks Parser & Autocomplete Engine

import { state, getActiveNormalNotes, getActiveNote, saveNotesToStorage } from './state.js';
import { escapeHTML } from './utils.js';

// HTMLからWikiText（生ブラケット）への逆シリアライザ
export function serializeHtmlToWikiText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  
  // 1. WikiLink の逆パース
  const links = clone.querySelectorAll('.wiki-link');
  links.forEach(link => {
    const target = link.textContent || link.getAttribute('data-target') || '';
    const isJp = link.getAttribute('data-bracket') === 'jp';
    const open = isJp ? '「「' : '[[';
    const close = isJp ? '」」' : ']]';
    const textNode = document.createTextNode(`${open}${target}${close}`);
    link.parentNode.replaceChild(textNode, link);
  });

  // 2. 外部リンクの逆パース
  const extLinks = clone.querySelectorAll('.external-link');
  extLinks.forEach(link => {
    const label = link.textContent || '';
    const url = link.getAttribute('href') || '';
    const textNode = document.createTextNode(`[${label}](${url})`);
    link.parentNode.replaceChild(textNode, link);
  });

  // 3. 編集中の外部リンクの逆パース
  const extEditLinks = clone.querySelectorAll('.external-link-edit');
  extEditLinks.forEach(link => {
    const textNode = document.createTextNode(link.textContent);
    link.parentNode.replaceChild(textNode, link);
  });

  return clone.textContent;
}

// Regex for wiki links
const WIKI_LINK_REGEX = /\[\[(.*?)\]\]/g;
const JP_LINK_REGEX = /「「(.*?)」」/g;

export function parseWikiLinks(htmlContent) {
  if (!htmlContent) return '';

  let parsed = htmlContent;

  const replaceLink = (match, noteTitle) => {
    const trimmedTitle = noteTitle.trim();
    if (!trimmedTitle) return match;

    const exists = state.notes.some(note => note.title.toLowerCase() === trimmedTitle.toLowerCase());
    const className = exists ? 'wiki-link' : 'wiki-link wiki-link-new';
    const tooltip = exists ? 'ノートを開く' : 'ノートを自動作成して開く';

    const isJp = match.startsWith('「「');
    const bracketAttr = isJp ? 'data-bracket="jp"' : 'data-bracket="en"';

    return `<span class="${className}" data-target="${escapeHTML(trimmedTitle)}" ${bracketAttr} title="${tooltip}">${escapeHTML(noteTitle)}</span>`;
  };

  parsed = parsed.replace(WIKI_LINK_REGEX, replaceLink);
  parsed = parsed.replace(JP_LINK_REGEX, replaceLink);

  // 外部リンクのパース [label](url) を <a> に変換
  parsed = parsed.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, (match, label, url) => {
    const decodedUrl = url.replace(/&amp;/g, '&');
    return `<a class="external-link" href="${escapeHTML(decodedUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(decodedUrl)}">${escapeHTML(label)}</a>`;
  });

  return parsed;
}

export function handleWikiLinkTrigger(contentDiv, e) {
  const text = contentDiv.textContent;
  const cursorIdx = getCaretCharacterOffsetWithin(contentDiv);
  const leftText = text.substring(0, cursorIdx);

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

  const linkMenu = document.getElementById('link-menu');

  if (triggerIdx !== -1) {
    const searchString = leftText.substring(triggerIdx + 2);

    if (searchString.includes(']]') || searchString.includes('」」')) {
      closeLinkMenu();
      return;
    }

    state.linkMenuOpen = true;
    state.linkTriggerPos = {
      index: triggerIdx,
      type: triggerType,
      search: searchString,
      originalLength: searchString.length
    };

    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    if (linkMenu) {
      linkMenu.style.left = `${rect.left}px`;
      linkMenu.style.top = `${rect.bottom + window.scrollY + 6}px`;
      linkMenu.style.display = 'block';
    }

    const linkMenuSearchInput = document.getElementById('link-menu-search-input');
    if (linkMenuSearchInput && document.activeElement !== linkMenuSearchInput) {
      linkMenuSearchInput.value = searchString;
    }

    renderLinkMenuList(searchString);
  } else {
    closeLinkMenu();
  }
}

export function renderLinkMenuList(searchQuery) {
  const linkMenuList = document.getElementById('link-menu-list');
  if (!linkMenuList) return;
  linkMenuList.innerHTML = '';

  const filtered = getActiveNormalNotes().filter(n =>
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
        linkMenuList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        state.linkMenuActiveIndex = idx;
        selectLinkMenuItem();
      };
      linkMenuList.appendChild(li);
    });
  }

  state.linkMenuActiveIndex = Math.min(state.linkMenuActiveIndex, Math.max(0, filtered.length - 1));
}

export function navigateLinkMenu(dir) {
  const linkMenuList = document.getElementById('link-menu-list');
  if (!linkMenuList) return;
  const items = linkMenuList.querySelectorAll('li:not(.no-match)');
  if (items.length === 0) return;
  state.linkMenuActiveIndex = (state.linkMenuActiveIndex + dir + items.length) % items.length;

  items.forEach((li, idx) => {
    if (idx === state.linkMenuActiveIndex) {
      li.classList.add('active');
      li.scrollIntoView({ block: 'nearest' });
    } else {
      li.classList.remove('active');
    }
  });
}

export function selectLinkMenuItem() {
  let activeContentDiv = state.lastActiveEditTarget;
  if (!activeContentDiv || (!activeContentDiv.classList.contains('block-content') && !activeContentDiv.classList.contains('db-cell-edit'))) {
    activeContentDiv = document.activeElement;
  }
  if (!activeContentDiv || (!activeContentDiv.classList.contains('block-content') && !activeContentDiv.classList.contains('db-cell-edit'))) {
    activeContentDiv = document.querySelector(`.block-content[data-id="${state.activeFocusedBlockId}"]`);
  }
  if (!activeContentDiv) return;

  activeContentDiv.focus();

  const searchQuery = state.linkTriggerPos ? state.linkTriggerPos.search : '';
  const filtered = getActiveNormalNotes().filter(n =>
    n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  let noteTitle = '';
  if (filtered.length > 0 && state.linkMenuActiveIndex >= 0 && state.linkMenuActiveIndex < filtered.length) {
    noteTitle = filtered[state.linkMenuActiveIndex].title;
  } else {
    noteTitle = searchQuery;
  }

  const isJp = state.linkTriggerPos && state.linkTriggerPos.type === '「「';
  const openBracket = isJp ? '「「' : '[[';
  const closeBracket = isJp ? '」」' : ']]';
  const completedLink = `${openBracket}${noteTitle}${closeBracket}`;

  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const endNode = range.endContainer;
    const endOffset = range.endOffset;

    const origLen = (state.linkTriggerPos && state.linkTriggerPos.originalLength !== undefined)
      ? state.linkTriggerPos.originalLength
      : searchQuery.length;
    const backLength = 2 + origLen;

    if (endNode.nodeType === Node.TEXT_NODE && endOffset >= backLength) {
      range.setStart(endNode, endOffset - backLength);
    } else {
      const caretOffset = getCaretCharacterOffsetWithin(activeContentDiv);
      const startOffset = Math.max(0, caretOffset - backLength);
      const startPos = findDOMPosition(activeContentDiv, startOffset);
      if (startPos) {
        range.setStart(startPos.node, startPos.offset);
      }
    }

    range.deleteContents();
    const newTextNode = document.createTextNode(completedLink);
    range.insertNode(newTextNode);

    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(newTextNode);
    newRange.collapse(true);
    sel.addRange(newRange);
  }

  const note = getActiveNote();
  if (note) {
    if (activeContentDiv.classList.contains('block-content')) {
      if (window.Notidian && typeof window.Notidian.findBlockAndParent === 'function') {
        const found = window.Notidian.findBlockAndParent(note.blocks, state.activeFocusedBlockId);
        if (found) found.block.content = activeContentDiv.textContent;
      }
    } else if (activeContentDiv.classList.contains('db-cell-edit')) {
      const tr = activeContentDiv.closest('tr');
      const td = activeContentDiv.closest('td');
      if (tr && td) {
        const tableContainer = tr.closest('.database-container');
        if (tableContainer) {
          const blockWrapper = tableContainer.closest('.block-wrapper');
          const blockId = blockWrapper ? blockWrapper.getAttribute('data-id') : null;
          if (window.Notidian && typeof window.Notidian.findBlockAndParent === 'function') {
            const found = window.Notidian.findBlockAndParent(note.blocks, blockId);
            if (found && found.block.properties && found.block.properties.rows) {
              const rowIndex = Array.from(tr.parentNode.children).indexOf(tr);
              const colId = td.getAttribute('data-col-id');
              const rowDataList = found.block.properties.rows;
              const row = rowDataList[rowIndex];
              if (row && colId) {
                row[colId] = activeContentDiv.textContent;

                const tableEl = tr.closest('table');
                if (window.Notidian && typeof window.Notidian.recalculateTableFooter === 'function') {
                  window.Notidian.recalculateTableFooter(tableEl, found.block, rowDataList);
                }
              }
            }
          }
        }
      }
    }
  }

  closeLinkMenu();
  saveNotesToStorage();
}

export function closeLinkMenu() {
  state.linkMenuOpen = false;
  const linkMenu = document.getElementById('link-menu');
  if (linkMenu) linkMenu.style.display = 'none';
  state.linkTriggerPos = null;
  state.linkMenuActiveIndex = 0;
  const linkMenuSearchInput = document.getElementById('link-menu-search-input');
  if (linkMenuSearchInput) {
    linkMenuSearchInput.value = '';
  }
}

export function initLinkMenuSearchEvents() {
  const linkMenuSearchInput = document.getElementById('link-menu-search-input');
  if (!linkMenuSearchInput) return;

  linkMenuSearchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (state.linkTriggerPos) {
      state.linkTriggerPos.search = val;
    }
    renderLinkMenuList(val);
  });

  linkMenuSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateLinkMenu(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateLinkMenu(-1);
    } else if (e.key === 'Enter') {
      if (e.isComposing) return;
      e.preventDefault();
      selectLinkMenuItem();
    }
  });
}

// Helpers
function getCaretCharacterOffsetWithin(element) {
  let caretOffset = 0;
  const doc = element.ownerDocument || element.document;
  const win = doc.defaultView || doc.parentWindow;
  const sel = win.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    caretOffset = preCaretRange.toString().length;
  }
  return caretOffset;
}

function findDOMPosition(container, offset) {
  let charCount = 0;
  const nodeQueue = [container];
  while (nodeQueue.length > 0) {
    const node = nodeQueue.shift();
    if (node.nodeType === Node.TEXT_NODE) {
      const nextCharCount = charCount + node.length;
      if (offset >= charCount && offset <= nextCharCount) {
        return { node: node, offset: offset - charCount };
      }
      charCount = nextCharCount;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        nodeQueue.push(node.childNodes[i]);
      }
    }
  }
  return null;
}

export function checkAndInsertPairBrackets(contentDiv) {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const offset = range.startOffset;
      const beforeText = text.substring(0, offset);

      // 直前の2文字が「「または[[であるかチェック
      const lastTwo = beforeText.substring(beforeText.length - 2);
      if (lastTwo === '「「' || lastTwo === '[[') {
        const isJp = lastTwo === '「「';
        const closeBracket = isJp ? '」」' : ']]';

        // カーソルの直後にすでに閉じカッコが存在するかどうかを確認（存在する場合は二重挿入しない）
        const afterText = text.substring(offset);
        if (!afterText.startsWith(closeBracket)) {
          // 閉じカッコを挿入
          node.textContent = beforeText + closeBracket + afterText;
          
          // カーソル位置を元の位置（カッコの間）に戻す
          const newRange = document.createRange();
          newRange.setStart(node, offset);
          newRange.setEnd(node, offset);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    }
  }
}
