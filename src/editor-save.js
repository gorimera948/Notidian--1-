export function createEditorSaveQueue(save, start = setTimeout, stop = clearTimeout) {
  let pending = false, timer = null;
  const flush = () => {
    stop(timer);
    if (!pending) return;
    pending = false;
    save();
  };
  return {
    schedule() { pending = true; stop(timer); timer = start(flush, 300); },
    flush
  };
}
