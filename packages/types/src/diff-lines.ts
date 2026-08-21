export type DiffOp = "context" | "added" | "removed"

export interface DiffLine {
  op: DiffOp
  text: string
}

const MAX_DIFF_LINES = 2000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      ...a.map((text): DiffLine => ({ op: "removed", text })),
      ...b.map((text): DiffLine => ({ op: "added", text })),
    ]
  }

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "context", text: a[i]! })
      i += 1
      j += 1
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: "removed", text: a[i]! })
      i += 1
    } else {
      out.push({ op: "added", text: b[j]! })
      j += 1
    }
  }
  while (i < a.length) {
    out.push({ op: "removed", text: a[i]! })
    i += 1
  }
  while (j < b.length) {
    out.push({ op: "added", text: b[j]! })
    j += 1
  }
  return out
}

export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.op !== "context")
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n")
}
