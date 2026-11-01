import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimpleTableProperties, addSimpleTableColumn, removeSimpleTableColumn } from '../src/simple-table.js';
import { getSimpleTableColumnWidths, resizeSimpleTableColumn, resetSimpleTableWidths,
  MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, bindTableResize } from '../src/simple-table-sizing.js';
import { mergeSnapshots } from '../src/sync-merge.js';

test('new tables start at 360px and retain their widths on narrow screens', () => {
  const table = createSimpleTableProperties();
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [120, 120, 120]);
  assert.deepEqual(getSimpleTableColumnWidths(table, 180), [120, 120, 120]);
});

test('resizing any column changes only that column, including the right edge', () => {
  const table = createSimpleTableProperties();
  resizeSimpleTableColumn(table, 0, 50, 600);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [170, 120, 120]);
  resizeSimpleTableColumn(table, 2, 70, 600);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [170, 120, 190]);
  assert.deepEqual(getSimpleTableColumnWidths(JSON.parse(JSON.stringify(table)), 180), [170, 120, 190]);
});

test('legacy percentage and weight widths migrate without shifting other columns', () => {
  const table = { columns: [{ id: 'a', width: 1 }, { id: 'b', width: 2 }, { id: 'c', width: 3 }], width: 80 };
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [80, 160, 240]);
  resizeSimpleTableColumn(table, 2, 40, 600);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [80, 160, 280]);
  assert.equal(table.columnSizing, 'pixels');
  assert.equal(Object.hasOwn(table, 'width'), false);
  assert.deepEqual(getSimpleTableColumnWidths(table, 900), [80, 160, 280]);
});

test('column bounds do not change the adjacent column', () => {
  const table = createSimpleTableProperties();
  resizeSimpleTableColumn(table, 1, -10000, 600);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [120, MIN_COLUMN_WIDTH, 120]);
  assert.equal(resizeSimpleTableColumn(table, 1, -30, 600), false);
  resizeSimpleTableColumn(table, 2, 10000, 600);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [120, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]);
});

test('adding and deleting columns retain existing widths and reset uses the compact default', () => {
  const table = createSimpleTableProperties();
  resizeSimpleTableColumn(table, 0, 80, 600);
  const added = addSimpleTableColumn(table);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [200, 120, 120, 120]);
  removeSimpleTableColumn(table, added.id);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [200, 120, 120]);
  resetSimpleTableWidths(table);
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [120, 120, 120]);
});

test('independent width changes and cell edits from different devices merge', () => {
  const base = { app: 'notidian', schemaVersion: 1, syncMeta: { updatedAt: 1, source: 'notes' },
    data: { notes: [{ id: 'note', title: 'table', blocks: [{ id: 'table', type: 'simple-table',
      content: '', properties: createSimpleTableProperties() }] }], folders: [], focusLogs: [] } };
  const local = structuredClone(base), remote = structuredClone(base);
  const p = local.data.notes[0].blocks[0].properties;
  resizeSimpleTableColumn(p, 0, 40, 600);
  const r = remote.data.notes[0].blocks[0].properties;
  resizeSimpleTableColumn(r, 2, 30, 600);
  r.rows[0].cells[r.columns[0].id] = 'スマホで編集';
  const merged = mergeSnapshots(local, remote, base);
  assert.equal(merged.conflicts, 0);
  const result = merged.snapshot.data.notes[0].blocks[0].properties;
  assert.equal(result.rows[0].cells[result.columns[0].id], 'スマホで編集');
  assert.deepEqual(getSimpleTableColumnWidths(result, 600), [160, 120, 150]);
});

test('cancelled or detached pointer drags never commit draft widths', () => {
  class Handle extends EventTarget {
    isConnected = true;
    captured = false;
    classList = { add() {}, remove() {} };
    focus() {}
    setPointerCapture() { this.captured = true; }
    hasPointerCapture() { return this.captured; }
    releasePointerCapture() { this.captured = false; }
  }
  const handle = new Handle(), finished = [];
  bindTableResize(handle, { start: () => ({ delta: 0 }),
    move: (draft, delta) => { draft.delta = delta; },
    finish: (draft, commit) => finished.push({ delta: draft.delta, commit }) });
  const emit = (type, x = 0) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: x });
    handle.dispatchEvent(event);
  };
  emit('pointerdown'); emit('pointermove', 30); emit('pointercancel'); emit('pointerup');
  assert.deepEqual(finished, [{ delta: 30, commit: false }]);
  emit('pointerdown'); emit('pointermove', 40); emit('pointerup');
  assert.deepEqual(finished.at(-1), { delta: 40, commit: true });
  emit('pointerdown'); emit('pointermove', 50); handle.isConnected = false; emit('pointerup');
  assert.deepEqual(finished.at(-1), { delta: 50, commit: false });
});
