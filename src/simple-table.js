import { generateId } from './utils.js';

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
    container.appendChild(toolbar);

    const scroll = document.createElement('div');
    scroll.className = 'simple-table-scroll';
    const table = document.createElement('table');
    table.className = 'simple-table'; table.setAttribute('aria-label', '簡易テーブル');
    table.style.minWidth = `${properties.columns.length * 140}px`;
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
        td.appendChild(input); tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body); scroll.appendChild(table); container.appendChild(scroll);
    scroll.scrollLeft = scrollLeft;
    focusCell(rowId, columnId);
  };
  // Do not steal focus whenever the editor renders an existing table.
  redraw(null, null);
  activeRow = properties.rows[0].id; activeColumn = properties.columns[0].id;
  return container;
}
