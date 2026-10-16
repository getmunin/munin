export function describeError(err: unknown, maxDepth = 4): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < maxDepth; depth++) {
    if (cur instanceof Error) {
      const code = (cur as NodeJS.ErrnoException).code;
      const message = redactQueryParams(cur.message);
      parts.push(code ? `${cur.name}[${code}]: ${message}` : `${cur.name}: ${message}`);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(stringifyNonError(cur));
      break;
    }
  }
  return parts.join(' <- ');
}

function stringifyNonError(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return redactQueryParams(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  try {
    return JSON.stringify(value) ?? '[unstringifiable]';
  } catch {
    return '[unstringifiable]';
  }
}

const QUERY_PARAMS_SEGMENT = /\nparams: [\s\S]*?(?=\n {4}at |$)/g;
const REDACTED_PARAMS = '\nparams: [redacted]';

export function redactQueryParams(text: string): string {
  return text.replace(QUERY_PARAMS_SEGMENT, REDACTED_PARAMS);
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === 'string') return redactQueryParams(value);
  if (value instanceof Error) {
    const copy = new Error(redactQueryParams(value.message));
    copy.name = value.name;
    copy.stack = value.stack === undefined ? undefined : redactQueryParams(value.stack);
    return copy;
  }
  return value;
}

export function redactQueryParamsDeep<T>(value: T, maxDepth = 8): T {
  return redactValue(value, maxDepth, new WeakSet()) as T;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactQueryParams(value);
  if (value === null || typeof value !== 'object' || depth <= 0) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Error) {
    return redactQueryParams(value.stack ?? `${value.name}: ${value.message}`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = redactValue(value[i], depth - 1, seen);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = redactValue(record[key], depth - 1, seen);
  return value;
}

const RUNTIME_ERROR_TYPES = [
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  EvalError,
  URIError,
  AggregateError,
];

const DATABASE_ERROR_CLASSES = new Set([
  'DrizzleQueryError',
  'DrizzleError',
  'TransactionRollbackError',
  'PostgresError',
]);

const SQLSTATE = /^[0-9A-Z]{5}$/;

interface ErrorFields {
  syscall?: unknown;
  errno?: unknown;
  severity?: unknown;
  code?: unknown;
}

export function isInternalError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (RUNTIME_ERROR_TYPES.some((type) => err instanceof type)) return true;
  if (DATABASE_ERROR_CLASSES.has(errorClassName(err))) return true;
  if ('parameters' in err || ('query' in err && 'params' in err)) return true;
  const fields: Error & ErrorFields = err;
  if (typeof fields.syscall === 'string' || fields.errno !== undefined) return true;
  if (
    typeof fields.severity === 'string' &&
    typeof fields.code === 'string' &&
    SQLSTATE.test(fields.code)
  ) {
    return true;
  }
  return /(^|\n)Failed query: |\nparams: /.test(err.message);
}

export function errorClassName(err: unknown): string {
  if (err instanceof Error) {
    const ctorName: unknown = err.constructor?.name;
    return typeof ctorName === 'string' && ctorName.length > 0 ? ctorName : err.name;
  }
  return err === null ? 'null' : typeof err;
}

export function errorMessage(err: unknown): string {
  return redactQueryParams(err instanceof Error ? err.message : String(err));
}

export function internalErrorKind(err: unknown): string {
  const sqlState = sqlStateOf(err);
  return sqlState ? `${errorClassName(err)}:${sqlState}` : errorClassName(err);
}

export function auditErrorText(err: unknown): string {
  return isInternalError(err) ? `internal_error[${internalErrorKind(err)}]` : errorMessage(err);
}

export function sqlStateOf(err: unknown, maxDepth = 4): string | null {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < maxDepth; depth++) {
    if (typeof cur !== 'object') return null;
    const { code, cause } = cur as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && SQLSTATE.test(code)) return code;
    cur = cause;
  }
  return null;
}
