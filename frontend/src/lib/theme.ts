/**
 * Resolved value of a theme token (see src/theme.css), for code that can't use CSS
 * variables directly, e.g. drawing on a canvas. Returns undefined outside the browser or
 * if the token is missing.
 */
export function themeColor(token: string, el: Element = document.documentElement): string | undefined {
  if (typeof getComputedStyle === 'undefined') return undefined
  return getComputedStyle(el).getPropertyValue(token).trim() || undefined
}
