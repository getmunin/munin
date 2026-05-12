import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "../cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-input border-[0.5px] border-rule-soft bg-paper px-3 py-1.5 text-sm text-ink transition-colors duration-fast ease-munin outline-none placeholder:text-ink-mute focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive dark:bg-card dark:text-foreground dark:border-rule-on-dark dark:focus-visible:border-cobalt-soft dark:focus-visible:ring-cobalt-soft",
        className
      )}
      {...props}
    />
  )
}

export { Input }
