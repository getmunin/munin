import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../messages/en.json';
import { ConfirmDialogProvider } from '../components/confirm-dialog';

function Providers({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </NextIntlClientProvider>
    </StrictMode>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, { ...options, wrapper: Providers });
}
