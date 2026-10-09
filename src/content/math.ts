import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import { STATE } from 'mathjax-full/js/core/MathItem.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
RegisterHTMLHandler(liteAdaptor());
/** Isolated macro scope per expression; no dynamic TeX package/network loading. */
export function renderMathML(source: string, display: boolean): string {
  if(source.length>10000)throw new Error('Math expression exceeds the rendering limit.');
  const input=new TeX({packages:AllPackages.filter(name=>!['require','autoload','html'].includes(name)),maxBuffer:10000,maxMacros:1000});
  const doc=mathjax.document('',{InputJax:input,OutputJax:new SVG({fontCache:'none'})});
  const node=doc.convert(source,{display,end:STATE.CONVERT});
  const serialized=new SerializedMmlVisitor().visitTree(node);
  // MathJax represents parse failures as merror nodes instead of throwing.
  if (serialized.includes('<merror')) throw new Error('Invalid math expression.');
  // This is generated MathML, never raw commenter HTML; navigation and application styles are excluded.
  return serialized.replace(/\s(?:href|xlink:href|style|id|class)="[^"]*"/g, '')
    .replace(/<annotation-xml\b[^>]*>[\s\S]*?<\/annotation-xml>/g, '');
}
