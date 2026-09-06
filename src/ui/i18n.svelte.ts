/** UI language. One language is shown at a time; the switcher swaps it live. */
export type Lang = 'en' | 'th';
const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;
export const i18n = $state({ lang: stored === 'en' ? 'en' : 'th' });
export const t = (en: string, th: string) => (i18n.lang === 'th' ? th : en);
