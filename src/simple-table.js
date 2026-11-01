import { generateId } from './utils.js';
import { MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH,
  getSimpleTableColumnWidths, ensureSimpleTablePixelWidths, resizeSimpleTableColumn,
  resetSimpleTableWidths, bindTableResize } from './simple-table-sizing.js';

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
  const redraw = (rowId = activeRow, columnId = activeColumn) => {
    const scrollLeft = container.querySelector('.simple-table-scroll')?.scrollLeft || 0;
    container.replaceChildren();
    activeRow = rowId; activeColumn = columnId;
    const toolbar = document.createElement('div');
    toolbar.className = 'simple-table-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '簡易テーブルの操作');
    const button = (label, action, disabled = false) => {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = label; el.disabled = disabled;
      el.addEventListener('click', event => { event.stopPropagation(); action(); });
      toolbar.appendChild(el);
      return el;
    };
    button('＋ 行', () => {
      const row = addSimpleTableRow(properties); save(); redraw(row.id, activeColumn);
    });
    button('＋ 列', () => {
      const column = addSimpleTableColumn(properties, availableWidth()); save(); redraw(activeRow, column.id);
    });
    button('行を削除', () => {
      const index = properties.rows.findIndex(row => row.id === activeRow);
      if (removeSimpleTableRow(properties, activeRow)) {
        save(); redraw(properties.rows[Math.min(index, properties.rows.length - 1)].id, activeColumn);
      }
    }, properties.rows.length <= 1);
    button('列を削除', () => {
      const index = properties.columns.findIndex(column => column.id === activeColumn);
      if (removeSimpleTableColumn(properties, activeColumn, availableWidth())) {
        save(); redraw(activeRow, properties.columns[Math.min(index, properties.columns.length - 1)].id);
      }
    }, properties.columns.length <= 1);
    const header = button('見出し行', () => {
      properties.headerRow = !properties.headerRow; save(); redraw();
    });
    header.setAttribute('aria-pressed', String(Boolean(properties.headerRow)));
    button('幅をリセット', () => {
      resetSimpleTableWidths(properties);
      updateLayout(); save();
    });
    container.appendChild(toolbar);

    const frame = document.createElement('div');
    frame.className = 'simple-table-frame';
    const scroll = document.createElement('div');
    scroll.className = 'simple-table-scroll';
    const table = document.createElement('table');
    table.className = 'simple-table'; table.setAttribute('aria-label', '簡易テーブル');
    table.style.minWidth = `${properties.columns.length * MIN_COLUMN_WIDTH}px`;
    const colgroup = document.createElement('colgroup');
    properties.columns.forEach(() => colgroup.appendChild(document.createElement('col')));
    table.appendChild(colgroup);
    const columnHandles = [];
    let outerHandle = null;
    const setColumnLayout = (draft = properties) => {
      const widths = getSimpleTableColumnWidths(draft, availableWidth());
      const total = widths.reduce((sum, width) => sum + width, 0);
      container.style.width = '100%';
      table.style.width = `${total}px`;
      table.style.minWidth = `${total}px`;
      frame.style.width = `${total + 2}px`;
      [...colgroup.children].forEach((col, index) => { col.style.width = `${widths[index]}px`; });
      columnHandles.forEach((handle, index) => {
        handle.setAttribute('aria-valuemax', String(MAX_COLUMN_WIDTH));
        handle.setAttribute('aria-valuenow', String(Math.round(widths[index])));
        handle.setAttribute('aria-valuetext', `${Math.round(widths[index])}px`);
      });
      if (outerHandle) {
        outerHandle.hidden = total > availableWidth();
        outerHandle.setAttribute('aria-valuenow', String(Math.round(widths.at(-1))));
        outerHandle.setAttribute('aria-valuetext', `${Math.round(widths.at(-1))}px`);
      }
    };
    const makeHandle = (ci, className, label) => {
      const handle = document.createElement('div');
      handle.className = className;
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', label);
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
          setColumnLayout();
        }
      });
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault(); event.stopPropagation();
        if (resizeSimpleTableColumn(properties, ci, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 30 : 10), availableWidth())) {
          setColumnLayout(); save();
        }
      });
      return handle;
    };
    const body = document.createElement('tbody');
    properties.rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      properties.columns.forEach((column, ci) => {
        const td = document.createElement(properties.headerRow && ri === 0 ? 'th' : 'td');
        if (td.tagName === 'TH') td.scope = 'col';
        const input = document.createElement('textarea');
        input.className = 'simple-table-cell'; input.rows = 1;
        input.dataset.rowId = row.id; input.dataset.columnId = column.id;
        input.setAttribute('aria-label', `${ri + 1}行${ci + 1}列`);
        input.value = row.cells[column.id] || '';
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
            focusCell(properties.rows[Math.floor(next / properties.columns.length)].id,
              properties.columns[next % properties.columns.length].id);
          }
        });
        td.appendChild(input);
        if (ri === 0) {
          const handle = makeHandle(ci, 'simple-table-column-resizer', `${ci + 1}列目の幅`);
          columnHandles.push(handle); td.appendChild(handle);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body); scroll.appendChild(table); frame.appendChild(scroll);
    outerHandle = makeHandle(properties.columns.length - 1, 'simple-table-width-resizer', '右端の列幅');
    frame.appendChild(outerHandle); container.appendChild(frame);
    updateLayout = () => setColumnLayout();
    setColumnLayout();
    scroll.scrollLeft = scrollLeft;
    focusCell(rowId, columnId);
  };
  // Do not steal focus whenever the editor renders an existing table.
  redraw(null, null);
  activeRow = properties.rows[0].id; activeColumn = properties.columns[0].id;
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (container.isConnected) updateLayout();
      else observer.disconnect();
    });
    observer.observe(container);
  }
  return container;
}
