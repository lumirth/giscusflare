/** The actual portable owner. Browser authentication, persistence and presentation are optional consumers. */
export { PageModel, type Transport, type PageConfig, type PageModelOptions, type CommentOrder, type Acquisition, type AcquisitionPurpose,
  type ActionAvailability, type SubjectActions, type ReactionState } from './page.js';
export { Writing, type WritingTarget, type WritingOutcome, type WritingFailure, type SavedWriting } from './writing.js';
export { CountFacts } from './counts.js';
export { countKey, type CountTarget } from '../contracts/count.js';
export type { Comment, Discussion, CountObservation, PageDocument, WindowPage, Patch, ContributionResult, Reactions, Reaction, AccessResult } from '../contracts/document.js';
export type { ContentInputData, ContentPreparer, PreparedContent, ContentPreview, ContentSource } from '../contracts/content.js';
