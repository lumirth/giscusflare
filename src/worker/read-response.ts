import type { SerializedRead } from '../contracts/rpc.js';

/** Transfer completed text across RPC; Response body streams can be cancelled
 * before the outer Worker finishes sending them (workerd issue #7277). */
export async function serializeRead(response: Response): Promise<SerializedRead> {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}

/** The object already serialized JSON. Reconstruct HTTP without parsing it. */
export function readResponse(value: SerializedRead): Response {
  return new Response(value.body, { status: value.status, headers: value.headers });
}
