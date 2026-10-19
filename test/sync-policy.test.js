import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSyncAction, synchronizeSnapshots } from '../src/sync-policy.js';
import { sampleNotes } from '../src/sample-notes.js';

function snapshot(time, text = 'PC notes', extra = {}) {
  return {
    app: 'notidian', schemaVersion: 1,
    syncMeta: { updatedAt: time, source: 'notes' },
    data: { notes: [{ id: 'user-note', title: text, blocks: [] }], folders: [], focusLogs: [], ...extra }
  };
}
function initial(time = 99999) {
  const result = snapshot(time);
  result.syncMeta.source = 'pomodoro';
  result.data.notes = structuredClone(sampleNotes);
  return result;
}
function harness(local, remote) {
  const calls = [];
  const api = {
    readLocal: () => local,
    readRemote: async () => ({ snapshot: remote, rev: 'revision-1' }),
    backup: async data => calls.push(['backup', structuredClone(data)]),
    upload: async (data, rev) => calls.push(['upload', data, rev]),
    apply: async data => calls.push(['apply', data]),
    isConflict: error => error.status === 409
  };
  return { api, calls };
}

test('new phone sample with a newer clock downloads real PC data', async () => {
  const pc = snapshot(100);
  const { api, calls } = harness(initial(), pc);
  assert.equal(await synchronizeSnapshots(api), 'download');
  assert.deepEqual(calls, [['apply', pc]]);
});

test('sample already uploaded by an old client never replaces real local notes', () => {
  assert.equal(chooseSyncAction(snapshot(100), initial()), 'upload');
});

test('startup-added flags and column widths still count as untouched sample data', () => {
  const phone = initial();
  for (const note of phone.data.notes) {
    Object.assign(note, { folderId: null, isTemplate: false, templateSourceId: null,
      isDailyDefault: false, isFavorite: false, tags: [], sortIndex: 123 });
  }
  phone.data.notes[0].blocks[4].children.forEach(column => { column.properties = { width: 50 }; });
  assert.equal(chooseSyncAction(phone, snapshot(100)), 'download');
});

test('edited sample notes are protected even if the last change was a timer edit', () => {
  const phone = initial();
  phone.data.notes[0].blocks[0].content = 'My own writing';
  assert.equal(chooseSyncAction(phone, snapshot(100)), 'conflict');
});

test('newer and larger content syncs in either direction; old large content does not win', () => {
  const older = snapshot(100, 'メモ');
  const newer = snapshot(200, '追記した日本語のメモ');
  assert.equal(chooseSyncAction(older, newer), 'download');
  assert.equal(chooseSyncAction(newer, older), 'upload');
  assert.equal(chooseSyncAction(snapshot(300, '短'), newer), 'conflict');
  assert.equal(chooseSyncAction(newer, snapshot(300, '短')), 'conflict');
});

test('missing note, folder or log IDs cannot be hidden by a large image', () => {
  for (const key of ['notes', 'folders', 'focusLogs']) {
    const older = snapshot(100);
    older.data[key].push({ id: 'must-keep' });
    assert.equal(chooseSyncAction(snapshot(200, 'large image'.repeat(1000)), older), 'conflict');
  }
});

test('same data is a no-op, while different content at the same time is protected', () => {
  assert.equal(chooseSyncAction(snapshot(100), snapshot(200)), 'equal');
  assert.equal(chooseSyncAction(snapshot(100, 'One'), snapshot(100, 'Two')), 'conflict');
});

test('backup completes before either side is replaced', async () => {
  const older = snapshot(100, 'old');
  const newer = snapshot(200, 'new and larger');
  for (const [local, remote, action] of [[older, newer, 'apply'], [newer, older, 'upload']]) {
    const { api, calls } = harness(local, remote);
    await synchronizeSnapshots(api);
    assert.deepEqual(calls.map(call => call[0]), ['backup', action]);
    assert.deepEqual(calls[0][1], older);
  }
});

test('failed backup leaves both sides untouched', async () => {
  const { api, calls } = harness(snapshot(100, 'old'), snapshot(200, 'new and larger'));
  api.backup = async () => { throw new Error('Backup failed'); };
  await assert.rejects(synchronizeSnapshots(api), /Backup failed/);
  assert.deepEqual(calls, []);
});

test('editing while downloading or backing up never gets overwritten', async () => {
  const local = snapshot(100, 'old');
  const { api, calls } = harness(local, snapshot(200, 'new and larger'));
  api.backup = async () => {
    local.data.notes[0].title = 'User is now writing a much longer local note';
    local.syncMeta.updatedAt = 300;
  };
  assert.equal(await synchronizeSnapshots(api), 'upload');
  assert.equal(calls.some(call => call[0] === 'apply'), false);
  assert.equal(calls[0][1].data.notes[0].title, local.data.notes[0].title);
});

test('revision race reloads and protects newer smaller cloud data', async () => {
  const local = snapshot(200, 'new and larger');
  const { api, calls } = harness(local, snapshot(100, 'old'));
  let reads = 0;
  api.readRemote = async () => ({ snapshot: reads++ ? snapshot(300, 'short') : snapshot(100, 'old'), rev: `rev-${reads}` });
  api.upload = async (data, rev) => {
    calls.push(['attempt', rev]);
    throw { status: 409 };
  };
  assert.equal(await synchronizeSnapshots(api), 'conflict');
  assert.equal(reads, 2);
  assert.deepEqual(calls.filter(call => call[0] === 'attempt'), [['attempt', 'rev-1']]);
});

test('simultaneous first uploads re-read the created file before retrying', async () => {
  const local = snapshot(100, 'old');
  const { api, calls } = harness(local, null);
  let reads = 0;
  api.readRemote = async () => ({ snapshot: reads++ ? snapshot(200, 'new and larger') : null, rev: reads > 1 ? 'created' : '' });
  api.upload = async (data, rev) => { assert.equal(rev, ''); throw { status: 409 }; };
  assert.equal(await synchronizeSnapshots(api), 'download');
  assert.equal(calls.at(-1)[0], 'apply');
});

test('malformed cloud data is rejected before any backup or replacement', async () => {
  const { api, calls } = harness(snapshot(100), { data: { notes: [] } });
  await assert.rejects(synchronizeSnapshots(api), /Invalid Notidian/);
  assert.deepEqual(calls, []);
});
