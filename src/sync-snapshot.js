import { sampleNotes } from './sample-notes.js';
import { DEFAULT_POMODORO_SETS } from './pomodoro-defaults.js';

export function canonicalJSON(value, ignored = new Set()) {
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
    if (data[key].some(item => !item || typeof item.id !== 'string') ||
        new Set(data[key].map(item => item.id)).size !== data[key].length) {
      throw new Error(`Invalid Notidian ${key}.`);
    }
  }
  if (snapshot.syncTombstones !== undefined) {
    if (!snapshot.syncTombstones || Array.isArray(snapshot.syncTombstones) || typeof snapshot.syncTombstones !== 'object') {
      throw new Error('Invalid Notidian deletion history.');
    }
    for (const [key, hashes] of Object.entries(snapshot.syncTombstones)) {
      const path = JSON.parse(key);
      if (!Array.isArray(path) || !path.every(part => typeof part === 'string') ||
          !Array.isArray(hashes) || !hashes.every(hash => typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash))) {
        throw new Error('Invalid Notidian deletion history.');
      }
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
    (!(pomodoro?.sets || []).length || canonicalJSON(pomodoro.sets) === canonicalJSON(DEFAULT_POMODORO_SETS)) &&
    (!(pomodoro?.schedule || []).length || canonicalJSON(pomodoro.schedule) === canonicalJSON([DEFAULT_POMODORO_SETS[0]])) &&
    (pomodoro?.timerVolume === undefined || Number(pomodoro.timerVolume) === 0.5) &&
    !snapshot.data.timerTargetTableName &&
    ['initial', 'pomodoro'].includes(snapshot.syncMeta?.source);
}
