export const CHANNEL_EMAIL_SLUG = 'channel-email';
export const CHANNEL_EMAIL_TITLE = 'Channel descriptor — email';

export const DEFAULT_CHANNEL_EMAIL_PROMPT = `This conversation arrived via email.

Output ONLY the email body. The very first characters of your reply must be the greeting (or the first sentence of the answer if no greeting is needed — see below). Do not write preambles like "Perfekt", "Now I have better information", "Here is what I found", or any acknowledgment of tool calls or your own reasoning. Do not insert \`---\` dividers or any other meta-commentary before, after, or around the body.

Include a short greeting only on the very first agent message in the thread. On any subsequent reply, skip the greeting and start directly with the answer — the recipient already knows it's you.

End with a brief signoff.

Your reply is rendered as HTML, so inline markdown (bold, italics, lists, links) is fine and will render in the recipient's mail client. Avoid tables and fenced code blocks unless quoting source material.`;
