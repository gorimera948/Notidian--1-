import { generateId } from './utils.js';
import { MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH,
  getSimpleTableColumnWidths, ensureSimpleTablePixelWidths, resizeSimpleTableColumn,
  bindTableResize } from './simple-table-sizing.js';

export function createSimpleTableProperties(rowCount = 3, columnCount = 3) {
  const columns = Array.from({ length: columnCount }, () => ({ id: generateId(), width: DEFAULT_COLUMN_WIDTH }));
  return { columns, rows: Array.from({ length: rowCount }, () => ({
    id: generateId(), cells: Object.fromEntries(columns.map(column => [column.id, '']))
  })), headerRow: true, columnSizing: 'pixels' };
}

export function addSimpleTableRow(properties) {
  const row = { id: generateId(), cells: Object.fromEntries(properties.columns.map(column => [column.id, ''])) };
  properties.rows.push(row);
  return row;
}

export function addSimpleTableColumn(properties, availableWidth) {
  ensureSimpleTablePixelWidths(properties, availableWidth);
  const column = { id: generateId(), width: DEFAULT_COLUMN_WIDTH };
  properties.columns.push(column);
  properties.rows.forEach(row => { row.cells[column.id] = ''; });
  return column;
}

export function removeSimpleTableRow(properties, id) {
  if (properties.rows.length <= 1 || !properties.rows.some(row => row.id === id)) return false;
  properties.rows = properties.rows.filter(row => row.id !== id);
  return true;
}

export function removeSimpleTableColumn(properties, id, availableWidth) {
  if (properties.columns.length <= 1 || !properties.columns.some(column => column.id === id)) return false;
  ensureSimpleTablePixelWidths(properties, availableWidth);
  properties.columns = properties.columns.filter(column => column.id !== id);
  properties.rows.forEach(row => { delete row.cells[id]; });
  return true;
}

export function createResizedSimpleTable(properties, rowCount, columnCount, availableWidth) {
  if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount < 1 || columnCount < 1) {
    throw new RangeError('A table must retain at least one row and column');
  }
  const draft = structuredClone(properties);
  ensureSimpleTablePixelWidths(draft, availableWidth);
  // Build every preview from the original. Shrinking and expanding during one
  // gesture restores the original cells until the user releases the handle.
  while (draft.columns.length > columnCount) removeSimpleTableColumn(draft, draft.columns.at(-1).id);
  while (draft.columns.length < columnCount) addSimpleTableColumn(draft);
  while (draft.rows.length > rowCount) draft.rows.pop();
  while (draft.rows.length < rowCount) addSimpleTableRow(draft);
  return draft;
}

export function getSimpleTableDragSize(properties, axis, dx, dy, rowHeight = 44) {
  const rows = properties.rows.length, columns = properties.columns.length;
  return {
    rows: axis === 'columns' ? rows : Math.max(1, Math.min(Math.max(1000, rows), rows + Math.round(dy / Math.max(28, rowHeight)))),
    columns: axis === 'rows' ? columns : Math.max(1, Math.min(Math.max(100, columns), columns + Math.round(dx / DEFAULT_COLUMN_WIDTH)))
  };
}

export function createSimpleTableDOM(block, onChange) {
  const properties = block.properties ||= createSimpleTableProperties();
  const container = document.createElement('div');
  container.className = 'simple-table-container';
  container.dataset.blockId = block.id;
  let activeRow = properties.rows[0]?.id, activeColumn = properties.columns[0]?.id;
  let updateLayout = () => {};
  const availableWidth = () => {
    const parent = container.parentElement;
    if (!parent) return properties.columns.length * DEFAULT_COLUMN_WIDTH;
    const style = getComputedStyle(parent);
    return parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };
  const save = (immediate = true) => onChange(immediate);
  const focusCell = (rowId, columnId) => {
    const cell = [...container.querySelectorAll('textarea')].find(el => el.dataset.rowId === rowId && el.dataset.columnId === columnId);
    cell?.focus();
  };
  const redraw = (rowId = null, columnId = null) => {
    const scrollLeft = container.querySelector('.simple-table-scroll')?.scrollLeft || 0;
    container.replaceChildren();
    const frame = document.createElement('div');
    frame.className = 'simple-table-frame';
    const scroll = document.createElement('div');
    scroll.className = 'simple-table-scroll';
    const table = document.createElement('table');
    table.className = 'simple-table'; table.setAttribute('aria-label', '簡易テーブル');
    let colgroup;
    const columnHandles = [], countHandles = [];
    let shown = properties;
    const setColumnLayout = (draft = shown) => {
      const widths = getSimpleTableColumnWidths(draft, availableWidth());
      const total = widths.reduce((sum, width) => sum + width, 0);
      table.style.width = `${total}px`;
      table.style.minWidth = `${total}px`;
      frame.style.width = `${total + 2}px`;
      [...colgroup.children].forEach((col, index) => { col.style.width = `${widths[index]}px`; });
      columnHandles.forEach((handle, index) => {
        handle.setAttribute('aria-valuenow', String(Math.round(widths[index])));
        handle.setAttribute('aria-valuetext', `${Math.round(widths[index])}px`);
      });
      countHandles.forEach(handle => { handle.dataset.size = `${draft.rows.length}行 × ${draft.columns.length}列`; });
    };
    const makeColumnHandle = ci => {
      const handle = document.createElement('div');
      handle.className = 'simple-table-column-resizer'; handle.tabIndex = 0;
      handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', `${ci + 1}列目の幅`);
      handle.setAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH));
      handle.setAttribute('aria-valuemax', String(MAX_COLUMN_WIDTH));
      handle.title = 'ドラッグでこの列だけ幅を調整（矢印キーでも調整できます）';
      bindTableResize(handle, {
        start: () => ({ original: structuredClone(properties), draft: structuredClone(properties), width: availableWidth() }),
        move: (drag, delta) => {
          drag.draft = structuredClone(drag.original);
          drag.changed = resizeSimpleTableColumn(drag.draft, ci, delta, drag.width);
          setColumnLayout(drag.draft);
        },
        finish: (drag, commit) => {
          if (commit && drag.changed) {
            properties.columnSizing = drag.draft.columnSizing;
            if (properties.columnSizing === 'pixels') delete properties.width;
            properties.columns.forEach((column, index) => {
              if (drag.draft.columns[index].width !== undefined) column.width = drag.draft.columns[index].width;
            });
            save();
          }
          setColumnLayout(properties);
        }
      });
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault(); event.stopPropagation();
        if (resizeSimpleTableColumn(properties, ci, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 30 : 10), availableWidth())) {
          setColumnLayout(properties); save();
        }
      });
      return handle;
    };
    const renderGrid = (draft = properties, preview = false) => {
      shown = draft;
      const left = scroll.scrollLeft, top = scroll.scrollTop;
      table.replaceChildren(); columnHandles.length = 0;
      colgroup = document.createElement('colgroup');
      draft.columns.forEach(() => colgroup.appendChild(document.createElement('col')));
      table.appendChild(colgroup);
      const body = document.createElement('tbody');
      draft.rows.forEach((row, ri) => {
        const tr = document.createElement('tr');
        draft.columns.forEach((column, ci) => {
          const td = document.createElement(draft.headerRow && ri === 0 ? 'th' : 'td');
          if (td.tagName === 'TH') td.scope = 'col';
          const input = document.createElement('textarea');
          input.className = 'simple-table-cell'; input.rows = 1;
          input.dataset.rowId = row.id; input.dataset.columnId = column.id;
          input.setAttribute('aria-label', `${ri + 1}行${ci + 1}列`);
          input.value = row.cells[column.id] || '';
          if (preview) { input.readOnly = true; input.tabIndex = -1; }
          else {
            input.addEventListener('focus', () => {
              activeRow = row.id; activeColumn = column.id;
              container.querySelectorAll('.is-active-cell').forEach(el => el.classList.remove('is-active-cell'));
              td.classList.add('is-active-cell');
            });
            input.addEventListener('input', () => { row.cells[column.id] = input.value; save(false); });
            input.addEventListener('keydown', event => {
              if (event.key !== 'Tab' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
              const next = ri * properties.columns.length + ci + (event.shiftKey ? -1 : 1);
              if (next < 0) return;
              event.preventDefault();
              if (next >= properties.rows.length * properties.columns.length) {
                const added = addSimpleTableRow(properties); save(); redraw(added.id, properties.columns[0].id);
              } else {
                focusCell(properties.rows[Math.floor(next / properties.columns.length)].id, properties.columns[next % properties.columns.length].id);
              }
            });
          }
          td.appendChild(input);
          if (ri === 0 && !preview) {
            const handle = makeColumnHandle(ci); columnHandles.push(handle); td.appendChild(handle);
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body); setColumnLayout(draft);
      scroll.scrollLeft = left; scroll.scrollTop = top;
    };
    const commitStructure = (draft, axis) => {
      // Record any debounced cell edits before a drag removes their row/column.
      // Undo can then restore the complete table as it was before the gesture.
      save();
      properties.rows = draft.rows; properties.columns = draft.columns;
      properties.columnSizing = draft.columnSizing; delete properties.width;
      if (!properties.rows.some(row => row.id === activeRow)) activeRow = properties.rows.at(-1).id;
      if (!properties.columns.some(column => column.id === activeColumn)) activeColumn = properties.columns.at(-1).id;
      save(); redraw();
      container.querySelector(`[data-table-axis="${axis}"]`)?.focus({ preventScroll: true });
    };
    const makeCountHandle = (axis, label, symbol) => {
      const handle = document.createElement('button');
      handle.type = 'button'; handle.className = `simple-table-count-handle simple-table-count-${axis}`;
      handle.dataset.tableAxis = axis;
      handle.setAttribute('aria-label', label); handle.textContent = symbol;
      handle.title = axis === 'rows' ? '下へドラッグして行を追加、上へドラッグして削除。クリックで1行追加。'
        : axis === 'columns' ? '右へドラッグして列を追加、左へドラッグして削除。クリックで1列追加。'
        : '斜めにドラッグして行・列を増減';
      bindTableResize(handle, {
        start: () => ({ original: structuredClone(properties), draft: null, moved: false, width: availableWidth(),
          rowHeight: table.getBoundingClientRect().height / properties.rows.length }),
        move: (drag, dx, dy) => {
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          const size = getSimpleTableDragSize(drag.original, axis, dx, dy, drag.rowHeight);
          if (drag.draft?.rows.length === size.rows && drag.draft?.columns.length === size.columns) return;
          drag.draft = createResizedSimpleTable(drag.original, size.rows, size.columns, drag.width);
          renderGrid(drag.draft, true);
        },
        finish: (drag, commit) => {
          if (commit && !drag.moved) {
            const size = getSimpleTableDragSize(drag.original, axis, axis === 'rows' ? 0 : DEFAULT_COLUMN_WIDTH,
              axis === 'columns' ? 0 : drag.rowHeight, drag.rowHeight);
            drag.draft = createResizedSimpleTable(drag.original, size.rows, size.columns, drag.width);
          }
          if (commit && drag.draft && (drag.draft.rows.length !== properties.rows.length || drag.draft.columns.length !== properties.columns.length)) {
            commitStructure(drag.draft, axis);
          } else renderGrid(properties);
        }
      });
      handle.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        // Pointer clicks are committed by pointerup. Keyboard/assistive clicks
        // have detail=0 and also need to add one row or column.
        if (event.detail !== 0) return;
        const size = getSimpleTableDragSize(properties, axis, axis === 'rows' ? 0 : DEFAULT_COLUMN_WIDTH, axis === 'columns' ? 0 : 44);
        commitStructure(createResizedSimpleTable(properties, size.rows, size.columns, availableWidth()), axis);
      });
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
        const dx = event.key === 'ArrowRight' ? DEFAULT_COLUMN_WIDTH : event.key === 'ArrowLeft' ? -DEFAULT_COLUMN_WIDTH : 0;
        const dy = event.key === 'ArrowDown' ? 44 : event.key === 'ArrowUp' ? -44 : 0;
        const size = getSimpleTableDragSize(properties, axis, dx, dy);
        event.preventDefault(); event.stopPropagation();
        if (size.rows !== properties.rows.length || size.columns !== properties.columns.length) {
          commitStructure(createResizedSimpleTable(properties, size.rows, size.columns, availableWidth()), axis);
        }
      });
      countHandles.push(handle); frame.appendChild(handle);
    };
    scroll.appendChild(table); frame.appendChild(scroll); container.appendChild(frame);
    makeCountHandle('rows', '行を増減', '+');
    makeCountHandle('columns', '列を増減', '+');
    makeCountHandle('both', '行と列を増減', '⤡');
    renderGrid(); scroll.scrollLeft = scrollLeft;
    updateLayout = () => setColumnLayout();
    focusCell(rowId, columnId);
  };
  redraw();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (container.isConnected) updateLayout(); else observer.disconnect();
    });
    observer.observe(container);
  }
  return container;
}
