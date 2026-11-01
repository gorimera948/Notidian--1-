import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimpleTableProperties, addSimpleTableRow, addSimpleTableColumn,
  removeSimpleTableRow, removeSimpleTableColumn } from '../src/simple-table.js';
import { mergeSnapshots } from '../src/sync-merge.js';

test('plain tables start as 3x3 and retain existing cell values when expanded', () => {
  const table = createSimpleTableProperties();
  assert.equal(table.rows.length, 3); assert.equal(table.columns.length, 3);
  assert.equal(new Set(table.rows.map(row => row.id)).size, 3);
  table.rows[0].cells[table.columns[0].id] = '残すテキスト';
  const row = addSimpleTableRow(table), column = addSimpleTableColumn(table);
  assert.equal(table.rows.length, 4); assert.equal(table.columns.length, 4);
  assert.equal(table.rows[0].cells[table.columns[0].id], '残すテキスト');
  assert.equal(row.cells[column.id], '');
  assert.deepEqual(JSON.parse(JSON.stringify(table)), table);
});

test('removal keeps at least one row and column without deleting other cells', () => {
  const table = createSimpleTableProperties(1, 1);
  const firstRow = table.rows[0].id, firstColumn = table.columns[0].id;
  assert.equal(removeSimpleTableRow(table, firstRow), false);
  assert.equal(removeSimpleTableColumn(table, firstColumn), false);
  const addedRow = addSimpleTableRow(table), addedColumn = addSimpleTableColumn(table);
  table.rows[0].cells[firstColumn] = '残す';
  assert.equal(removeSimpleTableRow(table, addedRow.id), true);
  assert.equal(removeSimpleTableColumn(table, addedColumn.id), true);
  assert.equal(table.rows[0].cells[firstColumn], '残す');
  assert.equal(Object.hasOwn(table.rows[0].cells, addedColumn.id), false);
});

test('PC and phone edits to different cells in a plain table merge', () => {
  const base = { app: 'notidian', schemaVersion: 1, syncMeta: { updatedAt: 1, source: 'notes' },
    data: { notes: [{ id: 'note', title: '表', blocks: [{ id: 'table', type: 'simple-table', content: '',
      properties: createSimpleTableProperties() }] }], folders: [], focusLogs: [] } };
  const local = structuredClone(base), remote = structuredClone(base);
  const lp = local.data.notes[0].blocks[0].properties;
  const rp = remote.data.notes[0].blocks[0].properties;
  lp.rows[0].cells[lp.columns[0].id] = 'PC';
  rp.rows[0].cells[rp.columns[1].id] = 'スマホ';
  const merged = mergeSnapshots(local, remote, base);
  assert.equal(merged.conflicts, 0);
  const table = merged.snapshot.data.notes[0].blocks[0].properties;
  assert.equal(table.rows[0].cells[table.columns[0].id], 'PC');
  assert.equal(table.rows[0].cells[table.columns[1].id], 'スマホ');
});
