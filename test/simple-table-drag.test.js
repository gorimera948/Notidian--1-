import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimpleTableProperties, createResizedSimpleTable, getSimpleTableDragSize } from '../src/simple-table.js';
import { getSimpleTableColumnWidths, resizeSimpleTableColumn } from '../src/simple-table-sizing.js';

test('dragging the bottom, right edge, and corner changes the intended counts', () => {
  const table = createSimpleTableProperties();
  assert.deepEqual(getSimpleTableDragSize(table, 'rows', 240, 88), { rows: 5, columns: 3 });
  assert.deepEqual(getSimpleTableDragSize(table, 'columns', 240, 88), { rows: 3, columns: 5 });
  assert.deepEqual(getSimpleTableDragSize(table, 'both', 120, -44), { rows: 2, columns: 4 });
  assert.deepEqual(getSimpleTableDragSize(table, 'both', -10000, -10000), { rows: 1, columns: 1 });
});

test('structural previews retain existing cells, IDs and independent widths', () => {
  const table = createSimpleTableProperties();
  table.rows[0].cells[table.columns[0].id] = '残す';
  resizeSimpleTableColumn(table, 1, 40, 600);
  const snapshot = structuredClone(table);
  const expanded = createResizedSimpleTable(table, 5, 4, 600);
  assert.deepEqual(table, snapshot);
  assert.deepEqual(getSimpleTableColumnWidths(expanded, 600), [120, 160, 120, 120]);
  assert.deepEqual(expanded.rows[0], { ...table.rows[0], cells: { ...table.rows[0].cells, [expanded.columns[3].id]: '' } });
  assert.ok(expanded.rows[4].cells[expanded.columns[3].id] === '');
});

test('shrinking removes only the final rows/columns and can be cancelled or expanded back', () => {
  const table = createSimpleTableProperties();
  table.rows[2].cells[table.columns[2].id] = 'ドラッグを戻すと復元';
  const reduced = createResizedSimpleTable(table, 1, 1, 600);
  assert.equal(reduced.rows.length, 1);
  assert.equal(reduced.columns.length, 1);
  assert.deepEqual(Object.keys(reduced.rows[0].cells), [table.columns[0].id]);
  assert.deepEqual(createResizedSimpleTable(table, 3, 3, 600), table);
  assert.equal(table.rows[2].cells[table.columns[2].id], 'ドラッグを戻すと復元');
  assert.throws(() => createResizedSimpleTable(table, 0, 1, 600), RangeError);
});
