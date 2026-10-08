import type { Selection } from './requests.js';
/** Strip presentation and creation values from a page's data identity. */
export function selection(page: Selection): Selection {
  const { repo, term, number, strict, origin } = page;
  return { repo, term, number, strict, origin };
}
