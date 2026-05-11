import * as React from 'react';

import { cn } from '../cn';

type RailNavProps = React.ComponentProps<'nav'>;

function RailNav({ className, ...props }: RailNavProps) {
  return (
    <nav
      data-slot="rail-nav"
      className={cn('hidden w-56 shrink-0 md:block', className)}
      {...props}
    />
  );
}

interface RailGroupProps extends React.ComponentProps<'div'> {
  label: React.ReactNode;
}

function RailGroup({ label, className, children, ...props }: RailGroupProps) {
  return (
    <div data-slot="rail-group" className={cn('mb-6', className)} {...props}>
      <p className="px-3 pb-3 block font-mono uppercase tracking-eyebrow text-ink-mute text-[11px]">
        {label}
      </p>
      <ul className="space-y-px">{children}</ul>
    </div>
  );
}

function railItemClass(active?: boolean) {
  return cn(
    'flex items-center justify-between gap-2 px-3 py-1.5 text-sm border-l-2 border-transparent transition-colors duration-fast ease-munin',
    active
      ? 'border-cobalt bg-paper text-ink font-medium dark:bg-card dark:text-foreground dark:border-cobalt-soft'
      : 'text-ink-soft hover:bg-paper hover:text-ink dark:hover:bg-card dark:hover:text-foreground',
  );
}

interface RailItemProps {
  active?: boolean;
  count?: React.ReactNode;
  children: React.ReactNode;
  asChild?: never;
  render: React.ReactElement<{ className?: string; children?: React.ReactNode }>;
}

function RailItem({ active, count, children, render }: RailItemProps) {
  const inner = (
    <>
      <span className="truncate">{children}</span>
      {count != null ? (
        <span
          className={cn(
            'font-mono text-[10px] tracking-eyebrow uppercase',
            active ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );

  return (
    <li>
      {React.cloneElement(render, {
        className: cn(railItemClass(active), render.props.className),
        children: inner,
      })}
    </li>
  );
}

export { RailNav, RailGroup, RailItem, railItemClass };
