// Builds site-internal URLs that work at the domain root and under a base path (GitHub Pages).
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
export const url = (path = ''): string => base + path.replace(/^\//, '');
/** Path without the base prefix, for example "/about/". */
export const stripBase = (pathname: string): string =>
  pathname.startsWith(base) ? '/' + pathname.slice(base.length) : pathname;
