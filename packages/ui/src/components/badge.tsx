import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../cn"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow font-medium border whitespace-nowrap before:content-[''] before:size-[5px] before:rounded-full before:bg-current",
  {
    variants: {
      variant: {
        default: "border-current text-ink dark:text-foreground",
        secondary: "border-rule-soft text-ink-mute dark:border-rule-on-dark",
        outline: "border-current text-ink-mute dark:text-foreground",
        cobalt: "border-current text-cobalt dark:text-cobalt-soft",
        destructive: "border-current text-destructive",
        warning: "border-current text-[#9a7a1f] dark:text-amber-300",
        success: "border-current text-cobalt dark:text-cobalt-soft",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, type BadgeProps }
