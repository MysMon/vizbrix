import {
  BASE,
  CURRENT_VERSION,
  DEFAULTS,
  PINS,
  type Breakpoint,
  type DashboardDoc,
  type DashboardInput,
  type DashboardItem,
  type Pin,
  type Rect,
} from './types';

export interface Issue {
  /** Where in the input the problem was found, e.g. `items[2].w`. */
  path: string;
  message: string;
  /** `error` means data was dropped or replaced; `warning` means it was adjusted. */
  severity: 'error' | 'warning';
}

export interface ParseResult {
  /** Always a valid, renderable document — even when the input was garbage. */
  doc: DashboardDoc;
  /** True when the input was used without dropping anything. */
  ok: boolean;
  issues: Issue[];
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade *from*. Adding schema version 2
 * means adding `1: (raw) => ...` here; documents saved today keep loading.
 */
const MIGRATIONS: Record<number, Migration> = {};

let idCounter = 0;

export function createId(prefix = 'b'): string {
  idCounter = (idCounter + 1) % 1296;
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const round = (n: number): number => Math.round(n * 100) / 100;

/** An empty document with default settings. */
export function emptyDashboard(): DashboardDoc {
  return {
    version: CURRENT_VERSION,
    width: DEFAULTS.width,
    gap: DEFAULTS.gap,
    padding: DEFAULTS.padding,
    breakpoints: DEFAULTS.breakpoints,
    items: [],
    layouts: {},
  };
}

function readNumber(
  raw: unknown,
  fallback: number,
  min: number,
  path: string,
  issues: Issue[],
  present = raw !== undefined,
): number {
  if (!present) return fallback;
  if (!finite(raw)) {
    issues.push({ path, message: `expected a finite number, got ${describe(raw)}`, severity: 'error' });
    return fallback;
  }
  if (raw < min) {
    issues.push({ path, message: `${raw} is below the minimum ${min}`, severity: 'warning' });
    return min;
  }
  return round(raw);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'number') return String(v);
  return typeof v;
}

function readRect(raw: unknown, path: string, issues: Issue[]): Rect | null {
  if (!isObject(raw)) return null;
  const { x, y, w, h } = raw;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) {
    issues.push({ path, message: 'expected { x, y, w, h } with positive size', severity: 'error' });
    return null;
  }
  return { x: round(Math.max(0, x)), y: round(Math.max(0, y)), w: round(w), h: round(h) };
}

function readBreakpoints(raw: unknown, width: number, issues: Issue[]): readonly Breakpoint[] {
  if (raw === undefined) return DEFAULTS.breakpoints.filter((b) => b.maxWidth < width);
  if (!Array.isArray(raw)) {
    issues.push({ path: 'breakpoints', message: 'expected an array', severity: 'error' });
    return DEFAULTS.breakpoints.filter((b) => b.maxWidth < width);
  }
  const out: Breakpoint[] = [];
  const names = new Set<string>([BASE]);
  raw.forEach((entry, i) => {
    const path = `breakpoints[${i}]`;
    if (!isObject(entry) || typeof entry.name !== 'string' || !entry.name || !finite(entry.maxWidth)) {
      issues.push({ path, message: 'expected { name, maxWidth, columns }', severity: 'error' });
      return;
    }
    if (names.has(entry.name)) {
      issues.push({ path, message: `duplicate breakpoint name "${entry.name}"`, severity: 'error' });
      return;
    }
    if (entry.maxWidth <= 0) {
      issues.push({ path, message: 'maxWidth must be positive', severity: 'error' });
      return;
    }
    names.add(entry.name);
    const columns = finite(entry.columns) ? Math.max(1, Math.min(12, Math.round(entry.columns))) : 1;
    out.push({ name: entry.name, maxWidth: round(entry.maxWidth), columns });
  });
  return out.sort((a, b) => b.maxWidth - a.maxWidth);
}

function readItem(
  raw: unknown,
  index: number,
  width: number,
  seen: Set<string>,
  issues: Issue[],
): DashboardItem | null {
  const path = `items[${index}]`;
  if (!isObject(raw)) {
    issues.push({ path, message: `expected an object, got ${describe(raw)}`, severity: 'error' });
    return null;
  }
  // Unknown keys are carried through untouched so a document written by a
  // newer minor version survives a round trip through an older reader.
  const item: Record<string, unknown> = { ...raw };

  let id = typeof raw.id === 'string' && raw.id ? raw.id : '';
  if (!id) {
    id = createId();
    if (raw.id !== undefined) issues.push({ path: `${path}.id`, message: 'invalid id replaced', severity: 'error' });
  } else if (seen.has(id)) {
    issues.push({ path: `${path}.id`, message: `duplicate id "${id}" replaced`, severity: 'error' });
    id = createId();
  }
  seen.add(id);
  item.id = id;

  if (typeof raw.type !== 'string' || !raw.type) {
    issues.push({ path: `${path}.type`, message: 'missing brick type', severity: 'error' });
    item.type = 'unknown';
  }

  const minW = readNumber(raw.minW, DEFAULTS.minW, 1, `${path}.minW`, issues);
  const minH = readNumber(raw.minH, DEFAULTS.minH, 1, `${path}.minH`, issues);
  let w = readNumber(raw.w, DEFAULTS.itemW, 1, `${path}.w`, issues);
  const h = Math.max(minH, readNumber(raw.h, DEFAULTS.itemH, 1, `${path}.h`, issues));
  w = Math.min(width, Math.max(Math.min(minW, width), w));
  let x = readNumber(raw.x, 0, 0, `${path}.x`, issues);
  const y = readNumber(raw.y, 0, 0, `${path}.y`, issues);
  if (x + w > width) {
    if (raw.x !== undefined) {
      issues.push({ path: `${path}.x`, message: 'brick moved back inside the canvas', severity: 'warning' });
    }
    x = round(width - w);
  }
  item.x = x;
  item.y = y;
  item.w = w;
  item.h = h;
  if (raw.minW === undefined) delete item.minW;
  else item.minW = minW;
  if (raw.minH === undefined) delete item.minH;
  else item.minH = minH;

  if (raw.pin !== undefined && !PINS.includes(raw.pin as Pin)) {
    issues.push({ path: `${path}.pin`, message: `unknown pin "${String(raw.pin)}"`, severity: 'error' });
    delete item.pin;
  }
  if (raw.pin === 'scale') delete item.pin;
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    issues.push({ path: `${path}.title`, message: 'expected a string', severity: 'error' });
    delete item.title;
  }
  if (raw.props !== undefined && !isObject(raw.props)) {
    issues.push({ path: `${path}.props`, message: 'expected an object', severity: 'error' });
    delete item.props;
  }
  if (raw.locked !== undefined && typeof raw.locked !== 'boolean') delete item.locked;
  if (raw.locked === false) delete item.locked;

  return item as unknown as DashboardItem;
}

function normalize(raw: Record<string, unknown>, issues: Issue[]): DashboardDoc {
  const width = readNumber(raw.width, DEFAULTS.width, 120, 'width', issues);
  const gap = readNumber(raw.gap, DEFAULTS.gap, 0, 'gap', issues);
  const padding = readNumber(raw.padding, DEFAULTS.padding, 0, 'padding', issues);
  const breakpoints = readBreakpoints(raw.breakpoints, width, issues);

  const items: DashboardItem[] = [];
  const seen = new Set<string>();
  if (raw.items !== undefined && !Array.isArray(raw.items)) {
    issues.push({ path: 'items', message: 'expected an array', severity: 'error' });
  } else if (Array.isArray(raw.items)) {
    raw.items.forEach((entry, i) => {
      const item = readItem(entry, i, width, seen, issues);
      if (item) items.push(item);
    });
  }

  const layouts: Record<string, Record<string, Rect>> = {};
  if (isObject(raw.layouts)) {
    for (const bp of breakpoints) {
      const source = raw.layouts[bp.name];
      if (!isObject(source)) continue;
      const rects: Record<string, Rect> = {};
      for (const id of Object.keys(source)) {
        if (!seen.has(id)) continue; // a layout entry for a removed brick
        const rect = readRect(source[id], `layouts.${bp.name}.${id}`, issues);
        if (!rect) continue;
        rect.w = Math.min(rect.w, bp.maxWidth);
        rect.x = Math.min(rect.x, bp.maxWidth - rect.w);
        rects[id] = rect;
      }
      layouts[bp.name] = rects;
    }
  } else if (raw.layouts !== undefined) {
    issues.push({ path: 'layouts', message: 'expected an object', severity: 'error' });
  }

  return { version: CURRENT_VERSION, width, gap, padding, breakpoints, items, layouts };
}

/**
 * Build a document from a loose authoring shape. Missing geometry falls back
 * to defaults and bricks without a position are placed left-to-right, wrapping
 * into rows — so `items: [{ type: 'stat' }, { type: 'line' }]` is a valid start.
 */
export function createDashboard<P = Record<string, unknown>>(input: DashboardInput<P> = {}): DashboardDoc<P> {
  const width = finite(input.width) ? input.width : DEFAULTS.width;
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  let placedBottom = 0;
  for (const item of input.items ?? []) {
    if (finite(item.y) && finite(item.h)) placedBottom = Math.max(placedBottom, item.y + item.h);
  }
  cursorY = placedBottom;
  const items = (input.items ?? []).map((item) => {
    if (finite(item.x) && finite(item.y)) return item;
    const w = Math.min(width, finite(item.w) ? item.w : DEFAULTS.itemW);
    const h = finite(item.h) ? item.h : DEFAULTS.itemH;
    if (cursorX + w > width + 0.01) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    const placed = { ...item, x: cursorX, y: cursorY, w, h };
    cursorX += w;
    rowH = Math.max(rowH, h);
    return placed;
  });
  const issues: Issue[] = [];
  const doc = normalize({ ...input, items } as Record<string, unknown>, issues);
  if (issues.length && typeof console !== 'undefined' && isDev()) {
    console.warn(
      `[vizbrix] createDashboard adjusted the input:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
    );
  }
  return doc as unknown as DashboardDoc<P>;
}

function isDev(): boolean {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * Load a stored dashboard. Never throws: the result always carries a
 * renderable document plus the list of everything that had to be repaired,
 * so a corrupt row in a database degrades to a report instead of a crash.
 */
export function parseDashboard(input: unknown): ParseResult {
  const issues: Issue[] = [];
  let raw: unknown = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      issues.push({ path: '', message: `invalid JSON: ${(err as Error).message}`, severity: 'error' });
      return { doc: emptyDashboard(), ok: false, issues };
    }
  }
  if (!isObject(raw)) {
    issues.push({ path: '', message: `expected an object, got ${describe(raw)}`, severity: 'error' });
    return { doc: emptyDashboard(), ok: false, issues };
  }

  let version = finite(raw.version) ? raw.version : 1;
  if (raw.version !== undefined && !finite(raw.version)) {
    issues.push({ path: 'version', message: 'invalid version, assuming 1', severity: 'warning' });
    version = 1;
  }
  let current: Record<string, unknown> = raw;
  if (version > CURRENT_VERSION) {
    issues.push({
      path: 'version',
      message: `document version ${version} is newer than this reader (${CURRENT_VERSION}); loaded best-effort`,
      severity: 'warning',
    });
  }
  try {
    while (version < CURRENT_VERSION) {
      const migrate = MIGRATIONS[version];
      if (!migrate) break;
      current = migrate(current);
      version += 1;
    }
  } catch (err) {
    issues.push({ path: 'version', message: `migration failed: ${(err as Error).message}`, severity: 'error' });
    return { doc: emptyDashboard(), ok: false, issues };
  }

  const doc = normalize(current, issues);
  return { doc, ok: !issues.some((i) => i.severity === 'error'), issues };
}

const ITEM_KEY_ORDER = ['id', 'type', 'title', 'x', 'y', 'w', 'h', 'pin', 'minW', 'minH', 'locked', 'props'];

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = sortKeys(value[key]);
  }
  return out;
}

/**
 * Serialize with a stable key order, so two saves of the same dashboard are
 * byte-identical and a diff between two versions shows only what changed.
 */
export function serializeDashboard(doc: DashboardDoc<unknown>, space?: number): string {
  const items = doc.items.map((item) => {
    const src = item as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of ITEM_KEY_ORDER) {
      if (src[key] !== undefined) out[key] = key === 'props' ? sortKeys(src[key]) : src[key];
    }
    for (const key of Object.keys(src).sort()) {
      if (!(key in out) && src[key] !== undefined) out[key] = sortKeys(src[key]);
    }
    return out;
  });
  const layouts: Record<string, unknown> = {};
  for (const name of Object.keys(doc.layouts).sort()) layouts[name] = sortKeys(doc.layouts[name]);
  return JSON.stringify(
    {
      version: doc.version,
      width: doc.width,
      gap: doc.gap,
      padding: doc.padding,
      breakpoints: doc.breakpoints,
      items,
      layouts,
    },
    null,
    space,
  );
}
