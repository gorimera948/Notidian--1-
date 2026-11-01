export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 2000;
export const DEFAULT_COLUMN_WIDTH = 120;
const weight = column => Number.isFinite(Number(column.width)) && Number(column.width) > 0 ? Number(column.width) : 160;
const clamp = width => Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));

export function getSimpleTableColumnWidths(properties, availableWidth) {
  if (properties.columnSizing === 'pixels') {
    return properties.columns.map(column => clamp(Number(column.width) || DEFAULT_COLUMN_WIDTH));
  }
  // Older tables stored percentages/relative weights. Preserve their visible
  // size until the first resize converts them to independent pixel widths.
  const weights = properties.columns.map(weight);
  const oldPercent = Number.isFinite(Number(properties.width)) ? Math.max(25, Math.min(100, Number(properties.width))) : 100;
  const result = [];
  let remaining = Math.max(weights.length * MIN_COLUMN_WIDTH, (Number(availableWidth) || weights.length * 160) * oldPercent / 100);
  let open = weights.map((_, index) => index);
  while (open.length) {
    const sum = open.reduce((total, index) => total + weights[index], 0);
    const small = open.filter(index => remaining * weights[index] / sum < MIN_COLUMN_WIDTH);
    if (!small.length) {
      open.forEach(index => { result[index] = remaining * weights[index] / sum; });
      break;
    }
    small.forEach(index => { result[index] = MIN_COLUMN_WIDTH; remaining -= MIN_COLUMN_WIDTH; });
    open = open.filter(index => !small.includes(index));
  }
  return result;
}

export function ensureSimpleTablePixelWidths(properties, availableWidth) {
  if (properties.columnSizing === 'pixels') return;
  const widths = getSimpleTableColumnWidths(properties, availableWidth);
  properties.columns.forEach((column, index) => { column.width = Math.round(clamp(widths[index]) * 10) / 10; });
  properties.columnSizing = 'pixels';
  delete properties.width;
}

export function resizeSimpleTableColumn(properties, index, delta, availableWidth) {
  if (!Number.isInteger(index) || index < 0 || index >= properties.columns.length || !Number.isFinite(delta)) return false;
  const widths = getSimpleTableColumnWidths(properties, availableWidth);
  const next = Math.round(clamp(widths[index] + delta) * 10) / 10;
  if (Math.abs(next - widths[index]) < 0.01) return false;
  ensureSimpleTablePixelWidths(properties, availableWidth);
  properties.columns[index].width = next;
  return true;
}

export function resetSimpleTableWidths(properties) {
  properties.columnSizing = 'pixels';
  delete properties.width;
  properties.columns.forEach(column => { column.width = DEFAULT_COLUMN_WIDTH; });
}

// Pointer capture keeps mouse and touch drags on the handle. Draft changes are
// committed only on release, so cancelled drags never alter saved table data.
export function bindTableResize(handle, { start, move, finish }) {
  let drag = null;
  const end = (commit, event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag; drag = null;
    handle.classList.remove('is-resizing');
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    finish(current.value, commit && handle.isConnected);
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault(); event.stopPropagation();
    handle.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, x: event.clientX, value: start() };
    handle.classList.add('is-resizing');
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    move(drag.value, event.clientX - drag.x);
  });
  handle.addEventListener('pointerup', event => end(true, event));
  handle.addEventListener('pointercancel', event => end(false, event));
  handle.addEventListener('lostpointercapture', event => end(false, event));
}
