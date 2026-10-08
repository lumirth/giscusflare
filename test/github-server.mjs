import { createServer } from 'node:http';
import { FakeGitHub } from './github-fixture.mjs';

/** External effects outlive workerd restarts, as GitHub effects do. */
export async function githubServer(options = {}) {
  const upstream = new FakeGitHub(options);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const headers = new Headers(incoming.headers);
      const url = headers.get('X-Fixture-GitHub-URL');
      headers.delete('X-Fixture-GitHub-URL');
      const request = new Request(url, { method: incoming.method, headers, redirect: 'manual', ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await upstream.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      // A committed effect followed by a lost response must remain a transport failure.
      if (error instanceof TypeError && error.message === 'lost response after commit') incoming.socket.destroy();
      else { outgoing.writeHead(500); outgoing.end(String(error)); }
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { upstream, origin: 'http://127.0.0.1:' + server.address().port, dispose: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
