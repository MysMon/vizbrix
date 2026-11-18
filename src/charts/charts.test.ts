import { describe, expect, it } from 'vitest';
import { formatter, formatValue, textWidth, truncate } from './format';
import { linePath, lttb, niceTicks, smoothPath, timeTicks } from './scale';

describe('niceTicks', () => {
  it('produces round steps that cover the domain', () => {
    expect(niceTicks(0, 97, 5).values).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(2480, 6240, 5).values).toEqual([2000, 3000, 4000, 5000, 6000, 7000]);
    expect(niceTicks(-3, 7, 5).values).toEqual([-4, -2, 0, 2, 4, 6, 8]);
    expect(niceTicks(0, 0.018, 4).values).toEqual([0, 0.005, 0.01, 0.015, 0.02]);
  });

  it('survives degenerate domains', () => {
    expect(niceTicks(5, 5).values[0]).toBe(0);
    expect(niceTicks(0, 0).max).toBeGreaterThan(0);
    expect(niceTicks(NaN, 1).values).toEqual([0, 1]);
  });
});

describe('timeTicks', () => {
  it('lands on month starts for a year-long span', () => {
    const lo = new Date(2026, 0, 12).getTime();
    const hi = new Date(2026, 11, 20).getTime();
    const ticks = timeTicks(lo, hi, 6, 'en');
    expect(ticks.values.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks.values) {
      const d = new Date(t);
      expect(d.getDate()).toBe(1);
      expect(t).toBeGreaterThanOrEqual(lo);
      expect(t).toBeLessThanOrEqual(hi);
    }
  });

  it('lands on local midnights for a multi-week span and on year starts for decades', () => {
    const days = timeTicks(new Date(2026, 7, 1).getTime(), new Date(2026, 9, 29).getTime(), 5, 'en');
    for (const t of days.values) expect(new Date(t).getHours()).toBe(0);
    const years = timeTicks(new Date(1990, 5, 1).getTime(), new Date(2026, 5, 1).getTime(), 6, 'en');
    for (const t of years.values) expect([new Date(t).getMonth(), new Date(t).getDate()]).toEqual([0, 1]);
  });
});

describe('lttb', () => {
  it('keeps endpoints, respects the budget and preserves a spike', () => {
    const n = 10000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = xs.map((i) => (i === 4321 ? 1000 : Math.sin(i / 50)));
    const kept = lttb(xs, ys, 200);
    expect(kept).toHaveLength(200);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(n - 1);
    expect(kept).toContain(4321);
    expect([...kept].sort((a, b) => a - b)).toEqual(kept);
  });

  it('is the identity under the threshold', () => {
    expect(lttb([0, 1, 2], [5, 6, 7], 10)).toEqual([0, 1, 2]);
  });
});

describe('paths', () => {
  it('draws straight and smooth paths through every point', () => {
    const pts = [
      [0, 10],
      [10, 0],
      [20, 10],
    ] as const;
    expect(linePath(pts)).toBe('M0,10L10,0L20,10');
    const smooth = smoothPath(pts);
    expect(smooth.startsWith('M0,10C')).toBe(true);
    expect(smooth.endsWith('20,10')).toBe(true);
  });

  it('never overshoots the data range when smoothing', () => {
    const pts = [
      [0, 100],
      [10, 100],
      [20, 0],
      [30, 0],
    ] as const;
    const ys = [...smoothPath(pts).matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});

describe('format', () => {
  it('formats presets', () => {
    expect(formatter('number', 'en')(1234.567)).toBe('1,234.57');
    expect(formatter('integer', 'en')(1234.567)).toBe('1,235');
    expect(formatter('percent', 'en')(0.1234)).toBe('12.3%');
    expect(formatter('compact', 'en')(12900)).toBe('12.9K');
    expect(formatter('currency:USD', 'en')(42)).toBe('$42.00');
    expect(formatter((v) => `${v}!`)(3)).toBe('3!');
    expect(formatter({ minimumFractionDigits: 1 }, 'en')(2)).toBe('2.0');
  });

  it('switches auto and currency to compact from 10,000 up, by magnitude', () => {
    expect(formatter('auto', 'en', 9000)(9000)).toBe('9,000');
    expect(formatter('auto', 'en', 20000)(10000)).toBe('10K');
    expect(formatter('currency:USD', 'en', 4_200_000)(4_200_000)).toBe('$4.2M');
  });

  it('never prints NaN', () => {
    expect(formatter('auto', 'en')(NaN)).toBe('–');
    expect(formatValue(null)).toBe('–');
    expect(formatValue('abc')).toBe('abc');
    expect(formatValue(1500, 'auto', 'en')).toBe('1,500');
  });

  it('falls back instead of throwing on a bad currency code', () => {
    expect(() => formatter('currency:NOPE!', 'en')(1)).not.toThrow();
  });

  it('estimates and truncates label widths', () => {
    expect(textWidth('日本語')).toBeGreaterThan(textWidth('abc'));
    const cut = truncate('A very long category label', 60);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut)).toBeLessThanOrEqual(60);
    expect(truncate('short', 200)).toBe('short');
  });
});
