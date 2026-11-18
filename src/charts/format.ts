/**
 * Number formatting shared by every chart and figure. Formats are plain,
 * serializable values so they can live inside a stored dashboard document.
 */
export type Format =
  | 'auto'
  | 'number'
  | 'integer'
  | 'compact'
  | 'percent'
  | `currency:${string}`
  | Intl.NumberFormatOptions
  | ((value: number) => string);

const cache = new Map<string, Intl.NumberFormat>();

function intl(lang: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang ?? ''}|${JSON.stringify(options)}`;
  let hit = cache.get(key);
  if (!hit) {
    try {
      hit = new Intl.NumberFormat(lang, options);
    } catch {
      hit = new Intl.NumberFormat(lang);
    }
    cache.set(key, hit);
  }
  return hit;
}

function optionsFor(format: Exclude<Format, (value: number) => string>, compact: boolean): Intl.NumberFormatOptions {
  if (typeof format === 'object') return format;
  if (format === 'integer') return { maximumFractionDigits: 0 };
  if (format === 'compact') return { notation: 'compact', maximumFractionDigits: 1 };
  if (format === 'percent') return { style: 'percent', maximumFractionDigits: 1 };
  if (format.startsWith('currency:')) {
    return {
      style: 'currency',
      currency: format.slice(9),
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
    };
  }
  if (compact) return { notation: 'compact', maximumFractionDigits: 1 };
  return { maximumFractionDigits: 2 };
}

/**
 * Build a formatter. `magnitude` is the largest value the formatter will see
 * (an axis maximum, a stat value): `auto` and currency formats switch to
 * compact notation once it reaches 10,000, so one axis never mixes styles.
 */
export function formatter(format: Format = 'auto', lang?: string, magnitude = 0): (value: number) => string {
  if (typeof format === 'function') return format;
  const compact =
    (format === 'auto' || (typeof format === 'string' && format.startsWith('currency:'))) && Math.abs(magnitude) >= 10000;
  const nf = intl(lang, optionsFor(format === 'auto' ? 'number' : format, compact));
  return (value) => (Number.isFinite(value) ? nf.format(value) : '–');
}

export function formatValue(value: unknown, format: Format = 'auto', lang?: string): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'number') return formatter(format, lang, value)(value);
  if (value instanceof Date) return dateFormatter(lang, { dateStyle: 'medium' })(value);
  return String(value);
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

export function dateFormatter(lang: string | undefined, options: Intl.DateTimeFormatOptions): (date: Date) => string {
  const key = `${lang ?? ''}|${JSON.stringify(options)}`;
  let hit = dateCache.get(key);
  if (!hit) {
    hit = new Intl.DateTimeFormat(lang, options);
    dateCache.set(key, hit);
  }
  return (date) => hit.format(date);
}

/** Rough rendered width of a label, good enough to reserve axis space without measuring the DOM. */
export function textWidth(text: string, fontSize = 11): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0x2e80) em += 1;
    else if (/[A-ZMWmw@%]/.test(ch)) em += 0.7;
    else if (/[ilj.,:;'|! ]/.test(ch)) em += 0.3;
    else em += 0.56;
  }
  return em * fontSize;
}

export function truncate(text: string, maxWidth: number, fontSize = 11): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, fontSize) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
