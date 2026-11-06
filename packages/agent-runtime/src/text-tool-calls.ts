export interface TextToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface RecoveredTextToolCalls {
  prose: string;
  calls: TextToolCall[];
}

const CALL_START = /(?<![\w.:`])`?(?:<\|tool_call>\s*)?(?:call:)?[A-Za-z_][\w.-]*\s*[({]/g;
const FENCE = '```';
const FENCE_HEADER = /^[\w-]*[ \t]*\n/;
const GEMMA_QUOTE = '<|"|>';
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const IDENTIFIER = /^[A-Za-z_][\w.-]*/;

export function recoverTextToolCalls(
  content: string | null | undefined,
  toolNames: ReadonlySet<string>,
): RecoveredTextToolCalls | null {
  if (typeof content !== 'string' || toolNames.size === 0) return null;
  const text = content.trimEnd();
  if (text.length === 0) return null;

  const fence = trailingFence(text);
  if (fence) {
    const calls = parseRun(fence.body, 0, toolNames);
    if (calls) return { prose: text.slice(0, fence.start).trimEnd(), calls };
  }

  for (const match of text.matchAll(CALL_START)) {
    const calls = parseRun(text, match.index, toolNames);
    if (calls) return { prose: text.slice(0, match.index).trimEnd(), calls };
  }
  return null;
}

function trailingFence(text: string): { start: number; body: string } | null {
  if (!text.endsWith(FENCE)) return null;
  const close = text.length - FENCE.length;
  const open = text.lastIndexOf(FENCE, close - 1);
  if (open < 0) return null;
  const header = FENCE_HEADER.exec(text.slice(open + FENCE.length, close));
  if (!header) return null;
  return { start: open, body: text.slice(open + FENCE.length + header[0].length, close).trim() };
}

function parseRun(
  text: string,
  start: number,
  toolNames: ReadonlySet<string>,
): TextToolCall[] | null {
  const cursor = new Cursor(text, start);
  const calls: TextToolCall[] = [];
  while (true) {
    const call = parseCall(cursor, toolNames);
    if (!call) return null;
    calls.push(call);
    cursor.skipSpace();
    if (!cursor.consume(';')) cursor.consume(',');
    cursor.skipSpace();
    if (cursor.done()) return calls;
  }
}

function parseCall(cursor: Cursor, toolNames: ReadonlySet<string>): TextToolCall | null {
  cursor.skipSpace();
  const backtick = cursor.consume('`');
  cursor.consume('<|tool_call>');
  cursor.skipSpace();
  cursor.consume('call:');
  const name = cursor.match(IDENTIFIER);
  if (!name || !toolNames.has(name)) return null;
  cursor.skipSpace();
  const args = cursor.consume('{')
    ? parseFields(cursor, '}')
    : cursor.consume('(')
      ? parseParenArgs(cursor)
      : null;
  if (!args) return null;
  cursor.skipSpace();
  cursor.consume('<tool_call|>');
  if (backtick && !cursor.consume('`')) return null;
  return { name, args };
}

function parseParenArgs(cursor: Cursor): Record<string, unknown> | null {
  cursor.skipSpace();
  if (cursor.peek() === '{') {
    cursor.consume('{');
    const args = parseFields(cursor, '}');
    cursor.skipSpace();
    return args && cursor.consume(')') ? args : null;
  }
  return parseFields(cursor, ')');
}

function parseFields(cursor: Cursor, close: string): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  while (true) {
    cursor.skipSpace();
    if (cursor.consume(close)) return fields;
    const key = parseKey(cursor);
    if (key === null) return null;
    cursor.skipSpace();
    if (!cursor.consume(':') && !cursor.consume('=')) return null;
    const value = parseValue(cursor, close);
    if (value === INVALID) return null;
    fields[key] = value;
    cursor.skipSpace();
    if (cursor.consume(',')) continue;
    if (cursor.consume(close)) return fields;
    return null;
  }
}

function parseKey(cursor: Cursor): string | null {
  const quoted = parseString(cursor);
  if (quoted !== null) return quoted;
  return cursor.match(IDENTIFIER);
}

const INVALID = Symbol('invalid');
const LITERALS: Record<string, boolean | null> = {
  true: true,
  True: true,
  false: false,
  False: false,
  null: null,
  None: null,
};

function parseValue(cursor: Cursor, close: string): unknown {
  cursor.skipSpace();
  const quoted = parseString(cursor);
  if (quoted !== null) return quoted;
  if (cursor.consume('[')) return parseList(cursor);
  if (cursor.consume('{')) return parseFields(cursor, '}') ?? INVALID;
  const number = cursor.match(NUMBER);
  if (number !== null && !/^[\w.]/.test(cursor.peek())) return Number(number);
  if (number !== null) cursor.rewind(number.length);
  const literal = cursor.match(/^(?:true|false|null|True|False|None)\b/);
  if (literal !== null) return LITERALS[literal] ?? null;
  const bare = cursor.match(new RegExp(`^[^,\\]\\n${escapeRegExp(close)}]+`));
  if (bare === null) return INVALID;
  const trimmed = bare.trim();
  return trimmed.length > 0 ? trimmed : INVALID;
}

function parseList(cursor: Cursor): unknown {
  const items: unknown[] = [];
  while (true) {
    cursor.skipSpace();
    if (cursor.consume(']')) return items;
    const value = parseValue(cursor, ']');
    if (value === INVALID) return INVALID;
    items.push(value);
    cursor.skipSpace();
    if (cursor.consume(',')) continue;
    if (cursor.consume(']')) return items;
    return INVALID;
  }
}

function parseString(cursor: Cursor): string | null {
  if (cursor.consume(GEMMA_QUOTE)) {
    const end = cursor.indexOf(GEMMA_QUOTE);
    if (end < 0) return null;
    const value = cursor.take(end);
    cursor.consume(GEMMA_QUOTE);
    return value;
  }
  const quote = cursor.peek();
  if (quote !== '"' && quote !== "'") return null;
  const start = cursor.position;
  cursor.advance(1);
  let value = '';
  while (!cursor.done()) {
    const ch = cursor.next();
    if (ch === '\\') {
      const escaped = cursor.next();
      value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
      continue;
    }
    if (ch === quote) return value;
    value += ch;
  }
  cursor.rewind(cursor.position - start);
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class Cursor {
  constructor(
    private readonly text: string,
    public position: number,
  ) {}

  done(): boolean {
    return this.position >= this.text.length;
  }

  peek(): string {
    return this.text[this.position] ?? '';
  }

  next(): string {
    const ch = this.peek();
    this.position += 1;
    return ch;
  }

  advance(count: number): void {
    this.position += count;
  }

  rewind(count: number): void {
    this.position -= count;
  }

  consume(token: string): boolean {
    if (!this.text.startsWith(token, this.position)) return false;
    this.position += token.length;
    return true;
  }

  match(pattern: RegExp): string | null {
    const found = pattern.exec(this.text.slice(this.position));
    if (!found || found.index !== 0) return null;
    this.position += found[0].length;
    return found[0];
  }

  indexOf(token: string): number {
    const at = this.text.indexOf(token, this.position);
    return at < 0 ? -1 : at - this.position;
  }

  take(count: number): string {
    const value = this.text.slice(this.position, this.position + count);
    this.position += count;
    return value;
  }

  skipSpace(): void {
    while (/\s/.test(this.peek())) this.position += 1;
  }
}
