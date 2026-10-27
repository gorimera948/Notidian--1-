import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncDownloadTransport } from '../src/sync-download.js';
import { watchDropboxChanges, REMOTE_POLL_MS } from '../src/sync-watch.js';
import { createSyncBaselineStore } from '../src/sync-baseline.js';
import { createEditorSaveQueue } from '../src/editor-save.js';

test('conditional GET downloads once, reuses a 304, and isolates cached content from edits', async () => {
  const snapshot = { app: 'notidian', schemaVersion: 1, data: { notes: [], folders: [], focusLogs: [] } };
  const path = '/notidian-sync.json', calls = [];
  const transport = createSyncDownloadTransport(path, async (url, options) => {
    calls.push(options);
    return new Response(null, { status: calls.length === 1 ? 200 : 304, headers: { etag: '"version-1"' } });
  });
  const client = { async filesDownload() {
    const response = await transport.fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST', headers: { 'Dropbox-API-Arg': JSON.stringify({ path }), Authorization: 'Bearer test' }
    });
    if (response.status === 304) throw { status: 304 };
    return { result: { rev: 'version-1', fileBlob: new Blob([JSON.stringify(snapshot)]) } };
  } };
  const first = await transport.read(client);
  first.snapshot.data.notes.push({ id: 'local-edit' });
  const second = await transport.read(client);
  assert.equal(second.snapshot.data.notes.length, 0);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].headers.get('If-None-Match'), '"version-1"');
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer test');
  transport.clear();
  await assert.rejects(transport.read(client));
  assert.equal(calls[2].headers.has('If-None-Match'), false);
});

test('other endpoints are unaffected by conditional-download headers', async () => {
  let actual;
  const transport = createSyncDownloadTransport('/notidian-sync.json', async (url, options) => { actual = options; return new Response(); });
  const options = { method: 'POST', body: 'request' };
  await transport.fetch('https://api.dropboxapi.com/2/files/upload', options);
  assert.equal(actual, options);
});

test('visible online devices poll and resume on focus, visibility and editing completion', async () => {
  const win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  let connected = true, online = true, tick, checks = 0, stopped = false;
  const stop = watchDropboxChanges({ window: win, document: doc,
    sync: () => checks++, connected: () => connected, online: () => online,
    setInterval: (callback, ms) => { assert.equal(ms, REMOTE_POLL_MS); tick = callback; return 1; },
    clearInterval: id => { assert.equal(id, 1); stopped = true; } });
  tick(); win.dispatchEvent(new Event('focus')); assert.equal(checks, 2);
  doc.visibilityState = 'hidden'; tick(); assert.equal(checks, 2);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(checks, 3);
  doc.dispatchEvent(new Event('focusout')); await Promise.resolve(); assert.equal(checks, 4);
  online = false; tick(); connected = false; online = true; tick(); assert.equal(checks, 4);
  stop(); win.dispatchEvent(new Event('focus')); assert.ok(stopped); assert.equal(checks, 4);
});

test('baseline has a safe in-memory fallback and returns independent clones', async () => {
  const store = createSyncBaselineStore('account', null);
  assert.equal(await store.read(), null);
  const snapshot = { data: { notes: [{ id: 'one' }] } };
  await store.remember(snapshot); snapshot.data.notes = [];
  const saved = await store.read(); assert.equal(saved.data.notes.length, 1);
  saved.data.notes = []; assert.equal((await store.read()).data.notes.length, 1);
  assert.equal(await createSyncBaselineStore('other-account', null).read(), null);
});

test('typing is persisted after a short debounce and page hiding can flush immediately', () => {
  let pending, saves = 0;
  const queue = createEditorSaveQueue(() => saves++, fn => { pending = fn; return 1; }, () => {});
  queue.schedule(); queue.schedule(); assert.equal(saves, 0);
  pending(); assert.equal(saves, 1); queue.flush(); assert.equal(saves, 1);
  queue.schedule(); queue.flush(); assert.equal(saves, 2);
});
