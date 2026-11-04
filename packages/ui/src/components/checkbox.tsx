"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "../cn"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 border-[1px] border-ink bg-transparent outline-none transition-colors duration-fast ease-munin focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 data-[checked]:border-ink data-[checked]:bg-ink dark:border-paper dark:data-[checked]:border-paper dark:data-[checked]:bg-paper",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-paper dark:text-ink"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
