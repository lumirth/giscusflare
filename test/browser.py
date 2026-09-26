"""Browser tests for the widget and Hono API with simulated GitHub.

Default mode tests a cross-origin iframe and popup. Component mode uses
about:blank and an HTTP bridge when browser policy blocks navigation.
"""
from __future__ import annotations
import base64, hashlib, http.cookiejar, json, os, pathlib, re, socket, subprocess, time
import urllib.error, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'docs' / 'evidence'
EVIDENCE.mkdir(parents=True, exist_ok=True)
COMPONENT = os.environ.get('BROWSER_COMPONENT_ONLY') == '1'
PORT = int(os.environ.get('BROWSER_PORT', '18787'))
BLOG_PORT = int(os.environ.get('BROWSER_BLOG_PORT', '18788'))
SERVICE, BLOG = f'http://127.0.0.1:{PORT}', f'http://127.0.0.1:{BLOG_PORT}'
results = []
report = {'suite':'browser', 'mode':'component-api-bridge' if COMPONENT else 'cross-origin-iframe', 'github':'simulated', 'status':'not-run', 'checks':results}
process = None

def check(name, fn):
    start = time.monotonic()
    try:
        fn()
        results.append({'name':name,'status':'passed','seconds':round(time.monotonic()-start,3)})
        print('PASS',name,flush=True)
    except Exception as error:
        results.append({'name':name,'status':'failed','details':str(error)[:2000]})
        raise

def urlopen(request):
    try: return urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error: return error

def bridge(data):
    url = urllib.parse.urlsplit(data['url'])
    if url.scheme:
        assert url.scheme == 'http' and url.netloc == f'127.0.0.1:{PORT}', 'Unexpected test-bridge host'
    assert url.path.startswith('/api/'), 'Bridge permits only application API endpoints'
    headers = data.get('headers') or {}
    headers['Origin'] = SERVICE
    body = data.get('body')
    request = urllib.request.Request(SERVICE+url.path+('?' + url.query if url.query else ''), data=body.encode() if body is not None else None, headers=headers, method=data.get('method','GET'))
    response = urlopen(request)
    return {'status':response.code,'body':response.read().decode(),'headers':dict(response.headers)}

def session_from_http():
    """Test sign-in with a cookie jar, PKCE verifier, and the application controllers."""
    verifier = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')
    proof = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def post(path, body):
        response=opener.open(urllib.request.Request(SERVICE+path,data=json.dumps(body).encode(),method='POST',headers={'Content-Type':'application/json','Origin':SERVICE}),timeout=15)
        assert response.code==200
        return json.load(response)
    common={'repo':'example/comments','origin':BLOG+'/article'}
    prepared=post('/api/auth/prepare',{**common,'challenge':proof,'mode':'popup'})
    authorization=prepared.get('authorizeURL') or prepared.get('authorizationURL')
    parameters=urllib.parse.parse_qs(urllib.parse.urlsplit(authorization).query)
    callback=SERVICE+'/auth/callback?'+urllib.parse.urlencode({'state':parameters['state'][0],'code':'fixture_'+parameters['code_challenge'][0]})
    result=opener.open(callback,timeout=15);assert result.code==200;result.read()
    auth={**common,'attempt':prepared['attempt'],'verifier':verifier}
    ticket=post('/api/auth/poll',auth)['ticket']
    return post('/api/auth/consume',{**auth,'ticket':ticket})['session']

try:
    for port in [PORT,BLOG_PORT]:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',port))
    process=subprocess.Popen(['node','scripts/demo.mjs'],cwd=ROOT,env={**os.environ,'PORT':str(PORT),'BLOG_PORT':str(BLOG_PORT)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Demo stopped: '+process.stdout.read()[-4000:])
        try:
            if urllib.request.urlopen(SERVICE+'/healthz',timeout=.5).code==200: break
        except Exception: time.sleep(.1)
    else: raise RuntimeError('Local test application did not start')
    with sync_playwright() as p:
        launch={'headless':True}
        if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
        if os.environ.get('BROWSER_NO_SANDBOX')=='1':launch['args']=['--no-sandbox']
        browser=p.chromium.launch(**launch)
        report['browser_version']=browser.version
        context=browser.new_context(viewport={'width':1000,'height':900})
        page=context.new_page();page.set_default_timeout(12000)
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        if COMPONENT:
            query=urllib.parse.urlencode({'repo':'example/comments','origin':BLOG+'/article','term':'article','category':'Announcements','inputPosition':'top'})
            html=urllib.request.urlopen(SERVICE+'/widget?'+query).read().decode()
            # Load the server configuration and browser component.
            html=re.sub(r'<script\b(?=[^>]*\bsrc=)[^>]*>\s*</script>','',html)
            html=re.sub(r'<link\b[^>]*>','',html)
            css=(ROOT/'public/widget.css').read_text()
            page.set_content(html.replace('</head>','<style>'+css+'</style></head>'))
            page.expose_function('__giscusTestHTTP',bridge)
            page.evaluate('''() => {
              if (!crypto.randomUUID) crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return (c==='x'?r:(r&3)|8).toString(16)});
              globalThis.fetch=async (url,init={})=>{
                const result=await window.__giscusTestHTTP({url:String(url),method:init.method||'GET',headers:Object.fromEntries(new Headers(init.headers)),body:init.body});
                return new Response(result.body,{status:result.status,headers:result.headers});
              };
            }''')
            page.add_script_tag(content=(ROOT/'dist/widget-test.js').read_text())
            ui=page
        else:
            page.goto(BLOG+'/article')
            ui=page.frame_locator('iframe.giscus-frame')
        check('widget starts without rendering a fatal error',lambda:expect(ui.locator('textarea').first).to_be_visible())
        if COMPONENT:
            token=session_from_http()
            page.evaluate('''({token,origin})=>window.dispatchEvent(new MessageEvent('message',{source:window,origin,data:{giscus:{init:{session:token,draft:'',draftState:''}}}}))''',{'token':token,'origin':BLOG})
        else:
            ui.get_by_role('button',name=re.compile('Sign in.*GitHub',re.I)).first.click()
        check('GitHub-controller session authenticates the component',lambda:expect(ui.get_by_role('button',name=re.compile('Sign out',re.I)).first).to_be_visible())
        def post_comment():
            ui.locator('textarea').first.fill('Browser integration proof **bold text**.')
            ui.get_by_role('button',name=re.compile('^Post comment$|^Post$',re.I)).first.click()
            expect(ui.get_by_text('Browser integration proof',exact=False).first).to_be_visible()
        check('comment creation passes through the production API',post_comment)
        def responsive():
            for width in [320,375,430,768,1200]:
                page.set_viewport_size({'width':width,'height':900})
                bounds=ui.locator('body').evaluate('(e)=>({scroll:e.scrollWidth,width:document.documentElement.clientWidth})')
                assert bounds['scroll']<=bounds['width']+1,(width,bounds)
        check('no horizontal overflow across five viewport widths',responsive)
        if COMPONENT:
            page.add_script_tag(content=(ROOT/'dist/renderer-test.js').read_text())
            def renderer_security():
                state=page.evaluate('''() => {
                  const renderer=GiscusRendererTest.renderMarkdown;
                  if(typeof renderer!=='function')throw new Error('Renderer test export is missing');
                  const host=document.createElement('div');window.__giscusXSS=0;
                  const payloads=[
                    '<img src=x onerror="window.__giscusXSS=1">',
                    '<svg><g onload="window.__giscusXSS=1"></g></svg>',
                    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__giscusXSS=1>">',
                    '<a href="java&#x73;cript:window.__giscusXSS=1">bad</a>',
                    '<a href="data:text/html,bad">bad</a>',
                    '<iframe srcdoc="<script>parent.__giscusXSS=1</script>"></iframe>',
                    '<form id="gw-config"><input name="action"></form>',
                    '<style>body{display:none}</style>',
                    '<link rel=stylesheet href="https://evil.example/a.css">',
                    '<details ontoggle="window.__giscusXSS=1"><summary>test</summary></details>',
                    '<img src="https://example.com/a" style="position:fixed" srcset="https://evil.example/b 2x">',
                    '<a href="https://user:pass@example.com">bad</a>',
                    '<input type=submit formaction="https://evil.example"><input type=checkbox checked>',
                    '<custom-element onclick="window.__giscusXSS=1">text</custom-element>',
                    '<a id="gw-config" href="#gw-config">note</a>'
                  ];
                  for(const payload of payloads){const output=renderer(payload);if(output instanceof Node)host.append(output);else throw new Error('Unexpected renderer output');}
                  document.body.append(host);
                  const bad=[...host.querySelectorAll('*')].flatMap(n=>[...n.attributes].filter(a=>/^on/i.test(a.name)||['style','srcdoc','srcset','formaction','name'].includes(a.name)));
                  const urls=[...host.querySelectorAll('[href],[src]')].map(n=>n.getAttribute('href')||n.getAttribute('src'));
                  const result={xss:window.__giscusXSS,bad:bad.length,dangerous:host.querySelectorAll('script,style,svg,math,iframe,form,object,embed,custom-element').length,clobber:!!host.querySelector('#gw-config'),urls};host.remove();return result;
                }''')
                assert state['xss']==0 and state['bad']==0 and state['dangerous']==0 and not state['clobber'],state
                assert all(not re.match(r'^(?:javascript|data|vbscript):',u,re.I) for u in state['urls']),state
            check('restricted renderer rejects fifteen executable or clobbering payload classes',renderer_security)
        page.set_viewport_size({'width':430,'height':950})
        page.screenshot(path=str(EVIDENCE/'browser-mobile.png'))
        page.set_viewport_size({'width':1100,'height':850})
        page.screenshot(path=str(EVIDENCE/'browser-desktop.png'))
        def logout():
            ui.get_by_role('button',name=re.compile('Sign out',re.I)).first.click()
            expect(ui.get_by_role('button',name=re.compile('Sign in.*GitHub',re.I)).first).to_be_visible()
        check('logout revokes the session and returns to anonymous UI',logout)
        if errors:raise AssertionError('Uncaught browser errors: '+repr(errors))
        results.append({'name':'no uncaught browser errors','status':'passed'})
        report['status']='passed'
        browser.close()
except Exception as error:
    report['status']='failed'
    report['details']=str(error)[:4000]
    print(report['details'],flush=True)
    raise
finally:
    if process and process.poll() is None:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait()
    (EVIDENCE/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
