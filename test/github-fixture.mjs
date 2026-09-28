/** Stateful GitHub responses for local tests. */
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
  constructor({seed = false, now = () => Date.now()} = {}) {
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
  addThread(title, options={}) {
    const number=this.discussions.length+1;
    const value={id:'D_'+number,number,title,body:title,bodyHTML:render(title),url:`https://github.com/example/comments/discussions/${number}`,locked:false,closed:false,answer:null,repository:{id:'R_fixture',nameWithOwner:'example/comments',isPrivate:false},category:{id:'CAT_fixture',name:'Announcements'},comments:[],votes:{},...options};
    this.discussions.push(value); return value;
  }
  addComment(d,body,{author='reader',replyTo=null,html=render(body)}={}) {
    const c={id:'DC_'+this.nextComment++,body,bodyHTML:html,url:d.url+'#discussioncomment-'+this.nextComment,createdAt:new Date(this.now()).toISOString(),lastEditedAt:null,author:{...AUTHOR,login:author,url:'https://github.com/'+author},authorAssociation:author==='maintainer'?'OWNER':'NONE',isMinimized:false,minimizedReason:null,deletedAt:null,replyTo:replyTo?{id:replyTo}:null,replies:[],votes:{}};
    if(replyTo){const root=d.comments.find(c=>c.id===replyTo);check(root,'reply root');root.replies.push(c);}else d.comments.push(c);return c;
  }
  groups(node,user){return reactions.map(content=>({content,viewerHasReacted:Boolean(user&&node.votes[content]?.includes(user)),users:{totalCount:node.votes[content]?.length||0}}));}
  comment(c,user,root=false,replyPrefetch=5){const {replies,votes,...value}=c;const result={...clone(value),isAnswer:Boolean(c.isAnswer),viewerCanMarkAsAnswer:user==='maintainer'&&!c.isAnswer,viewerCanUnmarkAsAnswer:user==='maintainer'&&Boolean(c.isAnswer),viewerDidAuthor:c.author?.login===user,viewerCanUpdate:c.author?.login===user,viewerCanDelete:c.author?.login===user||user==='maintainer',viewerCanMinimize:user==='maintainer',viewerCanUnminimize:user==='maintainer',reactionGroups:this.groups(c,user)};if(root)result.replies=connection(replies.map(r=>this.comment(r,user)),{last:replyPrefetch});return result;}
  discussion(d,user,paging){const {comments,votes,...value}=d;const result={...clone(value),viewerCanClose:user==='maintainer'&&!d.closed,viewerCanReopen:user==='maintainer'&&d.closed,viewerCanUpdate:user==='maintainer',viewerCanDelete:user==='maintainer',repository:{...d.repository,isPrivate:d.repository.isPrivate||this.meta.isPrivate},reactionGroups:this.groups(d,user)};if(paging)result.comments=connection(comments.map(c=>this.comment(c,user,true,paging.replyPrefetch)),paging);return result;}
  identity(d){return {id:d.id,number:d.number,repository:{...clone(d.repository),isPrivate:d.repository.isPrivate||this.meta.isPrivate},category:clone(d.category)};}
  targetComment(c,user){return {id:c.id,viewerCanUpdate:c.author?.login===user,viewerCanDelete:c.author?.login===user||user==='maintainer',viewerCanMinimize:user==='maintainer',viewerCanUnminimize:user==='maintainer',replyTo:clone(c.replyTo)};}
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
      if(p.get('grant_type')==='refresh_token'){this.refreshes++;check(p.get('refresh_token')?.startsWith('ghr_'),'refresh token');return response({access_token:'ghu_reader_refreshed',expires_in:28800,refresh_token:'ghr_rotated',refresh_token_expires_in:15552000});}
      const code=p.get('code');if(code==='bad')return response({error:'bad_verification_code'});
      check(code?.startsWith('fixture_')&&await sha256(p.get('code_verifier')||'')===code.slice(8),'independent PKCE proof');
      return response({access_token:'ghu_reader',expires_in:28800,refresh_token:'ghr_reader',refresh_token_expires_in:15552000});
    }
    check(url.origin==='https://api.github.com','REST/GraphQL host');check(Boolean(token),'authorization');
    if(url.pathname==='/repos/'+this.meta.nameWithOwner+'/installation'){check(token.split('.').length===3,'app JWT');return response({id:123});}
    if(url.pathname==='/app/installations/123/access_tokens'){const b=JSON.parse(payload);check(b.repositories.join()===this.meta.nameWithOwner.split('/')[1]&&b.permissions.discussions==='write','restricted app permission scope');this.installations++;return response({token:'ghs_fixture',expires_at:new Date(this.now()+3600000).toISOString()});}
    if(url.pathname==='/user'){check(user,'user token');return response({login:user,avatar_url:AUTHOR.avatarUrl,html_url:'https://github.com/'+user});}
    if(url.pathname==='/markdown'){check(user,'authenticated preview');return new Response(render(JSON.parse(payload).text),{headers:{'Content-Type':'text/html'}});}
    if(url.pathname.startsWith('/user/blocks/')){check(user,'user authority for blocking');this.blocked=request.method==='PUT';return new Response(null,{status:204});}
    check(url.pathname==='/graphql'&&request.method==='POST','known endpoint');
    const {query,variables:x}=JSON.parse(payload),operation=/^(?:query|mutation) (\w+)/.exec(query)?.[1]||(x.discussion?'RankDiscovery':x.ids0?'RankObservation':undefined);call.operation=operation;call.variables=x;call.query=query;
    let data;
    switch(operation){
      case 'Authority': data={repository:{...clone(this.meta),viewerPermission:user==='maintainer'?'ADMIN':'READ',owner:{__typename:'User'}}};break;
      case 'DiscussionAction': {
        check(user==='maintainer','moderator authority');const name=/\{(\w+)\(input/.exec(query)[1],id=x.input.id||x.input.discussionId||x.input.lockableId,t=this.locate(id);check(t,'target exists');
        if(name==='closeDiscussion'||name==='reopenDiscussion')t.d.closed=name==='closeDiscussion';
        if(name==='lockLockable'||name==='unlockLockable')t.d.locked=name==='lockLockable';
        if(name==='updateDiscussion'){t.d.title=x.input.title;t.d.body=x.input.body;t.d.bodyHTML=render(x.input.body);}
        if(name==='deleteDiscussion')this.discussions=this.discussions.filter(d=>d.id!==id);
        if(name==='markDiscussionCommentAsAnswer'||name==='unmarkDiscussionCommentAsAnswer'){t.node.isAnswer=name==='markDiscussionCommentAsAnswer';t.d.answer=t.node.isAnswer?{id}:null;}
        data={[name]:{clientMutationId:null}};break;
      }
      case 'RankDiscovery': {
        const d=this.discussions.find(d=>d.id===x.discussion);
        const compact=c=>({...this.comment(c,user),reactionGroups:this.groups(c,user).map(g=>({...g,reactors:g.users})),replies:{totalCount:c.replies.length},upvoteCount:c.upvoteCount||0});
        data={repository:clone(this.meta),node:d?{...this.discussion(d,user),comments:connection(d.comments.map(compact),{last:100,before:x.cursor})}:null};break;
      }
      case 'RankObservation': {
        data={repository:clone(this.meta)};
        for(const [key,ids] of Object.entries(x).filter(([key])=>/^ids[0-9]+$/.test(key)))data['batch'+key.slice(3)]=ids.map(id=>{const t=this.locate(id);return t?{...this.comment(t.node,user),discussion:this.discussion(t.d,user),reactionGroups:this.groups(t.node,user).map(g=>({...g,reactors:g.users})),replies:{totalCount:t.node.replies.length},upvoteCount:t.node.upvoteCount||0}:null;});break;
      }
      case 'Hydrate':data={nodes:x.ids.map(id=>{const t=this.locate(id);return t?{...this.comment(t.node,user,true,x.replyPrefetch),discussion:this.identity(t.d)}:null;})};break;
      case 'Repository': check(x.owner+'/'+x.name===this.meta.nameWithOwner,'scoped metadata');data={repository:clone(this.meta)};break;
      case 'FindDiscussion': {
        check(x.query.startsWith('repo:example/comments category:"Announcements" '),'quoted scoped search');
        const term=JSON.parse(/in:(?:body|title) ("(?:\\.|[^"\\])*")/.exec(x.query)?.[1]||'""');
        const nodes=this.hideSearch?[]:this.discussions.filter(d=>x.query.includes('in:body')?d.body.includes(term):d.title.includes(term));
        check(!/bodyHTML|reactionGroups|comments\s*\{/.test(query),'search selects identity and optional strict body only');data={search:{nodes:nodes.slice(0,10).map(d=>({...this.identity(d),...(x.strict?{body:d.body}:{})}))}};break;
      }
      case 'CommentCounts': {
        data={repository:clone(this.meta)};
        for(const [key,number] of Object.entries(x).filter(([key])=>/^n[0-9]+$/.test(key))){
          const d=this.discussions.find(d=>d.number===number);
          data.repository['p'+key.slice(1)]=d?{...this.discussion(d,user),comments:{totalCount:d.comments.length}}:null;
        }
        for(const [key,query] of Object.entries(x).filter(([key])=>/^q[0-9]+$/.test(key))){
          check(query.startsWith('repo:example/comments category:"Announcements" '),'scoped count search');
          const term=JSON.parse(query.slice(query.indexOf('in:')+(query.includes('in:body')?8:9),query.lastIndexOf(' sort:')));
          const nodes=this.hideSearch?[]:this.discussions.filter(d=>query.includes('in:body')?d.body.includes(term):d.title.includes(term));
          data['p'+key.slice(1)]={nodes:nodes.slice(0,10).map(d=>({...this.discussion(d,user),comments:{totalCount:d.comments.length}}))};
        }
        break;
      }
      case 'DiscussionAccess': {check(!/body|reactionGroups|comments/.test(query),'access excludes display fields');const d=this.discussions.find(d=>d.number===x.number);data={repository:{isPrivate:this.meta.isPrivate,discussion:d?{...this.identity(d),locked:d.locked}:null}};break;}
      case 'CombinedThread':
      case 'Thread': {check(([0,20].includes(x.first)&&x.last===null)||([0,20].includes(x.last)&&x.first===null),'exclusive cursor direction');const d=this.discussions.find(d=>d.number===x.number);data={repository:{...clone(this.meta),viewerPermission:user==='maintainer'?'ADMIN':'READ',isPrivate:this.meta.isPrivate,discussion:d?this.discussion(d,user,x):null}};break;}
      case 'Target': {check(!/body|reactionGroups|author\s*\{|replies\s*\{/.test(query),'target excludes display fields');const t=this.locate(x.id);data={node:t?t.d===t.node?{__typename:'Discussion',...this.identity(t.d)}:{__typename:'DiscussionComment',...this.targetComment(t.node,user),discussion:this.identity(t.d)}:null};break;}
      case 'CommentRefresh': {const t=this.locate(x.id);data={node:t&&t.node!==t.d?{...this.comment(t.node,user),discussion:this.identity(t.d)}:null};break;}
      case 'Replies': {const t=this.locate(x.id);data={node:t?{id:t.node.id,replyTo:t.node.replyTo,discussion:this.identity(t.d),replies:connection(t.node.replies.map(c=>this.comment(c,user)),{last:50,before:x.before})}:null};break;}
      case 'CreateDiscussion': {check(token==='ghs_fixture','app authors first discussion');check(x.input.repositoryId==='R_fixture'&&x.input.categoryId==='CAT_fixture','creation scope');const d=this.addThread(x.input.title,{body:x.input.body,bodyHTML:render(x.input.body)});data={createDiscussion:{discussion:{id:d.id,number:d.number}}};break;}
      case 'AddComment': {check(user,'reader authors comments');const d=this.discussions.find(d=>d.id===x.input.discussionId);check(d&&!d.locked,'writable discussion');const c=this.addComment(d,x.input.body,{author:user,replyTo:x.input.replyToId||null});data={addDiscussionComment:{comment:this.comment(c,user)}};break;}
      case 'EditComment': {const t=this.locate(x.input.commentId);check(t?.node.author?.login===user,'editor ownership');t.node.body=x.input.body;t.node.bodyHTML=render(x.input.body);t.node.lastEditedAt=new Date(this.now()).toISOString();data={updateDiscussionComment:{comment:this.comment(t.node,user)}};break;}
      case 'DeleteComment': {
        const t=this.locate(x.input.id);check(t?.node.author?.login===user||user==='maintainer','delete ownership');
        if(t.node.replies.length){t.node.body='';t.node.bodyHTML='';t.node.deletedAt=new Date(this.now()).toISOString();t.node.author=null;data={deleteDiscussionComment:{comment:this.comment(t.node,user)}};}
        else { if(t.node.replyTo){const root=this.locate(t.node.replyTo.id).node;root.replies=root.replies.filter(c=>c.id!==t.node.id);}else t.d.comments=t.d.comments.filter(c=>c.id!==t.node.id);data={deleteDiscussionComment:{comment:null}}; } break;
      }
      case 'React': case 'Unreact': {const t=this.locate(x.input.subjectId);check(t&&user&&reactions.includes(x.input.content),'reaction target');const votes=t.node.votes[x.input.content]||[];t.node.votes[x.input.content]=operation==='React'?[...new Set([...votes,user])]:votes.filter(u=>u!==user);data={[operation==='React'?'addReaction':'removeReaction']:{subject:{id:t.node.id,reactionGroups:this.groups(t.node,user)}}};break;}
      case 'Minimize': case 'Unminimize': {check(user==='maintainer','moderator permission');const t=this.locate(x.input.subjectId);check(t,'moderation target');t.node.isMinimized=operation==='Minimize';t.node.minimizedReason=t.node.isMinimized?'off-topic':null;data={[operation==='Minimize'?'minimizeComment':'unminimizeComment']:{clientMutationId:null}};break;}
      default: throw new Error('Unknown GraphQL fixture operation: '+operation);
    }
    if(this.corruptNext){const change=this.corruptNext;this.corruptNext=null;data=change(data,operation);}
    if(this.failAfterMutation&&query.startsWith('mutation')){this.failAfterMutation=false;throw new TypeError('lost response after commit');}
    return response({data});
  }
}
