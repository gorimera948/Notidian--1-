export function isEditableKeyboardTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const control = target.closest?.('input, textarea');
  if (!control || control.disabled || control.readOnly) return false;
  if (control.tagName === 'TEXTAREA') return true;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'image'].includes(control.type);
}

// Backspace outside a text editor must not invoke history navigation or the
// block deletion shortcuts. Deliberate block deletion still uses Delete.
export function preventUnfocusedBackspace(event, active = globalThis.document?.activeElement) {
  if (event.key !== 'Backspace' || isEditableKeyboardTarget(active || event.target)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
