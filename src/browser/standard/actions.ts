import { html, nothing } from 'lit-html';
import { bindDismissableMenu, type Comment, type Discussion } from '../headless.js';
import { strings } from '../i18n.js';
import { icon } from "./icon.js";
import { confirmAction } from './dialog.js';
import type { StandardContext } from './contracts.js';
import { resource } from './resource.js';
export function actions({runtime,report,scope}:StandardContext, host:HTMLElement, item:Comment|Discussion) {
  let element: HTMLDetailsElement, signal: AbortSignal;
  const act=(work:()=>Promise<unknown>|void)=>async()=>{
    if (signal.aborted) return;
    element.open=false;try{await work();}catch(error){if(!signal.aborted)report(error);}
  };
  const t=strings(runtime.appearance.lang),discussion='locked' in item, capability=runtime.actions(item.id);
  const actionable=(state:typeof capability.edit)=>state.status==='available';
    const hide=async()=>{
      if(discussion)return;
      if(item.isMinimized){await runtime.moderateComment(item.id,false);return;}
      const reason=await confirmAction(host,t.hide,{confirm:t.hide,cancel:t.cancel},signal,{label:t.reason,choices:[
        ['OFF_TOPIC',t.reasonOffTopic],['ABUSE',t.reasonAbuse],['DUPLICATE',t.reasonDuplicate],['OUTDATED',t.reasonOutdated],['RESOLVED',t.reasonResolved],['SPAM',t.reasonSpam],
      ].map(([value,label])=>({value:value!,label:label!}))});
      if(reason!==null&&!signal.aborted)await runtime.moderateComment(item.id,true,reason as 'OFF_TOPIC');
    };
    return html`<details class="gsc-actions" ${resource(scope, (node, lifetime, fresh) => { element = node as HTMLDetailsElement;signal = lifetime;if (fresh) bindDismissableMenu(element, signal); })}><summary aria-label=${discussion?t.discussionActions:t.actions} title=${discussion?t.discussionActions:t.actions}>${icon('kebab-horizontal')}</summary>
      <div class="gsc-action-menu color-bg-overlay color-border-primary">
        <a href=${item.url} target="_blank" rel="noopener noreferrer">${t.onGitHub}</a>
        ${!discussion&&actionable(capability.edit)?html`<button type="button" @click=${act(()=>runtime.interactions.focus(runtime.writing({kind:'edit',id:item.id}).show().id))}>${t.edit}</button>`:nothing}
        ${!discussion&&actionable(capability.remove)?html`<button type="button" class="color-text-danger" @click=${act(async()=>{
          if(await confirmAction(host,t.deleteConfirm,{confirm:t.remove,cancel:t.cancel},signal)!==null&&!signal.aborted)await runtime.removeComment(item.id);
        })}>${t.remove}</button>`:nothing}
        ${!discussion&&actionable(capability.moderate)?html`<button type="button" @click=${act(hide)}>${item.isMinimized?t.unhide:t.hide}</button>`:nothing}
        ${capability.recover.status !== 'unavailable' ? html`<button type="button" @click=${act(()=>runtime.retryAction(item.id))}>${t.retry}</button>${capability.abandon.status === 'available' ? html`<button type="button" @click=${() => { if (window.confirm('This action may already be saved on GitHub. Stop trying to recover its outcome?')) runtime.abandonAction(item.id); }}>${t.cancel}</button>` : nothing}` : nothing}
        <a href=${'https://github.com/contact/report-abuse?report='+encodeURIComponent(item.url)} target="_blank" rel="noopener noreferrer">${t.reportOnGitHub}</a>
      </div></details>`;
}
