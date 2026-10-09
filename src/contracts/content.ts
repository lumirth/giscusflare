import * as v from 'valibot';

export interface ContentResources { revision: string; styles: string[]; scripts: string[] }
/** A profile owns safe interpretation and the complete resource requirements. */
export interface PreparedContent {
  html: string;
  revision: string;
  /** Profile-generated local anchors receive a unique namespace per installed mount. */
  anchorPrefixes?: string[];
  /** The selected manifest identity; omit when the body needs no additional resources. */
  resources?: string;
}
export const ContentInputSchema = v.object({
  html: v.optional(v.pipe(v.string(), v.maxLength(2_000_000))),
  markdown: v.pipe(v.string(), v.maxLength(1_000_000)),
  purpose: v.picklist(['comment', 'preview']),
  repo: v.pipe(v.string(), v.maxLength(200)),
  pageURL: v.pipe(v.string(), v.url(), v.maxLength(2000)),
  comment: v.optional(v.object({ id: v.pipe(v.string(), v.maxLength(200)), url: v.pipe(v.string(), v.url(), v.maxLength(2000)), parentId: v.nullable(v.pipe(v.string(), v.maxLength(200))) })),
  draft: v.optional(v.pipe(v.string(), v.maxLength(200))),
});
export type ContentInputData = v.InferOutput<typeof ContentInputSchema>;
export const ContentBatch = v.object({ inputs: v.pipe(v.array(ContentInputSchema), v.minLength(1), v.maxLength(20)) });
export type ContentPreparer = (input: ContentInputData, signal?: AbortSignal) => PreparedContent | Promise<PreparedContent>;
export interface ContentPreview { html?: string; prepared?: PreparedContent }
export type ContentResult = ContentPreview | { error: string };
export interface ContentBatchResult { results: ContentResult[] }
/** A deliberate browser interpretation profile may request provider HTML. */
export const ContentSource = v.picklist(['source', 'github', 'prepared', 'stock']);
export type ContentSource = v.InferOutput<typeof ContentSource>;
