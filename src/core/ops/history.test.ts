import { describe, expect, it } from 'vitest';
import type { Op, Transaction } from '../schema/types';
import { DEFAULT_HISTORY_DEPTH, createHistory } from './history';

function tx(name: string): Transaction {
  const op: Op = {
    type: 'setZ',
    id: name,
    before: 'a0',
    after: 'a1',
  };
  return { label: { kind: 'reorder', ids: [name] }, ops: [op], source: 'api' };
}

describe('createHistory', () => {
  it('starts empty', () => {
    const h = createHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.peekUndo()).toBeUndefined();
    expect(h.peekRedo()).toBeUndefined();
    expect(h.popUndo()).toBeUndefined();
    expect(h.popRedo()).toBeUndefined();
  });

  it('pops in last-in-first-out order', () => {
    const h = createHistory();
    h.push(tx('one'));
    h.push(tx('two'));
    expect(h.peekUndo()?.label.ids).toStrictEqual(['two']);
    expect(h.popUndo()?.label.ids).toStrictEqual(['two']);
    expect(h.popUndo()?.label.ids).toStrictEqual(['one']);
    expect(h.canUndo()).toBe(false);
  });

  it('clears the redo stack when a new transaction is pushed', () => {
    const h = createHistory();
    h.push(tx('one'));
    const undone = h.popUndo()!;
    h.pushRedo(undone);
    expect(h.canRedo()).toBe(true);

    // A new edit forks the timeline: the abandoned redo branch is gone.
    h.push(tx('two'));
    expect(h.canRedo()).toBe(false);
    expect(h.peekRedo()).toBeUndefined();
  });

  it('keeps the redo stack while entries are only moved between stacks', () => {
    const h = createHistory();
    h.push(tx('one'));
    h.pushRedo(h.popUndo()!);
    // Replaying an existing entry is not a new edit.
    h.push(tx('two'));
    expect(h.canRedo()).toBe(false);
  });

  it('evicts the OLDEST entry once the depth is reached', () => {
    const h = createHistory(3);
    for (const name of ['a', 'b', 'c', 'd', 'e']) h.push(tx(name));
    expect(h.popUndo()?.label.ids).toStrictEqual(['e']);
    expect(h.popUndo()?.label.ids).toStrictEqual(['d']);
    expect(h.popUndo()?.label.ids).toStrictEqual(['c']);
    // 'a' and 'b' fell off the bottom — the newest is always undoable.
    expect(h.canUndo()).toBe(false);
  });

  it('defaults to a depth of 100', () => {
    expect(DEFAULT_HISTORY_DEPTH).toBe(100);
    const h = createHistory();
    for (let i = 0; i < 150; i++) h.push(tx(`t${i}`));
    let count = 0;
    while (h.popUndo()) count++;
    expect(count).toBe(100);
  });

  it('treats depth 0 as "record nothing" without breaking the interface', () => {
    const h = createHistory(0);
    h.push(tx('one'));
    expect(h.canUndo()).toBe(false);
    expect(h.popUndo()).toBeUndefined();
  });

  it('ignores a transaction that carries no ops', () => {
    const h = createHistory();
    h.push({ label: { kind: 'edit', ids: [] }, ops: [], source: 'api' });
    expect(h.canUndo()).toBe(false);
  });

  it('clear() drops both stacks', () => {
    const h = createHistory();
    h.push(tx('one'));
    h.pushRedo(tx('two'));
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('bounds the redo stack by the same depth', () => {
    const h = createHistory(2);
    for (const name of ['a', 'b', 'c']) h.pushRedo(tx(name));
    expect(h.popRedo()?.label.ids).toStrictEqual(['c']);
    expect(h.popRedo()?.label.ids).toStrictEqual(['b']);
    expect(h.canRedo()).toBe(false);
  });

  it('survives a non-numeric depth', () => {
    const h = createHistory(Number.NaN);
    h.push(tx('one'));
    expect(h.canUndo()).toBe(true);
  });
});
