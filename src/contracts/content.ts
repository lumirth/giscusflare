import * as v from 'valibot';

/** Delivery is selected explicitly; canonical writing remains Markdown. */
export const ContentSource = v.picklist(['source', 'github', 'prepared']);
export type ContentSource = v.InferOutput<typeof ContentSource>;
export interface PreparedContent {
  html: string;
  revision: string;
  resources?: { styles: string[]; scripts: string[] };
}
export interface ContentInputData {
  markdown: string;
  purpose: 'comment' | 'preview';
  repo: string;
  pageURL: string;
  comment?: { id: string; url: string; parentId: string | null };
  draft?: string;
}
/** Trusted deployment code prepares safe commenter content without browser APIs. */
export type ContentPreparer = (input: ContentInputData, signal?: AbortSignal) => PreparedContent | Promise<PreparedContent>;
export interface ContentPreview { html?: string; prepared?: PreparedContent }
