import { generateId } from './utils.js';

const TYPES = { terminal: '開始・終了', process: '作業', decision: '分岐' };
const WIDTH = 148;
const HEIGHT = 76;
const PAD = 16;
const MAX_POSITION = 6000;
const SVG = 'http://www.w3.org/2000/svg';

const coordinate = value => Number.isFinite(value) ? Math.max(PAD, Math.min(MAX_POSITION, Math.round(value))) : PAD;
const label = value => typeof value === 'string' ? value.slice(0, 100) : '';
const makeNode = (type, text, x, y) => ({ id: generateId(), type, label: label(text), x: coordinate(x), y: coordinate(y) });

export function createFlowchartProperties(initialText = '') {
  const nodes = [
    makeNode('terminal', '開始', 64, 24),
    makeNode('process', initialText || '作業', 64, 134),
    makeNode('terminal', '終了', 64, 244)
  ];
  return { nodes, edges: nodes.slice(1).map((node, i) => ({
    id: generateId(), from: nodes[i].id, to: node.id, label: ''
  })) };
}

function validChart(properties) {
  const nodes = [], edges = [];
  const ids = new Set(), edgeIds = new Set();
  for (const node of Array.isArray(properties?.nodes) ? properties.nodes : []) {
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !Object.hasOwn(TYPES, node.type)) continue;
    ids.add(node.id);
    nodes.push({ id: node.id, type: node.type, label: label(node.label), x: coordinate(node.x), y: coordinate(node.y) });
  }
  for (const edge of Array.isArray(properties?.edges) ? properties.edges : []) {
    if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id) ||
        edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to)) continue;
    edgeIds.add(edge.id);
    edges.push({ id: edge.id, from: edge.from, to: edge.to, label: label(edge.label) });
  }
  return { nodes, edges };
}

function element(tag, className, content) {
  const el = document.createElement(tag);
  el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
}

function button(className, text, click) {
  const el = element('button', className, text);
  el.type = 'button';
  el.addEventListener('click', click);
  return el;
}

function svgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function borderPoint(node, dx, dy) {
  const x = node.x + WIDTH / 2, y = node.y + HEIGHT / 2;
  const horizontal = Math.abs(dx) / (WIDTH / 2);
  const vertical = Math.abs(dy) / (HEIGHT / 2);
  const scale = 1 / (node.type === 'decision' ? horizontal + vertical : Math.max(horizontal, vertical));
  return [x + dx * scale, y + dy * scale];
}

function createBoard(chart, interactions) {
  const scroller = element('div', 'flowchart-scroll');
  const board = element('div', 'flowchart-board');
  const lines = svgElement('svg', { class: 'flowchart-lines' });
  const arrows = svgElement('g');
  const arrowId = 'flow-arrow-' + generateId();
  const defs = svgElement('defs');
  const marker = svgElement('marker', {
    id: arrowId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto'
  });
  marker.appendChild(svgElement('path', { d: 'M0 0L10 5L0 10Z', fill: 'currentColor' }));
  defs.appendChild(marker);
  lines.append(defs, arrows);
  board.appendChild(lines);
  scroller.appendChild(board);
  const nodeElements = new Map();
  const edgeElements = new Map();

  const updateSize = () => {
    const extents = chart.nodes.reduce((bounds, node) => ({
      width: Math.max(bounds.width, node.x + WIDTH + PAD),
      height: Math.max(bounds.height, node.y + HEIGHT + PAD)
    }), { width: 270, height: 150 });
    board.style.width = `${extents.width}px`;
    board.style.height = `${extents.height}px`;
  };

  const placeNode = node => {
    const el = nodeElements.get(node.id);
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
  };

  const updateEdges = () => {
    const nodes = new Map(chart.nodes.map(node => [node.id, node]));
    for (const edge of chart.edges) {
      const entry = edgeElements.get(edge.id);
      const from = nodes.get(edge.from), to = nodes.get(edge.to);
      if (!entry || !from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (!distance) {
        entry.group.style.display = 'none';
        continue;
      }
      const [startX, startY] = borderPoint(from, dx, dy);
      const [endX, endY] = borderPoint(to, -dx, -dy);
      const ux = dx / distance, uy = dy / distance;
      const room = (endX - startX) * ux + (endY - startY) * uy;
      if (room <= 0) {
        entry.group.style.display = 'none';
        continue;
      }
      entry.group.style.display = '';
      const padding = Math.min(1, room / 12);
      const x1 = startX + 2 * padding * ux, y1 = startY + 2 * padding * uy;
      const x2 = endX - 4 * padding * ux, y2 = endY - 4 * padding * uy;
      const d = `M ${x1} ${y1} L ${x2} ${y2}`;
      entry.line.setAttribute('d', d);
      entry.hit?.setAttribute('d', d);
      entry.text.setAttribute('x', (x1 + x2) / 2);
      entry.text.setAttribute('y', (y1 + y2) / 2 - 7);
      entry.text.textContent = edge.label;
    }
  };

  const highlight = (selected, from) => {
    nodeElements.forEach((el, id) => {
      el.classList.toggle('is-selected', selected?.kind === 'node' && selected.id === id);
      el.classList.toggle('is-connecting', id === from);
    });
    edgeElements.forEach(({group}, id) => group.classList.toggle('is-selected', selected?.kind === 'edge' && selected.id === id));
  };

  const rebuild = () => {
    arrows.replaceChildren();
    nodeElements.forEach(el => el.remove());
    nodeElements.clear();
    edgeElements.clear();
    const nodes = new Map(chart.nodes.map(node => [node.id, node]));
    for (const edge of chart.edges) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
      const group = svgElement('g', { class: 'flowchart-edge' });
      const line = svgElement('path', { class: 'flowchart-edge-line', 'marker-end': `url(#${arrowId})` });
      const text = svgElement('text', { class: 'flowchart-edge-label', 'text-anchor': 'middle' });
      let hit;
      group.append(line, text);
      if (interactions) {
        hit = svgElement('path', { class: 'flowchart-edge-hit', tabindex: 0, role: 'button' });
        hit.setAttribute('aria-label', `矢印: ${nodes.get(edge.from).label} → ${nodes.get(edge.to).label}`);
        hit.addEventListener('click', () => interactions.edge(edge));
        hit.addEventListener('keydown', event => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          interactions.edge(edge);
        });
        group.appendChild(hit);
      }
      edgeElements.set(edge.id, { group, line, text, hit });
      arrows.appendChild(group);
    }
    for (const node of chart.nodes) {
      const className = `flowchart-node flowchart-node-${node.type}`;
      const el = interactions ? button(className, undefined, () => interactions.node(node)) : element('div', className);
      el.appendChild(element('span', 'flowchart-node-label', node.label || TYPES[node.type]));
      if (interactions) {
        el.setAttribute('aria-label', `${TYPES[node.type]}: ${node.label || '無題'}`);
        interactions.drag(el, node);
      }
      board.appendChild(el);
      nodeElements.set(node.id, el);
      placeNode(node);
    }
    updateSize();
    updateEdges();
  };

  rebuild();
  return { scroller, board, rebuild, highlight, nodeElements, updateEdges, move(node) {
    placeNode(node);
    updateSize();
    updateEdges();
  } };
}

function openFlowchartEditor(properties, noteId, onSave) {
  if (!noteId || document.querySelector('.flowchart-dialog[open]')) return;
  const chart = validChart(properties);
  const original = JSON.stringify(chart);
  const dialog = element('dialog', 'flowchart-dialog');
  dialog.dataset.flowchartNote = noteId;
  const title = element('h2', 'flowchart-editor-title', 'フローチャートを編集');
  title.id = 'flowchart-title-' + generateId();
  dialog.setAttribute('aria-labelledby', title.id);
  const panel = element('div', 'flowchart-editor-panel');
  const tools = element('div', 'flowchart-editor-tools');
  const inspector = element('div', 'flowchart-inspector');
  const status = element('p', 'flowchart-status');
  status.setAttribute('role', 'status');
  const footer = element('div', 'flowchart-editor-footer');
  const actionClass = 'btn-secondary flowchart-action';
  let selected = null, connecting = false, from = null;

  const setStatus = text => { status.textContent = text; };
  const endConnect = () => {
    from = null;
    connecting = false;
    connect.setAttribute('aria-pressed', 'false');
  };
  const refreshSelection = () => {
    diagram.highlight(selected, from);
    const item = selected && chart[selected.kind === 'node' ? 'nodes' : 'edges'].find(item => item.id === selected.id);
    inspector.replaceChildren();
    if (!item || connecting) return;
    const field = element('label', 'flowchart-inspector-field');
    field.appendChild(element('span', '', selected.kind === 'node' ? '図形の文字' : '矢印のラベル'));
    const input = element('input', '');
    input.value = item.label;
    input.maxLength = 100;
    input.addEventListener('input', () => {
      item.label = input.value;
      if (selected.kind === 'edge') diagram.updateEdges();
      else {
        const node = diagram.nodeElements.get(item.id);
        node.firstElementChild.textContent = item.label || TYPES[item.type];
        node.setAttribute('aria-label', `${TYPES[item.type]}: ${item.label || '無題'}`);
      }
    });
    field.appendChild(input);
    const remove = button(actionClass, selected.kind === 'node' ? '図形を削除' : '矢印を削除', () => {
      if (selected.kind === 'node') {
        chart.nodes.splice(chart.nodes.indexOf(item), 1);
        chart.edges = chart.edges.filter(edge => edge.from !== item.id && edge.to !== item.id);
      } else chart.edges.splice(chart.edges.indexOf(item), 1);
      selected = null;
      diagram.rebuild();
      refreshSelection();
      connect.focus({ preventScroll: true });
      setStatus('削除しました。');
    });
    inspector.append(field, remove);
  };

  const selectNode = node => {
    if (connecting) {
      if (!from) {
        from = node.id;
        refreshSelection();
        setStatus('矢印の終点を選んでください。');
        return;
      }
      if (from === node.id) {
        setStatus('始点とは別の図形を選んでください。');
        return;
      }
      let edge = chart.edges.find(edge => edge.from === from && edge.to === node.id);
      if (!edge) {
        edge = { id: generateId(), from, to: node.id, label: '' };
        chart.edges.push(edge);
      }
      endConnect();
      selected = { kind: 'edge', id: edge.id };
      diagram.rebuild();
      refreshSelection();
      inspector.querySelector('input')?.focus({ preventScroll: true });
      setStatus('矢印を選択しました。ラベルを付けられます。');
      return;
    }
    selected = { kind: 'node', id: node.id };
    refreshSelection();
    setStatus('図形を選択しました。');
  };

  const diagram = createBoard(chart, {
    node: selectNode,
    edge(edge) {
      if (connecting) return;
      selected = { kind: 'edge', id: edge.id };
      refreshSelection();
      setStatus('矢印を選択しました。');
    },
    drag(el, node) {
      let drag, suppressClick = false;
      el.addEventListener('click', event => {
        if (!suppressClick || event.detail === 0) return;
        event.stopImmediatePropagation();
      }, true);
      el.addEventListener('pointerdown', event => {
        suppressClick = false;
        if (connecting || drag || !event.isPrimary || event.button !== 0) return;
        drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y, moved: false };
        el.setPointerCapture(event.pointerId);
      });
      el.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        if (!drag.moved) {
          drag.moved = true;
          selectNode(node);
        }
        node.x = coordinate(drag.x + dx);
        node.y = coordinate(drag.y + dy);
        diagram.move(node);
      });
      const finish = (event, cancelled) => {
        if (drag?.id !== event.pointerId) return;
        suppressClick = drag.moved;
        if (cancelled && drag.moved) {
          node.x = drag.x;
          node.y = drag.y;
          diagram.move(node);
        }
        drag = null;
      };
      el.addEventListener('pointerup', event => finish(event, false));
      el.addEventListener('pointercancel', event => finish(event, true));
      el.addEventListener('lostpointercapture', event => finish(event, true));
      el.addEventListener('keydown', event => {
        if (connecting || event.ctrlKey || event.metaKey || event.altKey) return;
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction) return;
        event.preventDefault();
        const step = event.shiftKey ? 24 : 6;
        node.x = coordinate(node.x + direction[0] * step);
        node.y = coordinate(node.y + direction[1] * step);
        diagram.move(node);
        selectNode(node);
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
  });
  diagram.scroller.classList.add('flowchart-editor-scroll');

  for (const [type, name] of Object.entries(TYPES)) {
    tools.appendChild(button(actionClass, `＋ ${name}`, () => {
      endConnect();
      const x = coordinate(diagram.scroller.scrollLeft + (diagram.scroller.clientWidth - WIDTH) / 2);
      const bottom = chart.nodes.reduce((y, node) => Math.max(y, node.y + HEIGHT + 34), 24);
      const node = makeNode(type, name, x, bottom);
      chart.nodes.push(node);
      selected = { kind: 'node', id: node.id };
      diagram.rebuild();
      refreshSelection();
      diagram.nodeElements.get(node.id).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      setStatus(`${name}を追加しました。`);
    }));
  }
  const connect = button(actionClass, 'つなぐ', () => {
    if (connecting) {
      endConnect();
      setStatus('接続をキャンセルしました。');
    } else {
      connecting = true;
      selected = null;
      connect.setAttribute('aria-pressed', 'true');
      setStatus('矢印の始点を選んでください。');
    }
    refreshSelection();
  });
  connect.setAttribute('aria-pressed', 'false');
  tools.appendChild(connect);
  setStatus('図形はドラッグで移動できます。');

  const cancel = () => {
    if (JSON.stringify(chart) !== original && !window.confirm('保存していない変更を破棄しますか？')) return;
    dialog.close();
  };
  footer.append(button(actionClass, 'キャンセル', cancel),
    button(`${actionClass} flowchart-save`, '保存', () => {
      if (JSON.stringify(chart) !== original && !onSave(validChart(chart))) {
        setStatus('元のフローチャートが見つからないため、保存できませんでした。');
        return;
      }
      dialog.close();
    }));
  panel.append(title, tools, status, diagram.scroller, inspector, footer);
  dialog.appendChild(panel);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (window.NotidianSync?.getDropboxSyncState?.().status === 'pending') {
      window.NotidianSync.syncNow({ reason: 'editor-closed' });
    }
  }, { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
}

export function createFlowchartDOM(block, noteId, onSave) {
  const container = element('section', 'flowchart-block');
  const header = element('div', 'flowchart-header');
  const title = element('span', '', 'フローチャート');
  const edit = button('btn-secondary flowchart-action', '編集', event => {
    event.stopPropagation();
    openFlowchartEditor(block.properties, noteId, onSave);
  });
  edit.dataset.flowchartEdit = '';
  header.append(title, edit);
  const chart = validChart(block.properties);
  if (chart.nodes.length) {
    const preview = createBoard(chart);
    preview.scroller.setAttribute('aria-label', 'フローチャートのプレビュー');
    preview.scroller.tabIndex = 0;
    container.append(header, preview.scroller);
  } else container.append(header, element('p', 'flowchart-status', '「編集」から図形を追加できます。'));
  return container;
}
