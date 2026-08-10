/**
 * Fractional indexing over a base-62 alphabet.
 *
 * Keys are plain strings that sort correctly under the built-in `<` operator
 * (ASCII-ordinal, matching Postgres `COLLATE "C"`). The alphabet is
 * `0-9A-Za-z` in ASCII order, so digits < uppercase < lowercase.
 *
 * A key is `<integer part><fractional part>`. The integer part is a
 * self-delimiting variable-length signed integer: its first character (the
 * "head") both encodes the integer's sign and how many characters the
 * integer part occupies, so `getIntegerLength`/`integerPart` never need an
 * out-of-band length. This is the classic trick (as used by e.g. Figma's and
 * Rocicorp's fractional-indexing implementations) that makes *sequential*
 * inserts at one end of a list grow the key length only O(log N) instead of
 * O(N): appending past the end of the current key space increments the
 * integer part by one, and only *overflowing* a fixed-width integer widens
 * it to the next tier — so N sequential appends need only ~log_62(N) tier
 * widenings, not N halvings.
 *
 * The fractional part (everything after the integer part) subdivides the gap
 * between two keys that share the same integer part, via plain digit-by-digit
 * midpoint bisection. A fractional part must never end in the lowest digit
 * `'0'`: a trailing `'0'` is redundant padding (`"a1" === "a10"` numerically)
 * that would make it impossible to `keyBetween` an even-shorter key below it
 * without growing an ever-longer common prefix. The integer part's own last
 * digit is exempt from this rule — it is a fixed-width magnitude digit, not
 * padding, so e.g. `"a0"` (the canonical first-ever key) is valid.
 */

/** Base-62 alphabet in ASCII order: digits, then uppercase, then lowercase. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 62
const DIGIT_ZERO = ALPHABET[0]; // '0'
const DIGIT_MAX = ALPHABET[BASE - 1]; // 'z'

/** Char code bounds for the integer-part head ranges. */
const CODE_A_LOWER = 97; // 'a'
const CODE_Z_LOWER = 122; // 'z'
const CODE_A_UPPER = 65; // 'A'
const CODE_Z_UPPER = 90; // 'Z'

function digitValue(ch: string): number {
  const v = ALPHABET.indexOf(ch);
  if (v < 0) {
    throw new RangeError(`fractional: invalid base-62 digit ${JSON.stringify(ch)}`);
  }
  return v;
}

/**
 * Number of characters the integer part occupies, given its head character.
 * `'a'..'z'` encode non-negative tiers, narrowest (`'a'`, 2 chars) to widest
 * (`'z'`, 27 chars). `'A'..'Z'` encode negative tiers, the mirror image:
 * narrowest (closest to zero, `'Z'`, 2 chars) to widest (`'A'`, 27 chars).
 * This ordering is exactly why plain string comparison works end to end:
 * `'A' < ... < 'Z' < 'a' < ... < 'z'` tracks increasing numeric value.
 */
function integerLength(head: string): number {
  const code = head.charCodeAt(0);
  if (code >= CODE_A_LOWER && code <= CODE_Z_LOWER) return code - CODE_A_LOWER + 2;
  if (code >= CODE_A_UPPER && code <= CODE_Z_UPPER) return CODE_Z_UPPER - code + 2;
  throw new RangeError(`fractional: invalid integer-part head ${JSON.stringify(head)}`);
}

/** Throws if `key` is too short to contain a well-formed integer part. */
function integerPart(key: string): string {
  const len = integerLength(key[0] ?? '');
  if (len > key.length) {
    throw new RangeError(`fractional: invalid order key ${JSON.stringify(key)}`);
  }
  return key.slice(0, len);
}

/**
 * Increments a well-formed integer part by the smallest representable step.
 * Returns `null` when `int` is already the maximum representable integer
 * (head `'z'` with every magnitude digit at `'z'`).
 */
function incrementInteger(int: string): string | null {
  const head = int[0];
  const digits = int.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = digitValue(digits[i]) + 1;
    if (d === BASE) {
      digits[i] = DIGIT_ZERO;
    } else {
      digits[i] = ALPHABET[d];
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a' + DIGIT_ZERO; // top of narrowest-negative -> bottom of narrowest-positive
  if (head === 'z') return null; // top of the widest positive tier: nothing bigger
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') {
    digits.push(DIGIT_ZERO); // moving deeper into positive tiers: widen
  } else {
    digits.pop(); // moving toward zero within negative tiers: narrow
  }
  return nextHead + digits.join('');
}

/**
 * Decrements a well-formed integer part by the smallest representable step.
 * Returns `null` when `int` is already the minimum representable integer
 * (head `'A'` with every magnitude digit at `'0'`).
 */
function decrementInteger(int: string): string | null {
  const head = int[0];
  const digits = int.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = digitValue(digits[i]) - 1;
    if (d === -1) {
      digits[i] = DIGIT_MAX;
    } else {
      digits[i] = ALPHABET[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + DIGIT_MAX; // bottom of narrowest-positive -> top of narrowest-negative
  if (head === 'A') return null; // bottom of the widest negative tier: nothing smaller
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < 'Z') {
    digits.push(DIGIT_MAX); // moving deeper into negative tiers: widen
  } else {
    digits.pop(); // moving toward zero within positive tiers: narrow
  }
  return prevHead + digits.join('');
}

/**
 * Digit-by-digit midpoint of two fractional-part strings. `a` may be `''`
 * (open lower bound); `b` may be `null` (open upper bound). Preconditions
 * (upheld by every caller in this file): neither `a` nor `b` ends in `'0'`,
 * and `a < b` when `b` is given.
 */
function midpointFraction(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? DIGIT_ZERO) === b[n]) n++;
    if (n > 0) {
      return b.slice(0, n) + midpointFraction(a.slice(n), b.slice(n));
    }
  }
  const digitA = a.length > 0 ? digitValue(a[0]) : 0;
  const digitB = b !== null ? digitValue(b[0]) : BASE;
  if (digitB - digitA > 1) {
    return ALPHABET[Math.round((digitA + digitB) / 2)];
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return ALPHABET[digitA] + midpointFraction(a.slice(1), null);
}

/**
 * Extends `key` until it is no longer a PROPER PREFIX of the upper bound.
 *
 * Bisection legitimately produces a prefix — `midpointFraction` returns `b`'s
 * leading digit whenever the two candidate digits are consecutive — and the
 * spec forbids it (§1.8, §5: "never a prefix of `b`") for a concrete reason:
 * a prefix leaves no room below `b` for the two jitter digits `keyBetween`
 * appends, so EVERY jittered candidate sorts past the bound and the fallback
 * silently strips the jitter. The collision resistance would disappear exactly
 * on the inserts most likely to collide (two clients splitting the same gap).
 *
 * Appending the midpoint of the bound's remaining digits keeps the key strictly
 * below `b` while guaranteeing a digit position where it is strictly smaller —
 * which is what makes any suffix, jitter included, still sort below `b`. Each
 * pass adds at least one character and the result stays under `b`, so the loop
 * ends within `b.length` passes.
 */
function avoidPrefixOf(key: string, b: string | null): string {
  if (b === null) return key;
  let out = key;
  while (out.length < b.length && b.startsWith(out)) {
    out += midpointFraction('', b.slice(out.length));
  }
  return out;
}

/** The deterministic (unjittered) key strictly between `a` and `b`. */
function generateKeyBetween(a: string | null, b: string | null): string {
  return avoidPrefixOf(generateKeyCandidate(a, b), b);
}

/** Plain bisection, before the prefix-of-upper-bound guarantee is enforced. */
function generateKeyCandidate(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new RangeError(
      `fractional: lower bound ${JSON.stringify(a)} >= upper bound ${JSON.stringify(b)}`,
    );
  }

  if (a === null && b === null) {
    return 'a' + DIGIT_ZERO;
  }

  if (a === null) {
    const ib = integerPart(b as string);
    const fb = (b as string).slice(ib.length);
    const dec = decrementInteger(ib);
    return dec !== null ? dec : ib + midpointFraction('', fb);
  }

  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const inc = incrementInteger(ia);
    return inc !== null ? inc : ia + midpointFraction(fa, null);
  }

  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) {
    return ia + midpointFraction(fa, fb);
  }
  const inc = incrementInteger(ia);
  if (inc !== null && inc < b) {
    return inc;
  }
  return ia + midpointFraction(fa, null);
}

/** Random base-62 digit index in `[0, BASE)`, uniformly distributed. */
function randomDigitIndex(): number {
  return Math.floor(Math.random() * BASE);
}

/** Random base-62 digit index in `[1, BASE)` — excludes `'0'`. */
function randomNonZeroDigitIndex(): number {
  return 1 + Math.floor(Math.random() * (BASE - 1));
}

/**
 * Generates a key that sorts strictly between `a` and `b` (either bound may
 * be `null` for an open end).
 *
 * Two random base-62 digits are appended to the deterministic candidate as
 * jitter (collision resistance for concurrent, uncoordinated generation:
 * e.g. two offline clients both inserting "between the same two items" won't
 * usually produce the identical key). The jitter is generated first, then
 * verified to still land strictly inside `(a, b)` — appending characters can
 * only make a string *larger*, so the lower bound is never at risk, and the
 * upper bound is not either because {@link generateKeyBetween} guarantees the
 * candidate is never a proper prefix of `b` (see {@link avoidPrefixOf}); the
 * verification is kept as a belt-and-braces check, and on failure the call
 * deterministically falls back to the unjittered candidate. The trailing jitter
 * digit is never `'0'`, so a jittered result never ends in the lowest digit.
 *
 * @param a lower bound (exclusive), or `null` for no lower bound
 * @param b upper bound (exclusive), or `null` for no upper bound
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidKey(a)) {
    throw new RangeError(`fractional.keyBetween: invalid lower bound ${JSON.stringify(a)}`);
  }
  if (b !== null && !isValidKey(b)) {
    throw new RangeError(`fractional.keyBetween: invalid upper bound ${JSON.stringify(b)}`);
  }

  const candidate = generateKeyBetween(a, b);
  const jittered = candidate + ALPHABET[randomDigitIndex()] + ALPHABET[randomNonZeroDigitIndex()];
  const aboveLower = a === null || jittered > a;
  const belowUpper = b === null || jittered < b;
  return aboveLower && belowUpper ? jittered : candidate;
}

/**
 * Generates `n` keys strictly between `a` and `b`, evenly distributed
 * (divide-and-conquer around the midpoint, so the batch stays balanced
 * rather than chaining `n` sequential single-digit insertions off one end).
 *
 * @param a lower bound (exclusive), or `null` for no lower bound
 * @param b upper bound (exclusive), or `null` for no upper bound
 * @param n how many keys to generate, in ascending order
 */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];

  if (b === null) {
    const result: string[] = [];
    let cursor = a;
    for (let i = 0; i < n; i++) {
      cursor = keyBetween(cursor, null);
      result.push(cursor);
    }
    return result;
  }

  if (a === null) {
    const result: string[] = [];
    let cursor = b;
    for (let i = 0; i < n; i++) {
      cursor = keyBetween(null, cursor);
      result.push(cursor);
    }
    result.reverse();
    return result;
  }

  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

/**
 * True iff `k` is a well-formed fractional key: non-empty, drawn entirely
 * from the base-62 alphabet, with a structurally valid integer-part prefix
 * whose *fractional* suffix (if any) does not end in `'0'`. A bare integer
 * part (no fractional suffix, e.g. `"a0"`) is valid even though its last
 * character is `'0'` — that digit is significant magnitude, not padding.
 */
export function isValidKey(k: string): boolean {
  if (k.length === 0) return false;
  for (let i = 0; i < k.length; i++) {
    if (ALPHABET.indexOf(k[i]) < 0) return false;
  }
  let ip: string;
  try {
    ip = integerPart(k);
  } catch {
    return false;
  }
  const frac = k.slice(ip.length);
  return frac.length === 0 || frac[frac.length - 1] !== DIGIT_ZERO;
}
