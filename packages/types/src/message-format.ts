export interface PriceRange {
  currency: string;
  priceMin: string | null;
  priceMax: string | null;
}

export function formatPriceRange(price: PriceRange, locale: string): string | null {
  const min = toAmount(price.priceMin);
  const max = toAmount(price.priceMax);
  if (min === null && max === null) return null;
  const low = min ?? max!;
  const high = max ?? min!;
  if (high > low) {
    return `${formatAmount(low, price.currency, locale, false)}–${formatAmount(high, price.currency, locale, true)}`;
  }
  return formatAmount(low, price.currency, locale, true);
}

function toAmount(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function formatAmount(
  amount: number,
  currency: string,
  locale: string,
  withCurrency: boolean,
): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  const plain = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  if (!withCurrency) return plain;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${plain} ${currency}`;
  }
}
