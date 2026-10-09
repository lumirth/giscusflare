import * as v from 'valibot';
import { ContentBatch, type ContentInputData, type ContentPreparer, type PreparedContent, type ContentBatchResult } from '../contracts/content.js';
export type { ContentInputData, ContentPreparer, PreparedContent } from '../contracts/content.js';
export interface ContentWorkerOptions {
  /** Change whenever interpretation, trust policy or required resources change. */
  revision: string;
  prepare: ContentPreparer;
}
/** Isolated interpretation without repository coordination or commenter credentials. */
export function createContentWorker(options: ContentWorkerOptions) {
  // Only completed immutable values cross requests: no I/O promises or request signals.
  const artifacts = new Map<string, { content: PreparedContent; bytes: number }>();
  let bytes = 0;
  const prepare = async (input: ContentInputData, signal: AbortSignal): Promise<PreparedContent> => {
    signal.throwIfAborted();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([options.revision, input])));
    const key = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const cached = artifacts.get(key);
    if (cached) { artifacts.delete(key); artifacts.set(key, cached); return cached.content; }
    const content = await options.prepare(input, signal);
    signal.throwIfAborted();
    if (!content || typeof content.html !== 'string' || content.html.length > 2_000_000) throw new Error('Content output exceeds the rendering limit.');
    const output = { ...content, revision: options.revision };
    const size = new TextEncoder().encode(JSON.stringify(output)).byteLength;
    if (size <= 2_000_000) {
      while (artifacts.size && (artifacts.size >= 256 || bytes + size > 8 * 1024 * 1024)) {
        const oldest = artifacts.keys().next().value!; bytes -= artifacts.get(oldest)!.bytes; artifacts.delete(oldest);
      }
      const previous = artifacts.get(key); if (previous) bytes -= previous.bytes;
      artifacts.set(key, { content: output, bytes: size }); bytes += size;
    }
    return output;
  };
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // The public gateway already applies streaming limits; enforce them for direct binding callers too.
      const reader = request.body?.getReader();
      if (!reader) return new Response('Missing content input', { status: 400 });
      const parts: Uint8Array[] = []; let length = 0;
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength;
        if (length > 4 * 1024 * 1024) { await reader.cancel(); return new Response('Content input too large', { status: 413 }); }
        parts.push(next.value);
      }
      let inputs: ContentInputData[];
      try {
        const all = new Uint8Array(length); let offset = 0;
        for (const part of parts) { all.set(part, offset); offset += part.byteLength; }
        inputs = v.parse(ContentBatch, JSON.parse(new TextDecoder().decode(all))).inputs;
      } catch { return new Response('Invalid content input', { status: 400 }); }
      const results: ContentBatchResult['results'] = new Array(inputs.length);
      // Bounded parallel execution; one failed body does not discard another body's output.
      let position = 0, outputBytes = 0;
      await Promise.all(Array.from({ length: Math.min(4, inputs.length) }, async () => {
        for (;;) {
          const index = position++; if (index >= inputs.length) return;
          try {
            const prepared = await prepare(inputs[index]!, request.signal);
            const result = { prepared };
            const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
            if (outputBytes + size > 8 * 1024 * 1024) throw new Error('Content batch output limit exceeded.');
            outputBytes += size; results[index] = result;
          }
          catch { results[index] = { error: 'Content could not be prepared. Retry this body.' }; }
        }
      }));
      return Response.json({ results });
    },
  };
}
