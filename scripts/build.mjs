import { build } from 'esbuild';
import {buildStyles} from './build-styles.mjs';
import postcss from 'postcss';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await rm('public/chunks',{recursive:true,force:true});
await rm('dist/browser',{recursive:true,force:true});
await rm('dist/types',{recursive:true,force:true});
await mkdir('dist', { recursive: true });
await buildStyles();
const worker = await build({ entryPoints: ['src/worker/entry.ts'], outfile: 'dist/worker.mjs', bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers'], minify: true, legalComments: 'eof', metafile: true });
await build({entryPoints:['src/browser/client.ts'],outfile:'public/client.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
const browser = await build({entryPoints:['widget','native','headless','auth-window','auth-complete','setup'].map(name=>'src/browser/'+name+'.ts'),outdir:'public',chunkNames:'chunks/[name]-[hash]',bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true});
if(Object.keys(browser.metafile.inputs).some(p=>/node_modules\/(hono|valibot)/.test(p)))throw new Error('Browser graph includes server libraries.');
await writeFile('dist/browser-metafile.json',JSON.stringify(browser.metafile,null,2)+'\n');
const sizes = {};
for (const name of ['dist/worker.mjs', 'public/client.js', 'public/widget.js', 'public/auth-window.js', 'public/auth-complete.js', 'public/setup.js', 'public/widget.css', 'public/embed.css']) {
  const buffer = await readFile(name); sizes[name] = { bytes: buffer.length, gzip: gzipSync(buffer).length, sha256: createHash('sha256').update(buffer).digest('hex') };
}
if (sizes['dist/worker.mjs'].gzip > 3 * 1024 * 1024) throw new Error('The Worker exceeds the 3 MiB gzip budget.');
const outputs=browser.metafile.outputs;
const graph=(entry, dynamic=false,seen=new Set())=>{
 if(seen.has(entry)||!outputs[entry])return seen;seen.add(entry);
 for(const dep of outputs[entry].imports)if(!dep.external&&(dynamic||dep.kind!=='dynamic-import'))graph(dep.path,dynamic,seen);
 return seen;
};
if([...graph('public/headless.js',true)].some(path=>Object.keys(outputs[path].inputs).some(input=>(input.endsWith('/widget.ts')||input.includes('/standard/')))))throw new Error('Headless entry must not import the default presentation.');
sizes.browserGraphs={};
for(const entry of ['public/widget.js','public/native.js']){
 const summarize=async files=>{let bytes=0,gzip=0;for(const name of files){const data=await readFile(name);bytes+=data.length;gzip+=gzipSync(data).length;}return {files:[...files],bytes,gzip};};
 sizes.browserGraphs[entry]={initial:await summarize(graph(entry)),includingLazy:await summarize(graph(entry,true))};
}
await writeFile('dist/sizes.json', JSON.stringify(sizes, null, 2) + '\n');
await writeFile('dist/worker-metafile.json', JSON.stringify(worker.metafile, null, 2) + '\n');
console.log(JSON.stringify({ build: 'passed', sizes }, null, 2));

// Keep the native presentation reset inside the comments host.
const sheet = postcss.parse(await readFile('public/widget.css', 'utf8'));
sheet.walkRules(rule => {
  if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
  rule.selectors = rule.selectors.filter(selector => selector.trim()).map(selector => {
    const scoped = selector.replace(/(^|[ ,])(:root|html|body|:host)(?=[ ,.:#\[]|$)/g, '$1.giscusflare').replace(/\.giscusflare\s+\.giscusflare/g, '.giscusflare');
    return scoped.includes('.giscusflare') ? scoped : '.giscusflare ' + scoped;
  });
});
await mkdir('public/themes', {recursive:true});
let nativeThemes='';
for(const name of (await readdir('vendor/giscus/themes')).filter(n=>n.endsWith('.css'))){
  const source=postcss.parse(await readFile('vendor/giscus/themes/'+name,'utf8'));
  source.walkAtRules(/keyframes$/, rule=>{
    const original=rule.params, scoped='giscusflare-'+name.slice(0,-4)+'-'+original;
    rule.params=scoped;
    source.walkDecls(/animation(?:-name)?$/, declaration=>{declaration.value=declaration.value.replace(new RegExp('\\b'+original+'\\b','g'),scoped);});
  });
  source.walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;rule.selectors=rule.selectors.map(s=>`.giscusflare[data-theme="${name.slice(0,-4)}"]`+(/^(main|html|body|:root|:host)(?=$|[\s.:#\[])/.test(s)?s.replace(/^(main|html|body|:root|:host)/,''):' '+s));});
  const iframe = source.clone();
  iframe.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map(selector => selector.replace(/^\.giscusflare\[data-theme="[^"\]]+"\]/, ':root'));
  });
  await writeFile('public/themes/'+name,iframe.toString());
  nativeThemes+=source.toString()+'\n';
}
await writeFile('public/native.css', sheet.toString()+'\n'+nativeThemes);
await build({entryPoints:['src/browser/native.ts','src/browser/headless.ts','src/browser/interactions.ts','src/browser/content.ts'],outdir:'dist/browser',bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof'});
await import('./build-assets.mjs');
