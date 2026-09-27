import { html, render, nothing } from 'lit-html';
import { bindDismissableMenu, type Comment, type Discussion } from '../headless.js';
import { strings } from '../i18n.js';
import { icon } from '../icons.js';
import { requestFields } from './dialog.js';
import type { Part, StandardContext } from './contracts.js';
export function createActions({runtime,report}:StandardContext,host:HTMLElement):Part<Comment|Discussion>{
  const element=document.createElement('details');element.className='gsc-actions';
  const stop=bindDismissableMenu(element);
  const act=(work:()=>Promise<unknown>|void)=>async()=>{
    element.open=false;try{await work();}catch(error){report(error);}
  };
  return {element,update(item){
    const t=strings(runtime.appearance.lang),discussion='commentCount' in item;
    const hide=async()=>{
      if(discussion)return;
      if(item.isMinimized){await runtime.moderateComment(item.id,false);return;}
      const fields=await requestFields(host,t.hide,[{kind:'select',name:'reason',label:t.reason,value:'OFF_TOPIC',options:[
        ['OFF_TOPIC',t.reasonOffTopic],['ABUSE',t.reasonAbuse],['DUPLICATE',t.reasonDuplicate],['OUTDATED',t.reasonOutdated],['RESOLVED',t.reasonResolved],['SPAM',t.reasonSpam],
      ].map(([value,label])=>({value:value!,label:label!}))}],{confirm:t.hide,cancel:t.cancel});
      if(fields)await runtime.moderateComment(item.id,true,fields.reason as 'OFF_TOPIC');
    };
    render(html`<summary aria-label=${discussion?t.discussionActions:t.actions} title=${discussion?t.discussionActions:t.actions}>${icon('kebab-horizontal')}</summary>
      <div class="gsc-action-menu color-bg-overlay color-border-primary">
        <a href=${item.url} target="_blank" rel="noopener noreferrer">${t.onGitHub}</a>
        ${runtime.signedIn&&!discussion&&item.viewerCanUpdate?html`<button type="button" @click=${act(()=>runtime.interactions.focus(runtime.beginEdit(item)))}>${t.edit}</button>`:nothing}
        ${runtime.signedIn&&!discussion&&item.viewerCanDelete?html`<button type="button" class="color-text-danger" @click=${act(async()=>{
          if(await requestFields(host,t.deleteConfirm,[],{confirm:t.remove,cancel:t.cancel}))await runtime.removeComment(item.id);
        })}>${t.remove}</button>`:nothing}
        ${runtime.signedIn&&!discussion&&(item.viewerCanMinimize||item.viewerCanUnminimize)?html`<button type="button" @click=${act(hide)}>${item.isMinimized?t.unhide:t.hide}</button>`:nothing}
        <a href=${'https://github.com/contact/report-abuse?report='+encodeURIComponent(item.url)} target="_blank" rel="noopener noreferrer">${t.reportOnGitHub}</a>
      </div>`,element);
  },dispose(){stop();render(nothing,element);}};
}
