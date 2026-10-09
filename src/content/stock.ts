import { createContentWorker } from './worker.js';
import { interpretGitHubContent } from './github.js';
import type { ContentInputData } from '../contracts/content.js';
import { stockResourceRevision } from './stock-resources.js';
export async function prepareGitHubContent(input: ContentInputData) { return {...(await interpretGitHubContent(input)).prepared, resources: stockResourceRevision}; }
export default createContentWorker({revision:'github-stock-v1',prepare:prepareGitHubContent});
