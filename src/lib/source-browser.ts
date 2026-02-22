'use client';

export const SOURCE_BROWSER_STORAGE_KEY = 'decotv:source-browser:current';
export const SOURCE_BROWSER_CHANGE_EVENT = 'decotv:source-browser:change';

export function getStoredSourceBrowserValue(): string {
  if (typeof window === 'undefined') return 'auto';
  const stored = localStorage.getItem(SOURCE_BROWSER_STORAGE_KEY);
  if (!stored || stored.trim() === '') return 'auto';
  return stored;
}

export function setStoredSourceBrowserValue(sourceKey: string): void {
  if (typeof window === 'undefined') return;
  const nextValue = sourceKey || 'auto';
  localStorage.setItem(SOURCE_BROWSER_STORAGE_KEY, nextValue);
  window.dispatchEvent(
    new CustomEvent(SOURCE_BROWSER_CHANGE_EVENT, {
      detail: { sourceKey: nextValue },
    }),
  );
}
