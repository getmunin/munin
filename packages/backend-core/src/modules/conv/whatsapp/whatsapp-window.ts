import { BadRequestException } from '@nestjs/common';

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const WHATSAPP_WINDOW_CLOSED_ERROR_CODES: ReadonlySet<number> = new Set([131047]);

export const WHATSAPP_WINDOW_CLOSED_CODE = 'conv_whatsapp_window_closed';

export interface WhatsAppWindow {
  open: boolean;
  closesAt: string | null;
  lastInboundAt: string | null;
}

export function computeWhatsAppWindow(lastInboundAt: Date | null, now: Date = new Date()): WhatsAppWindow {
  if (!lastInboundAt) return { open: false, closesAt: null, lastInboundAt: null };
  const closesAt = new Date(lastInboundAt.getTime() + WHATSAPP_WINDOW_MS);
  return {
    open: closesAt.getTime() > now.getTime(),
    closesAt: closesAt.toISOString(),
    lastInboundAt: lastInboundAt.toISOString(),
  };
}

export function whatsappWindowClosedError(detail: string | null): string {
  return `whatsapp_window_closed: the 24-hour customer-service window has closed — send an approved template with conv_send_whatsapp_template${detail ? ` (${detail})` : ''}`;
}

export class WhatsAppWindowClosedException extends BadRequestException {
  constructor(conversationId: string, closesAt: string | null) {
    const when = closesAt ? ` at ${closesAt}` : '';
    const message = `${WHATSAPP_WINDOW_CLOSED_CODE}: the 24-hour WhatsApp customer-service window for conversation ${conversationId} closed${when}, so a free-form message cannot be sent. Send an approved template with conv_send_whatsapp_template instead.`;
    super({ message, code: WHATSAPP_WINDOW_CLOSED_CODE });
  }
}
