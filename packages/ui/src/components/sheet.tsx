import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../cn"

const sheetVariants = cva(
  "fixed z-50 flex flex-col bg-paper outline-none transition-transform duration-300 ease-munin dark:bg-card",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b border-ink data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full dark:border-rule-on-dark",
        bottom:
          "inset-x-0 bottom-0 border-t border-ink data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full dark:border-rule-on-dark",
        left: "inset-y-0 left-0 h-full w-full max-w-[560px] border-r border-ink data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full dark:border-rule-on-dark",
        right:
          "inset-y-0 right-0 h-full w-full max-w-[560px] border-l border-ink data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full dark:border-rule-on-dark",
      },
    },
    defaultVariants: { side: "right" },
  }
)

function Sheet(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

function SheetBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-ink/40 transition-opacity duration-200 ease-munin opacity-100 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 dark:bg-ink/70",
        className
      )}
      {...props}
    />
  )
}

interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Popup>,
    VariantProps<typeof sheetVariants> {}

function SheetContent({ side, className, children, ...props }: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetBackdrop />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2 px-6 py-5 border-b border-rule-soft dark:border-rule-on-dark", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-serif text-xl leading-tight font-normal tracking-tight", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-ink-mute", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetBackdrop,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
}
