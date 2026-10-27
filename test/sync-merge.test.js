import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots, sameSyncContent } from '../src/sync-merge.js';
import { sampleNotes } from '../src/sample-notes.js';

const copy = structuredClone;
const note = (id, text = id) => ({ id, title: id, updatedAt: 1,
  blocks: [{ id: `${id}-a`, type: 'p', content: text }, { id: `${id}-b`, type: 'p', content: 'second' }] });
function snapshot(notes = [note('one'), note('two')]) {
  return { app: 'notidian', schemaVersion: 1, syncMeta: { updatedAt: 1, source: 'notes' },
    data: { notes, folders: [], focusLogs: [], pomodoro: { sets: [], schedule: [], presets: [], timerVolume: 0.5 },
      customTagColors: {}, dailyFolderId: '', timerTargetTableName: '' } };
}
const titles = result => result.snapshot.data.notes.map(n => n.title);

test('different devices edit different notes, including shorter text', () => {
  const base = snapshot(), local = copy(base), remote = copy(base);
  local.data.notes[0].blocks[0].content = '短';
  remote.data.notes[1].blocks[0].content = 'written on a phone';
  const result = mergeSnapshots(local, remote, base);
  assert.equal(result.snapshot.data.notes[0].blocks[0].content, '短');
  assert.equal(result.snapshot.data.notes[1].blocks[0].content, 'written on a phone');
  assert.equal(result.conflicts, 0);
});

test('different blocks in one note combine without a conflict copy', () => {
  const base = snapshot(), local = copy(base), remote = copy(base);
  local.data.notes[0].blocks[0].content = 'PC';
  remote.data.notes[0].blocks[1].content = 'phone';
  const result = mergeSnapshots(local, remote, base);
  assert.deepEqual(result.snapshot.data.notes[0].blocks.map(b => b.content), ['PC', 'phone']);
  assert.equal(result.conflicts, 0);
});

test('the same block edited concurrently keeps a deterministic separate note', () => {
  const base = snapshot(), local = copy(base), remote = copy(base);
  local.data.notes[0].blocks[0].content = 'PC';
  remote.data.notes[0].blocks[0].content = 'phone';
  const a = mergeSnapshots(local, remote, base), b = mergeSnapshots(remote, local, base);
  assert.equal(a.conflicts, 1);
  assert.deepEqual(new Set(a.snapshot.data.notes.filter(n => n.id === 'one' || n.syncConflict).map(n => n.blocks[0].content)), new Set(['PC', 'phone']));
  assert.deepEqual(new Set(a.snapshot.data.notes.map(n => n.id)), new Set(b.snapshot.data.notes.map(n => n.id)));
  const again = mergeSnapshots(a.snapshot, a.snapshot, a.snapshot);
  assert.equal(again.snapshot.data.notes.length, a.snapshot.data.notes.length);
  assert.equal(again.conflicts, 0);
});

test('new devices still discard untouched sample data, regardless of its clock', () => {
  const initial = snapshot(copy(sampleNotes));
  initial.syncMeta = { updatedAt: 999999, source: 'pomodoro' };
  const real = snapshot();
  assert.deepEqual(titles(mergeSnapshots(initial, real)), ['one', 'two']);
  assert.deepEqual(titles(mergeSnapshots(real, initial)), ['one', 'two']);
});

test('an edited sample and custom timer settings are preserved on first migration', () => {
  const initial = snapshot(copy(sampleNotes));
  initial.syncMeta.source = 'pomodoro';
  initial.data.notes[0].blocks[0].content = 'my own sample edit';
  assert.equal(mergeSnapshots(initial, snapshot()).snapshot.data.notes.length, 5);
  initial.data.notes = copy(sampleNotes);
  initial.data.pomodoro.timerVolume = 0.9;
  const result = mergeSnapshots(initial, snapshot());
  assert.ok(result.snapshot.data.notes.some(n => n.id === 'note-welcome'));
  assert.ok(result.snapshot.data.pomodoro.timerVolume === 0.9 || result.snapshot.data.notes.some(n => n.syncConflict));
});

test('without a common base, disjoint new notes are united and differing versions are saved', () => {
  const result = mergeSnapshots(snapshot([note('pc')]), snapshot([note('phone')]));
  assert.deepEqual(new Set(titles(result)), new Set(['pc', 'phone']));
  const local = snapshot(), remote = snapshot();
  local.data.notes[0].blocks[0].content = 'unsynced local work';
  assert.equal(mergeSnapshots(local, remote).conflicts, 1);
});

test('note deletions propagate and cannot be resurrected by an unchanged offline device', () => {
  const base = snapshot(), deleted = copy(base);
  deleted.data.notes.shift();
  const merged = mergeSnapshots(deleted, base, base).snapshot;
  assert.deepEqual(merged.data.notes.map(n => n.id), ['two']);
  assert.ok(Object.keys(merged.syncTombstones).length > 0);
  const stale = mergeSnapshots(base, merged).snapshot;
  assert.deepEqual(stale.data.notes.map(n => n.id), ['two']);
});

test('deleted blocks remain deleted even when an offline client has no saved baseline', () => {
  const base = snapshot(), deleted = copy(base);
  deleted.data.notes[0].blocks.shift();
  const merged = mergeSnapshots(base, deleted, base).snapshot;
  assert.deepEqual(merged.data.notes[0].blocks.map(b => b.id), ['one-b']);
  const stale = mergeSnapshots(base, merged).snapshot;
  assert.deepEqual(stale.data.notes[0].blocks.map(b => b.id), ['one-b']);
});

test('a concurrent edit wins over deletion without losing that edit', () => {
  const base = snapshot(), deleted = copy(base), edited = copy(base);
  deleted.data.notes.shift();
  edited.data.notes[0].blocks[0].content = 'important concurrent edit';
  const result = mergeSnapshots(deleted, edited, base);
  assert.equal(result.snapshot.data.notes.find(n => n.id === 'one').blocks[0].content, 'important concurrent edit');
});

test('deleting every note remains an empty notebook', () => {
  const base = snapshot(), local = copy(base);
  local.data.notes = [];
  const result = mergeSnapshots(local, base, base).snapshot;
  assert.equal(result.data.notes.length, 0);
  assert.equal(mergeSnapshots(base, result).snapshot.data.notes.length, 0);
});

test('independent insertions in the middle of a block list retain both additions', () => {
  const base = snapshot(), local = copy(base), remote = copy(base);
  local.data.notes[0].blocks.splice(1, 0, { id: 'new-pc', content: 'PC addition' });
  remote.data.notes[0].blocks.splice(1, 0, { id: 'new-phone', content: 'phone addition' });
  const result = mergeSnapshots(local, remote, base);
  const ids = result.snapshot.data.notes[0].blocks.map(b => b.id);
  assert.equal(ids[0], 'one-a'); assert.equal(ids.at(-1), 'one-b');
  assert.ok(ids.includes('new-pc') && ids.includes('new-phone'));
  assert.equal(result.conflicts, 0);
});

test('database row cells merge independently through nested ID arrays', () => {
  const base = snapshot();
  base.data.notes[0].blocks = [{ id: 'table', type: 'database', properties: {
    rows: [{ id: 'row', name: 'old', duration: 10 }] } }];
  const local = copy(base), remote = copy(base);
  local.data.notes[0].blocks[0].properties.rows[0].name = 'PC';
  remote.data.notes[0].blocks[0].properties.rows[0].duration = 20;
  const result = mergeSnapshots(local, remote, base);
  assert.deepEqual(result.snapshot.data.notes[0].blocks[0].properties.rows[0], { id: 'row', name: 'PC', duration: 20 });
  assert.equal(result.conflicts, 0);
});

test('folders and logs merge; folder deletion never leaves an invisible note', () => {
  const base = snapshot();
  base.data.folders = [{ id: 'folder', name: 'folder' }];
  base.data.notes[0].folderId = 'folder';
  const local = copy(base), remote = copy(base);
  local.data.folders = [];
  remote.data.notes[0].blocks[0].content = 'retained work';
  local.data.focusLogs.push({ id: 'pc-log', duration: 1 });
  remote.data.focusLogs.push({ id: 'phone-log', duration: 2 });
  const result = mergeSnapshots(local, remote, base).snapshot;
  assert.equal(result.data.notes[0].folderId, null);
  assert.equal(result.data.focusLogs.length, 2);
});

test('independent tags and settings updates combine', () => {
  const base = snapshot();
  base.data.notes[0].tags = ['remove', 'keep'];
  const local = copy(base), remote = copy(base);
  local.data.notes[0].tags = ['keep', 'pc'];
  remote.data.notes[0].tags.push('phone');
  local.data.customTagColors.pc = 'red';
  remote.data.pomodoro.timerVolume = 0.8;
  const result = mergeSnapshots(local, remote, base);
  assert.deepEqual(new Set(result.snapshot.data.notes[0].tags), new Set(['keep', 'pc', 'phone']));
  assert.equal(result.snapshot.data.customTagColors.pc, 'red');
  assert.equal(result.snapshot.data.pomodoro.timerVolume, 0.8);
  assert.equal(result.conflicts, 0);
});

test('metadata and UI state alone do not produce endless uploads', () => {
  const a = snapshot(), b = copy(a);
  b.syncMeta.updatedAt = 999;
  b.data.collapsedFolders = ['folder'];
  assert.ok(sameSyncContent(a, b));
});

test('duplicate record IDs and invalid deletion history fail safely', () => {
  const local = snapshot(), remote = copy(local);
  remote.data.notes.push(copy(remote.data.notes[0]));
  assert.throws(() => mergeSnapshots(local, remote), /Invalid Notidian/);
  remote.data.notes.pop(); remote.syncTombstones = { bad: [123] };
  assert.throws(() => mergeSnapshots(local, remote));
});
