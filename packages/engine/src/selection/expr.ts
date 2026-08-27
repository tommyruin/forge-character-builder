/**
 * Requirement-expression evaluator for the corpus grammar.
 *
 * Grammar (from third-party/elements/testdata — the corpus is the spec):
 *   expr    := orExpr
 *   orExpr  := andExpr (("||" | "|") andExpr)*
 *   andExpr := unary (("," | "&&" | "&") unary)*
 *   unary   := "!" unary | "(" expr ")" | atom
 *   atom    := IDENT | "[" ident ":" number (":" rest)* "]" | "level" ":" number
 *
 * Atoms: `ID_...` is true when the context has the element registered;
 * `[ability:min]` (e.g. `[dex:13]`) is a score comparison; `[level:N]` compares
 * character level; `[level:class:N]` compares a class level. Bracket atoms
 * with more segments split on the last colon into a stat path and a minimum
 * (`[innate speed:climb:1]`), resolved through the context's `ability()` —
 * contexts back unknown names with the computed statistics, and a name that
 * resolves nowhere evaluates to false. Malformed input never throws; any
 * parse failure yields false.
 */

export interface RequirementContext {
  hasElement(id: string): boolean;
  /** True when a registered element has the given type (e.g. `[type:class]`). */
  hasType?(type: string): boolean;
  ability(name: string): number;
  level: number;
  /** Levels gained in the class with the given (lowercased) name (`[level:wizard:1]`). */
  classLevel?(name: string): number;
}

const isIdentChar = (code: number): boolean =>
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  (code >= 0x30 && code <= 0x39) ||
  code === 0x5f ||
  code === 0x2d;

type Token =
  | { kind: "ident"; value: string }
  | { kind: "number"; value: number }
  | { kind: "or" }
  | { kind: "and" }
  | { kind: "not" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "lbracket" }
  | { kind: "rbracket" }
  | { kind: "colon" }
  | { kind: "end" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // A handful of corpus expressions write a single `|` (or `&`) where they
    // mean `||` (or `&&`) — Tiefling's Infernal grant and Eldritch Adept's
    // non-warlock invocation list among them. Rejecting those would read as
    // "requirements not met" and silently switch the rule off, so accept one
    // or two characters alike.
    if (ch === "|") {
      tokens.push({ kind: "or" });
      i += source[i + 1] === "|" ? 2 : 1;
      continue;
    }
    if (ch === "&") {
      tokens.push({ kind: "and" });
      i += source[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "and" });
      i++;
      continue;
    }
    if (ch === "!") {
      tokens.push({ kind: "not" });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === "[") {
      tokens.push({ kind: "lbracket" });
      i++;
      continue;
    }
    if (ch === "]") {
      tokens.push({ kind: "rbracket" });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "colon" });
      i++;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x30 && code <= 0x39) {
      let j = i;
      while (j < n && source[j]!.charCodeAt(0) >= 0x30 && source[j]!.charCodeAt(0) <= 0x39) j++;
      tokens.push({ kind: "number", value: Number(source.slice(i, j)) });
      i = j;
      continue;
    }
    if (isIdentChar(code)) {
      let j = i;
      while (j < n && isIdentChar(source[j]!.charCodeAt(0))) j++;
      tokens.push({ kind: "ident", value: source.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`unexpected character '${ch}'`);
  }
  tokens.push({ kind: "end" });
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: RequirementContext,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  parse(): boolean {
    if (this.tokens.length <= 1) return true;
    const value = this.parseOr();
    if (this.peek().kind !== "end") throw new Error("unexpected trailing tokens");
    return value;
  }

  private parseOr(): boolean {
    let value = this.parseAnd();
    for (;;) {
      const token = this.peek();
      if (token.kind !== "or") return value;
      this.next();
      const right = this.parseAnd();
      value = value || right;
    }
  }

  private parseAnd(): boolean {
    let value = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== "and") return value;
      this.next();
      const right = this.parseUnary();
      value = value && right;
    }
  }

  private parseUnary(): boolean {
    const token = this.next();
    if (token.kind === "not") {
      return !this.parseUnary();
    }
    if (token.kind === "lparen") {
      const value = this.parseOr();
      if (this.next().kind !== "rparen") throw new Error("missing ')'");
      return value;
    }
    if (token.kind === "ident") {
      return this.finishAtom(token.value);
    }
    if (token.kind === "lbracket") {
      return this.parseBracket();
    }
    throw new Error("expected atom");
  }

  /** IDENT may be followed by `:N` (bare level check). */
  private finishAtom(ident: string): boolean {
    if (ident === "level" && this.peek().kind === "colon") {
      this.next();
      const value = this.next();
      if (value.kind !== "number") throw new Error("expected level number");
      return this.ctx.level >= value.value;
    }
    return this.ctx.hasElement(ident);
  }

  /**
   * `[name:number (: ...)*]` — ability, level and stat-key checks. Part
   * names may contain spaces ("innate speed") and the checked path may span
   * colons ("innate speed:climb"); the final part is the minimum. The
   * context's ability() resolves both ability scores and stat values.
   */
  private parseBracket(): boolean {
    const parts: string[] = [];
    let value: string | null = null;
    for (;;) {
      const token = this.next();
      if (token.kind === "rbracket") break;
      if (token.kind === "end") throw new Error("unterminated bracket");
      if (token.kind === "colon") {
        if (value !== null) {
          parts.push(value);
          value = null;
        }
        continue;
      }
      if (token.kind === "ident" || token.kind === "number") {
        const text = token.kind === "number" ? String(token.value) : token.value;
        value = value === null ? text : `${value} ${text}`;
        continue;
      }
      throw new Error("unexpected token in bracket");
    }
    if (value !== null) parts.push(value);
    if (parts.length < 2) return false;
    const name = parts.slice(0, -1).join(":");
    if (name === "type" && parts.length === 2) return this.ctx.hasType?.(parts[1]!) ?? false;
    const minimum = Number(parts[parts.length - 1]);
    if (Number.isNaN(minimum)) return false;
    if (name === "level" || name === "character") return this.ctx.level >= minimum;
    if (name.startsWith("level:")) {
      const className = name.slice("level:".length).toLowerCase();
      const levels = this.ctx.classLevel?.(className) ?? 0;
      return levels >= minimum;
    }
    const score = this.ctx.ability(name);
    if (Number.isNaN(score)) return false;
    return score >= minimum;
  }
}

/**
 * Evaluates a requirement expression against the context. Absent or blank
 * expressions have no requirements (true). Malformed input is false, never
 * throws.
 */
export function evaluateRequirements(
  expression: string | undefined,
  ctx: RequirementContext,
): boolean {
  if (expression === undefined || expression.trim() === "") return true;
  try {
    return new Parser(tokenize(expression), ctx).parse();
  } catch {
    return false;
  }
}
