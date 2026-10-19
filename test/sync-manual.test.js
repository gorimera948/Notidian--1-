import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleNotes } from '../src/sample-notes.js';

test('manual sync uses size protection, downloads on a new device, and creates files safely', async () => {
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
      async filesUpload(args) { uploads.push(args); return { result: { rev: 'uploaded-rev' } }; }
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
    export const showToast = () => {};`;
  const stubURL = 'data:text/javascript,' + encodeURIComponent(stub);
  const policyURL = new URL('../src/sync-policy.js', import.meta.url).href;
  const source = (await readFile(new URL('../src/sync.js', import.meta.url), 'utf8'))
    .replace("from 'dropbox'", `from '${stubURL}'`)
    .replace("from './state.js'", `from '${stubURL}'`)
    .replace("from './utils.js'", `from '${stubURL}'`)
    .replace("from './sync-policy.js'", `from '${policyURL}'`)
    .replaceAll('import.meta.env', '({ VITE_DROPBOX_APP_KEY: "test-only" })');
  const sync = await import('data:text/javascript,' + encodeURIComponent(source));
  // Initialize the Dropbox client with a disconnected test-only session.
  await sync.disconnectDropbox();
  store.set('notidian_dropbox_refresh_token', 'test-only');
  await sync.syncNow({ reason: 'manual' });
  assert.equal(sync.getDropboxSyncState().status, 'protected');
  assert.equal(uploads.length, 0);
  assert.equal(local.data.notes[0].title, 'short');

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
