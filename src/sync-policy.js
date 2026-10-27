import { canonicalJSON, isInitialSnapshot, validateSnapshot } from './sync-snapshot.js';
import { mergeSnapshots, sameSyncContent } from './sync-merge.js';
export { validateSnapshot, isInitialSnapshot, snapshotContent } from './sync-snapshot.js';

// Re-read both devices on every race; a manual sync never forces an overwrite.
export async function synchronizeSnapshots({ readRemote, readLocal, readBase = async () => null,
  remember = async () => {}, backup, upload, apply, isConflict, canApply = () => true, onConflicts = () => {} }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { snapshot: remote, rev } = await readRemote();
    const base = await readBase();
    const local = structuredClone(readLocal());
    validateSnapshot(local);
    const { snapshot, conflicts } = mergeSnapshots(local, remote, base);
    const uploadNeeded = !remote || !sameSyncContent(snapshot, remote);
    const applyNeeded = !sameSyncContent(snapshot, local);
    if (!uploadNeeded && !applyNeeded) {
      if (!base || !sameSyncContent(base, snapshot)) await remember(snapshot);
      return 'equal';
    }
    if (applyNeeded && !canApply(snapshot)) return 'deferred';
    if (applyNeeded && !isInitialSnapshot(local)) await backup(local, 'local');
    if (uploadNeeded && remote && !isInitialSnapshot(remote)) await backup(remote, 'cloud');
    if (canonicalJSON(readLocal()) !== canonicalJSON(local)) continue;
    if (applyNeeded && !canApply(snapshot)) return 'deferred';
    try {
      if (uploadNeeded) await upload(snapshot, rev);
    } catch (err) {
      if (!isConflict(err)) throw err;
      continue;
    }
    // A keystroke during upload must be merged again before applying anything.
    if (canonicalJSON(readLocal()) !== canonicalJSON(local)) {
      // This device has seen its captured pre-upload state, but has not yet
      // applied incoming additions. Use that ancestor for the next merge.
      if (uploadNeeded) await remember(local);
      return 'retry';
    }
    if (applyNeeded && !canApply(snapshot)) return 'deferred';
    if (applyNeeded) await apply(snapshot);
    await remember(snapshot);
    onConflicts(conflicts);
    return uploadNeeded ? applyNeeded ? 'merge' : 'upload' : 'download';
  }
  return 'retry';
}
