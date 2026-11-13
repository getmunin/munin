import * as React from "react"

const ERROR_SELECTOR = '[role="alert"], [aria-invalid="true"]'

function isRendered(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.getClientRects().length > 0
}

function scrollContainer(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node
    }
    if (node === root) return null
  }
  return null
}

function byDocumentOrder(a: Element, b: Element): number {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

export function revealFirstError(root: HTMLElement, candidates?: Iterable<Element>): HTMLElement | null {
  const pool = candidates ? Array.from(candidates) : Array.from(root.querySelectorAll(ERROR_SELECTOR))
  const first = pool
    .filter((el) => root.contains(el) && el.matches(ERROR_SELECTOR))
    .filter(isRendered)
    .sort(byDocumentOrder)[0]
  if (!first) return null
  const container = scrollContainer(first, root)
  if (!container) return null
  const box = first.getBoundingClientRect()
  const view = container.getBoundingClientRect()
  if (box.top >= view.top && box.bottom <= view.bottom) return null
  first.scrollIntoView({ block: "center", behavior: "smooth" })
  return first
}

function collectErrors(mutations: MutationRecord[]): Set<Element> {
  const found = new Set<Element>()
  for (const mutation of mutations) {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
    const owner = target?.closest(ERROR_SELECTOR)
    if (owner) found.add(owner)
    for (const node of Array.from(mutation.addedNodes)) {
      if (!(node instanceof Element)) continue
      if (node.matches(ERROR_SELECTOR)) found.add(node)
      for (const inner of Array.from(node.querySelectorAll(ERROR_SELECTOR))) found.add(inner)
    }
  }
  return found
}

export function useRevealErrors(root: HTMLElement | null): void {
  React.useEffect(() => {
    if (!root) return
    let frame = 0
    let pending: Set<Element> | "all" | null = null

    const flush = () => {
      frame = 0
      const scope = pending
      pending = null
      if (scope === "all") revealFirstError(root)
      else if (scope) revealFirstError(root, scope)
    }
    const schedule = (next: Set<Element> | "all") => {
      if (next === "all" || pending === "all") pending = "all"
      else pending = new Set([...(pending ?? []), ...next])
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(flush)
      })
    }

    const observer = new MutationObserver((mutations) => {
      const errors = collectErrors(mutations)
      if (errors.size > 0) schedule(errors)
    })
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-invalid", "role"],
    })

    const onSubmit = () => schedule("all")
    root.addEventListener("submit", onSubmit, true)

    return () => {
      observer.disconnect()
      root.removeEventListener("submit", onSubmit, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [root])
}
