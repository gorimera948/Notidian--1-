import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimpleTableProperties } from '../src/simple-table.js';
import { getSimpleTableWidth, setSimpleTableWidth, getSimpleTableColumnWidths,
  resizeSimpleTableColumn, MIN_COLUMN_WIDTH, bindTableResize } from '../src/simple-table-sizing.js';
import { mergeSnapshots } from '../src/sync-merge.js';

test('legacy tables retain full width and table width is clamped and serialized', () => {
  const table = createSimpleTableProperties();
  assert.equal(getSimpleTableWidth(table), 100);
  setSimpleTableWidth(table, 62.36); assert.equal(getSimpleTableWidth(table), 62.4);
  assert.equal(getSimpleTableWidth(JSON.parse(JSON.stringify(table))), 62.4);
  setSimpleTableWidth(table, 999); assert.equal(table.width, 100);
  setSimpleTableWidth(table, -1); assert.equal(table.width, 25);
  assert.equal(setSimpleTableWidth(table, NaN), false);
});

test('column resizing moves one boundary while retaining the total table width', () => {
  const table = createSimpleTableProperties();
  assert.deepEqual(getSimpleTableColumnWidths(table, 600), [200, 200, 200]);
  assert.equal(resizeSimpleTableColumn(table, 0, 50, 600), true);
  const widths = getSimpleTableColumnWidths(table, 600);
  [250, 150, 200].forEach((expected, i) => assert.ok(Math.abs(widths[i] - expected) < 0.01));
  const restored = getSimpleTableColumnWidths(JSON.parse(JSON.stringify(table)), 600);
  assert.deepEqual(restored, widths);
});

test('columns retain readable minimum widths, including narrow screens', () => {
  const table = createSimpleTableProperties();
  resizeSimpleTableColumn(table, 0, 10000, 600);
  assert.equal(Math.round(getSimpleTableColumnWidths(table, 600)[1]), MIN_COLUMN_WIDTH);
  assert.ok(getSimpleTableColumnWidths(table, 180).every(width => width >= MIN_COLUMN_WIDTH));
  assert.equal(resizeSimpleTableColumn(table, 0, 30, 180), false);
  assert.equal(resizeSimpleTableColumn(table, 2, 30, 600), false);
});

test('resizing still works when another column was already clamped to minimum width', () => {
  const table = createSimpleTableProperties();
  table.columns.forEach((col, i) => { col.width = [30, 200, 400][i]; });
  const before = getSimpleTableColumnWidths(table, 500);
  resizeSimpleTableColumn(table, 1, 30, 500);
  const after = getSimpleTableColumnWidths(table, 500);
  assert.ok(Math.abs(after[0] - before[0]) < 0.01);
  assert.ok(Math.abs(after[1] - before[1] - 30) < 0.01);
  assert.ok(Math.abs(after[2] - before[2] + 30) < 0.01);
});

test('width changes and edits from another device merge without losing cell content', () => {
  const base = { app: 'notidian', schemaVersion: 1, syncMeta: { updatedAt: 1, source: 'notes' },
    data: { notes: [{ id: 'note', title: 'table', blocks: [{ id: 'table', type: 'simple-table',
      content: '', properties: createSimpleTableProperties() }] }], folders: [], focusLogs: [] } };
  const local = structuredClone(base), remote = structuredClone(base);
  const p = local.data.notes[0].blocks[0].properties;
  setSimpleTableWidth(p, 70); resizeSimpleTableColumn(p, 0, 40, 600);
  const r = remote.data.notes[0].blocks[0].properties;
  r.rows[0].cells[r.columns[0].id] = 'スマホで編集';
  const merged = mergeSnapshots(local, remote, base);
  assert.equal(merged.conflicts, 0);
  const result = merged.snapshot.data.notes[0].blocks[0].properties;
  assert.equal(result.width, 70);
  assert.equal(result.rows[0].cells[result.columns[0].id], 'スマホで編集');
  assert.ok(result.columns[0].width > result.columns[1].width);
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
