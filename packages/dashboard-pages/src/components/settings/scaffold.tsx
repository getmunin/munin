'use client';

import type { ReactNode } from 'react';
import { Button, cn } from '@getmunin/ui';

export const SETTINGS_MEASURE = 'max-w-[720px]';
export const SETTINGS_MEASURE_WIDE = 'max-w-[1000px]';
export const SETTINGS_MEASURE_FIELD = 'max-w-[420px]';

export function SettingsColumn({
  wide,
  className,
  children,
}: {
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(wide ? SETTINGS_MEASURE_WIDE : SETTINGS_MEASURE, 'space-y-8', className)}>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  meta,
  help,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-5 border-b-[1px] border-ink pb-2 dark:border-paper">
        <h2 className="font-serif text-xl font-normal leading-tight tracking-tight text-ink dark:text-foreground">
          {title}
        </h2>
        {meta ? (
          <p className="whitespace-nowrap font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-mute">
            {meta}
          </p>
        ) : null}
      </div>
      {help ? (
        <p className="max-w-[460px] text-[12.5px] leading-[1.5] text-ink-mute">{help}</p>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[12.5px] font-semibold text-ink dark:text-foreground"
    >
      {children}
    </label>
  );
}

export function SettingsFieldNote({ children }: { children: ReactNode }) {
  return <p className="max-w-[520px] text-[11.5px] leading-[1.45] text-ink-mute">{children}</p>;
}

export function SaveButton({
  dirty,
  saving,
  onClick,
  label,
  savingLabel,
  type = 'button',
}: {
  dirty: boolean;
  saving: boolean;
  onClick?: () => void;
  label: string;
  savingLabel: string;
  type?: 'button' | 'submit';
}) {
  const disabled = !dirty || saving;
  return (
    <Button
      type={type}
      variant={disabled ? 'outline' : 'default'}
      disabled={disabled}
      onClick={onClick}
      className={
        disabled
          ? 'border-rule-soft text-ink-mute disabled:opacity-100 dark:border-rule-on-dark'
          : undefined
      }
    >
      {saving ? savingLabel : label}
    </Button>
  );
}

export function HairlineRow({
  title,
  description,
  value,
}: {
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b-[1px] border-rule-soft py-3 dark:border-rule-on-dark">
      <div className="min-w-0">
        <div className="font-serif text-[17px] tracking-tight text-ink dark:text-foreground">
          {title}
        </div>
        {description ? (
          <div className="mt-1 text-[11.5px] leading-[1.45] text-ink-mute">{description}</div>
        ) : null}
      </div>
      {value ? (
        <div className="whitespace-nowrap text-right font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-mute">
          {value}
        </div>
      ) : null}
    </div>
  );
}

export function PickerRow({
  title,
  description,
  value,
  selected,
  onClick,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  selected: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-baseline justify-between gap-6 px-3.5 py-3 text-left transition-colors',
        selected
          ? 'border-[1.5px] border-cobalt dark:border-cobalt-soft'
          : 'border-[1px] border-rule-soft hover:border-ink/30 dark:border-rule-on-dark',
      )}
    >
      <span className="min-w-0">
        <span className="block font-serif text-[17px] tracking-tight text-ink dark:text-foreground">
          {title}
        </span>
        {description ? (
          <span className="mt-1 block text-[11.5px] leading-[1.45] text-ink-mute">
            {description}
          </span>
        ) : null}
        {children}
      </span>
      {value ? (
        <span
          className={cn(
            'whitespace-nowrap font-mono text-[10px] font-medium uppercase tracking-eyebrow',
            selected ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
          )}
        >
          {value}
        </span>
      ) : null}
    </button>
  );
}

export function CheckboxRow({
  checked,
  onChange,
  disabled,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border-b-[1px] border-rule-soft py-2.5 last:border-0 dark:border-rule-on-dark">
      <input
        type="checkbox"
        className="mt-0.5 size-3.5 shrink-0 accent-ink"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="flex flex-1 flex-col gap-1">
        <span className="text-[13.5px] text-ink dark:text-foreground">{title}</span>
        {description ? (
          <span className="text-[11.5px] leading-[1.4] text-ink-mute">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

export function RadioRow({
  name,
  checked,
  onChange,
  disabled,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border-b-[1px] border-rule-soft py-2.5 last:border-0 dark:border-rule-on-dark">
      <input
        type="radio"
        name={name}
        className="mt-0.5 size-3.5 shrink-0 accent-ink"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="flex flex-1 flex-col gap-1">
        <span className="text-[13.5px] text-ink dark:text-foreground">{title}</span>
        {description ? (
          <span className="text-[11.5px] leading-[1.4] text-ink-mute">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
