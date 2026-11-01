import { generateId } from './utils.js';
import { MIN_COLUMN_WIDTH, MIN_TABLE_WIDTH, getSimpleTableWidth, setSimpleTableWidth,
  getSimpleTableColumnWidths, resizeSimpleTableColumn, bindTableResize } from './simple-table-sizing.js';

export function createSimpleTableProperties(rowCount = 3, columnCount = 3) {
  const columns = Array.from({ length: columnCount }, () => ({ id: generateId() }));
  return { columns, rows: Array.from({ length: rowCount }, () => ({
    id: generateId(), cells: Object.fromEntries(columns.map(column => [column.id, '']))
  })), headerRow: true };
}

export function addSimpleTableRow(properties) {
  const row = { id: generateId(), cells: Object.fromEntries(properties.columns.map(column => [column.id, ''])) };
  properties.rows.push(row);
  return row;
}

export function addSimpleTableColumn(properties) {
  const column = { id: generateId() };
  properties.columns.push(column);
  properties.rows.forEach(row => { row.cells[column.id] = ''; });
  return column;
}

export function removeSimpleTableRow(properties, id) {
  if (properties.rows.length <= 1 || !properties.rows.some(row => row.id === id)) return false;
  properties.rows = properties.rows.filter(row => row.id !== id);
  return true;
}

export function removeSimpleTableColumn(properties, id) {
  if (properties.columns.length <= 1 || !properties.columns.some(column => column.id === id)) return false;
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
      const column = addSimpleTableColumn(properties); save(); redraw(activeRow, column.id);
    });
    button('行を削除', () => {
      const index = properties.rows.findIndex(row => row.id === activeRow);
      if (removeSimpleTableRow(properties, activeRow)) {
        save(); redraw(properties.rows[Math.min(index, properties.rows.length - 1)].id, activeColumn);
      }
    }, properties.rows.length <= 1);
    button('列を削除', () => {
      const index = properties.columns.findIndex(column => column.id === activeColumn);
      if (removeSimpleTableColumn(properties, activeColumn)) {
        save(); redraw(activeRow, properties.columns[Math.min(index, properties.columns.length - 1)].id);
      }
    }, properties.columns.length <= 1);
    const header = button('見出し行', () => {
      properties.headerRow = !properties.headerRow; save(); redraw();
    });
    header.setAttribute('aria-pressed', String(Boolean(properties.headerRow)));
    button('幅をリセット', () => {
      delete properties.width;
      properties.columns.forEach(column => { delete column.width; });
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
    const setColumnLayout = (draft = properties) => {
      const widths = getSimpleTableColumnWidths(draft, table.getBoundingClientRect().width);
      const total = widths.reduce((sum, width) => sum + width, 0);
      [...colgroup.children].forEach((col, index) => { col.style.width = `${widths[index] / total * 100}%`; });
      columnHandles.forEach((handle, index) => {
        handle.setAttribute('aria-valuemax', String(Math.round(widths[index] + widths[index + 1] - MIN_COLUMN_WIDTH)));
        handle.setAttribute('aria-valuenow', String(Math.round(widths[index])));
        handle.setAttribute('aria-valuetext', `${Math.round(widths[index])}px`);
      });
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
        if (ri === 0 && ci < properties.columns.length - 1) {
          const handle = document.createElement('div');
          handle.className = 'simple-table-column-resizer';
          handle.tabIndex = 0;
          handle.setAttribute('role', 'separator');
          handle.setAttribute('aria-orientation', 'vertical');
          handle.setAttribute('aria-label', `${ci + 1}列目の幅`);
          handle.setAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH));
          handle.title = 'ドラッグで列幅を調整（矢印キーでも調整できます）';
          columnHandles.push(handle);
          bindTableResize(handle, {
            start: () => ({ original: structuredClone(properties), draft: structuredClone(properties), width: table.getBoundingClientRect().width }),
            move: (drag, delta) => {
              drag.draft = structuredClone(drag.original);
              resizeSimpleTableColumn(drag.draft, ci, delta, drag.width);
              setColumnLayout(drag.draft);
            },
            finish: (drag, commit) => {
              if (commit) {
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
            if (resizeSimpleTableColumn(properties, ci, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 30 : 10), table.getBoundingClientRect().width)) {
              setColumnLayout(); save();
            }
          });
          td.appendChild(handle);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body); scroll.appendChild(table); frame.appendChild(scroll);
    const widthHandle = document.createElement('div');
    let previewWidth = null;
    widthHandle.className = 'simple-table-width-resizer';
    widthHandle.tabIndex = 0;
    widthHandle.setAttribute('role', 'separator');
    widthHandle.setAttribute('aria-orientation', 'vertical');
    widthHandle.setAttribute('aria-label', '表全体の幅');
    widthHandle.setAttribute('aria-valuemin', String(MIN_TABLE_WIDTH));
    widthHandle.setAttribute('aria-valuemax', '100');
    widthHandle.title = 'ドラッグで表全体の幅を調整（ダブルクリックで全幅に戻します）';
    const setWidthLayout = (width = previewWidth ?? getSimpleTableWidth(properties)) => {
      container.style.width = `${width}%`;
      widthHandle.setAttribute('aria-valuenow', String(width));
      widthHandle.setAttribute('aria-valuetext', `${width}%`);
      setColumnLayout();
    };
    updateLayout = () => setWidthLayout();
    bindTableResize(widthHandle, {
      start: () => {
        const parent = container.parentElement;
        const style = getComputedStyle(parent);
        return { original: getSimpleTableWidth(properties), next: getSimpleTableWidth(properties),
          available: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          start: container.getBoundingClientRect().width };
      },
      move: (drag, delta) => {
        const draft = {};
        setSimpleTableWidth(draft, (drag.start + delta) / Math.max(1, drag.available) * 100);
        drag.next = draft.width; previewWidth = drag.next; setWidthLayout();
      },
      finish: (drag, commit) => {
        previewWidth = null;
        if (commit) { setSimpleTableWidth(properties, drag.next); save(); }
        setWidthLayout();
      }
    });
    widthHandle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? MIN_TABLE_WIDTH : event.key === 'End' ? 100 :
        getSimpleTableWidth(properties) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 2);
      setSimpleTableWidth(properties, next); setWidthLayout(); save();
    });
    widthHandle.addEventListener('dblclick', event => {
      event.preventDefault(); event.stopPropagation();
      setSimpleTableWidth(properties, 100); setWidthLayout(); save();
    });
    frame.appendChild(widthHandle); container.appendChild(frame);
    setWidthLayout();
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
