/** Stateful GitHub responses for local tests. */
import { createHash } from 'node:crypto';
import { validateGitHubQuery } from './github-schema.mjs';
const AUTHOR = { login: 'reader', avatarUrl: 'https://avatars.githubusercontent.com/u/1', url: 'https://github.com/reader' };
const reactions = ['THUMBS_UP','THUMBS_DOWN','LAUGH','HOORAY','CONFUSED','HEART','ROCKET','EYES'];
const clone = value => JSON.parse(JSON.stringify(value));
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json', ...headers } });
const check = (ok, message) => { if (!ok) throw new Error('Fixture contract: ' + message); };
export function escape(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function render(text) { return '<p>' + escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>') + '</p>'; }
function connection(nodes, { first = 20, last = null, after = null, before = null } = {}) {
  let start = after ? Number(after.slice(2)) + 1 : 0, end = before ? Number(before.slice(2)) : nodes.length;
  if (last !== null) start = Math.max(start, end - last); else end = Math.min(end, start + first);
  const result = nodes.slice(start, end);
  return { totalCount: nodes.length, pageInfo: { hasNextPage: end < nodes.length, hasPreviousPage: start > 0, startCursor: result.length ? 'c:' + start : null, endCursor: result.length ? 'c:' + (end - 1) : null }, nodes: result };
}
async function sha256(value) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
export class FakeGitHub {
  constructor({seed = false, now = () => Date.now(), oauthUser = 'reader'} = {}) {
    this.oauthUser=oauthUser;
    this.principals=new Map(['reader','visitor','maintainer'].map(login=>[login,{id:'U_'+login,login}]));
    this.now=now; this.calls=[]; this.discussions=[]; this.nextComment=1; this.failNext=null; this.corruptNext=null; this.failAfterMutation=false; this.hideSearch=false; this.refreshes=0; this.installations=0;
    this.meta={id:'R_fixture',nameWithOwner:'example/comments',isPrivate:false,isArchived:false,discussionCategories:{nodes:[{id:'CAT_fixture',name:'Announcements',isAnswerable:false}]}};
    if(seed) {
      const d=this.addThread('article');
      const root=this.addComment(d,'Try posting a comment or replying here.',{author:'maintainer'});
      for(let i=0;i<7;i++)this.addComment(d,'Reply '+(i+1),{replyTo:root.id,author:i%2?'reader':'visitor'});
      this.addComment(d,'**Code**, tables, and task lists stay readable on small screens.',{html:'<p><strong>Code</strong>, tables, and task lists stay readable on small screens.</p><pre><code>export default {\n  fetch(request, env) {\n    return new Response("Hello");\n  }\n};</code></pre><table><tr><th>Layer</th><th>Implementation</th></tr><tr><td>HTTP</td><td>Hono</td></tr><tr><td>Contracts</td><td>Valibot</td></tr></table><ul><li><input type="checkbox" checked disabled> Shared conversation model</li></ul>'});
      for(let i=0;i<21;i++)this.addComment(d,'Conversation '+(i+1),{author:'visitor'});
      root.votes.THUMBS_UP=['visitor']; d.votes.THUMBS_UP=['visitor'];
    }
    this.fetch=this.fetch.bind(this);
  }
  profile(principal) {
    if(!this.principals.has(principal))this.principals.set(principal,{id:'U_'+principal,login:principal});
    const user=this.principals.get(principal);return {...AUTHOR,...user,url:'https://github.com/'+user.login};
  }
  setLogin(principal,login) { this.profile(principal);this.principals.get(principal).login=login; }
  addThread(title, options={}) {
    const number=this.discussions.length+1;
    const value={id:'D_'+number,number,title,body:title+'\n<!-- sha1: '+createHash('sha1').update(title).digest('hex')+' -->',bodyHTML:render(title),url:`https://github.com/example/comments/discussions/${number}`,locked:false,closed:false,answer:null,repository:{id:'R_fixture',nameWithOwner:'example/comments',isPrivate:false},category:{id:'CAT_fixture',name:'Announcements'},comments:[],votes:{},...options};
    this.discussions.push(value); return value;
  }
  addComment(d,body,{author='reader',replyTo=null,html=render(body)}={}) {
    const number=this.nextComment++;
    const c={id:btoa('DiscussionComment:'+String(number).padStart(6,'0')),body,bodyHTML:html,url:d.url+'#discussioncomment-'+number,createdAt:new Date(this.now()).toISOString(),lastEditedAt:null,author:this.profile(author),authorPrincipal:author,authorAssociation:author==='maintainer'?'OWNER':'NONE',isMinimized:false,minimizedReason:null,deletedAt:null,replyTo:replyTo?{id:replyTo}:null,replies:[],votes:{}};
    if(replyTo){const root=d.comments.find(c=>c.id===replyTo);check(root,'reply root');root.replies.push(c);}else d.comments.push(c);return c;
  }
  groups(node,user){return reactions.map(content=>({content,viewerHasReacted:Boolean(user&&node.votes[content]?.includes(user)),reactors:{totalCount:node.votes[content]?.length||0}}));}
  comment(c,user,root=false,replyPrefetch=5){const {replies,votes,authorPrincipal,...value}=c,own=Boolean(c.author&&authorPrincipal===user);const result={...clone(value),author:c.author?this.profile(authorPrincipal):null,isAnswer:Boolean(c.isAnswer),upvoteCount:c.upvoteCount||0,viewerDidAuthor:own,viewerCanUpdate:own,viewerCanDelete:own||user==='maintainer',viewerCanMinimize:user==='maintainer',viewerCanUnminimize:user==='maintainer',reactionGroups:this.groups(c,user)};if(root){const page=connection(replies,{last:replyPrefetch});result.replies={...page,nodes:page.nodes.map(r=>this.comment(r,user))};}return result;}
  discussion(d,user,paging){const {comments,votes,...value}=d;const result={...clone(value),repository:{...d.repository,isPrivate:d.repository.isPrivate||this.meta.isPrivate},reactionGroups:this.groups(d,user)};if(paging){const page=connection(comments,paging);result.comments={...page,nodes:page.nodes.map(c=>this.comment(c,user,true,paging.replyPrefetch))};}return result;}
  identity(d){return {id:d.id,number:d.number,repository:{...clone(d.repository),isPrivate:d.repository.isPrivate||this.meta.isPrivate},category:clone(d.category)};}
  locate(id){for(const d of this.discussions){if(d.id===id)return {d,node:d};for(const c of d.comments){if(c.id===id)return {d,node:c};const r=c.replies.find(r=>r.id===id);if(r)return {d,node:r};}}return null;}
  async fetch(request) {
    const url=new URL(request.url),token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    const payload=request.method==='POST'?await request.text():'';
    const user=token.startsWith('ghu_')?token.slice(4).replace(/_refreshed$/,''):'';
    check(request.redirect==='manual','manual redirect handling');check(request.headers.has('User-Agent'),'User-Agent');
    check(['https://api.github.com','https://github.com'].includes(url.origin),'only fixed upstream hosts');
    const call={path:url.pathname,method:request.method,token};this.calls.push(call);
    if(this.failNext){const fail=this.failNext;this.failNext=null;if(fail==='network')throw new TypeError('simulated disconnect');return response({message:'PRIVATE_UPSTREAM_DETAILS'},fail);}
    if(url.pathname==='/login/oauth/access_token'){
      const p=new URLSearchParams(payload);check(p.get('client_secret')==='fixture-client-secret','correct OAuth secret');
      if(p.get('grant_type')==='refresh_token'){this.refreshes++;check(p.get('refresh_token')?.startsWith('ghr_'),'refresh token');const principal=p.get('refresh_token').slice(4).replace(/_rotated$/,'');return response({access_token:'ghu_'+principal+'_refreshed',expires_in:28800,refresh_token:'ghr_'+principal+'_rotated',refresh_token_expires_in:15552000});}
      const code=p.get('code');if(code==='bad')return response({error:'bad_verification_code'});
      check(code?.startsWith('fixture_')&&await sha256(p.get('code_verifier')||'')===code.slice(8),'independent PKCE proof');
      return response({access_token:'ghu_'+this.oauthUser,expires_in:28800,refresh_token:'ghr_'+this.oauthUser,refresh_token_expires_in:15552000});
    }
    check(url.origin==='https://api.github.com','REST/GraphQL host');check(/^Bearer \S+$/.test(request.headers.get('Authorization')||''),'authorization');
    if(url.pathname==='/repos/'+this.meta.nameWithOwner+'/installation'){check(token.split('.').length===3,'app JWT');return response({id:123});}
    if(url.pathname==='/app/installations/123/access_tokens'){const b=JSON.parse(payload);check(b.repositories.join()===this.meta.nameWithOwner.split('/')[1]&&(b.permissions.discussions==='write'||b.permissions.metadata==='read'),'restricted app permission scope');this.installations++;return response({token:'ghs_fixture',expires_at:new Date(this.now()+3600000).toISOString(),repositories:[{node_id:this.meta.id,full_name:this.meta.nameWithOwner,private:this.meta.isPrivate}]});}
    if(url.pathname==='/user'){check(user,'user token');const profile=this.profile(user);return response({node_id:profile.id,login:profile.login,avatar_url:profile.avatarUrl,html_url:profile.url});}
    if(url.pathname==='/markdown'){check(user||token==='ghs_fixture','registered or reader interpretation');return new Response(render(JSON.parse(payload).text),{headers:{'Content-Type':'text/html'}});}
    check(url.pathname==='/graphql'&&request.method==='POST','known endpoint');
    const {query,variables:x}=JSON.parse(payload);
    validateGitHubQuery(query,x);
    const operation=/^(?:query|mutation) (\w+)/.exec(query)?.[1]||(x.discussion?'RankDiscovery':x.ids0?'RankObservation':undefined);call.operation=operation;call.variables=x;call.query=query;
    let data;
    switch(operation){
      case 'RankHead': {const d=this.discussions.find(d=>d.id===x.discussion),page=d?connection(d.comments,{last:1}):null;data={node:d?{...this.discussion(d,user),repository:{...this.identity(d).repository,isArchived:this.meta.isArchived},comments:{totalCount:page.totalCount,nodes:page.nodes.map(c=>({id:c.id}))}}:null};break;}
      case 'RankDiscovery': {
        const d=this.discussions.find(d=>d.id===x.discussion);
        const compact=c=>({id:c.id,createdAt:c.createdAt,isMinimized:c.isMinimized,
          ...(query.includes('reactionGroups')?{reactionGroups:this.groups(c,user)}:{}),
          ...(query.includes('replies{')||query.includes('replies(first:')?{replies:{totalCount:c.replies.length}}:{}),
          ...(query.includes('upvoteCount')?{upvoteCount:c.upvoteCount||0}:{}),
          ...(query.includes('isAnswer')?{isAnswer:Boolean(c.isAnswer)}:{})});
        const page=d?connection(d.comments,{last:100,before:x.cursor}):null;data={node:d?{...this.identity(d),comments:{...page,nodes:page.nodes.map(compact)}}:null};break;
      }
      case 'RankObservation': {
        data={};
        for(const [key,ids] of Object.entries(x).filter(([key])=>/^ids[0-9]+$/.test(key)))data['batch'+key.slice(3)]=ids.map(id=>{
          const t=this.locate(id);if(!t||t.node===t.d)return null;
          return {id:t.node.id,createdAt:t.node.createdAt,isMinimized:t.node.isMinimized,replyTo:t.node.replyTo,discussion:this.identity(t.d),
            ...(query.includes('reactionGroups')?{reactionGroups:this.groups(t.node,user)}:{}),
            ...(query.includes('replies{')||query.includes('replies(first:')?{replies:{totalCount:t.node.replies.length}}:{}),
            ...(query.includes('upvoteCount')?{upvoteCount:t.node.upvoteCount||0}:{}),
            ...(query.includes('isAnswer')?{isAnswer:Boolean(t.node.isAnswer)}:{})};
        });break;
      }
      case 'RepositoryHead':
      case 'Repository': check(x.owner+'/'+x.name===this.meta.nameWithOwner,'scoped metadata');data={...(x.signedIn?{viewer:this.profile(user)}:{}),repository:clone(this.meta)};break;
      case 'ViewerAccess': {
        check(x.owner+'/'+x.name===this.meta.nameWithOwner,'scoped account metadata');
        const d=this.discussions.find(d=>d.number===x.number);
        data={viewer:this.profile(user),repository:{id:this.meta.id,nameWithOwner:this.meta.nameWithOwner,isPrivate:this.meta.isPrivate,isArchived:this.meta.isArchived,
          discussion:d?this.discussion(d,user):null},nodes:x.ids.map(id=>{const t=this.locate(id);return t&&t.node!==t.d?{...this.comment(t.node,user),discussion:this.identity(t.d)}:null;})};
        break;
      }
      case 'OperationAccess': {
        check(x.owner+'/'+x.name===this.meta.nameWithOwner,'scoped operation metadata');
        const d=this.discussions.find(d=>d.number===x.number);
        data={repository:{id:this.meta.id,nameWithOwner:this.meta.nameWithOwner,isPrivate:this.meta.isPrivate,isArchived:this.meta.isArchived,
          discussion:d?{...this.identity(d),title:d.title,url:d.url,locked:d.locked,closed:d.closed,answer:d.answer,reactionGroups:this.groups(d,user)}:null}};
        if(x.selected){const t=this.locate(x.target),c=t&&t.node!==t.d?this.comment(t.node,user):null;
          data.target=c?{id:c.id,url:c.url,replyTo:c.replyTo,viewerCanUpdate:c.viewerCanUpdate,viewerCanDelete:c.viewerCanDelete,
            viewerCanMinimize:c.viewerCanMinimize,viewerCanUnminimize:c.viewerCanUnminimize,discussion:this.identity(t.d)}:null;
        }
        break;
      }
      case 'CommentCounts': {
        data={...(x.signedIn?{viewer:this.profile(user)}:{}),repository:clone(this.meta)};
        for(const [key,number] of Object.entries(x).filter(([key])=>/^n[0-9]+$/.test(key))){
          const d=this.discussions.find(d=>d.number===number);
          data.repository['p'+key.slice(1)]=d?{...this.discussion(d,user),comments:{totalCount:d.comments.length}}:null;
        }
        for(const [key,id] of Object.entries(x).filter(([key])=>/^p[0-9]+$/.test(key))){
          const located=this.locate(id);
          data[key]=located&&located.node!==located.d?{id:located.node.id,replyTo:located.node.replyTo,discussion:{...this.identity(located.d),body:located.d.body},replies:{totalCount:located.node.replies.length}}:null;
        }
        for(const [key,query] of Object.entries(x).filter(([key])=>/^s[0-9]+$/.test(key))){
          check(query.startsWith('repo:example/comments in:body '),'scoped count search');
          const term=JSON.parse(query.slice(query.indexOf('in:')+(query.includes('in:body')?8:9),query.lastIndexOf(' sort:')));
          const nodes=this.hideSearch?[]:this.discussions.filter(d=>query.includes('in:body')?d.body.includes(term):d.title.includes(term));
          data[key]={nodes:nodes.slice(0,10).map(d=>({...this.discussion(d,user),comments:{totalCount:d.comments.length}}))};
        }
        break;
      }
      case 'Page': {
        const d=this.discussions.find(d=>d.number===x.number);
        const project=t=>t&&t.node!==t.d?{...this.comment(t.node,user,true,x.previewReplies?x.prefetch:0),discussion:this.identity(t.d)}:null;
        data={...(x.signedIn?{viewer:this.profile(user)}:{}),repository:{...clone(this.meta),discussion:d?this.discussion(d,user,{...x,replyPrefetch:x.previewReplies?x.prefetch:0}):null}};
        if(x.selected)data.nodes=x.ids.map(id=>project(this.locate(id)));
        if(x.reply){const t=this.locate(x.parent);data.parent=project(t);if(data.parent){const page=connection(t.node.replies,{last:50,before:x.replyBefore});data.parent.replies={...page,nodes:page.nodes.map(c=>this.comment(c,user))};}}
        if (!x.html) {
          for (const comment of [...(data.repository.discussion?.comments.nodes ?? []), ...(data.nodes ?? []), ...(data.parent ? [data.parent] : [])]) {
            if (!comment) continue;
            delete comment.bodyHTML; for (const reply of comment.replies?.nodes ?? []) delete reply.bodyHTML;
          }
          if (data.repository.discussion) delete data.repository.discussion.bodyHTML;
        }
        if(!x.roots&&data.repository.discussion)data.repository.discussion.comments.nodes=[];
        if(!x.previewReplies){for(const node of [...(data.repository.discussion?.comments.nodes??[]),...(data.nodes??[])])if(node)node.replies.nodes=[];}
        if(data.repository.discussion)for(const root of data.repository.discussion.comments.nodes)root.discussion=this.identity(d);
        break;
      }
      case 'CreateDiscussion': {check(token==='ghs_fixture','app authors first discussion');check(x.input.repositoryId==='R_fixture'&&x.input.categoryId==='CAT_fixture','creation scope');const d=this.addThread(x.input.title,{body:x.input.body,bodyHTML:render(x.input.body)});data={createDiscussion:{discussion:{...this.identity(d),locked:d.locked}}};break;}
      case 'AddComment': {check(user,'reader authors comments');const d=this.discussions.find(d=>d.id===x.input.discussionId);check(d&&!d.locked,'writable discussion');const c=this.addComment(d,x.input.body,{author:user,replyTo:x.input.replyToId||null});data={addDiscussionComment:{comment:this.comment(c,user)}};break;}
      case 'EditComment': {const t=this.locate(x.input.commentId);check(t?.node.author&&t.node.authorPrincipal===user,'editor ownership');t.node.body=x.input.body;t.node.bodyHTML=render(x.input.body);t.node.lastEditedAt=new Date(this.now()).toISOString();data={updateDiscussionComment:{comment:this.comment(t.node,user)}};break;}
      case 'DeleteComment': {
        const t=this.locate(x.input.id);check(t?.node.author&&t.node.authorPrincipal===user||user==='maintainer','delete ownership');
        if(t.node.replies.length){t.node.body='';t.node.bodyHTML='';t.node.deletedAt=new Date(this.now()).toISOString();t.node.author=null;data={deleteDiscussionComment:{comment:this.comment(t.node,user)}};}
        else { if(t.node.replyTo){const root=this.locate(t.node.replyTo.id).node;root.replies=root.replies.filter(c=>c.id!==t.node.id);if(root.deletedAt&&!root.replies.length)t.d.comments=t.d.comments.filter(c=>c.id!==root.id);}else t.d.comments=t.d.comments.filter(c=>c.id!==t.node.id);data={deleteDiscussionComment:{comment:null}}; } break;
      }
      case 'React': case 'Unreact': {const t=this.locate(x.input.subjectId);check(t&&user&&reactions.includes(x.input.content),'reaction target');const votes=t.node.votes[x.input.content]||[];t.node.votes[x.input.content]=operation==='React'?[...new Set([...votes,user])]:votes.filter(u=>u!==user);data={[operation==='React'?'addReaction':'removeReaction']:{subject:{id:t.node.id,reactionGroups:this.groups(t.node,user)}}};break;}
      case 'Minimize': case 'Unminimize': {check(user==='maintainer','moderator permission');const t=this.locate(x.input.subjectId);check(t,'moderation target');t.node.isMinimized=operation==='Minimize';t.node.minimizedReason=t.node.isMinimized?'off-topic':null;data={moderate:{comment:{...this.comment(t.node,user),discussion:this.identity(t.d)}}};break;}
      default: throw new Error('Unknown GraphQL fixture operation: '+operation);
    }
    if(query.includes('effect:')){
      const payload=Object.values(data)[0],changed=payload.comment??payload.subject??null;
      if(changed){
        if(['AddComment','EditComment','DeleteComment','Minimize','Unminimize'].includes(operation)){
          const target=this.locate(changed.id);
          changed.discussion={...this.identity(target.d),comments:{totalCount:target.d.comments.length}};
          if(changed.replyTo){const parent=this.locate(changed.replyTo.id).node;changed.replyTo={id:parent.id,replies:{totalCount:parent.replies.length}};}
        }
        if(!query.includes('bodyHTML'))delete changed.bodyHTML;
      }
      data={effect:query.includes('display:')?{identity:changed?{id:changed.id}:null,display:changed}:{identity:changed}};
    }
    if(this.corruptNext){const change=this.corruptNext;this.corruptNext=null;data=change(data,operation);}
    if(this.failAfterMutation&&query.startsWith('mutation')){this.failAfterMutation=false;throw new TypeError('lost response after commit');}
    return response({data});
  }
}
