"""Package source and reports. Exclude secrets, installed tools, databases, and caches."""
from pathlib import Path
import hashlib, json, os, re, shutil, zipfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'giscus-workers-v2.zip'
for required in ['src/worker/app.ts','src/worker/repository.ts','src/contracts/requests.ts','src/domain/repository.ts','src/browser/widget.ts','package.json','README.md','VERIFICATION.md','LICENSE']:
    if not (ROOT/required).is_file():raise RuntimeError('Required implementation file missing: '+required)
licenses=ROOT/'licenses';licenses.mkdir(exist_ok=True)
for package in ['hono','valibot','@standard-schema/spec']:
    directory=ROOT/'node_modules'/package
    for name in ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md']:
        source=directory/name
        if source.is_file():
            shutil.copyfile(source,licenses/(package.replace('/','-').replace('@','')+'.txt'))
            break
skip={'node_modules','.git','.wrangler','__pycache__','test-results'}
files=[]
for p in sorted(ROOT.rglob('*')):
    relative=p.relative_to(ROOT)
    if not p.is_file() or p.is_symlink() or any(x in skip or x.startswith('.runtime-test-') for x in relative.parts):continue
    if p.name=='SOURCE-MANIFEST.json':continue
    if p.name.startswith(('.env','.dev.vars')) and not p.name.endswith('.example'):continue
    if p.suffix.lower() in ['.pem','.key','.sqlite','.sqlite3','.db','.pyc','.ttf','.otf','.woff','.woff2']:continue
    if p.stat().st_size>8*1024*1024:raise RuntimeError('Unexpected oversized release file: '+str(relative))
    files.append(p)
for p in files:
    if p.suffix=='.md':
        for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
            if target.startswith(('http:','https:','mailto:','#')):continue
            if not (p.parent/target.split('#')[0]).exists():raise RuntimeError(f'Broken documentation link in {p.name}: {target}')
manifest={'algorithm':'sha256','files':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
(ROOT/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n');files.append(ROOT/'SOURCE-MANIFEST.json')
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for p in files:archive.write(p,'giscus-workers-v2/'+str(p.relative_to(ROOT)))
with zipfile.ZipFile(OUT) as archive:
    assert archive.testzip() is None
    for name,digest in manifest['files'].items():assert hashlib.sha256(archive.read('giscus-workers-v2/'+name)).hexdigest()==digest
(ROOT.parent/'giscus-workers-v2.sha256').write_text(hashlib.sha256(OUT.read_bytes()).hexdigest()+'  giscus-workers-v2.zip\n')
print(json.dumps({'archive':str(OUT),'files':len(files),'bytes':OUT.stat().st_size,'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest()},indent=2))
