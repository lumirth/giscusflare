import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';

test('native styles retain root-level theme fonts and theme-specific Mona animations',async()=>{
 const css=postcss.parse(await readFile('public/native.css','utf8'));
 const declaration=(selector,property)=>{let value;css.walkRules(rule=>{if(rule.selectors.includes(selector))rule.walkDecls(property,decl=>{value=decl.value;});});return value;};
 assert.equal(declaration('.giscusflare[data-theme="purple_dark"]','font-family'),'Inter, Helvetica, Arial, sans-serif');
 assert.equal(declaration('.giscusflare[data-theme="fro"]','--font-family-default'),'var(--font-family-serif)');
 for(const [theme,asset] of [['light','default'],['dark','dark'],['dark_dimmed','dimmed']]){
  assert.equal(declaration(`.giscusflare[data-theme="${theme}"] .gsc-loading-image`,'background-image'),`url("https://github.githubassets.com/images/mona-loading-${asset}.gif")`);
 }
});

test('native selector scoping does not turn an empty selector into container styling',async()=>{
 const css=postcss.parse(await readFile('public/native.css','utf8'));
 css.walkRules(rule=>{
  if(rule.selectors.includes('.giscusflare')){
   assert.equal(rule.nodes.some(n=>n.prop==='padding'&&n.value==='1rem'),false,'code-block padding must not apply to the native container');
   assert.equal(rule.nodes.some(n=>n.prop==='overflow'&&n.value==='auto'),false,'code-block overflow must not apply to the native container');
  }
 });
});
