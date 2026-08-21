"use client"

import * as React from "react"

import { cn } from "../cn"
import { diffLines, type DiffLine } from "@getmunin/types"

const MARKER: Record<DiffLine["op"], string> = {
  added: "+",
  removed: "-",
  context: " ",
}

const LINE_CLASS: Record<DiffLine["op"], string> = {
  added:
    "bg-[oklch(0.95_0.06_150)] text-ink dark:bg-[oklch(0.28_0.05_150)] dark:text-foreground",
  removed:
    "bg-[oklch(0.95_0.05_25)] text-ink line-through decoration-1 dark:bg-[oklch(0.28_0.05_25)] dark:text-foreground",
  context: "text-ink-mute",
}

function BodyDiff({
  before,
  after,
  unchangedLabel,
  className,
}: {
  before: string
  after: string
  unchangedLabel?: string
  className?: string
}) {
  const lines = React.useMemo(() => diffLines(before, after), [before, after])
  const changed = lines.some((l) => l.op !== "context")

  if (!changed) {
    return (
      <p className="text-sm leading-relaxed text-ink-mute">
        {unchangedLabel ?? "No changes."}
      </p>
    )
  }

  return (
    <div
      className={cn(
        "overflow-x-auto border-[1px] border-ink bg-paper text-[13px] leading-relaxed dark:border-rule-on-dark dark:bg-card",
        className,
      )}
    >
      <pre className="w-max min-w-full font-mono">
        {lines.map((line, i) => (
          <div key={i} className={cn("px-3", LINE_CLASS[line.op])}>
            <span aria-hidden className="select-none pr-2 opacity-60">
              {MARKER[line.op]}
            </span>
            {line.text === "" ? "​" : line.text}
          </div>
        ))}
      </pre>
    </div>
  )
}

export { BodyDiff }
