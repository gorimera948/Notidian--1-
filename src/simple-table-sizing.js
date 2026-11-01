export const MIN_COLUMN_WIDTH = 80;
export const MIN_TABLE_WIDTH = 25;
const weight = column => Number.isFinite(Number(column.width)) && Number(column.width) > 0 ? Number(column.width) : 160;

export function getSimpleTableWidth(properties) {
  const width = Number(properties.width);
  return Number.isFinite(width) ? Math.max(MIN_TABLE_WIDTH, Math.min(100, width)) : 100;
}

export function setSimpleTableWidth(properties, width) {
  if (!Number.isFinite(width)) return false;
  properties.width = Math.round(Math.max(MIN_TABLE_WIDTH, Math.min(100, width)) * 10) / 10;
  return true;
}

export function getSimpleTableColumnWidths(properties, availableWidth) {
  const weights = properties.columns.map(weight);
  const result = [];
  let remaining = Math.max(weights.length * MIN_COLUMN_WIDTH, Number(availableWidth) || 0);
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

export function resizeSimpleTableColumn(properties, index, delta, availableWidth) {
  if (!Number.isInteger(index) || index < 0 || index >= properties.columns.length - 1 || !Number.isFinite(delta)) return false;
  const widths = getSimpleTableColumnWidths(properties, availableWidth);
  const shift = Math.max(MIN_COLUMN_WIDTH - widths[index], Math.min(widths[index + 1] - MIN_COLUMN_WIDTH, delta));
  if (Math.abs(shift) < 0.01) return false;
  const free = widths.findIndex(width => width > MIN_COLUMN_WIDTH + 0.01);
  const scale = weight(properties.columns[free]) / widths[free];
  properties.columns[index].width = Number(((widths[index] + shift) * scale).toFixed(4));
  properties.columns[index + 1].width = Number(((widths[index + 1] - shift) * scale).toFixed(4));
  return true;
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
