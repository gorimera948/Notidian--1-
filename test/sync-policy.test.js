import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizeSnapshots } from '../src/sync-policy.js';
import { sameSyncContent } from '../src/sync-merge.js';
import { sampleNotes } from '../src/sample-notes.js';

const copy = structuredClone;
const note = (id, text = id) => ({ id, title: id, blocks: [{ id: `${id}-block`, type: 'p', content: text }] });
const snapshot = (notes = [note('one'), note('two')]) => ({ app: 'notidian', schemaVersion: 1,
  syncMeta: { updatedAt: 1, source: 'notes' }, data: { notes, folders: [], focusLogs: [] } });
function harness(local = snapshot(), remote = copy(local), base = copy(local)) {
  const state = { local, remote, base, rev: 1 }, calls = [];
  const api = {
    readLocal: () => state.local,
    readRemote: async () => ({ snapshot: copy(state.remote), rev: state.remote ? String(state.rev) : '' }),
    readBase: async () => copy(state.base),
    remember: async data => { calls.push('remember'); state.base = copy(data); },
    backup: async (data, side) => calls.push(`backup-${side}`),
    upload: async (data, rev) => {
      assert.equal(rev, state.remote ? String(state.rev) : '');
      calls.push('upload'); state.remote = copy(data); state.rev++;
    },
    apply: async data => { calls.push('apply'); state.local = copy(data); },
    isConflict: err => err.status === 409
  };
  return { state, calls, api };
}

test('a new device receives real content without uploading its initial sample', async () => {
  const sample = snapshot(copy(sampleNotes)); sample.syncMeta.source = 'initial';
  const { api, calls, state } = harness(sample, snapshot(), null);
  assert.equal(await synchronizeSnapshots(api), 'download');
  assert.deepEqual(calls, ['apply', 'remember']);
  assert.equal(state.local.data.notes.length, 2);
});

test('merging backs up both originals before a revision-checked upload and local apply', async () => {
  const { api, state, calls } = harness();
  state.local.data.notes[0].title = 'PC'; state.remote.data.notes[1].title = 'phone';
  assert.equal(await synchronizeSnapshots(api), 'merge');
  assert.deepEqual(calls, ['backup-local', 'backup-cloud', 'upload', 'apply', 'remember']);
  assert.deepEqual(state.local.data.notes.map(n => n.title), ['PC', 'phone']);
  assert.ok(sameSyncContent(state.local, state.remote));
});

test('a failed backup stops the replacement without recording a successful sync', async () => {
  const { api, state, calls } = harness();
  state.remote.data.notes[0].title = 'phone';
  api.backup = async () => { throw new Error('Backup failed'); };
  await assert.rejects(synchronizeSnapshots(api), /Backup failed/);
  assert.deepEqual(calls, []);
  assert.equal(state.local.data.notes[0].title, 'one');
});

test('edits during a backup are re-read before anything replaces the local notebook', async () => {
  const { api, state } = harness();
  state.remote.data.notes[1].title = 'phone';
  api.backup = async () => { state.local.data.notes[0].title = 'still typing'; };
  await synchronizeSnapshots(api);
  assert.deepEqual(state.local.data.notes.map(n => n.title), ['still typing', 'phone']);
});

test('edits during upload survive the next pass without false conflicts', async () => {
  const { api, state, calls } = harness();
  state.local.data.notes[0].title = 'PC'; state.remote.data.notes[1].title = 'phone';
  const upload = api.upload;
  api.upload = async (...args) => { await upload(...args); state.local.data.notes[0].title = 'PC continued'; };
  assert.equal(await synchronizeSnapshots(api), 'retry');
  assert.equal(calls.includes('apply'), false);
  api.upload = upload;
  assert.equal(await synchronizeSnapshots(api), 'merge');
  assert.deepEqual(state.local.data.notes.map(n => n.title), ['PC continued', 'phone']);
  assert.equal(state.local.data.notes.length, 2);
});

test('another device wins the upload race, then its new additions are merged', async () => {
  const { api, state } = harness(); state.local.data.notes[0].title = 'PC';
  const upload = api.upload; let attempts = 0;
  api.upload = async (...args) => {
    if (!attempts++) {
      state.remote.data.notes.push(note('third-device')); state.rev++;
      throw { status: 409 };
    }
    return upload(...args);
  };
  await synchronizeSnapshots(api);
  assert.equal(attempts, 2);
  assert.deepEqual(new Set(state.local.data.notes.map(n => n.title)), new Set(['PC', 'two', 'third-device']));
});

test('simultaneous first uploads use add, then merge the existing file on conflict', async () => {
  const { api, state } = harness(snapshot([note('pc')]), null, null);
  const upload = api.upload; let attempts = 0;
  api.upload = async (data, rev) => {
    if (!attempts++) { assert.equal(rev, ''); state.remote = snapshot([note('phone')]); throw { status: 409 }; }
    return upload(data, rev);
  };
  await synchronizeSnapshots(api);
  assert.deepEqual(new Set(state.remote.data.notes.map(n => n.id)), new Set(['pc', 'phone']));
});

test('active editing defers an incoming replacement and resumes later', async () => {
  const { api, state, calls } = harness(); state.remote.data.notes[0].title = 'phone';
  api.canApply = () => false;
  assert.equal(await synchronizeSnapshots(api), 'deferred'); assert.deepEqual(calls, []);
  api.canApply = () => true;
  assert.equal(await synchronizeSnapshots(api), 'download');
  assert.equal(state.local.data.notes[0].title, 'phone');
});

test('unchanged polling does not upload or rewrite the baseline', async () => {
  const { api, calls } = harness();
  assert.equal(await synchronizeSnapshots(api), 'equal'); assert.deepEqual(calls, []);
});

test('persistent revision conflicts yield a retry without applying uncommitted data', async () => {
  const { api, state, calls } = harness(); state.local.data.notes[0].title = 'PC';
  let attempts = 0;
  api.upload = async () => { attempts++; throw { status: 409 }; };
  assert.equal(await synchronizeSnapshots(api), 'retry');
  assert.equal(attempts, 3); assert.equal(calls.includes('apply'), false);
});

test('invalid or unavailable cloud data never triggers an initial upload', async () => {
  const { api, calls } = harness();
  api.readRemote = async () => ({ snapshot: { data: { notes: [] } }, rev: 'bad' });
  await assert.rejects(synchronizeSnapshots(api), /Invalid Notidian/); assert.deepEqual(calls, []);
  api.readRemote = async () => { throw new Error('offline'); };
  await assert.rejects(synchronizeSnapshots(api), /offline/); assert.deepEqual(calls, []);
});

test('three devices converge after separate offline edits, additions and deletions', async () => {
  const cloud = { snapshot: snapshot(), rev: 1 };
  const devices = [0, 1, 2].map(() => harness());
  for (const { api } of devices) {
    api.readRemote = async () => ({ snapshot: copy(cloud.snapshot), rev: String(cloud.rev) });
    api.upload = async (data, rev) => {
      if (rev !== String(cloud.rev)) throw { status: 409 };
      cloud.snapshot = copy(data); cloud.rev++;
    };
  }
  devices[0].state.local.data.notes[0].blocks[0].content = 'PC writing';
  devices[1].state.local.data.notes[1].blocks[0].content = 'phone writing';
  devices[2].state.local.data.notes.push(note('tablet'));
  await Promise.all(devices.map(d => synchronizeSnapshots(d.api)));
  for (let i = 0; i < 2; i++) for (const d of devices) await synchronizeSnapshots(d.api);
  for (const d of devices) {
    assert.ok(sameSyncContent(d.state.local, cloud.snapshot));
    assert.equal(d.state.local.data.notes.length, 3);
    assert.equal(d.state.local.data.notes[0].blocks[0].content, 'PC writing');
    assert.equal(d.state.local.data.notes[1].blocks[0].content, 'phone writing');
  }
  devices[1].state.local.data.notes = devices[1].state.local.data.notes.filter(n => n.id !== 'tablet');
  for (const d of [devices[1], devices[0], devices[2]]) await synchronizeSnapshots(d.api);
  assert.equal(cloud.snapshot.data.notes.some(n => n.id === 'tablet'), false);
});
