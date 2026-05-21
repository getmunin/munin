import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "../cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap font-mono uppercase tracking-eyebrow text-[10px] font-medium transition-colors duration-fast ease-munin outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-ink text-paper shadow-[inset_0_0_0_0.5px_rgb(var(--munin-ink))] hover:bg-cobalt-deep hover:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-accent-deep))] dark:bg-paper dark:text-ink dark:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-paper))] dark:hover:bg-cobalt-soft dark:hover:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-accent-soft))] dark:hover:text-ink",
        outline:
          "bg-transparent text-ink shadow-[inset_0_0_0_0.5px_rgb(var(--munin-ink))] hover:bg-ink hover:text-paper dark:text-paper dark:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-paper))] dark:hover:bg-paper dark:hover:text-ink",
        secondary:
          "bg-paper-deep text-ink shadow-[inset_0_0_0_0.5px_rgb(var(--munin-ink)/0.145)] hover:bg-ink hover:text-paper hover:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-ink))] dark:bg-secondary dark:text-foreground dark:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-fg-on-dark-2)/0.2)] dark:hover:bg-paper dark:hover:text-ink",
        ghost:
          "text-ink hover:bg-paper-deep dark:text-foreground dark:hover:bg-secondary",
        accent:
          "bg-cobalt text-paper shadow-[inset_0_0_0_0.5px_rgb(var(--munin-accent))] hover:bg-cobalt-deep hover:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-accent-deep))]",
        destructive:
          "bg-transparent text-destructive shadow-[inset_0_0_0_0.5px_var(--destructive)] hover:bg-destructive hover:text-destructive-foreground",
        link:
          "border-0 border-b-[0.5px] border-cobalt bg-transparent text-cobalt font-serif italic normal-case tracking-normal text-[15px] hover:text-cobalt-deep hover:border-cobalt-deep h-auto px-0 py-0 dark:text-cobalt-soft dark:border-cobalt-soft",
      },
      size: {
        default: "h-9 gap-1.5 px-3 py-2",
        xs: "h-6 gap-1 px-2 py-1",
        sm: "h-7 gap-1.5 px-2.5 py-1",
        lg: "h-11 gap-2 px-4 py-2.5 text-[11px]",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface ButtonExtraProps {
  pending?: boolean
}

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  pending = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & ButtonExtraProps) {
  const resolvedNativeButton = nativeButton ?? render === undefined
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      nativeButton={resolvedNativeButton}
      disabled={pending || disabled}
      {...props}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
