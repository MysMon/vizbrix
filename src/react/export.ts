import type { DashboardItem } from '../core/types';
import { resolveData, type DataMap } from './brick';

type Row = Readonly<Record<string, unknown>>;

/** The rows behind a brick: its dataset, or a single row for object-shaped data (stat, meter). */
export function brickRows(item: DashboardItem, data: DataMap): Row[] {
  const resolved = resolveData<unknown>(item.props?.data, data);
  if (Array.isArray(resolved)) return resolved.filter((r): r is Row => typeof r === 'object' && r !== null);
  if (resolved && typeof resolved === 'object') {
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resolved)) {
      if (value === null || typeof value !== 'object' || value instanceof Date) flat[key] = value;
    }
    return [flat];
  }
  return [];
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  // A spreadsheet would run a text cell starting with one of these as a formula.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize rows as CSV (RFC 4180), with a BOM so spreadsheets read UTF-8 correctly. */
export function toCsv(rows: readonly Row[], columns?: readonly string[]): string {
  const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [keys.map(cell).join(',')];
  for (const row of rows) lines.push(keys.map((key) => cell(row[key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'export';
}

function inlineStyles(source: Element, target: Element): void {
  if (source instanceof HTMLElement || source instanceof SVGElement) {
    const computed = getComputedStyle(source);
    let css = '';
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i]!;
      css += `${prop}:${computed.getPropertyValue(prop)};`;
    }
    (target as HTMLElement | SVGElement).setAttribute('style', css);
  }
  const from = source.children;
  const to = target.children;
  for (let i = 0; i < from.length && i < to.length; i++) inlineStyles(from[i]!, to[i]!);
}

/**
 * Render an element to a PNG without any library: clone it with its computed
 * styles inlined, wrap the clone in an SVG `foreignObject`, and draw that to
 * a canvas. Works for the HTML and SVG that bricks are made of; `<canvas>`,
 * cross-origin images and iframes inside a brick are not captured.
 */
export async function elementToPng(element: HTMLElement, scale = 2): Promise<Blob> {
  const box = element.getBoundingClientRect();
  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);
  const clone = element.cloneNode(true) as HTMLElement;
  inlineStyles(element, clone);
  clone.style.margin = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const markup = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;

  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('vizbrix: could not render the brick to an image'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('vizbrix: canvas is unavailable');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('vizbrix: image export failed'))), 'image/png');
  });
}
