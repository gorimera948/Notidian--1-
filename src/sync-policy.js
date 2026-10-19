import { sampleNotes } from './sample-notes.js';

function canonicalJSON(value, ignored = new Set()) {
  return JSON.stringify(value, (key, item) => {
    if (ignored.has(key)) return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]]));
  });
}

function sampleNoteContent(note) {
  function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    const ignored = new Set(['id', 'updatedAt', 'sortIndex', 'open', 'width']);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key))
      .map(([key, item]) => [key, clean(item)])
      .filter(([key, item]) => key !== 'properties' || Object.keys(item || {}).length));
  }
  return canonicalJSON(clean({
    ...note, folderId: note.folderId || null, isTemplate: Boolean(note.isTemplate),
    templateSourceId: note.templateSourceId || null, isDailyDefault: Boolean(note.isDailyDefault),
    isFavorite: Boolean(note.isFavorite), tags: note.tags || []
  }));
}
const sampleContent = new Map(sampleNotes.map(note => [note.id, sampleNoteContent(note)]));

// A timestamp alone must never allow an empty/new device to replace real notes.
export function validateSnapshot(snapshot) {
  const data = snapshot?.data;
  if (snapshot?.app !== 'notidian' || snapshot.schemaVersion !== 1 ||
      !data || !['notes', 'folders', 'focusLogs'].every(key => Array.isArray(data[key]))) {
    throw new Error('Invalid Notidian sync snapshot.');
  }
  for (const key of ['notes', 'folders', 'focusLogs']) {
    if (data[key].some(item => !item || typeof item.id !== 'string')) {
      throw new Error(`Invalid Notidian ${key}.`);
    }
  }
  return snapshot;
}

export function snapshotContent(snapshot) {
  // UI expansion/sort preferences do not measure how much user content exists.
  const { collapsedFolders, focusLogSort, ...content } = snapshot.data;
  return canonicalJSON(content);
}

export function isInitialSnapshot(snapshot) {
  const { notes, folders, focusLogs, customTagColors, pomodoro } = snapshot.data;
  return notes.every(note => sampleContent.get(note.id) === sampleNoteContent(note)) &&
    folders.length === 0 && focusLogs.length === 0 &&
    Object.keys(customTagColors || {}).length === 0 &&
    !(pomodoro?.presets || []).length &&
    ['initial', 'pomodoro'].includes(snapshot.syncMeta?.source);
}

function canReplace(candidate, existing) {
  const candidateSize = new TextEncoder().encode(snapshotContent(candidate)).length;
  const existingSize = new TextEncoder().encode(snapshotContent(existing)).length;
  if (candidateSize < existingSize) return false;
  // A large pasted image must not mask missing notes, folders or work logs.
  return ['notes', 'folders', 'focusLogs'].every(key => {
    const ids = new Set(candidate.data[key].map(item => item.id));
    return existing.data[key].every(item => ids.has(item.id));
  });
}

export function chooseSyncAction(local, remote) {
  validateSnapshot(local);
  if (!remote) return 'upload';
  validateSnapshot(remote);
  if (snapshotContent(local) === snapshotContent(remote)) return 'equal';

  const localInitial = isInitialSnapshot(local);
  const remoteInitial = isInitialSnapshot(remote);
  if (localInitial && !remoteInitial) return 'download';
  if (remoteInitial && !localInitial) return 'upload';
  if (localInitial && remoteInitial) return 'download';

  const localTime = Number(local.syncMeta?.updatedAt) || 0;
  const remoteTime = Number(remote.syncMeta?.updatedAt) || 0;
  if (remoteTime > localTime && canReplace(remote, local)) return 'download';
  if (localTime > remoteTime && canReplace(local, remote)) return 'upload';
  return 'conflict';
}

// Every retry reads both sides again; a revision conflict never forces a write.
export async function synchronizeSnapshots({ readRemote, readLocal, backup, upload, apply, isConflict }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { snapshot: remote, rev } = await readRemote();
    const local = structuredClone(readLocal());
    const action = chooseSyncAction(local, remote);
    if (action === 'conflict' || action === 'equal') return action;

    const replaced = action === 'download' ? local : remote;
    if (replaced && !isInitialSnapshot(replaced)) await backup(replaced);
    // The user can keep editing during the network request for the backup.
    if (JSON.stringify(readLocal()) !== JSON.stringify(local)) continue;

    if (action === 'download') {
      await apply(remote);
      return 'download';
    }
    try {
      await upload(local, rev);
      return JSON.stringify(readLocal()) === JSON.stringify(local) ? 'upload' : 'retry';
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  }
  return 'retry';
}
