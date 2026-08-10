/**
 * Built-in Japanese strings (`vizbrix/locales/ja`).
 *
 * Instructional/status copy (`instructions()`) uses です/ます調, matching how
 * Japanese assistive-tech documentation and screen-reader help text is
 * normally written. Live-region announcements are kept 簡潔 (terse) — long
 * announcements are read in full by screen readers on every gesture frame's
 * commit, so verbosity there is a real UX cost, not just a style choice.
 * Every function mirrors its English counterpart 1:1 (§1.24: functions, not
 * templates — this file demonstrates a translator reordering clauses freely,
 * e.g. leading with the item label + quotation marks rather than a trailing
 * clause, which the `fromMessages` template adapter could not do).
 */

import type { ItemStringContext, Transaction, VizbrixStrings } from '../schema/types';

const round = (n: number): number => Math.round(n);

/** 履歴ラベルの動詞。`Transaction['label']['kind']` に対応。 */
const KIND_VERB: Record<Transaction['label']['kind'], string> = {
  move: '移動',
  resize: 'サイズ変更',
  add: '追加',
  remove: '削除',
  reorder: '重ね順変更',
  edit: '編集',
};

/** 「元に戻す: 移動 revenue」「やり直す: サイズ変更 a, b (md)」 */
function historyLabel(verbPrefix: '元に戻す' | 'やり直す', tx: Transaction): string {
  const verb = KIND_VERB[tx.label.kind];
  const ids = tx.label.ids.join(', ');
  const sizeSuffix = tx.label.size !== undefined ? ` (${tx.label.size})` : '';
  return `${verbPrefix}: ${verb} ${ids}${sizeSuffix}`;
}

export const ja: VizbrixStrings = {
  itemRole(): string {
    return 'ドラッグ可能なウィジェット';
  },

  instructions(): string {
    return (
      'EnterキーまたはSpaceキーでこのウィジェットを掴みます。矢印キーで移動できます。' +
      'Shiftキーを押しながらだと10ピクセル単位の大きな移動になります。' +
      'もう一度EnterキーまたはSpaceキーを押すとその位置に配置します。' +
      'Escapeキーを押すとキャンセルして元の位置に戻ります。' +
      'CommandキーまたはCtrlキーを押しながら角かっこキー（[ または ]）を押すと、' +
      '重ね順を背面または前面に変更します。' +
      'DeleteキーまたはBackspaceキーで選択中のウィジェットを削除します。'
    );
  },

  grabbed(ctx: ItemStringContext): string {
    return `「${ctx.label}」を掴みました。位置 ${ctx.position}/${ctx.count}。座標 ${round(ctx.x)}, ${round(ctx.y)}。`;
  },

  moved(ctx: ItemStringContext): string {
    return `「${ctx.label}」を移動しました。座標 ${round(ctx.x)}, ${round(ctx.y)}。`;
  },

  dropped(ctx: ItemStringContext): string {
    return `「${ctx.label}」を配置しました。位置 ${ctx.position}/${ctx.count}。座標 ${round(ctx.x)}, ${round(ctx.y)}。`;
  },

  canceled(ctx: ItemStringContext): string {
    return `「${ctx.label}」の移動をキャンセルしました。座標 ${round(ctx.x)}, ${round(ctx.y)}に戻りました。`;
  },

  resized(ctx: ItemStringContext): string {
    return `「${ctx.label}」のサイズを変更しました。${round(ctx.w)} × ${round(ctx.h)} ピクセル。`;
  },

  removed(ctx: ItemStringContext): string {
    return `「${ctx.label}」を削除しました。残り ${ctx.count} 個。`;
  },

  placingStarted(ctx: ItemStringContext): string {
    return `「${ctx.label}」を配置します。配置場所をクリックまたはタップしてください。EnterキーまたはSpaceキーで矢印キー移動に切り替え、Escapeキーでキャンセルします。`;
  },

  placed(ctx: ItemStringContext): string {
    return `「${ctx.label}」を配置しました。座標 ${round(ctx.x)}, ${round(ctx.y)}。`;
  },

  reordered(ctx: ItemStringContext & { direction: 'front' | 'back' }): string {
    const where = ctx.direction === 'front' ? '最前面' : '最背面';
    return `「${ctx.label}」を${where}に移動しました。位置 ${ctx.position}/${ctx.count}。`;
  },

  undoLabel(tx: Transaction): string {
    return historyLabel('元に戻す', tx);
  },

  redoLabel(tx: Transaction): string {
    return historyLabel('やり直す', tx);
  },

  moveButtonLabel(ctx: ItemStringContext): string {
    return `「${ctx.label}」を移動`;
  },
};
