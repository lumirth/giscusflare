/** Consume a bounded body before decoding, including bodies without a length header. */
export async function bodyBytes(body: ReadableStream<Uint8Array> | null, maximum: number, empty: Error, oversized: Error): Promise<Uint8Array> {
  const reader = body?.getReader();
  if (!reader) throw empty;
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maximum) throw oversized;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
