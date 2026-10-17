// Tiny safe expression evaluator: numbers, identifiers, + - * / ( ), and
// floor/ceil/round(x[, step]), min(...), max(...). Bracketed names like [Raw] are identifiers.
type Tok = { t: 'num' | 'id' | 'op'; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: 'num', v: s.slice(i, j) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    if (c === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) throw new Error('Missing "]"');
      out.push({ t: 'id', v: s.slice(i, j + 1) }); i = j + 1; continue;
    }
    if ('+-*/(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

const step = (f: (x: number) => number) => (x: number, k = 1) => f(x / k) * k;
const FUNCS: Record<string, (...a: number[]) => number> = {
  floor: step(Math.floor), ceil: step(Math.ceil), round: step(Math.round),
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
};

export function evaluate(expr: string, lookup: (name: string) => number): number {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v && t.v !== v)) throw new Error(`Expected ${v ?? 'value'}`);
    p++; return t;
  };
  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'num') { p++; return parseFloat(t.v); }
    if (t.v === '-') { p++; return -primary(); }
    if (t.v === '(') { p++; const v = add(); eat(')'); return v; }
    if (t.t === 'id') {
      p++;
      if (peek()?.v === '(') {
        const fn = FUNCS[t.v.toLowerCase()];
        if (!fn) throw new Error(`Unknown function ${t.v}`);
        p++; const args: number[] = [];
        if (peek()?.v !== ')') { args.push(add()); while (peek()?.v === ',') { p++; args.push(add()); } }
        eat(')'); return fn(...args);
      }
      return lookup(t.v);
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const mul = (): number => {
    let v = primary();
    while (peek() && (peek().v === '*' || peek().v === '/')) { const o = eat().v; const r = primary(); v = o === '*' ? v * r : v / r; }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() && (peek().v === '+' || peek().v === '-')) { const o = eat().v; const r = mul(); v = o === '+' ? v + r : v - r; }
    return v;
  };
  const v = add();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return v;
}
