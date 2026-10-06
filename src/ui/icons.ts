/*
 * Small hand-drawn icons for the café, as inline SVG so nothing is fetched from the network.
 * They use currentColor so they follow the light and dark colour themes.
 */

export const logoIcon = `
<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" class="logo-mark">
  <path d="M24 10c-3 4 3 6 0 10M32 8c-3 4 3 6 0 10M40 10c-3 4 3 6 0 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <path d="M12 26h36v14a16 16 0 0 1-16 16h-4A16 16 0 0 1 12 40Z" fill="currentColor"/>
  <path d="M48 30h3a7 7 0 0 1 0 14h-4" fill="none" stroke="currentColor" stroke-width="4"/>
  <path d="M24 37l-4 4 4 4M36 37l4 4-4 4" fill="none" stroke="var(--cream-on-brown)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const flatWhite = `
<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <ellipse cx="24" cy="38" rx="18" ry="5" fill="currentColor" opacity="0.25"/>
  <path d="M9 18h30v8a15 15 0 0 1-30 0Z" fill="currentColor"/>
  <path d="M39 20h2a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M24 21c-4 0-5 3-2 4 3 1 3 3 2 4m0-8c4 0 5 3 2 4" fill="none" stroke="var(--cream-on-brown)" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const toastie = `
<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path d="M6 38 24 8l18 30Z" fill="currentColor"/>
  <path d="M11 33h26" stroke="var(--cream-on-brown)" stroke-width="3" stroke-linecap="round"/>
  <path d="M16 26l4-4m4 4 4-4m-10 8 4-4m4 4 4-4" stroke="var(--cream-on-brown)" stroke-width="1.5" opacity="0.6"/>
</svg>`;

const brownie = `
<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <rect x="7" y="12" width="34" height="26" rx="5" fill="currentColor"/>
  <path d="M7 20c6 3 10-2 17 1s11-2 17 0" fill="none" stroke="var(--cream-on-brown)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="16" cy="29" r="2" fill="var(--cream-on-brown)"/>
  <circle cx="27" cy="31" r="2" fill="var(--cream-on-brown)"/>
  <circle cx="34" cy="26" r="1.6" fill="var(--cream-on-brown)"/>
</svg>`;

const genericItem = `
<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <circle cx="24" cy="24" r="16" fill="currentColor"/>
</svg>`;

const productIcons: Readonly<Record<string, string>> = {
  "flat-white": flatWhite,
  toastie,
  brownie,
};

export function productIcon(productId: string): string {
  return productIcons[productId] ?? genericItem;
}
