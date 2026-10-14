import { formatPriceRange } from '@getmunin/types/message-format';
import type { MessageComponent, ProductListComponent, ProductListItem } from '@getmunin/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderMessageComponents(
  components: MessageComponent[] | undefined,
  locale: string,
): HTMLElement[] {
  if (!components?.length) return [];
  const out: HTMLElement[] = [];
  for (const component of components) {
    if (component.type === 'product_list') {
      out.push(renderProductList(component, locale));
    }
  }
  return out;
}

function renderProductList(component: ProductListComponent, locale: string): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'plist-rail';
  for (const item of component.items) {
    rail.appendChild(renderCard(item, locale));
  }
  return rail;
}

function renderCard(item: ProductListItem, locale: string): HTMLElement {
  const card = item.url ? linkCard(item.url) : document.createElement('div');
  card.className = 'pcard';

  const media = document.createElement('span');
  media.className = 'pcard-media';
  if (item.imageUrl) {
    const img = document.createElement('img');
    img.className = 'pcard-shot';
    img.src = item.imageUrl;
    img.alt = item.title;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.replaceWith(placeholderShot());
    });
    media.appendChild(img);
  } else {
    media.appendChild(placeholderShot());
  }

  const price = formatPriceRange(item, locale);
  if (price) {
    const priceEl = document.createElement('span');
    priceEl.className = 'pcard-price';
    priceEl.textContent = price;
    media.appendChild(priceEl);
  }
  card.appendChild(media);

  const body = document.createElement('span');
  body.className = 'pcard-body';
  const name = document.createElement('span');
  name.className = 'pcard-name';
  name.textContent = item.title;
  body.appendChild(name);
  if (item.url) body.appendChild(externalArrow());
  card.appendChild(body);

  return card;
}

function linkCard(url: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function placeholderShot(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'pcard-shot pcard-shot-empty';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function externalArrow(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pcard-arrow');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M7 17 17 7M8 7h9v9');
  svg.appendChild(path);
  return svg;
}
