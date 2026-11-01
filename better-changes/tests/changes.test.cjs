const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function harness(mode='sidebar') {
 const pending=[],values={},calls=[],commands=[],live={spaces:[],panes:[]};
 function el(){const data={nodes:[],handlers:{}};let proxy;proxy=new Proxy(data,{get(t,k){if(k in t)return t[k];if(k==='child')return c=>{t.nodes.push(c);return proxy};if(k==='children')return cs=>{t.nodes.push(...cs);return proxy};if(k==='when')return(b,f)=>{if(b)f(proxy);return proxy};return(...a)=>{if(k==='id')t.id=a[0];if(k.startsWith('on_'))t.handlers[k.slice(3)]=a.at(-1);return proxy}}});return proxy;}
 const state=()=>({text:'',value(){return this.text},set_value(v){this.text=v},on(){}});
 const cx={stop_propagation(){},notify(){},timer:{every(){}},spawn(fn){pending.push(fn(cx))}};
 const context={View:class{},div:el,svg:el,v_flex:el,h_flex:el,InputState:{new:state},Input:{new:el},Scrollbar:{vertical:el},v_virtual_list:()=>el(),
 spaces:()=>live.spaces,panes:()=>live.panes,focused:()=>null,props:()=>({mode}),theme:()=>({}),settings:()=>({font_size:14,font_family:'Configured code'}),
 localStorage:{getItem:()=>null,setItem(){}},shared:k=>values[k],setShared:(k,v)=>values[k]=v,layout:()=>({id:'center-body',type:'stack',active:'main',children:[{id:'main'},{id:'file-diff'}]}),run:(cmd,args)=>commands.push({cmd,args}),
 nextCommand:()=>new Promise(()=>{}),watchFolder:async()=>{throw Error('test')},readTextFile:async()=>null,exec:async(cmd,args,options)=>{calls.push({cmd,args,options});return{code:0,stdout:''}}};
 vm.createContext(context);
 for(const file of ['typography.js','model.js','main.js'])vm.runInContext(fs.readFileSync(`mods/better-changes/${file}`,'utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replace('export default class Changes','globalThis.Changes=class Changes'),context);
 const mod=new context.Changes();mod.init({},cx);pending.length=0;live.spaces=[{id:'s',active:true,folder:'/repo',tabs:[{id:'t',active:true}]}];live.panes=[{tab:'t',cwd:'/repo',focused:true}];
 mod.context=JSON.stringify({cwd:'/repo',on:null});mod.root='/repo';mod.on=null;mod.hasHead=true;
 return{mod,cx,context,values,calls,commands,live,flush:async()=>{while(pending.length)await Promise.all(pending.splice(0))}};
}
function find(node,id){if(node?.id===id)return node;for(const c of node?.nodes??[]){const hit=find(c,id);if(hit)return hit;}}
const files=[{path:'src/app.js',status:'M',add:2,del:1,staged:false,unstaged:true,unstagedStats:{add:2,del:1}},{path:'src/lib/new.js',status:'A',fresh:true,add:0,del:0,staged:false,unstaged:true},{path:'README.md',status:'M',add:1,del:0,staged:true,unstaged:false,stagedStats:{add:1,del:0}}];
test('porcelain and numstat preserve special filenames, conflicts, deletions and binary changes',()=>{
 const h=harness();h.context.status=' M path with spaces\0?? nested/new\tname\0UU conflict\0 D deleted\0 M image.png\0';h.context.stats=['2\t3\tpath with spaces\0-\t-\timage.png\0'];
 const parsed=vm.runInContext('changedFiles(status,stats)',h.context);assert.equal(parsed.find(f=>f.path==='path with spaces').del,3);assert.equal(parsed.find(f=>f.path==='nested/new\tname').fresh,true);assert.equal(parsed.find(f=>f.path==='conflict').status,'U');assert.equal(parsed.find(f=>f.path==='deleted').status,'D');assert.equal(parsed.find(f=>f.path==='image.png').binary,true);
});
test('tree groups directories and collapsed folders hide descendants',()=>{
 const h=harness();h.context.files=files;const tree=vm.runInContext('fileTree(files)',h.context);assert.equal(tree[0].kind,'folder');assert.equal(tree[0].path,'src');assert.equal(tree.find(r=>r.file?.path==='src/lib/new.js').depth,2);
 const collapsed=vm.runInContext('fileTree(files,new Set(["src"]))',h.context);assert.equal(collapsed.length,2);assert.equal(collapsed[1].file.path,'README.md');
});
test('diff rows preserve old and new line numbers through additions and deletions',()=>{
 const h=harness();h.context.lines=['@@ -3,2 +3,2 @@',' old','-removed','+added','\\ No newline at end of file'];const rows=vm.runInContext('diffRows(lines)',h.context);assert.equal(rows[1].old,3);assert.equal(rows[1].next,3);assert.equal(rows[2].old,4);assert.equal(rows[2].next,undefined);assert.equal(rows[3].next,4);
});
test('sidebar toggles tree and flat views and opens selected file in the center without inline diff',()=>{
 const h=harness();h.mod.files=files;h.mod.total=3;let rendered=h.mod.render(h.cx);assert.ok(find(rendered,'changes-folder-unstaged-src'));assert.equal(find(rendered,'factory-diff-x'),undefined);
 find(rendered,'changes-flat').handlers.click({},h.cx);rendered=h.mod.render(h.cx);assert.equal(find(rendered,'changes-folder-unstaged-src'),undefined);
 find(rendered,'change-unstaged-src/app.js').handlers.click({},h.cx);assert.equal(h.values['better-changes.selection'].path,'src/app.js');assert.equal(h.commands[0].cmd,'tab.new');assert.equal(h.commands[0].args.name,'app.js');assert.equal(h.commands[0].args.mod,'better-changes');assert.equal(h.commands[1].args.child,'main');
});
test('center diff runs readonly Git on the space machine and close targets its own tab',async()=>{
 const h=harness('diff');h.mod.files=files;h.mod.on='remote';h.values['better-changes.selection']={context:h.mod.context,path:'src/app.js',previous:'main'};
 h.context.exec=async(cmd,args,options)=>{h.calls.push({cmd,args,options});return{code:0,stdout:'diff --git a/src/app.js b/src/app.js\n@@ -1 +1 @@\n-before\n+after\n'}};
 h.mod.syncSelection(h.cx);await h.flush();assert.equal(h.mod.rows.length,3);assert.equal(h.calls[0].options.on,'remote');assert.ok(h.calls[0].args.includes('--no-ext-diff'));assert.ok(h.calls[0].args.includes('--no-textconv'));
 const rendered=h.mod.render(h.cx);assert.equal(find(rendered,'changes-list'),undefined);assert.ok(find(rendered,'factory-diff-x'));h.mod.diffSpace='s';h.live.spaces[0].tabs.push({id:'diff'});h.live.panes.push({tab:'diff',mod:'better-changes'});find(rendered,'diff-close').handlers.click({},h.cx);assert.equal(h.commands[0].cmd,'tab.close');assert.equal(h.commands[0].args.id,'diff');
});
test('late diff responses cannot replace another selected file',async()=>{
 const h=harness('diff');h.mod.files=files;let finish;
 h.context.exec=()=>new Promise(resolve=>finish=resolve);h.mod.path='src/app.js';h.mod.loadDiff(h.cx);
 h.mod.path='src/lib/new.js';h.context.readTextFile=async()=> 'new content\n';h.mod.loadDiff(h.cx);finish({code:0,stdout:'@@ -1 +1 @@\n-old\n+stale\n'});await h.flush();assert.ok(h.mod.rows.some(r=>r.text==='new content'));assert.ok(!h.mod.rows.some(r=>r.text==='stale'));
});
test('binary and empty new files have explicit previews; changing context clears old selection',async()=>{
 const h=harness('diff');h.mod.files=files;h.mod.path='src/lib/new.js';h.context.readTextFile=async()=>'';h.mod.loadDiff(h.cx);await h.flush();assert.equal(h.mod.rows[0].text,'Empty new file');
 h.context.readTextFile=async()=> 'bin\0data';h.mod.loadDiff(h.cx);await h.flush();assert.match(h.mod.rows[0].text,/Binary/);
 h.values['better-changes.selection']={context:'another-space',path:'secret'};h.mod.syncSelection(h.cx);assert.equal(h.mod.path,null);assert.equal(h.mod.rows.length,0);
});
test('partial staging keeps distinct index and working tree statistics and conflicts stay unstaged',()=>{
 const h=harness();h.context.status='MM partial\0A  added\0 D deleted\0?? fresh\0UU conflict\0';h.context.stats=['1\t1\tpartial\0','2\t3\tpartial\0'];
 const result=vm.runInContext('changedFiles(status,stats)',h.context),partial=result.find(f=>f.path==='partial');assert.equal(partial.staged,true);assert.equal(partial.unstaged,true);assert.equal(partial.stagedStats.add,1);assert.equal(partial.unstagedStats.add,2);
 assert.equal(result.find(f=>f.path==='fresh').staged,false);assert.equal(result.find(f=>f.path==='added').unstaged,false);assert.equal(result.find(f=>f.path==='conflict').staged,false);assert.equal(result.find(f=>f.path==='conflict').conflict,true);
});
test('file and bulk index actions use literal paths, keep remote context, and avoid opening a diff',async()=>{
 for(const [action,path,head,expected] of [
 ['stage','src/app.js',true,['--literal-pathspecs','add','--','src/app.js']],
 ['unstage','README.md',true,['--literal-pathspecs','reset','-q','HEAD','--','README.md']],
 ['stage',null,true,['add','-A']],
 ['unstage',null,true,['--literal-pathspecs','reset','-q','HEAD','--','.']],
 ['unstage','README.md',false,['--literal-pathspecs','rm','--cached','-r','-f','--','README.md']]]){
  const h=harness();h.mod.files=files;h.mod.on='remote';h.mod.hasHead=head;h.mod.refresh=()=>{};
  h.mod.indexAction(action,path,h.cx);h.mod.indexAction(action,path,h.cx);await h.flush();assert.equal(h.calls.length,1);assert.deepEqual(Array.from(h.calls[0].args.slice(5)),expected);assert.equal(h.calls[0].options.on,'remote');assert.equal(h.commands.length,0);assert.equal(h.mod.busy,false);assert.ok(h.values['better-changes.reload']);
 }
});
test('staging failure retains the commit message and unlocks controls',async()=>{
 const h=harness();h.mod.files=files;h.mod.message='Keep message';h.mod.refresh=()=>{};h.context.exec=async()=>({code:128,stderr:'index.lock exists'});
 h.mod.indexAction('stage','src/app.js',h.cx);await h.flush();assert.match(h.mod.note,/Stage failed: index.lock/);assert.equal(h.mod.message,'Keep message');assert.equal(h.mod.busy,false);assert.equal(h.values['better-changes.reload'],undefined);
});
test('commit writes only the staged index and refuses empty staging or conflicts',async()=>{
 const h=harness();h.mod.message='Commit staged work';h.mod.refresh=()=>{};h.mod.commit(h.cx);await h.flush();assert.equal(h.calls.length,0);
 h.mod.stagedCount=1;h.mod.conflicts=true;h.mod.commit(h.cx);await h.flush();assert.equal(h.calls.length,0);
 h.mod.conflicts=false;h.mod.commit(h.cx);await h.flush();assert.equal(h.calls.length,1);assert.deepEqual(Array.from(h.calls[0].args.slice(5)),['commit','-m','Commit staged work']);assert.equal(h.mod.message,'');
});
test('staged and unstaged entries render separately and select the correct diff version',async()=>{
 const h=harness();h.mod.files=[{...files[0],staged:true,unstaged:true}];h.mod.stagedCount=1;h.mod.unstagedCount=1;
 const rendered=h.mod.render(h.cx);assert.ok(find(rendered,'change-staged-src/app.js'));assert.ok(find(rendered,'change-unstaged-src/app.js'));
 find(rendered,'change-staged-src/app.js').handlers.click({},h.cx);assert.equal(h.values['better-changes.selection'].scope,'staged');
 const d=harness('diff');d.mod.files=h.mod.files;d.mod.path='src/app.js';d.context.exec=async(cmd,args,options)=>{d.calls.push({cmd,args,options});return{code:0,stdout:'@@ -1 +1 @@\n-old\n+new\n'}};
 d.mod.scope='staged';d.mod.loadDiff(d.cx);await d.flush();assert.ok(d.calls[0].args.includes('--cached'));
 d.mod.scope='unstaged';d.mod.loadDiff(d.cx);await d.flush();assert.ok(!d.calls[1].args.includes('--cached'));assert.ok(!d.calls[1].args.includes('HEAD'));
});
test('initial staging and unstaging preserve working files and literal filenames in real Git',async()=>{
 const os=require('node:os'),path=require('node:path'),cp=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'herdr-stage-'));
 const git=args=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  git(['init','-q']);const filename='[sample].txt';fs.writeFileSync(path.join(dir,filename),'original\n');fs.writeFileSync(path.join(dir,'s.txt'),'other\n');
  const h=harness();h.live.spaces[0].folder=dir;h.live.panes[0].cwd=dir;h.mod.context=JSON.stringify({cwd:dir,on:null});h.mod.root=dir;h.mod.hasHead=false;h.mod.refresh=()=>{};
  h.mod.files=[{path:filename,unstaged:true,staged:true}];h.context.exec=async(cmd,args)=>{try{return{code:0,stdout:git(args)}}catch(e){return{code:e.status,stderr:e.stderr.toString()}}};
  h.mod.indexAction('stage',filename,h.cx);await h.flush();assert.equal(h.mod.note,null);assert.equal(git(['ls-files']).trim(),filename);
  fs.writeFileSync(path.join(dir,filename),'working edits\n');h.mod.indexAction('unstage',filename,h.cx);await h.flush();assert.equal(h.mod.note,null);assert.equal(git(['ls-files']).trim(),'');assert.equal(fs.readFileSync(path.join(dir,filename),'utf8'),'working edits\n');
  git(['config','user.name','Test']);git(['config','user.email','test@example.invalid']);git(['add','--',filename]);git(['commit','-qm','baseline']);
  fs.writeFileSync(path.join(dir,filename),'staged version\n');git(['add','--',filename]);fs.writeFileSync(path.join(dir,filename),'unstaged version\n');
  h.mod.hasHead=true;h.mod.stagedCount=1;h.mod.message='Commit index only';h.mod.commit(h.cx);await h.flush();assert.equal(h.mod.note,null);
  assert.equal(git(['show',`HEAD:${filename}`]),'staged version\n');assert.equal(fs.readFileSync(path.join(dir,filename),'utf8'),'unstaged version\n');
  h.mod.indexAction('stage',filename,h.cx);await h.flush();h.mod.indexAction('unstage',filename,h.cx);await h.flush();assert.equal(h.mod.note,null);assert.equal(git(['diff','--cached']),'');assert.equal(fs.readFileSync(path.join(dir,filename),'utf8'),'unstaged version\n');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('different files reuse and rename the same diff tab, and closing permits a replacement',()=>{
 const h=harness();h.mod.files=files;h.mod.pick(files[0],h.cx,'unstaged');assert.equal(h.commands.filter(c=>c.cmd==='tab.new').length,1);
 h.live.spaces[0].tabs.push({id:'diff',name:'app.js'});h.live.panes.push({tab:'diff',mod:'better-changes'});
 h.mod.pick(files[2],h.cx,'staged');assert.equal(h.commands.filter(c=>c.cmd==='tab.new').length,1);assert.ok(h.commands.some(c=>c.cmd==='tab.rename'&&c.args.id==='diff'&&c.args.name==='README.md'));assert.ok(h.commands.some(c=>c.cmd==='tab.select'&&c.args.id==='diff'));
 h.live.spaces[0].tabs=h.live.spaces[0].tabs.filter(t=>t.id!=='diff');h.live.panes=h.live.panes.filter(p=>p.tab!=='diff');h.mod.pick(files[0],h.cx,'unstaged');assert.equal(h.commands.filter(c=>c.cmd==='tab.new').length,2);
});
test('rapid file picks while a diff tab is opening create only one tab and keep the latest file',()=>{
 const h=harness();h.mod.pick(files[0],h.cx);h.mod.pick(files[2],h.cx);assert.equal(h.commands.filter(c=>c.cmd==='tab.new').length,1);assert.equal(h.values['better-changes.diff-tabs'].s.selection.path,'README.md');
});
test('a diff tab pins its source directory when the mod tab has no terminal cwd or another space is selected',()=>{
 const h=harness('diff');h.mod.diffSpace='s';h.mod.source={cwd:'/original',on:'remote'};h.values['better-changes.diff-tabs']={s:{source:{cwd:'/repo',on:null},selection:{context:h.mod.context,path:'README.md'}}};
 h.live.spaces[0].tabs=[{id:'diff',active:true}];h.live.panes=[{tab:'diff',mod:'better-changes',cwd:null}];
 assert.equal(vm.runInContext('location().cwd',h.context),'/repo');assert.equal(h.mod.location().cwd,'/repo');
 h.live.spaces=[{id:'other',active:true,folder:'/other',tabs:[]}];assert.equal(h.mod.location().cwd,'/repo');assert.equal(h.mod.currentSelection().path,'README.md');
});
test('split diff aligns replacement blocks and preserves context and hunk boundaries',()=>{
 const h=harness();h.context.lines=['@@ -1,4 +1,3 @@',' same','-old one','-old two','+new one',' tail','@@ -10 +9,2 @@','+extra',' last'];
 const paired=vm.runInContext('splitDiffRows(diffRows(lines))',h.context);
 assert.equal(paired[0].kind,'@');assert.equal(paired[1].left.text,'same');assert.equal(paired[1].right.text,'same');
 assert.equal(paired[2].left.text,'old one');assert.equal(paired[2].right.text,'new one');assert.equal(paired[3].left.text,'old two');assert.equal(paired[3].right,null);
 assert.equal(paired[4].left.text,'tail');assert.equal(paired[5].kind,'@');assert.equal(paired[6].left,null);assert.equal(paired[6].right.text,'extra');assert.equal(paired[7].right.text,'last');
});
test('sidebar diff layout toggle shares and saves preference without opening a tab or reloading Git',()=>{
 const h=harness(),saved={};h.context.localStorage.setItem=(k,v)=>saved[k]=v;
 find(h.mod.render(h.cx),'changes-diff-split').handlers.click({},h.cx);assert.equal(h.mod.diffLayout,'split');assert.equal(h.values['better-changes.diff-layout'],'split');assert.equal(saved['better-changes.diff-layout'],'split');assert.equal(h.commands.length,0);assert.equal(h.calls.length,0);
 find(h.mod.render(h.cx),'changes-diff-inline').handlers.click({},h.cx);assert.equal(h.values['better-changes.diff-layout'],'inline');
});
test('side by side uses paired rows and one virtual list while retaining the same file selection',()=>{
 const h=harness('diff');h.mod.path='src/app.js';h.mod.rows=[{kind:'-',old:1,text:'before'},{kind:'+',next:1,text:'after'}];h.mod.diffLayout='split';
 const rendered=h.mod.render(h.cx);assert.ok(find(rendered,'diff-scroll-left'));assert.ok(find(rendered,'diff-scroll-right'));assert.equal(find(rendered,'factory-diff-x'),undefined);assert.equal(h.mod.pairedRows.length,1);assert.equal(h.mod.path,'src/app.js');
 h.mod.width=2000;h.mod.scrollSplit(100,h.cx);assert.equal(h.mod.splitOffset,100);h.mod.scrollSplit(-500,h.cx);assert.equal(h.mod.splitOffset,0);
 h.mod.setDiffLayout('inline',h.cx);assert.ok(find(h.mod.render(h.cx),'factory-diff-x'));assert.equal(h.mod.path,'src/app.js');assert.equal(h.commands.length,0);
});
test('ordinary layouts open the diff tab without requiring a Factory center stack',()=>{
 const h=harness();h.context.layout=()=>({id:'root',children:[{id:'main',content:{tab:'active'}}]});h.mod.pick(files[0],h.cx);
 assert.equal(h.commands.filter(c=>c.cmd==='tab.new').length,1);assert.equal(h.commands.filter(c=>c.cmd==='layout.select').length,0);
});
