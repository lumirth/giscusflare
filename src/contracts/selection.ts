import type { Selection } from './requests.js';
/** Strip presentation and creation values from canonical selection. */
export function selection(page:Selection):Selection { const {repo,selector,origin,pageURL,returnURL,registration}=page; return {repo,selector,origin,pageURL,returnURL,...(registration?{registration}:{})}; }
