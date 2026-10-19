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
