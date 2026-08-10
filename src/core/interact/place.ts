/**
 * Tap-to-place — the single-pointer alternative to dragging (WCAG 2.2 SC 2.5.7).
 *
 * Spec §10: `beginPlace(id) → completePlace(point) | cancelPlace()`. The item
 * stays exactly where it is while placing is armed; the second tap is what
 * commits, so the whole interaction is two independent taps with no path
 * between them and no dragging, holding or timing involved. The React adapter
 * surfaces it as a focusable per-item affordance (`ui.moveButtonProps`) and the
 * pointer sensor turns any press inside the container into `completePlace`.
 *
 * ## Where the item lands
 *
 * The point becomes the item's TOP-LEFT corner, not its centre. Centring reads
 * better for a mouse drag, where the item is already under the cursor — but a
 * tap-to-place user is aiming at a spot on a grid of other items' corners, and
 * every other coordinate in the system (the rect, the announcement, the CSS) is
 * expressed as a top-left origin. Landing the corner is what makes "place it at
 * 240, 300" mean one thing everywhere.
 *
 * The landing rect is clamped into the container so a placement can never put
 * an item entirely out of reach; the vertical clamp only applies when the
 * container has a definite height (§1.6).
 */

import type { Rect } from '../schema/types';
import type { InteractRuntime } from './machine';

export interface PlaceController {
  begin(id: string): void;
  complete(point: { x: number; y: number }): void;
  cancel(): void;
}

function clamp(value: number, max: number | undefined): number {
  const v = value < 0 ? 0 : value;
  if (max === undefined || !Number.isFinite(max)) return v;
  return v > max ? Math.max(0, max) : v;
}

export function createPlaceController<TData>(rt: InteractRuntime<TData>): PlaceController {
  const machine = rt.machine;

  function begin(id: string): void {
    if (!rt.isEdit()) return;
    // One transient phase at a time: a pointer gesture or a keyboard grab is
    // already moving this item.
    if (machine.busy() || machine.grab() !== null) return;
    const item = rt.store.getItem(id);
    const rect = rt.store.getItemView(id)?.rect;
    if (!item || !rect || item.locked === true) return;
    rt.store.setSelection([id]);
    machine.setPlacing(id);
    rt.setInteraction({ phase: 'placing', id });
    rt.announce('placingStarted', id, rect);
  }

  function complete(point: { x: number; y: number }): void {
    const id = machine.placing();
    if (id === null) return;
    const rect = rt.store.getItemView(id)?.rect;
    machine.setPlacing(null);
    rt.idle();
    // The dashboard went read-only between the two taps.
    if (!rect || !rt.isEdit()) return;

    const height = rt.layoutHeight();
    const target: Rect = {
      x: clamp(point.x, Math.max(0, rt.layoutWidth() - rect.w)),
      y: height === undefined ? Math.max(0, point.y) : clamp(point.y, Math.max(0, height - rect.h)),
      w: rect.w,
      h: rect.h,
    };

    rt.commitRects(new Map<string, Rect>([[id, target]]), 'move', 'place');
    rt.announce('placed', id);
  }

  function cancel(): void {
    const id = machine.placing();
    if (id === null) return;
    machine.setPlacing(null);
    rt.idle();
    rt.announce('canceled', id);
  }

  return { begin, complete, cancel };
}
