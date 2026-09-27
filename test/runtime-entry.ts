/** workerd tests with simulated GitHub responses. */
import { DurableObject } from 'cloudflare:workers';
import { serializeRead, readResponse } from '../src/worker/read-response.js';
import { configuration } from '../src/contracts/config.js';
import { hash } from '../src/domain/crypto.js';
import { app } from '../src/worker/app.js';
import { repositoryClass } from '../src/worker/repository.js';
import { FakeGitHub } from './github-fixture.mjs';

const github = new FakeGitHub({ seed: true });
export class Repository extends repositoryClass(request => github.fetch(request)) {}
export class Probe extends DurableObject {
  serializedRead() { return serializeRead(new Response('hello🌿'.repeat(32768), { status: 202, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Giscusflare-Expires': '2000000000000', 'Cache-Control': 'public, max-age=60' } })); }
  increment(): number {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, counter INTEGER NOT NULL)');
    sql.exec('INSERT INTO probe(id,counter) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET counter=counter+1');
    return [...sql.exec('SELECT counter FROM probe WHERE id=1')][0].counter as number;
  }
}
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__test/widget-cache') {
      const key=new URL('/widget?'+url.searchParams.toString(),url);
      key.searchParams.set('policy',await hash(JSON.stringify(configuration(env))));
      const cached=await caches.default.match(new Request(key));
      let immutable=false;
      if(cached){try{cached.headers.set('X-Test','probe');}catch{immutable=true;}}
      return Response.json({hit:Boolean(cached),immutable});
    }
    if (url.pathname === '/__test/serialized-read') {
      const stub = env.PROBE.get(env.PROBE.idFromName('serialized-read'));
      return readResponse(await stub.serializedRead());
    }
    if (url.pathname === '/__test/probe') {
      const stub = env.PROBE.get(env.PROBE.idFromName('persistent-probe'));
      return Response.json({ counter: await stub.increment() });
    }
    if (url.pathname === '/__test/native-limit') {
      const result = await env.TEST_LIMITER.limit({ key: url.searchParams.get('key') || 'probe' });
      return Response.json(result);
    }
    return app.fetch(request, env, ctx);
  }
};
