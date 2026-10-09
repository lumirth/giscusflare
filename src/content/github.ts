import { parseFragment, type DefaultTreeAdapterMap as Tree } from 'parse5';
import type { ContentInputData, PreparedContent } from '../contracts/content.js';
import { allowed, discard, richClasses, safeURL } from './github-policy.js';
export interface CodeContent {
  source: string;
  language: string;
  origin: 'fence' | 'github-file';
  file?: { url: string; path?: string; repository?: string; lineStart?: number; lineEnd?: number };
}
export interface MathContent { source: string; display: boolean }
export type ContentFeature = {key:string;kind:'code';input:CodeContent} | {key:string;kind:'math';input:MathContent};
export interface GitHubInterpretation {
  code?: 'default' | 'source' | 'custom';
  math?: 'default' | 'source' | 'custom';
  mathFailed?: string;
}
const escape = (value:string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const attribute = (node:Tree['element'],name:string) => node.attrs.find(attr=>attr.name===name)?.value || '';
const classes = (node:Tree['element']) => attribute(node,'class').split(/\s+/);
const text = (node:Tree['node']):string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
function descendants(node:Tree['element']):Tree['element'][] {
  return node.childNodes.flatMap(child => 'tagName' in child ? [child,...descendants(child)] : []);
}
function fileInput(node:Tree['element']):CodeContent {
  const nodes=descendants(node),rows=nodes.filter(node=>classes(node).includes('blob-code'));
  const header=nodes.find(node=>classes(node).includes('Box-header'));
  const links=header?descendants(header).filter(node=>node.tagName==='a'&&attribute(node,'href')):[];
  const anchor=links.find(node=>/\/(?:blob|raw)\//.test(attribute(node,'href')))||links[0];
  const url=anchor?safeURL(attribute(anchor,'href')):'',path=anchor?text(anchor).trim():'';
  const lines=nodes.filter(node=>classes(node).includes('blob-num')).map(node=>Number(attribute(node,'data-line-number'))).filter(value=>Number.isSafeInteger(value)&&value>0);
  let repository:string|undefined;try{const parsed=new URL(url);if(parsed.hostname==='github.com')repository=parsed.pathname.split('/').slice(1,3).join('/');}catch{/* Source links may be absent. */}
  return {source:rows.map(text).join('\n'),language:nodes.map(node=>attribute(node,'data-language')).find(Boolean)||'text',origin:'github-file',
    file:{url,...(path?{path}:{}),...(repository?{repository}:{}),...(lines.length?{lineStart:lines[0],lineEnd:lines.at(-1)}:{})}};
}
/** One provider interpretation owns safe markup and feature source semantics for every output. */
export async function interpretGitHubContent(input:ContentInputData, mode:GitHubInterpretation={}):Promise<{prepared:PreparedContent;features:ContentFeature[]}> {
  if(input.html===undefined)throw new Error('GitHub interpretation was not acquired.');
  const renderMath=mode.math!=='source'&&mode.math!=='custom'&&/<math-renderer\b/i.test(input.html)?(await import('./math.js')).renderMathML:undefined;
  const fragment=parseFragment(input.html),prefix='gw-md-'+crypto.randomUUID()+'-',ids=new Set<string>(),features:ContentFeature[]=[];let visited=0;
  const feature=(kind:'code'|'math',source:CodeContent|MathContent,fallback:string):string=> {
    const key=String(features.length);features.push(kind==='code'?{key,kind,input:source as CodeContent}:{key,kind,input:source as MathContent});
    return '<span class="giscus-content-feature" data-gw-feature="'+key+'">'+fallback+'</span>';
  };
  const copy=(node:Tree['node'],depth:number):string=> {
    if(++visited>20000||depth>100)throw new Error('Content exceeds the structural rendering limit.');
    if('value' in node)return escape(node.value);
    if(!('tagName' in node)||node.namespaceURI!=='http://www.w3.org/1999/xhtml')return '';
    const tag=node.tagName,css=classes(node);
    if(mode.code==='custom'&&(css.includes('Box')&&descendants(node).some(child=>classes(child).includes('blob-wrapper'))||css.includes('blob-wrapper'))) {
      const source=fileInput(node);return feature('code',source,'<pre><code>'+escape(source.source)+'</code></pre>');
    }
    if(tag==='math-renderer') {
      const display=!css.includes('js-inline-math'),raw=text(node).trim().slice(0,10001),delimiter=raw.startsWith('$$')&&raw.endsWith('$$')?'$$':raw.startsWith('$')&&raw.endsWith('$')?'$':'';
      const source=delimiter?raw.slice(delimiter.length,-delimiter.length).trim():raw;
      if(mode.math==='custom')return feature('math',{source,display},'<code>'+escape(source)+'</code>');
      let result:string,error=false;
      if(mode.math==='source')result=escape(source);
      else try{result=renderMath!(source,display);}catch{error=true;result='<span class="math-render-message">'+escape(mode.mathFailed||'Unable to render expression.')+'</span><code class="math-render-source">'+escape(raw)+'</code>';}
      return '<span class="giscus-math'+(error?' math-render-error':'')+'" data-display="'+(display?'block':'inline')+'">'+result+'</span>';
    }
    if(discard.has(tag)||tag==='input'&&attribute(node,'type')!=='checkbox')return '';
    const children=()=>node.childNodes.map(child=>copy(child,depth+1)).join('');
    if(!allowed.has(tag))return children();
    if(tag==='pre'&&mode.code==='custom') {
      const code=node.childNodes.find(child=>'tagName' in child&&child.tagName==='code'),parent=node.parentNode;
      const language=[node,...(code&&'tagName' in code?[code]:[]),...(parent&&'tagName' in parent?[parent]:[])].flatMap(classes).map(value=>value.match(/^(?:language-|highlight-source-)([a-z0-9-]+)$/)?.[1]).find(Boolean)||'text';
      const source:CodeContent={source:text(node),language,origin:'fence'};
      return feature('code',source,'<pre><code>'+escape(source.source)+'</code></pre>');
    }
    const attrs:string[]=[];const add=(name:string,value:string)=>attrs.push(' '+name+'="'+escape(value)+'"');
    const title=attribute(node,'title');if(title)add('title',title.slice(0,1000));
    const id=attribute(node,'id');if(id&&!ids.has(id)){ids.add(id);add('id',prefix+id);}
    const keep=css.filter(c=>richClasses.has(c)||/^(?:pl-[a-z0-9-]+|language-[a-z0-9-]+|highlight|task-list-item|task-list-item-checkbox|contains-task-list)$/.test(c));if(keep.length)add('class',keep.join(' '));
    if(css.includes('blob-num')&&/^\d{1,8}$/.test(attribute(node,'data-line-number')))add('data-line-number',attribute(node,'data-line-number'));
    if(tag==='table'&&/^[1-8]$/.test(attribute(node,'data-tab-size')))add('style','tab-size: '+attribute(node,'data-tab-size')+';');
    if(tag==='a') {
      const raw=attribute(node,'href');
      if(raw.startsWith('#')){let anchor=raw.slice(1);try{anchor=decodeURIComponent(anchor);}catch{/* Retain invalid escapes. */}add('href','#'+prefix+encodeURIComponent(anchor));}
      else {const href=safeURL(raw);if(href){add('href',href);add('target','_blank');add('rel','ugc nofollow noopener noreferrer');add('referrerpolicy','no-referrer');}}
    }
    if(tag==='img') {const src=safeURL(attribute(node,'src'));if(!src.startsWith('https://'))return '';add('src',src);add('alt',attribute(node,'alt').slice(0,2000));add('loading','lazy');add('decoding','async');add('referrerpolicy','no-referrer');}
    if(tag==='input'){add('type','checkbox');attrs.push(' disabled');if(node.attrs.some(a=>a.name==='checked'))attrs.push(' checked');}
    if(tag==='td'||tag==='th')for(const name of ['colspan','rowspan']){const n=Number(attribute(node,name));if(Number.isSafeInteger(n)&&n>0&&n<=100)add(name,String(n));}
    if(tag==='ol'&&node.attrs.some(a=>a.name==='start')){const n=Number(attribute(node,'start'));if(Number.isSafeInteger(n)&&Math.abs(n)<=100000)add('start',String(n));}
    const html='<'+tag+attrs.join('')+'>'+(['br','hr','img','input'].includes(tag)?'':children()+'</'+tag+'>');
    return tag==='pre'&&mode.code!=='source'?'<div class="code-block">'+html+'</div>':html;
  };
  return {prepared:{html:'<div class="markdown">'+fragment.childNodes.map(node=>copy(node,0)).join('')+'</div>',revision:'github-stock-v1',anchorPrefixes:['gw-md-']},features};
}
