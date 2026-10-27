import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_POMODORO_SETS } from '../src/pomodoro-defaults.js';

test('initial metadata preserves zero rather than stamping the opening time', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
  const { setLocalSyncMeta } = await import('../src/state.js');
  assert.equal(setLocalSyncMeta({ updatedAt: 0, source: 'initial' }).updatedAt, 0);
  assert.ok(setLocalSyncMeta({ source: 'notes' }).updatedAt > 0);
});

test('opening a new device initializes timers without marking the data newer', async () => {
  const source = (await readFile(new URL('../src/pomodoro.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const storage = new Map();
  let changes = 0;
  const context = vm.createContext({
    DEFAULT_POMODORO_SETS, structuredClone,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    markLocalDataChanged: () => changes++, console
  });
  vm.runInContext(source, context);
  vm.runInContext('loadPomodoroData()', context);
  assert.equal(changes, 0);
  assert.ok(JSON.parse(storage.get('pomodoro_sets')).length > 0);
  vm.runInContext('setTimerVolume(0.7)', context);
  assert.equal(changes, 1);
});

test('a storage quota error rolls back all snapshot keys and leaves in-memory notes intact', async () => {
  const original = [{ id: 'old', title: 'old', blocks: [] }];
  const storage = new Map([['notidian_notes', JSON.stringify(original)], ['notidian_folders', '[]']]);
  const before = new Map(storage);
  let fail = true;
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => {
      if (key === 'notidian_focus_logs' && fail) { fail = false; throw new Error('Quota exceeded'); }
      storage.set(key, String(value));
    }, removeItem: key => storage.delete(key)
  };
  const { state, applyNotidianSnapshot } = await import('../src/state.js');
  state.notes = original;
  assert.throws(() => applyNotidianSnapshot({ data: {
    notes: [{ id: 'new', blocks: [] }], folders: [{ id: 'folder' }], focusLogs: []
  } }), /Quota exceeded/);
  assert.deepEqual(storage, before); assert.equal(state.notes, original);
});

test('stored empty notes stay empty, while a new device still gets welcome notes', async () => {
  const storage = new Map([['notidian_notes', '[]'], ['notidian_focus_logs', '[]']]);
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)) };
  globalThis.window = {};
  const { state, initStorage } = await import('../src/state.js');
  initStorage(); assert.equal(state.notes.length, 0);
  storage.delete('notidian_notes'); initStorage();
  assert.equal(state.notes.length, 3);
});
