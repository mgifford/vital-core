/**
 * One brand mark for report tabs, headers and the self-contained ACR.
 *
 * The mark is deliberately simple at 16 px: a bold V on deep teal with an
 * amber ledger rule. It is inline SVG so the build needs no image tooling.
 */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="vital-mark-title">
  <title id="vital-mark-title">vital-scans</title>
  <rect width="64" height="64" rx="14" fill="#083b3d"/>
  <path d="M14 14h10l8 24 8-24h10L37 50H27Z" fill="#f7f3e8"/>
  <rect x="16" y="54" width="32" height="4" rx="2" fill="#e0a526"/>
</svg>
`;

export const FAVICON_FILENAME = 'favicon.svg';
export const FAVICON_PNG_FILENAME = 'favicon.png';

/** Data URI for the self-contained ACR HTML, which cannot rely on a linked asset. */
export const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;
