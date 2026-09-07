export async function copyText(value: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch (err) {
      console.warn('[clipboard] writeText failed, falling back to execCommand', err);
    }
  }
  return copyViaSelection(value);
}

function copyViaSelection(value: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);

  const selection = document.getSelection();
  const restore = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, value.length);
    copied = document.execCommand('copy');
  } catch (err) {
    console.warn('[clipboard] execCommand copy failed', err);
  }

  document.body.removeChild(field);
  if (selection && restore) {
    selection.removeAllRanges();
    selection.addRange(restore);
  }
  return copied;
}
