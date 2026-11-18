import { dateFormatter } from './format';

export interface Ticks {
  values: number[];
  min: number;
  max: number;
  step: number;
}

/** Round, human-friendly tick positions covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { values: [0, 1], min: 0, max: 1, step: 1 };
  if (min === max) {
    if (min === 0) max = 1;
    else if (min > 0) min = 0;
    else max = 0;
  }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const values: number[] = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) values.push(Number((lo + i * step).toPrecision(12)));
  return { values, min: lo, max: hi, step };
}

export type Scale = (value: number) => number;

export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const FIXED_STEPS: [number, Intl.DateTimeFormatOptions][] = [
  [SECOND, { hour: 'numeric', minute: '2-digit', second: '2-digit' }],
  [5 * SECOND, { hour: 'numeric', minute: '2-digit', second: '2-digit' }],
  [15 * SECOND, { hour: 'numeric', minute: '2-digit', second: '2-digit' }],
  [30 * SECOND, { hour: 'numeric', minute: '2-digit', second: '2-digit' }],
  [MINUTE, { hour: 'numeric', minute: '2-digit' }],
  [5 * MINUTE, { hour: 'numeric', minute: '2-digit' }],
  [15 * MINUTE, { hour: 'numeric', minute: '2-digit' }],
  [30 * MINUTE, { hour: 'numeric', minute: '2-digit' }],
  [HOUR, { hour: 'numeric', minute: '2-digit' }],
  [3 * HOUR, { hour: 'numeric', minute: '2-digit' }],
  [6 * HOUR, { hour: 'numeric', minute: '2-digit' }],
  [12 * HOUR, { month: 'short', day: 'numeric', hour: 'numeric' }],
  [DAY, { month: 'short', day: 'numeric' }],
  [2 * DAY, { month: 'short', day: 'numeric' }],
  [7 * DAY, { month: 'short', day: 'numeric' }],
  [14 * DAY, { month: 'short', day: 'numeric' }],
];

const MONTH_STEPS = [1, 3, 6];
const YEAR_STEPS = [1, 2, 5, 10, 20, 50, 100];

export interface TimeTicks {
  values: number[];
  format: (date: Date) => string;
}

/** Calendar-aware ticks: whole minutes, days, month starts or year starts depending on the span. */
export function timeTicks(min: number, max: number, count: number, lang?: string): TimeTicks {
  const span = Math.max(1, max - min);
  const target = span / Math.max(1, count);

  for (const [step, options] of FIXED_STEPS) {
    if (step < target) continue;
    const values: number[] = [];
    // Align day-or-longer steps to local midnight rather than to the epoch.
    const offset = step >= DAY ? new Date(min).getTimezoneOffset() * MINUTE : 0;
    for (let t = Math.ceil((min - offset) / step) * step + offset; t <= max; t += step) values.push(t);
    if (values.length >= 2) return { values, format: dateFormatter(lang, options) };
  }

  const start = new Date(min);
  for (const months of MONTH_STEPS) {
    if (months * 30 * DAY < target) continue;
    const values: number[] = [];
    const cursor = new Date(start.getFullYear(), Math.ceil(start.getMonth() / months) * months, 1);
    if (cursor.getTime() < min) cursor.setMonth(cursor.getMonth() + months);
    while (cursor.getTime() <= max) {
      values.push(cursor.getTime());
      cursor.setMonth(cursor.getMonth() + months);
    }
    if (values.length >= 2) {
      const sameYear = new Date(min).getFullYear() === new Date(max).getFullYear();
      return {
        values,
        format: dateFormatter(lang, sameYear ? { month: 'short' } : { month: 'short', year: '2-digit' }),
      };
    }
  }

  for (const years of YEAR_STEPS) {
    if (years * 365 * DAY < target) continue;
    const values: number[] = [];
    let year = Math.ceil(start.getFullYear() / years) * years;
    if (new Date(year, 0, 1).getTime() < min) year += years;
    for (; new Date(year, 0, 1).getTime() <= max; year += years) values.push(new Date(year, 0, 1).getTime());
    if (values.length >= 2) return { values, format: dateFormatter(lang, { year: 'numeric' }) };
  }
  return { values: [min, max], format: dateFormatter(lang, { dateStyle: 'medium' }) };
}

/**
 * Largest-Triangle-Three-Buckets downsampling: keeps the visual shape of a
 * series while capping the number of points sent to the SVG path. Returns the
 * indexes to keep.
 */
export function lttb(xs: ArrayLike<number>, ys: ArrayLike<number>, threshold: number): number[] {
  const n = xs.length;
  if (threshold >= n || threshold < 3) return Array.from({ length: n }, (_, i) => i);
  const out = [0];
  const bucket = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const nextStart = Math.floor((i + 1) * bucket) + 1;
    const nextEnd = Math.min(n, Math.floor((i + 2) * bucket) + 1);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += xs[j]!;
      avgY += ys[j]!;
    }
    const len = Math.max(1, nextEnd - nextStart);
    avgX /= len;
    avgY /= len;
    const start = Math.floor(i * bucket) + 1;
    let best = start;
    let bestArea = -1;
    for (let j = start; j < nextStart; j++) {
      const area = Math.abs((xs[a]! - avgX) * (ys[j]! - ys[a]!) - (xs[a]! - xs[j]!) * (avgY - ys[a]!));
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(best);
    a = best;
  }
  out.push(n - 1);
  return out;
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Straight polyline through the points. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  let d = '';
  for (let i = 0; i < points.length; i++) d += `${i ? 'L' : 'M'}${f(points[i]![0])},${f(points[i]![1])}`;
  return d;
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson): a smooth curve that never
 * overshoots the data, so a smoothed line cannot invent a peak or dip below zero.
 */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  if (n < 3) return linePath(points);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]![0] - points[i]![0]);
    slope.push((points[i + 1]![1] - points[i]![1]) / (dx[i] || 1));
  }
  const tangent: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    tangent.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / slope[i]!;
    const b = tangent[i + 1]! / slope[i]!;
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]!) / h;
      tangent[i + 1] = (3 * b * slope[i]!) / h;
    }
  }
  let d = `M${f(points[0]![0])},${f(points[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const third = dx[i]! / 3;
    d += `C${f(x0 + third)},${f(y0 + tangent[i]! * third)} ${f(x1 - third)},${f(y1 - tangent[i + 1]! * third)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
