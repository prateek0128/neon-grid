import type { AbilityKind, Vector } from '@neon/protocol';

const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
export function movementFromKeys(keys: ReadonlySet<string>): Vector {
  return {
    x: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
    y: Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')),
  };
}
export function attachKeyboard(onChange: (movement: Vector) => void, onAbility?: (ability: AbilityKind) => void) {
  const keys = new Set<string>();
  const abilitiesHeld = new Set<string>();
  const change = (event: KeyboardEvent, down: boolean) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (onAbility && (event.code === 'Space' || event.code === 'KeyE')) {
      event.preventDefault();
      if (down) {
        if (!event.repeat && !abilitiesHeld.has(event.code)) onAbility(event.code === 'Space' ? 'dash' : 'shield');
        abilitiesHeld.add(event.code);
      } else abilitiesHeld.delete(event.code);
      return;
    }
    if (!movementCodes.has(event.code)) return;
    event.preventDefault();
    if (down) keys.add(event.code); else keys.delete(event.code);
    onChange(movementFromKeys(keys));
  };
  const down = (event: KeyboardEvent) => change(event, true);
  const up = (event: KeyboardEvent) => change(event, false);
  const clear = () => { keys.clear(); abilitiesHeld.clear(); onChange({ x: 0, y: 0 }); };
  const visibility = () => { if (document.hidden) clear(); };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', visibility);
    clear();
  };
}
