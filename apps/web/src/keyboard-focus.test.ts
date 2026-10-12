import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachKeyboard } from './keyboard';
class Element {
  constructor(readonly kind = 'body') {}
  closest(selector: string) { return selector.includes(this.kind) && this.kind !== 'body' ? this : null; }
}
let windowEvents: EventTarget, documentEvents: EventTarget;
function key(code: string, down: boolean, kind = 'body') {
  const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false }, target: { value: new Element(kind) } });
  windowEvents.dispatchEvent(event); return event;
}
beforeEach(() => {
  windowEvents = new EventTarget(); documentEvents = new EventTarget();
  vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents); vi.stubGlobal('HTMLElement', Element);
});
afterEach(() => vi.unstubAllGlobals());
it('lets a focused native button receive Space without activating Dash or preventing its click', () => {
  const ability = vi.fn(), stop = attachKeyboard(vi.fn(), ability);
  try {
    expect(key('Space', true, 'button').defaultPrevented).toBe(false);
    expect(key('Space', false, 'button').defaultPrevented).toBe(false);
    expect(ability).not.toHaveBeenCalled();
  } finally { stop(); }
});
it('releases held movement and abilities even if focus changes before keyup', () => {
  const move = vi.fn(), ability = vi.fn(), stop = attachKeyboard(move, ability);
  try {
    key('KeyD', true); key('KeyD', false, 'input');
    expect(move.mock.lastCall?.[0]).toEqual({ x: 0, y: 0 });
    key('Space', true); key('Space', false, 'button'); key('Space', true);
    expect(ability).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});
