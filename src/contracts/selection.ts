import type {Selection} from './requests.js';
export function selection(widget: Selection): Selection {
  const {repo,repoId,category,categoryId,term,number,strict,origin}=widget;
  return {repo,repoId,category,categoryId,term,number,strict,origin};
}
