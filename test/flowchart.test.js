import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowchartProperties } from '../src/flowchart.js';
import { mergeSnapshots } from '../src/sync-merge.js';
import { state, historyState, undo, redo, pushHistory } from '../src/state.js';

function notebook() {
  return { app: 'notidian', schemaVersion: 1, syncMeta: { updatedAt: 1, source: 'notes' },
    data: { notes: [{ id: 'note', title: 'フロー', blocks: [
      { id: 'flow', type: 'flowchart', content: '', properties: createFlowchartProperties() }
    ] }], folders: [], focusLogs: [] } };
}

const graph = snapshot => snapshot.data.notes[0].blocks[0].properties;

test('Dropbox merge retains moves and labels made to different shapes and arrows', () => {
  const base = notebook(), local = structuredClone(base), remote = structuredClone(base);
  graph(local).nodes[0].x += 70;
  graph(remote).nodes[1].label = '確認する';
  graph(remote).edges[1].label = 'はい';

  const { snapshot, conflicts } = mergeSnapshots(local, remote, base);
  assert.equal(conflicts, 0);
  assert.equal(graph(snapshot).nodes[0].x, graph(local).nodes[0].x);
  assert.equal(graph(snapshot).nodes[1].label, '確認する');
  assert.equal(graph(snapshot).edges[1].label, 'はい');
});

test('undo restores the immediately previous chart and redo restores the saved edit', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.document = { activeElement: null };
  globalThis.window = { dispatchEvent() {} };
  const snapshot = notebook();
  const before = JSON.stringify(snapshot.data.notes);
  historyState.undoStack = [JSON.stringify([{ id: 'note', title: 'フロー', blocks: [] }]), before];
  historyState.redoStack = [];
  state.notes = snapshot.data.notes;
  graph(snapshot).nodes[1].label = 'もう一度確認';
  pushHistory();
  state.notes[0].updatedAt = 10;
  pushHistory();
  undo();
  assert.deepEqual(state.notes, JSON.parse(before));
  redo();
  assert.equal(state.notes[0].blocks[0].properties.nodes[1].label, 'もう一度確認');
});
