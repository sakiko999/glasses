import type { KeyEventLike, PlatformInput, PointerEventLike } from '../types';

export function createWebInput(target: HTMLElement): PlatformInput {
  const pointerCbs = new Set<(e: PointerEventLike) => void>();
  const keyCbs = new Set<(e: KeyEventLike) => void>();
  const lastPos = new Map<number, { x: number; y: number }>();
  // PointerEvent.detail is specified as always 0 — click counting must be
  // done by hand (time + distance window) or double-clicks never exist.
  let clickTime = 0;
  let clickX = 0;
  let clickY = 0;
  let clickCount = 0;

  const toLocal = (ev: PointerEvent) => {
    const rect = target.getBoundingClientRect();
    return {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    };
  };

  const emitPointer = (ev: PointerEvent, phase: PointerEventLike['phase']) => {
    const position = toLocal(ev);
    const prev = lastPos.get(ev.pointerId) ?? position;
    if (phase !== 'up' && phase !== 'cancel') {
      lastPos.set(ev.pointerId, position);
    } else {
      lastPos.delete(ev.pointerId);
    }
    if (phase === 'down') {
      const now = performance.now();
      const moved = Math.hypot(position.x - clickX, position.y - clickY);
      clickCount = now - clickTime < 450 && moved < 10 ? clickCount + 1 : 1;
      clickTime = now;
      clickX = position.x;
      clickY = position.y;
    }
    const event: PointerEventLike = {
      id: ev.pointerId,
      phase,
      position,
      delta: { x: position.x - prev.x, y: position.y - prev.y },
      buttons: ev.buttons,
      pressure: ev.pressure,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      detail: phase === 'down' ? clickCount : 0,
      preventDefault: () => ev.preventDefault(),
    };
    for (const cb of pointerCbs) cb(event);
  };

  const onPointerDown = (ev: PointerEvent) => {
    target.setPointerCapture(ev.pointerId);
    emitPointer(ev, 'down');
  };
  const onPointerMove = (ev: PointerEvent) => emitPointer(ev, 'move');
  const onPointerUp = (ev: PointerEvent) => {
    emitPointer(ev, 'up');
    if (target.hasPointerCapture(ev.pointerId)) {
      target.releasePointerCapture(ev.pointerId);
    }
  };
  const onPointerCancel = (ev: PointerEvent) => emitPointer(ev, 'cancel');

  const onKeyDown = (ev: KeyboardEvent) => {
    const event: KeyEventLike = {
      phase: 'down',
      key: ev.key,
      code: ev.code,
      repeat: ev.repeat,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      preventDefault: () => ev.preventDefault(),
    };
    for (const cb of keyCbs) cb(event);
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    const event: KeyEventLike = {
      phase: 'up',
      key: ev.key,
      code: ev.code,
      repeat: ev.repeat,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      preventDefault: () => ev.preventDefault(),
    };
    for (const cb of keyCbs) cb(event);
  };

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    onPointer(cb) {
      pointerCbs.add(cb);
      return () => pointerCbs.delete(cb);
    },
    onKey(cb) {
      keyCbs.add(cb);
      return () => keyCbs.delete(cb);
    },
  };
}
