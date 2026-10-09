import * as v from 'valibot';
import { bodyBytes } from '../domain/body.js';
import { LRU } from '../domain/lru.js';
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
  const artifacts = new LRU<{result:{prepared:PreparedContent};bytes:number}>(8 * 1024 * 1024, 256);
  const prepare = async (input: ContentInputData, signal: AbortSignal) => {
    signal.throwIfAborted();
    const key = JSON.stringify(input), cached = artifacts.get(key);
    if (cached) return cached;
    const content = await options.prepare(input, signal);
    signal.throwIfAborted();
    if (!content || typeof content.html !== 'string' || content.html.length > 2_000_000) throw new Error('Content output exceeds the rendering limit.');
    const result = {prepared:{...content,revision:options.revision}};
    const output = {result,bytes:new TextEncoder().encode(JSON.stringify(result)).byteLength};
    if (output.bytes <= 2_000_000) artifacts.set(key,output,output.bytes + new TextEncoder().encode(key).byteLength);
    return output;
  };
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // The public gateway already applies streaming limits; enforce them for direct binding callers too.
      let inputs: ContentInputData[];const tooLarge=new Error('Content input too large');
      try {
        const all=await bodyBytes(request.body,4 * 1024 * 1024,new Error('Missing content input'),tooLarge);
        inputs = v.parse(ContentBatch, JSON.parse(new TextDecoder().decode(all))).inputs;
      } catch(cause) { return new Response(cause===tooLarge?'Content input too large':'Invalid content input', { status:cause===tooLarge?413:400 }); }
      const results: ContentBatchResult['results'] = new Array(inputs.length);
      // Bounded parallel execution; one failed body does not discard another body's output.
      let position = 0, outputBytes = 0;
      await Promise.all(Array.from({ length: Math.min(4, inputs.length) }, async () => {
        for (;;) {
          const index = position++; if (index >= inputs.length) return;
          try {
            const output = await prepare(inputs[index]!, request.signal);
            if (outputBytes + output.bytes > 8 * 1024 * 1024) throw new Error('Content batch output limit exceeded.');
            outputBytes += output.bytes; results[index] = output.result;
          }
          catch { results[index] = { error: 'Content could not be prepared. Retry this body.' }; }
        }
      }));
      return Response.json({ results });
    },
  };
}
