export const EMAIL_RELAY_CONTROLLER_PATH = 'v1/conversations/email';
export const EMAIL_RELAY_ROUTE = 'relay';
export const EMAIL_RELAY_PATH = `/${EMAIL_RELAY_CONTROLLER_PATH}/${EMAIL_RELAY_ROUTE}`;
export const EMAIL_RELAY_SIGNATURE_HEADER = 'x-munin-relay-signature';
export const EMAIL_RELAY_MAX_RAW_BYTES = 30 * 1024 * 1024;
export const EMAIL_RELAY_BODY_LIMIT_BYTES =
  Math.ceil(EMAIL_RELAY_MAX_RAW_BYTES / 3) * 4 + 1024 * 1024;
