import { ConversationController } from '../conversation/controller.js';
import type { Widget } from '../contracts/requests.js';
import { BrowserSession, type SessionHost, type Login } from './session.js';
import { markdown } from './markdown.js';

export interface ConversationOptions {
  service: string;
  config: Widget;
  order?: 'oldest' | 'newest';
  /** Supplied by iframe hosts. Native embedding uses first-party browser storage. */
  host?: SessionHost;
  renderContent?: typeof markdown;
}
export interface ConversationRuntime {
  config: Widget;
  controller: ConversationController;
  session: BrowserSession;
  renderContent: typeof markdown;
  initialize(data: Record<string, unknown>): void;
  saveDrafts(): void;
  dispose(): void;
}
export function createConversation(options: ConversationOptions): ConversationRuntime {
  const {config,service}=options;
  const prefix=`giscusflare:1:${service}:${config.repo}:`;
  const draftKey='draft:'+JSON.stringify([config.categoryId||config.category,config.strict,config.number,config.term]);
  const memory=new Map<string,unknown>();
  function read(key:string,persistent=false):unknown {
    try {return JSON.parse((persistent?localStorage:sessionStorage).getItem(prefix+key)||'null');}catch{return memory.get(key)||null;}
  }
  function write(key:string,value:unknown,persistent=false):boolean {
    memory.set(key,value);
    try { const store=persistent?localStorage:sessionStorage;value===null?store.removeItem(prefix+key):store.setItem(prefix+key,JSON.stringify(value));return true;}catch{return false;}
  }
  const nativeHost:SessionHost={
    emit(value){
      if(typeof value.session==='string')write('session',value.session,true);
      if(value.signOut)write('session',null,true);
      if(value.pending&&typeof value.pending==='object') {const login=value.pending as Login;write('pending:'+login.challenge,{...login,fragment:location.hash});}
      if(typeof value.clearPending==='string')write('pending:'+value.clearPending,null);
      if(typeof value.draftState==='string')write(draftKey,value.draftState);
    },
    navigate(url){
      const target=new URL(url),proof=target.searchParams.get('challenge');
      if(target.origin!==service||target.pathname!=='/auth/window'||!proof)throw new Error('Invalid sign-in destination.');
      // Full-page return requires the verifier to survive navigation.
      if(!sessionStorage.getItem(prefix+'pending:'+proof))throw new Error('Allow popups to sign in when browser storage is unavailable.');
      location.assign(url);
    }
  };
  const host=options.host||nativeHost;
  const session=new BrowserSession(service,config,host);
  const controller=new ConversationController(config,session,options.order);
  let revision=session.revision;
  const unsubscribe=session.subscribe(()=>{
    if(session.revision!==revision){revision=session.revision;void controller.refresh();}
  });
  const saveDrafts=()=>{const state=controller.serializeDrafts();if(state.length<=240000)host.emit({draft:controller.draft(),draftState:state});};
  const unsubscribeDrafts=controller.subscribe(saveDrafts);
  const storage=(event:StorageEvent)=>{if(!options.host&&event.key===prefix+'session'){const token=read('session',true);session.setSession(typeof token==='string'?token:'');}};
  if(!options.host)window.addEventListener('storage',storage);
  const runtime:ConversationRuntime={config,controller,session,renderContent:options.renderContent||markdown,saveDrafts,
    initialize(data){
      if(typeof data.draftState==='string')controller.restoreDrafts(data.draftState);
      else if(typeof data.draft==='string')controller.setDraft('main',data.draft.slice(0,60000));
      if(typeof data.session==='string')session.setSession(data.session);
      if(data.handoff&&typeof data.handoff==='object'){
        const h=data.handoff as Record<string,unknown>;
        if(['ticket','verifier','attempt','challenge'].every(k=>typeof h[k]==='string'&&/^[A-Za-z0-9_-]{43}$/.test(h[k] as string))){void session.finish(h.ticket as string,{verifier:h.verifier as string,attempt:h.attempt as string,challenge:h.challenge as string,created:Date.now()});return;}
      }
      if(!controller.state.loading)void controller.refresh();
    },
    dispose(){unsubscribe();unsubscribeDrafts();window.removeEventListener('storage',storage);controller.dispose();session.dispose();}
  };
  if(!options.host){
    let handoff:Record<string,unknown>|undefined;
    if(location.hash.startsWith('#gw-auth='))try{
      const bytes=Uint8Array.from(atob(location.hash.slice(9).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const value=JSON.parse(new TextDecoder().decode(bytes));
      const pending=read('pending:'+value.challenge) as (Login&{fragment?:string})|null;
      if(value.repo===config.repo&&pending&&Date.now()-pending.created<600000){handoff={...value,verifier:pending.verifier};const url=new URL(location.href);url.hash=pending.fragment||'';history.replaceState(history.state,'',url);}
    }catch{/* Invalid return fragments do not grant a session. */}
    runtime.initialize({session:read('session',true),draftState:read(draftKey),handoff});
  }
  return runtime;
}
