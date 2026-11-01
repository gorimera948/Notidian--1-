import test from 'node:test';
import assert from 'node:assert/strict';
import { preventUnfocusedBackspace } from '../src/editor-keyboard.js';

const control = (tagName, extra = {}) => {
  const node = { tagName, ...extra };
  node.closest = () => ['INPUT', 'TEXTAREA'].includes(tagName) ? node : null;
  return node;
};
const key = (name = 'Backspace') => {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: name, stopped: false });
  event.stopImmediatePropagation = () => { event.stopped = true; };
  return event;
};

test('Backspace without a text caret blocks navigation and block deletion', () => {
  for (const active of [control('BODY'), control('BUTTON'), control('DIV'),
    control('INPUT', { type: 'checkbox' }), control('TEXTAREA', { readOnly: true })]) {
    const event = key();
    assert.equal(preventUnfocusedBackspace(event, active), true);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
  }
});

test('Backspace continues to edit notes, table cells, and text inputs', () => {
  for (const active of [control('DIV', { isContentEditable: true }), control('TEXTAREA'), control('INPUT', { type: 'text' })]) {
    const event = key();
    assert.equal(preventUnfocusedBackspace(event, active), false);
    assert.equal(event.defaultPrevented, false);
  }
});

test('Delete and other shortcuts remain available without a caret', () => {
  const event = key('Delete');
  assert.equal(preventUnfocusedBackspace(event, control('BODY')), false);
  assert.equal(event.defaultPrevented, false);
});
