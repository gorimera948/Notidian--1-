import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleNotes } from '../src/sample-notes.js';

test('manual sync merges both versions, downloads on a new device, and creates files safely', async () => {
  const real = (time, text) => ({ app: 'notidian', schemaVersion: 1, syncMeta: { updatedAt: time, source: 'notes' },
    data: { notes: [{ id: 'pc-note', title: text, blocks: [] }], folders: [], focusLogs: [] } });
  const sample = { ...real(99999, ''), syncMeta: { updatedAt: 99999, source: 'pomodoro' },
    data: { notes: structuredClone(sampleNotes), folders: [], focusLogs: [] } };
  let local = real(300, 'short');
  let remote = real(200, 'larger existing PC content');
  const uploads = [];
  const store = new Map([['notidian_dropbox_refresh_token', 'test-only']]);
  globalThis.localStorage = { getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  globalThis.window = { dispatchEvent() {}, Notidian: {} };
  globalThis.__syncTest = {
    auth: class {},
    client: class {
      async filesDownload() {
        if (!remote) throw { status: 409, error: { '.tag': 'not_found' } };
        return { result: { rev: 'cloud-rev', fileBlob: new Blob([JSON.stringify(remote)]) } };
      }
      async filesUpload(args) {
        uploads.push(args);
        if (args.path === '/notidian-sync.json') remote = JSON.parse(args.contents);
        return { result: { rev: 'uploaded-rev' } };
      }
    },
    create: () => local,
    apply: data => { local = data; },
  };
  const stub = `export const Dropbox = globalThis.__syncTest.client;
    export const DropboxAuth = globalThis.__syncTest.auth;
    export const createNotidianSnapshot = globalThis.__syncTest.create;
    export const applyNotidianSnapshot = globalThis.__syncTest.apply;
    export const getLocalSyncMeta = () => ({});
    export const setLocalSyncMeta = () => ({});
    export const state = { get notes() { return globalThis.__syncTest.create().data.notes; }, panes: [] };
    export const showToast = () => {};`;
  const stubURL = 'data:text/javascript,' + encodeURIComponent(stub);
  const policyURL = new URL('../src/sync-policy.js', import.meta.url).href;
  const source = (await readFile(new URL('../src/sync.js', import.meta.url), 'utf8'))
    .replace("from 'dropbox'", `from '${stubURL}'`)
    .replace("from './state.js'", `from '${stubURL}'`)
    .replace("from './utils.js'", `from '${stubURL}'`)
    .replace("from './sync-policy.js'", `from '${policyURL}'`)
    .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url).href}'`)
    .replaceAll('import.meta.env', '({ VITE_DROPBOX_APP_KEY: "test-only" })');
  const sync = await import('data:text/javascript,' + encodeURIComponent(source));
  // Initialize the Dropbox client with a disconnected test-only session.
  await sync.disconnectDropbox();
  store.set('notidian_dropbox_refresh_token', 'test-only');
  await sync.syncNow({ reason: 'manual' });
  assert.equal(sync.getDropboxSyncState().status, 'synced');
  assert.equal(local.data.notes.length, 2);
  assert.deepEqual(new Set(local.data.notes.map(n => n.title.replace('（別端末の変更）', ''))),
    new Set(['short', 'larger existing PC content']));
  assert.equal(uploads.filter(u => u.path === '/notidian-sync.json').length, 1);
  assert.deepEqual(uploads.find(u => u.path === '/notidian-sync.json').mode, { '.tag': 'update', update: 'cloud-rev' });
  uploads.length = 0;

  local = sample;
  await sync.syncNow({ reason: 'manual' });
  assert.equal(sync.getDropboxSyncState().status, 'synced');
  assert.deepEqual(local, remote);
  assert.equal(uploads.length, 0);

  remote = null;
  await sync.syncNow({ reason: 'manual' });
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].mode, { '.tag': 'add' });
  assert.equal(uploads[0].strict_conflict, true);
});
