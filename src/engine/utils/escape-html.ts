/**
 * Escapes a string for safe interpolation into HTML markup, covering both
 * element content and quoted attribute values. Use this for any user-supplied
 * or file-imported string (list names, satellite names, categories, etc.)
 * before it is concatenated into an innerHTML/insertAdjacentHTML payload.
 */
export const escapeHtml = (text: string): string => text
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;');
