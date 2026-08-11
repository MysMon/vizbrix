# Accessibility

**WCAG 2.2 SC 2.5.7 (Dragging Movements, Level AA)** requires that every function operated by a
dragging movement has a single-pointer alternative that does not require dragging. vizbrix ships
that alternative — tap-to-place — plus a complete keyboard path (SC 2.1.1) and live-region
announcements, in the box, in edit mode, with no configuration.

Nothing below is opt-in except rendering the move button.

## Keyboard

Items are focusable in edit mode (`tabIndex=0`), in z-sorted DOM order. With an item focused:

| Keys | Effect |
|---|---|
| <kbd>Arrow</kbd> | nudge 1 px |
| <kbd>Shift</kbd> + <kbd>Arrow</kbd> | nudge 10 px |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Arrow</kbd> | jump to the next snap candidate that way |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | grab ↔ drop |
| <kbd>R</kbd> | resize session: arrows adjust width/height (<kbd>Shift</kbd> for 10 px), <kbd>Enter</kbd>/<kbd>Space</kbd>/<kbd>R</kbd> commits, <kbd>Escape</kbd> cancels |
| <kbd>Escape</kbd> | cancel a grab and return the item to where it was picked up |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | remove the item |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>]</kbd> / <kbd>[</kbd> | bring to front / send to back |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>⇧Z</kbd> | undo / redo |

Two deliberate choices worth knowing:

- **Each arrow press is one commit and one undo step.** The alternative — batching nudges into a
  session that commits after an idle timeout — makes the undo boundary depend on how fast someone
  types, and leaves a transaction open across blur and unmount. Users who want one undo entry for a
  long move have <kbd>Enter</kbd>.
- **A grab session is one transaction.** <kbd>Enter</kbd> picks the item up, arrows move a ghost,
  <kbd>Enter</kbd> drops it and commits once. Because nothing was written during the session,
  <kbd>Escape</kbd> can truly revert. If focus leaves the dashboard mid-grab, the grab is cancelled
  rather than left as a ghost nobody can see. A resize session (<kbd>R</kbd>) works the same way:
  <kbd>ArrowRight</kbd>/<kbd>ArrowDown</kbd> grow, <kbd>ArrowLeft</kbd>/<kbd>ArrowUp</kbd> shrink,
  `minW`/`maxW`/`minH`/`maxH` clamp live, and the commit is announced with the new size — so every
  pointer resize has a keyboard path too (SC 2.1.1).

Under `direction: 'rtl'`, arrow keys are screen directions: the left arrow moves the item left.

**Typing inside a widget never edits the layout.** Keystrokes that originate in a form control,
contenteditable region, link, or button inside an item are left to the browser — Backspace in a
notes `<textarea>` deletes a character, not the widget. Add `data-vzb-keys` to an element to opt
its subtree back into the layout shortcuts. The one exception is a live grab, which owns the
keyboard until it ends so <kbd>Escape</kbd>/<kbd>Enter</kbd> always finish it.

**Collision `forbid` applies to every path.** A nudge into a forbidden overlap is a no-op with a
polite announcement; dropping a grab onto one keeps the item grabbed (announced assertively);
placing onto one is rejected and the placing session stays armed for another attempt.

Do **not** add your own Cmd/Ctrl+Z handler on the container — the core keyboard sensor owns it, and
a second React handler would undo twice per keystroke.

## Tap-to-place — the SC 2.5.7 path

`ui.moveButtonProps` is a fully-formed button spec: `type`, `aria-label` from your strings,
`aria-pressed` reflecting the placing state, and a click handler that arms and disarms the session.
Render it inside the item and you are done.

```tsx
<Vizbrix defaultLayout={layout} mode="edit">
  {(item, ui) => (
    <article className="card">
      <header {...ui.handleProps}>{item.id}</header>
      <button className="card__move" {...ui.moveButtonProps}>Move</button>
    </article>
  )}
</Vizbrix>
```

The interaction is two independent taps with nothing in between — no dragging, holding or timing:

1. Tap the move button. The item stays exactly where it is; the session is announced assertively
   ("Placing Revenue. Click or tap a location to place it, press Enter or Space to move it with
   the arrow keys instead, or press Escape to cancel.").
2. Tap anywhere in the dashboard. The tapped point becomes the item's **top-left corner** (not its
   centre — every other coordinate in the system is a top-left origin, and a tap-to-place user is
   aiming at a spot, not carrying something under the cursor). The landing rect is clamped into the
   container, so a placement can never put an item out of reach.

Tapping the move button again cancels. So does <kbd>Escape</kbd> — from anywhere inside the
dashboard, including a focused widget — and so does the dashboard going read-only between the two
taps. Pressing <kbd>Enter</kbd> or <kbd>Space</kbd> during a placing session hands the item over
to a keyboard grab instead, for users who started with a tap but want arrow-key precision.

The same session is available programmatically:

```tsx
const { beginPlace, completePlace, cancelPlace } = useVizbrix();
completePlace({ x: 240, y: 300 });   // container coordinates
```

Locked items get an inert, `disabled` move button — the affordance never lies about what is
possible.

## ARIA and live regions

In edit mode each item root carries:

- `role="button"` and `tabIndex={0}`
- `aria-roledescription` from `strings.itemRole()` — "draggable widget"
- `aria-describedby` pointing at one off-screen instructions node per dashboard, containing
  `strings.instructions()`
- `aria-pressed` when selected

The dashboard mounts exactly two live regions, both `role="status"`:

| region | politeness | announces |
|---|---|---|
| transitions | `assertive` | grabbed, dropped, canceled, removed, placing started, placed |
| position status | `polite` | moved, resized, reordered |

Announcements use position phrasing — *"Revenue grabbed. Position 2 of 5. 240, 300."* — because
"which one of how many" is the thing a screen-reader user cannot see. Coordinates are rounded to
whole pixels; nobody needs sub-pixel precision read aloud.

Mirror the same messages into your own UI (a toast, a status bar) with `onAnnounce`:

```tsx
<Vizbrix mode="edit" defaultLayout={layout} onAnnounce={(message, tone) => toast(message, tone)}>
  {render}
</Vizbrix>
```

Give items a human name — announcements and undo labels fall back to the id otherwise:

```tsx
<Vizbrix mode="edit" defaultLayout={layout} getLabel={(item) => titles[item.id] ?? item.id}>
  {render}
</Vizbrix>
```

## Touch

At rest an item has `touch-action: pan-y`, so a single-finger scroll over the dashboard scrolls the
page. A drag activates on a **450 ms long press** with an 8 px slop cancel; once activated, a
document-level non-passive `touchmove` listener prevents the in-flight scroll.

```tsx
<Vizbrix mode="edit" longPress={300}>{render}</Vizbrix>   // shorter press
<Vizbrix mode="edit" longPress="off">{render}</Vizbrix>   // 3px activation, for toolbar-gated edit
```

`longPress="off"` is for apps where editing is already behind an explicit mode switch, so an
accidental drag is not a risk.

## Internationalization

Strings are a bundle of **functions**, not templates, so a translator can reorder clauses, drop one
a language doesn't need, or restructure the sentence entirely.

```tsx
import { ja } from 'vizbrix/locales/ja';

<Vizbrix defaultLayout={layout} mode="edit" strings={ja}>{render}</Vizbrix>
```

English is built in (`en` / `defaultStrings` from `vizbrix`). Japanese ships as
`vizbrix/locales/ja`, and it is a real translation rather than a mirror: it leads with the item
label in 「」 quotes and uses です/ます調 for the instructional copy, which no
token-substitution template could express.

Write your own by implementing `VizbrixStrings` — 14 methods, all returning strings:

```ts
import type { VizbrixStrings, ItemStringContext } from 'vizbrix';

const fr: VizbrixStrings = {
  itemRole: () => 'widget déplaçable',
  instructions: () => 'Appuyez sur Entrée ou Espace pour saisir ce widget…',
  grabbed: (c: ItemStringContext) => `${c.label} saisi. Position ${c.position} sur ${c.count}.`,
  // …moved, dropped, canceled, resized, removed, placingStarted, placed, reordered,
  //   undoLabel, redoLabel, moveButtonLabel
};
```

If your localization pipeline can only round-trip flat JSON, `fromMessages` adapts a
`{ key: template }` bundle onto the same interface:

```ts
import { fromMessages } from 'vizbrix';

const strings = fromMessages({
  itemRole: 'widget déplaçable',
  moved: '{label} déplacé. {x}, {y}.',
  moveButtonLabel: 'Déplacer {label}',
  // any key you omit falls back to the English function, per key
});
```

Placeholders: `{label} {x} {y} {w} {h} {position} {count} {direction}` for item messages, and
`{kind} {ids} {size}` for `undoLabel`/`redoLabel`. This is honestly a degraded shape — a fixed
sentence with holes in it — so prefer implementing `VizbrixStrings` directly when you can.

## What this does and does not claim

- **Does**: a non-drag, single-pointer alternative for every drag operation (SC 2.5.7); keyboard
  operability for moving, placing, removing and re-stacking items (SC 2.1.1); programmatic role,
  name and state on every item; status messages via live regions (SC 4.1.3).
- **Does not**: audit your widget *contents*, choose accessible colours (there is no theming system
  — see [non-goals](../README.md#non-goals)), or guarantee conformance of the page around the
  dashboard. Focus-visible styling is yours: vizbrix sets no outline of its own.
