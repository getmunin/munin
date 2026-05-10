import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorAlertProps {
  title: string;
  children?: ReactNode;
}

export function ErrorAlert({ title, children }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className="mb-[22px] flex gap-3 rounded-[12px] bg-alert-bad px-4 py-3.5 text-[13px] leading-[1.5] text-alert-bad-ink"
    >
      <AlertCircle className="mt-px size-[18px] shrink-0" strokeWidth={2.2} />
      <div>
        <div className="mb-0.5 font-semibold">{title}</div>
        {children}
      </div>
    </div>
  );
}
