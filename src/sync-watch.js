export const REMOTE_POLL_MS = 15000;

export function watchDropboxChanges({ sync, connected, window: win = globalThis.window,
  document: doc = globalThis.document, online = () => globalThis.navigator?.onLine !== false,
  setInterval: start = globalThis.setInterval, clearInterval: stop = globalThis.clearInterval }) {
  const check = () => {
    if (connected() && online() && doc.visibilityState !== 'hidden') sync({ reason: 'poll' });
  };
  const afterEditing = () => queueMicrotask(check);
  win.addEventListener('focus', check);
  doc.addEventListener('visibilitychange', check);
  doc.addEventListener('focusout', afterEditing);
  const timer = start(check, REMOTE_POLL_MS);
  return () => {
    stop(timer);
    win.removeEventListener('focus', check);
    doc.removeEventListener('visibilitychange', check);
    doc.removeEventListener('focusout', afterEditing);
  };
}
