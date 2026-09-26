"""Check copy and reaction controls in Chromium with simulated API responses.

This test transpiles the browser modules without building the Worker. It does not
check Hono, Valibot, GitHub, OAuth navigation, or Cloudflare deployment.
"""
from pathlib import Path
import json, os, re, shutil, subprocess, tempfile, time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'copy-checks'
OUT.mkdir(parents=True, exist_ok=True)
reports = []
compiler = r'''
const fs=require('node:fs'),path=require('node:path');
const ts=require(process.env.TYPESCRIPT_PATH || 'typescript');
const modules={};
for(const name of ['dom','i18n','markdown','widget','setup','auth-complete','client']) {
  const file=path.join(process.cwd(),'src/browser',name+'.ts');
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,isolatedModules:true},
    fileName:file,reportDiagnostics:true
  });
  const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errors.length)throw new Error(ts.formatDiagnostics(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>"\n"}));
  modules[name]=compiled.outputText;
}
process.stdout.write(JSON.stringify({compiler:ts.version,modules}));
'''
env = dict(os.environ)
if not env.get('TYPESCRIPT_PATH') and not (ROOT/'node_modules/typescript').is_dir():
    global_modules = subprocess.check_output(['npm','root','-g'],text=True).strip()
    env['TYPESCRIPT_PATH'] = str(Path(global_modules)/'typescript')
compiled = json.loads(subprocess.check_output(['node','-e',compiler],cwd=ROOT,env=env,text=True))

def script(name):
    source = compiled['modules'][name]
    source = re.sub(r'^import .*?;\s*$', '', source, flags=re.M)
    source = re.sub(r'^export \{\};\s*$', '', source, flags=re.M)
    return re.sub(r'^export ', '', source, flags=re.M)

def check(name, action):
    try:
        action()
        reports.append({'name':name,'result':'passed'})
        print('PASS',name,flush=True)
    except Exception as error:
        reports.append({'name':name,'result':'failed','error':str(error)})
        raise

config = dict(repo='example/comments',repoId='R1',category='Announcements',categoryId='CAT1',
    origin='https://blog.example/article',backLink='https://blog.example/article',term='article',number=0,
    strict=False,description='',theme='light',lang='en',reactionsEnabled=True,emitMetadata=True,
    inputPosition='top',defaultCommentOrder='oldest')
bootstrap = r'''
window.calls=[];
const reactionKeys=['THUMBS_UP','THUMBS_DOWN','LAUGH','HOORAY','CONFUSED','HEART','ROCKET','EYES'];
window.groups = reactionKeys.map(content=>({content,users:{totalCount:0},viewerHasReacted:false}));
const pageInfo={startCursor:null,endCursor:null,hasNextPage:false,hasPreviousPage:false};
window.model={discussion:{id:'D1',number:1,title:'article',body:'article',bodyHTML:'<p>article</p>',
url:'https://github.com/example/comments/discussions/1',locked:false,reactionGroups:groups,
comments:{nodes:[],totalCount:0,pageInfo}},viewer:null,archived:false,order:'oldest',nextCursor:null};
if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('');
window.fetch=async (url,options={})=>{
  const body=options.body?JSON.parse(options.body):{};calls.push({url,body});
  if(url==='/api/thread')return Response.json(model);
  if(url==='/api/reaction') {
    const group=groups.find(g=>g.content===body.reaction);
    group.users.totalCount+=body.add?1:-1;group.viewerHasReacted=body.add;
    return Response.json({id:'D1',number:1});
  }
  if(url==='/api/comment') {
    const comment={id:'C1',body:body.body,bodyHTML:'<p>'+body.body+'</p>',
      author:{login:'reader',url:'https://github.com/reader',avatarUrl:'https://avatars.githubusercontent.com/u/1'},
      authorAssociation:'NONE',createdAt:'2026-09-26T12:00:00Z',lastEditedAt:null,
      url:'https://github.com/example/comments/discussions/1#comment-1',viewerCanUpdate:true,viewerCanDelete:true,
      viewerCanMinimize:false,isMinimized:false,minimizedReason:null,reactionGroups:[],
      replies:{nodes:[],totalCount:0,pageInfo}};
    model.discussion.comments={nodes:[comment],totalCount:1,pageInfo};return Response.json({id:'C1',number:1});
  }
  if(url==='/api/preview')return Response.json({html:'<p>Preview</p>'});
  if(url==='/api/delete'){model.discussion.comments.nodes=[];model.discussion.comments.totalCount=0;return Response.json({id:'C1',number:1});}
  if(url==='/api/logout'){model.viewer=null;return Response.json({ok:true});}
  return Response.json({error:{message:'Test endpoint not found.'}},{status:404});
};
'''
errors=[]
try:
    with sync_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        options={'headless':True,'args':['--no-sandbox']}
        if executable:options['executable_path']=executable
        browser=p.chromium.launch(**options)
        page=browser.new_page(viewport={'width':780,'height':900})
        page.set_default_timeout(5000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content('<!doctype html><html><head><style>'+ (ROOT/'public/widget.css').read_text() +'</style></head><body><giscus-comments></giscus-comments><script type="application/json" id="gw-config">'+json.dumps(config)+'</script></body></html>')
        page.evaluate(bootstrap)
        combined='\n'.join([script('dom'),'const h=element;',script('i18n'),script('markdown'),script('widget'),
            'window.copyStrings=strings;window.copyReactionLabel=reactionLabel;'])
        page.evaluate('() => {\n'+combined+'\n}')
        expect(page.locator('[data-composer="main"] textarea')).to_be_visible()
        def empty_reactions():
            expect(page.locator('.page-reactions > .gsc-reactions > button')).to_have_count(0)
            expect(page.locator('.empty,.notice,.widget-footer')).to_have_count(0)
            assert 'Start the conversation' not in page.locator('body').inner_text()
            page.locator('.page-reactions summary').click()
            expect(page.locator('.page-reactions .reaction-menu button')).to_have_count(8)
            labels=page.locator('.page-reactions .reaction-menu button').evaluate_all('(items)=>items.map(x=>x.title)')
            assert labels==['Thumbs up','Thumbs down','Laugh','Hooray','Confused','Heart','Rocket','Eyes'],labels
            assert '↑' not in page.locator('.page-reactions').inner_text()
            page.locator('.page-reactions summary').click()
        check('Empty reactions show a picker without a separate vote counter',empty_reactions)
        def dictionaries():
            values=page.evaluate('''() => ['en','es','fr','de','pl','pt','ja','ko','zh','ar'].map(lang=>{
              const t=copyStrings(lang);return {lang,removed:['like','saved','loginNote','empty'].filter(key=>key in t),
                labels:['THUMBS_UP','THUMBS_DOWN','LAUGH','HOORAY','CONFUSED','HEART','ROCKET','EYES'].map(key=>copyReactionLabel(t,key))};
            })''')
            for item in values:
                assert item['removed']==[],item
                assert len(item['labels'])==8 and all(label and '_' not in label for label in item['labels']),item
        check('All ten dictionaries use reaction names and omit deleted copy',dictionaries)
        def active_counts():
            page.evaluate("groups[0].users.totalCount=2;groups[5].users.totalCount=3;")
            page.get_by_role('button',name='Refresh',exact=True).click()
            expect(page.locator('.page-reactions > .gsc-reactions > button')).to_have_count(2)
            assert page.locator('.page-reactions > .gsc-reactions > button').all_text_contents()==['👍 2','♥ 3']
        check('Only reactions with existing counts appear outside the picker',active_counts)
        page.evaluate("model.viewer={login:'reader',url:'https://github.com/reader',avatarUrl:'https://avatars.githubusercontent.com/u/1'};window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://blog.example',data:{giscus:{init:{session:'s'.repeat(43)}}}}));")
        expect(page.get_by_role('button',name='Sign out',exact=True)).to_be_visible()
        def toggle():
            page.locator('.page-reactions > .gsc-reactions > button').first.click()
            expect(page.locator('.page-reactions > .gsc-reactions > button').first).to_have_text('👍 3')
            page.locator('.page-reactions > .gsc-reactions > button').first.click()
            expect(page.locator('.page-reactions > .gsc-reactions > button').first).to_have_text('👍 2')
            data=page.evaluate("calls.filter(x=>x.url==='/api/reaction').map(x=>x.body)")
            assert [x['add'] for x in data]==[True,False]
            assert all(x['reaction']=='THUMBS_UP' and 'voteMode' not in x['config'] for x in data)
        check('Thumbs up adds and removes a GitHub reaction',toggle)
        def sign_in_label():
            expect(page.locator('.signed-in')).to_have_text('reader')
            expect(page.locator('.signed-in')).to_have_attribute('aria-label','Signed in as reader')
            expect(page.get_by_role('link',name='Markdown guide')).to_have_attribute('href',re.compile('docs.github.com'))
            assert 'Your draft stays here' not in page.locator('body').inner_text()
        check('Account and Markdown controls have useful labels without reassurance text',sign_in_label)
        def submit():
            page.locator('[data-composer="main"] textarea').fill('Test comment')
            page.get_by_role('button',name='Post comment',exact=True).click()
            expect(page.locator('.gsc-comment-content').first).to_have_text('Test comment')
            expect(page.locator('[data-composer="main"] textarea')).to_have_value('')
            expect(page.locator('.notice')).to_have_count(0)
        check('Posting updates the comment list without a redundant saved message',submit)
        def deletion():
            messages=[]
            page.once('dialog',lambda dialog:(messages.append(dialog.message),dialog.dismiss()))
            page.get_by_role('button',name='Delete',exact=True).click()
            assert messages==['Delete this comment? This cannot be undone.']
            expect(page.locator('.gsc-comment-content').first).to_have_text('Test comment')
        check('Deletion explains its consequence when the reader chooses Delete',deletion)
        def widths():
            for width in [320,375,768,1100]:
                page.set_viewport_size({'width':width,'height':900})
                bounds=page.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})')
                assert bounds['scroll']<=bounds['width']+1,bounds
        check('Revised widget fits widths from 320 to 1100 pixels',widths)
        page.set_viewport_size({'width':375,'height':900})
        page.screenshot(path=str(OUT/'widget-mobile.png'),full_page=True)
        page.set_viewport_size({'width':900,'height':850})
        page.screenshot(path=str(OUT/'widget-desktop.png'),full_page=True)
        setup=browser.new_page(viewport={'width':900,'height':1000})
        setup.on('pageerror',lambda error:errors.append(str(error)))
        setup.set_content((ROOT/'public/index.html').read_text())
        setup.add_style_tag(content=(ROOT/'public/widget.css').read_text()+'\n'+(ROOT/'public/setup.css').read_text())
        setup.evaluate("() => { window.setupCalls=[];window.fetch=async(url,options={})=>{setupCalls.push(JSON.parse(options.body));return Response.json({repo:'example/comments',repoId:'R1',category:'Announcements',categoryId:'CAT1'});}; }")
        setup.evaluate('() => {\n'+script('setup')+'\n}')
        def conditional_fields():
            expect(setup.locator('#mapping-value')).to_be_hidden()
            expect(setup.locator('input[name=term]')).to_be_disabled()
            assert setup.locator('select[name=vote]').count()==0
            setup.locator('select[name=mapping]').select_option('number')
            expect(setup.locator('#mapping-value-label')).to_have_text('Discussion number')
            expect(setup.locator('#strict-setting')).to_be_hidden()
            setup.locator('select[name=mapping]').select_option('specific')
            expect(setup.locator('#mapping-value-label')).to_have_text('Search term')
            expect(setup.locator('#strict-setting')).to_be_visible()
        check('Setup shows term and strict-matching controls only where they apply',conditional_fields)
        def generated_embed():
            setup.locator('input[name=repo]').fill('example/comments')
            setup.locator('input[name=origin]').fill('https://blog.example')
            setup.locator('input[name=term]').fill('article')
            setup.get_by_role('button',name='Generate embed code',exact=True).click()
            expect(setup.locator('#setup-result')).to_be_visible()
            code=setup.locator('#setup-code').inner_text()
            assert 'data-reactions-enabled="1"' in code
            assert 'data-vote-mode' not in code and 'thumbs-up' not in code
            assert 'data-term="article"' in code
            expect(setup.locator('#setup-status')).to_have_text('')
        check('Generated embeds use emoji reactions without redundant success copy',generated_embed)
        def clipboard():
            setup.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});")
            setup.get_by_role('button',name='Copy code',exact=True).click()
            expect(setup.locator('#setup-copy')).to_have_text('Copied')
            expect(setup.locator('#setup-status')).to_have_text('')
            assert setup.evaluate('copied')==setup.locator('#setup-code').inner_text()
        check('Clipboard feedback confirms an otherwise invisible result',clipboard)
        def clipboard_failure():
            setup.evaluate("() => { navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); }; }")
            setup.locator('#setup-copy').click()
            expect(setup.locator('#copy-status')).to_have_text('Select the code and copy it manually.')
        check('Clipboard failure shows recovery instructions beside the copy button',clipboard_failure)
        setup.evaluate('() => { document.querySelector("#setup-result").hidden=true; document.querySelector("#setup-status").textContent=""; }')
        setup.screenshot(path=str(OUT/'setup.png'),full_page=True)
        def cancel_auth():
            auth=browser.new_page()
            auth.on('pageerror',lambda error:errors.append(str(error)))
            data={'status':'denied','returnURL':'https://blog.example/article','mode':'redirect','repo':'example/comments','attempt':'a'*43,'ticket':'','challenge':'c'*43}
            auth.set_content('<p id="auth-status"></p><a id="auth-return"></a><script type="application/json" id="gw-config">'+json.dumps(data)+'</script>')
            auth.evaluate('() => {\n'+script('dom')+'\n'+script('auth-complete')+'\n}')
            expect(auth.locator('#auth-status')).to_have_text('Sign-in cancelled.')
            expect(auth.locator('#auth-return')).to_have_text('Return to page')
            auth.close()
        check('Cancelled sign-in gives a return link without promises about drafts',cancel_auth)
        def no_errors():
            assert errors==[],errors
        check('No uncaught JavaScript errors during copy checks',no_errors)
        browser.close()
finally:
    (OUT/'browser.json').write_text(json.dumps({'mode':'copy-component-test','api':'simulated in browser','worker_tested':False,
      'typescript':compiled['compiler'],'checks':reports},ensure_ascii=False,indent=2)+'\n')
print(str(len(reports))+' copy component checks passed.')
