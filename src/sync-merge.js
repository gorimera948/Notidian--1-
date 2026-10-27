import { canonicalJSON, isInitialSnapshot, validateSnapshot, snapshotContent } from './sync-snapshot.js';

const MISSING = Symbol('missing');
const clone = value => value === MISSING ? MISSING : structuredClone(value);
const same = (a, b) => a === MISSING || b === MISSING ? a === b : canonicalJSON(a) === canonicalJSON(b);
const object = value => value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
const get = (value, key) => object(value) && Object.hasOwn(value, key) ? value[key] : MISSING;
const withoutTime = value => object(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt')) : value;

// Stable, non-secret content IDs deduplicate saved conflicts and deletion records.
export function contentId(value) {
  const text = canonicalJSON(withoutTime(value));
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function sameSyncContent(a, b) {
  return snapshotContent(a) === snapshotContent(b) &&
    canonicalJSON(a.syncTombstones || {}) === canonicalJSON(b.syncTombstones || {});
}

function mergeOrder(preferred, other, kept) {
  const order = preferred.filter(id => kept.has(id));
  for (let i = 0; i < other.length; i++) {
    const id = other[i];
    if (!kept.has(id) || order.includes(id)) continue;
    const previous = other.slice(0, i).reverse().find(key => order.includes(key));
    const next = other.slice(i + 1).find(key => order.includes(key));
    if (previous !== undefined) order.splice(order.indexOf(previous) + 1, 0, id);
    else if (next !== undefined) order.splice(order.indexOf(next), 0, id);
    else order.push(id);
  }
  return order;
}

function preferLocal(local, remote, fallback) {
  const lt = Number(local?.updatedAt) || fallback.localTime;
  const rt = Number(remote?.updatedAt) || fallback.remoteTime;
  return lt === rt ? canonicalJSON(local) > canonicalJSON(remote) : lt > rt;
}

function conflictNote(entity, collection, originalId) {
  const version = contentId({ collection, originalId, value: withoutTime(entity) });
  const id = `sync-conflict-${originalId}-${version}`;
  if (collection === 'notes') {
    return { ...clone(entity), id, title: `${entity.title || '無題'}（別端末の変更）`,
      isTemplate: false, isDailyDefault: false, templateSourceId: null,
      syncConflict: { originalId, version } };
  }
  const label = collection === 'folders' ? 'フォルダー' : collection === 'focusLogs' ? '作業ログ' : '設定';
  return { id, title: `同期で保存した別の変更：${label}`, updatedAt: Number(entity?.updatedAt) || 0,
    blocks: [{ id: `${id}-text`, type: 'p', content: JSON.stringify(entity, null, 2) }],
    syncConflict: { originalId, version } };
}

function mergeArray(base, local, remote, path, ctx) {
  const arrays = [base, local, remote].filter(Array.isArray);
  const items = arrays.flat();
  if (items.length && items.every(item => object(item) && typeof item.id === 'string') &&
      arrays.every(array => new Set(array.map(item => item.id)).size === array.length)) {
    return mergeRecords(Array.isArray(base) ? base : [], local, remote, path, ctx);
  }
  // Tags and other unique scalar lists can preserve independent additions/removals.
  if (items.every(item => item === null || typeof item !== 'object') &&
      arrays.every(array => new Set(array).size === array.length)) {
    const bm = new Set(Array.isArray(base) ? base : []);
    const lm = new Set(local), rm = new Set(remote);
    const kept = new Set([...lm, ...rm].filter(item => !bm.has(item) || lm.has(item) && rm.has(item)));
    return mergeOrder(ctx.preferLocal ? local : remote, ctx.preferLocal ? remote : local, kept);
  }
  ctx.conflict = true;
  return clone(ctx.preferLocal ? local : remote);
}

function mergeValue(base, local, remote, path, ctx) {
  // Visit ID-based descendants even when unchanged, to retain deletion history.
  if (Array.isArray(local) && Array.isArray(remote)) {
    const arrays = [base, local, remote].filter(Array.isArray);
    if (arrays.flat().length && arrays.flat().every(item => object(item) && typeof item.id === 'string') &&
        arrays.every(array => new Set(array.map(item => item.id)).size === array.length)) {
      return mergeRecords(Array.isArray(base) ? base : [], local, remote, path, ctx);
    }
  }
  if (object(local) && object(remote)) {
    const result = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(object(base) ? base : {})])) {
      const value = key === 'updatedAt'
        ? Math.max(Number(local[key]) || 0, Number(remote[key]) || 0)
        : mergeValue(get(base, key), get(local, key), get(remote, key), [...path, key], ctx);
      if (value !== MISSING) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  if (same(local, remote)) return clone(local);
  if (base !== MISSING && same(local, base)) return clone(remote);
  if (base !== MISSING && same(remote, base)) return clone(local);
  if (local === MISSING || remote === MISSING) {
    if (base !== MISSING) ctx.conflict = true; // Keep an edit concurrent with a deletion.
    return clone(local === MISSING ? remote : local);
  }
  if (Array.isArray(local) && Array.isArray(remote)) return mergeArray(base, local, remote, path, ctx);
  ctx.conflict = true;
  return clone(ctx.preferLocal ? local : remote);
}

function mergeRecords(base, local, remote, path, parent) {
  const bm = new Map(base.map(item => [item.id, item]));
  const lm = new Map(local.map(item => [item.id, item]));
  const rm = new Map(remote.map(item => [item.id, item]));
  const result = new Map();
  for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
    const b = bm.get(id) ?? MISSING;
    let l = lm.get(id) ?? MISSING, r = rm.get(id) ?? MISSING;
    const key = canonicalJSON([...path, id]);
    const deleted = new Set(parent.tombstones[key] || []);
    if (b !== MISSING && (l === MISSING || r === MISSING)) deleted.add(contentId(b));
    if (deleted.size) parent.tombstones[key] = [...deleted].sort();
    if (l !== MISSING && deleted.has(contentId(l))) l = MISSING;
    if (r !== MISSING && deleted.has(contentId(r))) r = MISSING;
    if (l === MISSING && r === MISSING) continue;
    const ctx = { ...parent, conflict: false,
      preferLocal: l !== MISSING && r !== MISSING ? preferLocal(l, r, parent) : parent.preferLocal };
    const merged = mergeValue(b, l, r, [...path, id], ctx);
    if (merged !== MISSING) result.set(id, merged);
    if (ctx.conflict && path.length === 1 && l !== MISSING && r !== MISSING) {
      const losing = ctx.preferLocal ? r : l;
      if (losing !== MISSING) parent.conflicts.push(conflictNote(losing, path[0], id));
    } else if (ctx.conflict) parent.conflict = true;
  }
  const baseOrder = base.map(item => item.id);
  const localOrder = local.map(item => item.id), remoteOrder = remote.map(item => item.id);
  const useLocal = same(baseOrder, remoteOrder) ? true : same(baseOrder, localOrder) ? false : parent.preferLocal;
  return mergeOrder(useLocal ? localOrder : remoteOrder, useLocal ? remoteOrder : localOrder, new Set(result.keys()))
    .map(id => result.get(id));
}

export function mergeSnapshots(local, remote, base = null) {
  validateSnapshot(local);
  if (!remote) return { snapshot: clone(local), conflicts: 0 };
  validateSnapshot(remote);
  if (base) validateSnapshot(base);
  if (sameSyncContent(local, remote) && (!base || sameSyncContent(base, local))) {
    return { snapshot: clone(local), conflicts: 0 };
  }
  if (isInitialSnapshot(local) && !isInitialSnapshot(remote)) return { snapshot: clone(remote), conflicts: 0 };
  if (isInitialSnapshot(remote) && !isInitialSnapshot(local)) return { snapshot: clone(local), conflicts: 0 };
  if (isInitialSnapshot(local) && isInitialSnapshot(remote)) return { snapshot: clone(remote), conflicts: 0 };

  const tombstones = {};
  for (const source of [base, local, remote]) {
    for (const [key, hashes] of Object.entries(source?.syncTombstones || {})) {
      tombstones[key] = [...new Set([...(tombstones[key] || []), ...hashes])].sort();
    }
  }
  const ctx = { tombstones, conflicts: [], conflict: false,
    localTime: Number(local.syncMeta?.updatedAt) || 0, remoteTime: Number(remote.syncMeta?.updatedAt) || 0 };
  ctx.preferLocal = preferLocal(local.syncMeta, remote.syncMeta, ctx);
  const data = {};
  for (const key of new Set([...Object.keys(local.data), ...Object.keys(remote.data)])) {
    if (key === 'collapsedFolders' || key === 'focusLogSort') {
      data[key] = clone(local.data[key] ?? remote.data[key]);
    } else if (['notes', 'folders', 'focusLogs'].includes(key)) {
      data[key] = mergeRecords(base?.data[key] || [], local.data[key], remote.data[key], [key], ctx);
    } else {
      const settings = { ...ctx, conflict: false };
      const value = mergeValue(get(base?.data, key), get(local.data, key), get(remote.data, key), [key], settings);
      if (value !== MISSING) data[key] = value;
      if (settings.conflict) ctx.conflicts.push(conflictNote({ [key]: ctx.preferLocal ? remote.data[key] : local.data[key] }, 'settings', key));
    }
  }
  for (const note of ctx.conflicts) if (!data.notes.some(existing => existing.id === note.id)) data.notes.push(note);
  // A concurrent folder deletion must never make its surviving notes disappear.
  const folders = new Set(data.folders.map(folder => folder.id));
  data.notes.forEach(note => { if (note.folderId && !folders.has(note.folderId)) note.folderId = null; });
  data.folders.forEach(folder => { if (folder.parentId && !folders.has(folder.parentId)) folder.parentId = null; });
  if (data.dailyFolderId && !folders.has(data.dailyFolderId)) data.dailyFolderId = '';
  return { snapshot: { app: 'notidian', schemaVersion: 1,
    syncMeta: { ...(ctx.preferLocal ? local.syncMeta : remote.syncMeta),
      updatedAt: Math.max(ctx.localTime, ctx.remoteTime), source: 'merge' },
    syncTombstones: tombstones, data }, conflicts: ctx.conflicts.length };
}
