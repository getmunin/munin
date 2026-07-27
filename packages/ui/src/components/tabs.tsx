import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "../cn"

function Tabs(props: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root {...props} />
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex items-stretch border-b-[1px] border-rule-soft text-ink-mute dark:border-rule-on-dark",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 -mb-px font-mono text-[10px] uppercase tracking-eyebrow font-medium border-b-2 border-transparent transition-colors duration-fast ease-munin outline-none focus-visible:text-ink hover:text-ink disabled:pointer-events-none disabled:opacity-50 data-[active]:border-cobalt data-[active]:text-ink dark:hover:text-foreground dark:data-[active]:text-foreground dark:data-[active]:border-cobalt-soft",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn(
        "mt-6 outline-none focus-visible:ring-1 focus-visible:ring-cobalt",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsPanel }
