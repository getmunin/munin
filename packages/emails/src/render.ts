import { render } from '@react-email/render';
import type { ReactElement } from 'react';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail(opts: {
  subject: string;
  element: ReactElement;
  plaintext: string;
}): Promise<RenderedEmail> {
  const html = await render(opts.element);
  return { subject: opts.subject, html, text: opts.plaintext };
}
