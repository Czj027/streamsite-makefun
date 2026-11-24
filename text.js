const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const monthNames = 'January February March April May June July August September October November December'.split(' ');

export const entity = character => entities[character] ?? character;
export const escape = text => /[&<>"']/.test(text) ? text.replace(/[&<>"']/g, entity) : text;

export function toSlug(text) {
  const latin = /[^\x00-\x7f]/.test(text) ? text.normalize('NFKD').replace(/\p{M}/gu, '') : text;
  return latin.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
    .replace(/-$/, '').toLowerCase() || 'untitled';
}

export class Slugs {
  constructor(reserved) {
    this.used = new Set(reserved);
    this.next = undefined;
  }

  take(base) {
    if (!this.used.has(base)) {
      this.used.add(base);
      return base;
    }
    let n = this.next?.get(base) ?? 2;
    let result;
    do result = `${base}-${n++}`;
    while (this.used.has(result));
    (this.next ??= new Map()).set(base, n);
    this.used.add(result);
    return result;
  }
}

export function formatDate(date) {
  return date ? `${+date.slice(8)} ${monthNames[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}` : '';
}

export function order(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}
