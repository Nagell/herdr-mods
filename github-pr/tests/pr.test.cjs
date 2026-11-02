const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(existingStorage) {
  const pending = [], storage = existingStorage ?? new Map(), timers = [];
  const cx = { focus_handle:()=>({focus(){}}), stop_propagation() {}, notify() {}, open_url() {}, spawn(fn) { const p = fn(cx); pending.push(p); }, timer: { every() {}, after(_ms,fn) { timers.push(fn); } } };
  function el() {
    const data = { nodes: [], handlers: {} }; let proxy;
    proxy = new Proxy(data,{get(t,k){if(k in t)return t[k];if(k==='child')return c=>{t.nodes.push(c);return proxy};if(k==='children')return cs=>{t.nodes.push(...cs);return proxy};if(k==='when')return(b,f)=>{if(b)f(proxy);return proxy};return(...a)=>{if(k==='id')t.elementId=a[0];if(k==='trigger'||k==='content')t.nodes.push(a[0]);if(k.startsWith('on_'))t.handlers[k.slice(3)]=a[0];if(k==='on_click')t.handlers.click=a[0];return proxy}}}); return proxy;
  }
  const state = ({ value = '' } = {}) => ({ text: value, value() { return this.text; }, set_value(v) { this.text = v; }, on() {} });
  const live = { spaces: [], panes: [], agents: [], terminals: [] };
  const context = { View: class {}, div: el, svg: el, Popover:{new:(id)=>el().id(id)}, v_flex: el, h_flex: el, InputState: {new:state}, TextareaState:{new:state}, Input:{new:el}, Textarea:{new:el}, TextView:{markdown:(_id,text)=>el().child(text)},
    spaces:()=>live.spaces, panes:()=>live.panes, agents:()=>live.agents, terminals:()=>live.terminals,
    readTextFile:async()=>null,shared:()=>null,setShared:()=>{},settings:()=>({font_size:14,ui_font_family:"Configured UI",font_family:"Configured Code"}),run:()=>{},props:()=>({}),nextCommand:()=>new Promise(()=>{}),theme:()=>({}),layout:()=>null,home:()=>'/home/user',appHome:()=>'/app',exec:async()=>({code:0,stdout:'{}'}),hc:async()=>({code:0}),
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console };
  vm.createContext(context);
  const typography=fs.readFileSync('mods/github-pr/typography.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function');
  vm.runInContext(typography,context);
  const source=fs.readFileSync('mods/github-pr/main.js','utf8').replace(/^import .*;\n/gm,'').replace('export default class PullRequests','globalThis.Mod = class PullRequests');
  vm.runInContext(source,context);
  const mod=new context.Mod(); mod.init({},cx); pending.length=0; mod.repo='owner/repo';mod.sp={id:'space',folder:'/repo'};mod.spaceKey='space';
  return {mod,cx,live,storage,context,tick:()=>{for(const fn of timers.splice(0))fn(cx)},flush:async()=>{while(pending.length)await Promise.all(pending.splice(0))}};
}
const pr = () => ({id:'pr',number:2,title:'Example',url:'https://github.com/o/r/pull/2',body:'Description',headRefOid:'abc',baseRefName:'main',headRefName:'fix',state:'OPEN',author:{login:'alice'},comments:[{id:'c',body:'General',url:'https://github.com/o/r/pull/2#issuecomment-1',createdAt:'2026-01-01',author:{login:'alice'}}],reviews:[],threads:[{id:'thread',path:'file.go',line:3,isResolved:false,viewerCanReply:true,viewerCanResolve:true,comments:[{id:'r',body:'Review concern',url:'https://github.com/o/r/pull/2#discussion_r1',author:{login:'bob'},createdAt:'2026-01-01',diffHunk:'@@\ncode'}]}],checks:[{name:'test',status:'COMPLETED',conclusion:'FAILURE',detailsUrl:'https://github.com/o/r/actions/runs/9'}]});
function strings(node) { if(typeof node==='string')return node;return (node?.nodes??[]).map(strings).join('\n'); }

test('detail, author filter, checks and composer render',()=>{
 const {mod}=harness();mod.pr=pr(); mod.section="conversation"; assert.match(strings(mod.render()),/Review concern/);
 mod.author='alice';assert.doesNotMatch(strings(mod.render()),/Review concern/);
 mod.author='bob';assert.match(strings(mod.render()),/Review concern/);
 mod.section='checks';mod.checkOpen['pr:0']=true;mod.jobs['9']={jobs:[{id:4,name:'test',conclusion:'failure',steps:[{number:1,name:'Run tests',conclusion:'failure'}]}]};assert.match(strings(mod.render()),/Failed step output/);
 mod.composer={kind:'agent'};assert.match(strings(mod.render()),/No live AI instances/);
});
test('stale list response does not replace another space',async()=>{
 const h=harness();let complete;h.mod.api=()=>new Promise(resolve=>complete=resolve);h.mod.loadList(h.cx);
 h.mod.changeSpace(null,'other',h.cx);complete({items:[{id:'old'}],cursors:{}});await h.flush();assert.equal(h.mod.items.length,0);
});
test('failed posting retains draft; successful posting clears it',async()=>{
 const h=harness();h.mod.pr=pr();h.mod.compose('reply','thread',null,h.cx);h.mod.editor.set_value('Keep this');h.storage.set(h.mod.draftKey,'Keep this');
 h.mod.api=async()=>{throw Error('offline')};h.mod.mutate('reply',h.cx,'thread');await h.flush();assert.equal(h.mod.editor.value(),'Keep this');assert.equal(h.storage.get(h.mod.draftKey),'Keep this');assert.match(h.mod.error,/offline/);
 h.mod.api=async r=>r.action==='detail'?pr():{};h.mod.mutate('reply',h.cx,'thread');await h.flush();assert.equal(h.mod.composer,null);assert.equal([...h.storage.keys()].filter(k=>k.startsWith('pr-draft:')).length,0);
});
test('repo detection follows the active terminal cwd',()=>{
 const h=harness();h.live.spaces=[{active:true,id:'s',folder:'/home',tabs:[{active:true,id:'tab'}]}];h.live.panes=[{tab:'tab',cwd:'/repo',focused:true}];assert.equal(vm.runInContext('activeSpace().folder',h.context),'/repo');
});
test('agent delivery requires selection and includes revision context',async()=>{
 const h=harness();h.mod.pr=pr();h.mod.compose('agent','thread','bob: Review concern',h.cx);
 let sent;h.context.hc=async args=>{sent=args;return{code:0}};
 h.mod.sendAgent(h.cx);await h.flush();assert.equal(sent,undefined);
 h.live.agents=[{address:'t7',space:'space',tab_name:'Analyst',status:'working'}];h.mod.target='t7';h.mod.sendAgent(h.cx);await h.flush();
 assert.equal(sent[0],'send');assert.equal(sent[1],'t7');assert.match(sent[2],/"head":"abc"/);assert.match(sent[2],/Review concern/);assert.match(sent[2],/Do not post comments/);assert.equal(h.mod.composer,null);
});
test('search waits for typing to stop, requires three characters, and resets when shortened',async()=>{
 const h=harness(),requests=[];h.mod.api=async r=>{requests.push(r);return{items:[],cursors:{}}};
 h.mod.search.set_value('ab');h.mod.searchChanged(h.cx);h.tick();await h.flush();assert.equal(requests.length,0);
 h.mod.search.set_value('abc');h.mod.searchChanged(h.cx);h.mod.search.set_value('abcd');h.mod.searchChanged(h.cx);assert.equal(requests.length,0);
 h.tick();await h.flush();assert.equal(requests.length,1);assert.equal(requests[0].search,'abcd');
 h.mod.search.set_value('ab');h.mod.searchChanged(h.cx);h.tick();await h.flush();assert.equal(requests[1].search,'');
});
test('repository detection prefers upstream and executes git on the space machine',async()=>{
 const h=harness(),calls=[];h.context.exec=async(cmd,args,options)=>{calls.push({cmd,args,options});return{code:0,stdout:'git@github.com:upstream/project.git\n'}};
 assert.equal(await h.mod.detectRepo({folder:'/repo',machine:'remote'}),'upstream/project');assert.equal(calls.length,1);assert.equal(calls[0].args.join(' '),'remote get-url upstream');assert.equal(calls[0].options.on,'remote');
});
test('repository detection falls back to branch tracking then origin',async()=>{
 const h=harness(),calls=[];h.context.exec=async(cmd,args)=>{calls.push(args.join(' '));if(args[0]==='symbolic-ref')return{code:0,stdout:'feature\n'};if(args[0]==='config')return{code:0,stdout:'fork\n'};if(args[2]==='origin')return{code:0,stdout:'https://github.com/owner/project.git'};return{code:1,stdout:''}};
 assert.equal(await h.mod.detectRepo({folder:'/repo'}),'owner/project');assert.equal(calls.at(-2),'remote get-url fork');assert.equal(calls.at(-1),'remote get-url origin');
 assert.throws(()=>vm.runInContext('repositoryFromRemote("https://notgithub.com/o/r.git")',h.context));
});
test('list chrome has dropdown filters and no manual repository or search buttons',()=>{
 const h=harness(),text=strings(h.mod.render());assert.match(text,/All PRs/);assert.ok(findElement(h.mod.render(),'pr-scope'));assert.ok(findElement(h.mod.render(),'pr-search-input'));assert.match(text,/owner\/repo/);assert.doesNotMatch(text,/Use repo|Search GitHub|Clear|Refresh/);
});
function findElement(node,id) { if(node?.elementId===id)return node;for(const child of node?.nodes??[]){const found=findElement(child,id);if(found)return found} }
test('native status popover exposes its trigger and selects each filter',async()=>{
 const h=harness(),requests=[];h.mod.api=async r=>{requests.push(r);return{items:[],cursors:{}}};
 for(const [state,label] of [['draft','Draft'],['merged','Merged'],['closed','Closed'],['all','All'],['open','Open']]){
  const closed=h.mod.render(),popover=findElement(closed,'pr-state');
  assert.ok(findElement(popover,'pr-state-trigger'),'native popover must own the trigger');
  assert.equal(findElement(closed,'pr-state-menu'),undefined);
  popover.handlers.open_change(true,h.cx);
  const opened=h.mod.render();assert.ok(findElement(opened,'pr-state-menu'));
  findElement(opened,`pr-state-${state}`).handlers.click({},h.cx);await h.flush();
  assert.equal(h.mod.state,state);assert.equal(h.mod.stateOpen,false);assert.equal(requests.at(-1).state,state);
  assert.match(strings(findElement(h.mod.render(),'pr-state-trigger')),new RegExp(label));
 }
});
test('status popover supports keyboard selection and native dismissal',async()=>{
 const h=harness();h.mod.api=async()=>({items:[],cursors:{}});
 findElement(h.mod.render(),'pr-state-trigger').handlers.key_down({key:'down'},h.cx);assert.equal(h.mod.stateOpen,true);
 let opened=h.mod.render();findElement(opened,'pr-state-menu').handlers.key_down({key:'down'},h.cx);
 opened=h.mod.render();findElement(opened,'pr-state-menu').handlers.key_down({key:'enter'},h.cx);await h.flush();
 assert.equal(h.mod.state,'draft');assert.equal(h.mod.stateOpen,false);
 findElement(h.mod.render(),'pr-state').handlers.open_change(true,h.cx);
 findElement(h.mod.render(),'pr-state').handlers.open_change(false,h.cx);assert.equal(h.mod.stateOpen,false);
});
test('remote menu discovers GitHub remotes and disables other hosts',async()=>{
 const h=harness(),calls=[];h.context.exec=async(cmd,args,options)=>{
  calls.push({args,options});if(args.length===1)return{code:0,stdout:'origin\nupstream\narchive\n'};
  return{code:0,stdout:args.at(-1)==='archive'?'git@gitlab.com:owner/archive.git':`git@github.com:${args.at(-1)}/repo.git`};
 };
 const remotes=await h.mod.discoverRemotes({folder:'/checkout',machine:'remote'});
 assert.equal(remotes.length,3);assert.equal(remotes.find(r=>r.name==='archive').repo,null);assert.equal(remotes.find(r=>r.name==='upstream').repo,'upstream/repo');assert.ok(calls.every(c=>c.options.on==='remote'&&c.options.cwd==='/checkout'));
 h.mod.remotes=remotes;h.mod.remote='origin';findElement(h.mod.remoteSelector({}),'pr-remote').handlers.open_change(true,h.cx);
 const opened=h.mod.remoteSelector({});assert.match(strings(findElement(opened,'pr-remote-menu')),/Not a GitHub remote/);assert.equal(findElement(opened,'pr-remote-archive').handlers.click,undefined);
});
test('selecting remote updates PR scope, preserves drafts, and invalidates stale requests',async()=>{
 const h=harness(),requests=[];let finishOld;
 h.mod.api=r=>{requests.push(r);if(requests.length===1)return new Promise(resolve=>finishOld=resolve);return Promise.resolve({items:[],cursors:{}})};
 h.mod.loadList(h.cx);h.mod.pr=pr();h.mod.compose('reply','thread',null,h.cx);h.storage.set(h.mod.draftKey,'Saved reply');
 h.mod.remotes=[{name:'origin',repo:'fork/repo'},{name:'upstream',repo:'owner/repo'}];h.mod.remote='upstream';
 findElement(h.mod.remoteSelector({}),'pr-remote').handlers.open_change(true,h.cx);
 findElement(h.mod.remoteSelector({}),'pr-remote-origin').handlers.click({},h.cx);
 finishOld({items:[{id:'stale'}],cursors:{}});await h.flush();
 assert.equal(h.mod.repo,'fork/repo');assert.equal(h.mod.remote,'origin');assert.equal(h.mod.pr,null);assert.equal(h.mod.items.length,0);assert.equal(requests.at(-1).repo,'fork/repo');assert.ok([...h.storage.values()].includes('Saved reply'));assert.equal(h.storage.get(h.mod.remotePreferenceKey()),'origin');
});
test('saved remote is restored and missing preference falls back to upstream',async()=>{
 const h=harness();h.mod.discoverRemotes=async()=>[{name:'origin',repo:'fork/repo'},{name:'upstream',repo:'owner/repo'}];h.mod.detectRepo=async()=> 'owner/repo';h.mod.api=async()=>({items:[],cursors:{}});
 h.storage.set(h.mod.remotePreferenceKey(),'origin');h.mod.resolveRepo(h.cx);await h.flush();assert.equal(h.mod.repo,'fork/repo');assert.equal(h.mod.remote,'origin');
 h.storage.set(h.mod.remotePreferenceKey(),'deleted');h.mod.resolveRepo(h.cx);await h.flush();assert.equal(h.mod.repo,'owner/repo');assert.equal(h.mod.remote,'upstream');assert.equal(h.storage.get(h.mod.remotePreferenceKey()),undefined);
});
test('branch sidebar loads matching PR details directly and supports choosing another PR',async()=>{
 const h=harness();h.mod.mode='branch';h.mod.discoverRemotes=async()=>[{name:'origin',repo:'fork/repo'},{name:'upstream',repo:'owner/repo'}];
 h.context.exec=async()=>({code:0,stdout:'feature\n'});
 const candidates=[{id:'a',number:1,repository:'owner/repo',headRepository:{nameWithOwner:'fork/repo'},state:'OPEN',updatedAt:'2026-01-02',title:'First'},{id:'b',number:2,repository:'owner/repo',headRepository:{nameWithOwner:'fork/repo'},state:'OPEN',updatedAt:'2026-01-01',title:'Second'},{id:'unrelated',number:3,repository:'owner/repo',headRepository:{nameWithOwner:'other/repo'},state:'OPEN',updatedAt:'2026-01-03'}];
 h.mod.api=async r=>r.action==='branch'?{items:r.repo==='owner/repo'?candidates:[]}:{...pr(),number:r.number,id:r.number===1?'a':'b'};
 h.mod.loadBranchPRs(h.cx);await h.flush();assert.equal(h.mod.branchPRs.length,2);assert.equal(h.mod.pr.number,1);assert.equal(findElement(h.mod.render(),'pr-back'),undefined);assert.equal(findElement(h.mod.render(),'pr-remote'),undefined);
 findElement(h.mod.render(),'branch-pr').handlers.open_change(true,h.cx);
 findElement(h.mod.render(),'branch-pr-b').handlers.click({},h.cx);await h.flush();assert.equal(h.mod.pr.number,2);
 h.mod.loadBranchPRs(h.cx);await h.flush();assert.equal(h.mod.pr.number,2);
});
test('branch sidebar handles detached HEAD and branches without PRs',async()=>{
 const h=harness();h.mod.mode='branch';h.context.exec=async()=>({code:1,stdout:''});h.mod.loadBranchPRs(h.cx);await h.flush();assert.match(strings(h.mod.render()),/Check out a branch/);
 h.context.exec=async()=>({code:0,stdout:'new-feature'});h.mod.discoverRemotes=async()=>[{repo:'owner/repo'}];h.mod.api=async()=>({items:[]});h.mod.loadBranchPRs(h.cx);await h.flush();assert.match(strings(h.mod.render()),/No pull requests found for new-feature/);
});
test('temporary public preview loads chosen PRs, blocks writes, and can be disabled',async()=>{
 const h=harness();h.mod.mode='branch';const requests=[];h.mod.api=async r=>{requests.push(r);return{...pr(),id:`preview-${r.number}`,number:r.number}};
 h.context.exec=async()=>{throw Error('preview must not run git')};h.mod.setPreview('cli/cli#14854,14858',h.cx);await h.flush();
 assert.equal(h.mod.pr.number,14854);assert.equal(h.mod.branchPRs.length,2);assert.equal(h.mod.repo,'cli/cli');assert.match(strings(h.mod.render()),/read-only/);
 const count=requests.length;h.mod.mutate('comment',h.cx);await h.flush();assert.equal(requests.length,count);assert.match(h.mod.error,/read-only/);
 h.context.exec=async()=>({code:1,stdout:''});h.mod.setPreview('off',h.cx);await h.flush();assert.equal(h.mod.preview,null);assert.equal(h.mod.pr,null);
});
test('branch sidebar All PRs opens a pinned browser tab without Better Tabs',()=>{
 const h=harness(),calls=[],state={};h.mod.mode='branch';h.context.run=(name,args)=>calls.push({name,args});
 h.context.shared=key=>state[key];h.context.setShared=(key,value)=>state[key]=value;
 h.live.spaces=[{id:'space',active:true,folder:'/main',tabs:[{id:'shell',active:true}]}];
 h.live.panes=[{tab:'shell',cwd:'/worktree',focused:true}];
 const open=()=>findElement(h.mod.render(),'pr-browser-toggle').handlers.click({},h.cx);
 open();assert.equal(calls.length,1);assert.equal(calls[0].name,'tab.new');assert.equal(calls[0].args.mod,'github-pr');
 assert.equal(calls[0].args.props.source.cwd,'/worktree');open();assert.equal(calls.length,1);
 h.live.spaces[0].tabs.push({id:'browser'});h.live.panes.push({mod:'github-pr',tab:'browser'});
 open();assert.equal(calls.at(-1).name,'tab.select');assert.equal(calls.at(-1).args.id,'browser');
});
test('browser tab has no internal close or stack toggle control',()=>{
 const h=harness();const root=h.mod.render();
 for(const id of ['pr-browser-close','pr-refresh','pr-github','pr-remote','pr-browser-toggle'])assert.equal(findElement(root,id),undefined);
 const row=findElement(root,'pr-filter-row');assert.ok(findElement(row,'pr-search-input'));assert.ok(findElement(row,'pr-scope'));assert.ok(findElement(row,'pr-state'));
});
test('browser list and details have no footer; branch sidebar keeps its status footer',()=>{
 const h=harness();assert.equal(findElement(h.mod.render(),'pr-footer'),undefined);
 h.mod.pr=pr();assert.equal(findElement(h.mod.render(),'pr-footer'),undefined);
 h.mod.mode='branch';assert.ok(findElement(h.mod.render(),'pr-footer'));
 h.mod.pr=null;assert.ok(findElement(h.mod.render(),'pr-footer'));
});
test('browser header shows the repository URL and opens only on modifier-click',()=>{
 const h=harness(),opened=[];h.cx.open_url=url=>opened.push(url);
 const link=findElement(h.mod.render(),'pr-repo-url');assert.ok(link);assert.match(strings(link),/https:\/\/github.com\/owner\/repo/);
 link.handlers.click({modifiers:{}},h.cx);assert.equal(opened.length,0);
 link.handlers.click({modifiers:{platform:true}},h.cx);assert.equal(opened[0],'https://github.com/owner/repo');
 link.handlers.click({modifiers:{control:true}},h.cx);assert.equal(opened.length,2);
 h.mod.repo='';assert.equal(findElement(h.mod.render(),'pr-repo-url'),undefined);
 h.mod.repo='owner/repo';h.mod.mode='branch';assert.equal(findElement(h.mod.render(),'pr-repo-url'),undefined);
});
test('browser tab pins its source checkout even while another space is selected',()=>{
 const h=harness();h.mod.mode='browser';h.mod.browserSpace='space';h.mod.source={cwd:'/worktree',on:'remote'};
 h.live.spaces=[{id:'space',folder:'/main',machine:'remote',tabs:[]},{id:'other',active:true,folder:'/other',tabs:[]}];
 assert.equal(h.mod.currentSpace().folder,'/worktree');assert.equal(h.mod.currentSpace().id,'space');
 h.live.spaces=[];assert.equal(h.mod.currentSpace(),null);
});
test('branch sidebar retains the browser checkout while a mod tab is selected',()=>{
 const h=harness();h.mod.mode='branch';h.live.spaces=[{id:'space',active:true,folder:'/main',tabs:[{id:'browser',active:true}]}];
 h.live.panes=[{mod:'github-pr',tab:'browser'}];
 h.context.shared=key=>key==='github-pr.browser-tabs'?{space:{source:{cwd:'/worktree',on:null}}}:null;
 assert.equal(h.mod.currentSpace().folder,'/worktree');
});
test('scope dropdown selects All PRs, Created and Involved',async()=>{
 const h=harness(),requests=[];h.mod.api=async r=>{requests.push(r);return{items:[],cursors:{}}};
 for(const id of ['mine','involved','all']){
  findElement(h.mod.render(),'pr-scope').handlers.open_change(true,h.cx);
  findElement(h.mod.render(),`pr-tab-${id}`).handlers.click({},h.cx);await h.flush();assert.equal(h.mod.tab,id);assert.equal(requests.at(-1).tab,id);assert.equal(h.mod.scopeOpen,false);
 }
});
test('PR selection distinguishes open, draft, merged and closed',()=>{
 const h=harness();for(const [pr,label,icon] of [[{state:'OPEN'},'Open','pull-request'],[{state:'OPEN',isDraft:true},'Draft','draft'],[{state:'MERGED',isDraft:true},'Merged','merged'],[{state:'CLOSED'},'Closed','closed']]){const status=h.mod.prStatus(pr);assert.equal(status.label,label);assert.equal(status.icon,icon)}
 h.mod.mode='branch';assert.match(strings(findElement(h.mod.render(),'pr-browser-toggle')),/All PRs/);
});
test('All PRs preview browses a public repository and persists through refresh',async()=>{
 const h=harness(),requests=[];h.mod.api=async r=>{requests.push(r);return{items:[],cursors:{}}};h.context.exec=async()=>{throw Error('preview must not inspect git')};
 h.mod.setPreview('cli/cli',h.cx);await h.flush();assert.equal(h.mod.repo,'cli/cli');assert.equal(requests[0].action,'list');assert.equal(requests[0].repo,'cli/cli');assert.match(strings(h.mod.render()),/read-only/);
 h.mod.refresh(h.cx);await h.flush();assert.equal(requests.at(-1).repo,'cli/cli');
 h.mod.detectRepo=async()=> 'owner/repo';h.mod.discoverRemotes=async()=>[{name:'origin',repo:'owner/repo'}];h.mod.setPreview('off',h.cx);await h.flush();assert.equal(h.mod.preview,null);assert.equal(h.mod.repo,'owner/repo');
});
test('shared center preview reaches the browser independently of the sidebar instance',async()=>{
 const h=harness(),requests=[];h.context.shared=()=> 'cli/cli';h.mod.api=async r=>{requests.push(r);return{items:[],cursors:{}}};
 h.mod.syncBrowserPreview(h.cx);await h.flush();assert.equal(h.mod.repo,'cli/cli');assert.equal(requests.length,1);
 h.mod.syncBrowserPreview(h.cx);await h.flush();assert.equal(requests.length,1);
});
test('PR details use one title row and independent full-description, conversation and check tabs',()=>{
 const h=harness();h.mod.pr={...pr(),body:'Full text '.repeat(100)+'END OF DESCRIPTION'};
 let rendered=h.mod.render();const header=findElement(rendered,'pr-detail-header');assert.ok(findElement(header,'pr-back'));assert.ok(findElement(header,'pr-detail-github'));assert.match(strings(header),/#2 Example/);
 assert.match(strings(rendered),/END OF DESCRIPTION/);assert.equal(findElement(rendered,'pr-description-toggle'),undefined);assert.doesNotMatch(strings(rendered),/Review concern/);
 findElement(rendered,'pr-conversation').handlers.click({},h.cx);rendered=h.mod.render();assert.match(strings(rendered),/Review concern/);assert.doesNotMatch(strings(rendered),/END OF DESCRIPTION/);assert.ok(findElement(rendered,'pr-detail-tabs'));
 findElement(rendered,'pr-checks').handlers.click({},h.cx);rendered=h.mod.render();assert.match(strings(rendered),/Checks & workflows/);assert.doesNotMatch(strings(rendered),/Review concern/);
 findElement(rendered,'pr-description').handlers.click({},h.cx);assert.match(strings(h.mod.render()),/END OF DESCRIPTION/);
});
test('reply dropdown opens an inline composer with Edit and Preview inside the thread',()=>{
 const h=harness();h.mod.pr=pr();h.mod.section='conversation';
 findElement(h.mod.render(),'pr-reply-thread-main').handlers.click({},h.cx);
 let card=findElement(h.mod.render(),'conversation-thread');assert.ok(findElement(card,'pr-composer-thread'));assert.equal(h.mod.editor.value(),'');
 h.mod.editor.set_value('**A reply**');findElement(card,'pr-editor-preview').handlers.click({},h.cx);
 card=findElement(h.mod.render(),'conversation-thread');assert.match(strings(findElement(card,'pr-editor-rendered-preview')),/A reply/);assert.equal(findElement(card,'pr-inline-input'),undefined);
 findElement(card,'pr-editor-edit').handlers.click({},h.cx);assert.equal(h.mod.editor.value(),'**A reply**');
 findElement(h.mod.render(),'pr-reply-thread-dropdown').handlers.open_change(true,h.cx);
 findElement(h.mod.render(),'pr-reply-thread-option-quote').handlers.click({},h.cx);assert.match(h.mod.editor.value(),/^> bob: Review concern/);
 findElement(h.mod.render(),'pr-cancel').handlers.click({},h.cx);assert.equal(h.mod.composer,null);
});
test('Send to Agent defaults to the first space agent, allows another, and sends the comment URL with the prompt',async()=>{
 const h=harness();h.mod.pr=pr();h.mod.section='conversation';h.live.agents=[{space:'space',address:'t1',tab_name:'First'},{space:'other',address:'t9',tab_name:'Elsewhere'},{space:'space',address:'t2',tab_name:'Second'}];
 const control=findElement(h.mod.render(),'pr-agent-thread');assert.match(strings(control),/Send to First/);
 findElement(control,'pr-agent-thread-main').handlers.click({},h.cx);assert.equal(h.mod.target,'t1');assert.ok(findElement(findElement(h.mod.render(),'conversation-thread'),'pr-composer-thread'));
 findElement(h.mod.render(),'pr-agent-thread-dropdown').handlers.open_change(true,h.cx);assert.equal(findElement(h.mod.render(),'pr-agent-thread-option-t1'),undefined);assert.equal(findElement(h.mod.render(),'pr-agent-thread-option-t9'),undefined);
 findElement(h.mod.render(),'pr-agent-thread-option-t2').handlers.click({},h.cx);assert.equal(h.mod.target,'t2');h.mod.editor.set_value('Please analyze the edge cases.');let sent;h.context.hc=async args=>{sent=args;return{code:0}};
 findElement(h.mod.render(),'pr-submit').handlers.click({},h.cx);await h.flush();assert.equal(sent[1],'t2');assert.match(sent[2],/Please analyze the edge cases/);assert.match(sent[2],/https:\/\/github.com\/o\/r\/pull\/2#discussion_r1/);assert.match(sent[2],/Review concern/);assert.equal(h.mod.composer,null);
});
test('GitHub-style checks group by workflow, expand jobs, and normalize result states',()=>{
 const h=harness();h.mod.pr=pr();h.mod.section='checks';h.mod.pr.checks=[{name:'unit',workflowName:'CI',status:'COMPLETED',conclusion:'SUCCESS',detailsUrl:'https://github.com/o/r/actions/runs/8/job/4'},{name:'lint',workflowName:'CI',status:'COMPLETED',conclusion:'SKIPPED',detailsUrl:'https://github.com/o/r/actions/runs/8/job/5'}];
 let rendered=h.mod.render();assert.match(strings(rendered),/All checks have passed/);assert.equal(findElement(rendered,'check-toggle-0'),undefined);
 findElement(rendered,'workflow-toggle-CI:8').handlers.click({},h.cx);rendered=h.mod.render();assert.ok(findElement(rendered,'check-toggle-0'));assert.ok(findElement(rendered,'check-toggle-1'));
 h.mod.jobs['8']={jobs:[{id:4,name:'unit',steps:[{name:'Run tests',conclusion:'success'}]}]};findElement(rendered,'check-toggle-0').handlers.click({},h.cx);assert.match(strings(h.mod.render()),/Run tests/);
 assert.equal(h.mod.checkStatus({conclusion:'cancelled'}).kind,'skipped');assert.equal(h.mod.checkStatus({status:'in_progress'}).kind,'running');
});
test('GitHub qualifier and body-only results remain visible without literal filtering',async()=>{
 for(const query of ['author:alice','label:bug','phrase only in the PR body']){
  const h=harness();h.mod.api=async()=>({items:[{id:'match',number:42,title:'Server matched this PR',author:{login:'alice'},updatedAt:'2026-01-01',reasons:[]}],cursors:{}});
  h.mod.search.set_value(query);h.mod.searchChanged(h.cx);h.tick();await h.flush();
  assert.ok(findElement(h.mod.render(),'pr-match'),query);
 }
});
test('rapid short keystrokes preserve reload after invalidating the initial request',async()=>{
 const h=harness(),requests=[];let oldResponse;
 h.mod.api=r=>{requests.push(r);return requests.length===1?new Promise(resolve=>oldResponse=resolve):Promise.resolve({items:[{id:'fresh',number:1,title:'Fresh',updatedAt:'2026-01-01',reasons:[]}],cursors:{}})};
 h.mod.loadList(h.cx);h.mod.search.set_value('a');h.mod.searchChanged(h.cx);h.mod.search.set_value('ab');h.mod.searchChanged(h.cx);
 oldResponse({items:[{id:'old'}],cursors:{}});h.tick();await h.flush();
 assert.equal(requests.length,2);assert.equal(requests[1].search,'');assert.equal(h.mod.items[0].id,'fresh');assert.equal(h.mod.searchPending,false);assert.equal(h.mod.loading,false);
});
test('switching directory during debounce uses the visible query in the new directory',async()=>{
 const h=harness(),requests=[];h.mod.api=async r=>{requests.push(r);return{items:[],cursors:{}}};h.mod.detectRepo=async()=> 'other/repo';h.mod.discoverRemotes=async()=>[{name:'origin',repo:'other/repo'}];
 h.mod.search.set_value('author:alice');h.mod.searchChanged(h.cx);h.mod.changeSpace({folder:'/other',id:'other'},'other',h.cx);h.tick();await h.flush();
 assert.equal(requests.length,1);assert.equal(requests[0].repo,'other/repo');assert.equal(requests[0].search,'author:alice');
});
test('saved repository context restores filters, query, selected PR and its detail tab',async()=>{
 const h=harness();h.mod.browseKey=h.mod.viewKey();h.mod.tab='mine';h.mod.state='draft';h.mod.search.set_value('author:alice');h.mod.adoptPR(pr());h.mod.author='alice';h.mod.unresolved=true;h.mod.selectSection('checks',h.cx);h.mod.rememberView();
 const restored=harness(h.storage);restored.mod.api=async r=>r.action==='list'?{items:[],cursors:{}}:pr();restored.mod.restoreView('owner/repo');restored.mod.loadList(restored.cx);await restored.flush();
 assert.equal(restored.mod.tab,'mine');assert.equal(restored.mod.state,'draft');assert.equal(restored.mod.search.value(),'author:alice');assert.equal(restored.mod.pr.number,2);assert.equal(restored.mod.section,'checks');assert.equal(restored.mod.author,'alice');assert.equal(restored.mod.unresolved,true);
});
test('read markers detect new and edited comments and persist after leaving conversations',()=>{
 const h=harness();h.mod.adoptPR(pr());assert.equal(h.mod.unreadIds.size,2);h.mod.selectSection('conversation',h.cx);h.mod.markRead();assert.equal(h.mod.unreadIds.size,0);
 const next=pr();next.comments[0].body='Edited comment';next.comments.push({id:'new',body:'New comment',author:{login:'alice'}});h.mod.adoptPR(next);assert.equal(h.mod.unreadIds.size,2);assert.ok(h.mod.unreadIds.has('new'));assert.ok(h.mod.unreadIds.has('c'));
 assert.match(strings(h.mod.render()),/Mark 2 read/);h.mod.leavePR();h.mod.adoptPR(next);assert.equal(h.mod.unreadIds.size,0);
});
test('failed reads retain last successful timestamp and Retry only reloads data',async()=>{
 const h=harness();h.mod.lastUpdated=123;h.mod.api=async()=>{throw Error('network unavailable')};h.mod.loadList(h.cx);await h.flush();assert.equal(h.mod.lastUpdated,123);assert.ok(findElement(h.mod.render(),'pr-retry'));
 h.mod.detectRepo=async()=> 'owner/repo';h.mod.discoverRemotes=async()=>[{name:'origin',repo:'owner/repo'}];h.mod.api=async()=>({items:[],cursors:{}});h.context.hc=()=>{throw Error('must not send agent message')};findElement(h.mod.render(),'pr-retry').handlers.click({},h.cx);await h.flush();assert.equal(h.mod.error,null);assert.ok(h.mod.lastUpdated>123);
});
test('review-comment workflow returns a proposal for editing and posts only after explicit submission',async()=>{
 const h=harness(),apiRequests=[];h.mod.pr=pr();h.mod.section='conversation';h.live.agents=[{space:'space',address:'t1',tab_name:'Analyst'}];let sent;h.context.hc=async args=>{sent=args;return{code:0}};h.mod.api=async r=>{apiRequests.push(r);return r.action==='detail'?pr():{}};
 findElement(h.mod.render(),'pr-workflow-thread').handlers.click({},h.cx);assert.equal(h.mod.composer.workflow,true);findElement(h.mod.render(),'pr-submit').handlers.click({},h.cx);await h.flush();assert.match(sent[2],/Write ONLY the result file/);assert.equal(apiRequests.length,0);
 const key=h.mod.proposalKey(),record=h.mod.readStored(key).thread;assert.equal(record.status,'waiting');
 h.context.readTextFile=async()=>JSON.stringify({schema:1,requestId:record.id,repo:record.repo,number:record.number,head:record.head,entry:record.entry,analysis:'The concern is valid.',proposedFix:'Add a boundary check.',reply:'I propose adding a boundary check.'});
 h.mod.pollProposals(h.cx,true);await h.flush();assert.equal(h.mod.readStored(key).thread.status,'ready');assert.equal(apiRequests.length,0);
 findElement(h.mod.render(),'pr-proposal-use-thread').handlers.click({},h.cx);assert.equal(h.mod.editor.value(),'I propose adding a boundary check.');assert.equal(apiRequests.length,0);
 findElement(h.mod.render(),'pr-submit').handlers.click({},h.cx);await h.flush();assert.equal(apiRequests.filter(r=>r.action==='reply').length,1);assert.equal(h.mod.readStored(key).thread.status,'posted');
});
test('proposal posting is blocked when the head or comment changes',async()=>{
 const h=harness();h.mod.pr=pr();h.mod.compose('reply','thread',null,h.cx,{entry:'thread',proposal:{head:'abc',entry:'thread',context:h.mod.entryContext('thread')}});h.mod.editor.set_value('Reviewed reply');let writes=0;
 h.mod.api=async r=>{if(r.action==='detail')return{...pr(),headRefOid:'different'};writes++;return{}};h.mod.mutate('reply',h.cx,'thread');await h.flush();assert.equal(writes,0);assert.match(h.mod.error,/changed since this draft/);assert.equal(h.mod.editor.value(),'Reviewed reply');
});
test('proposal results must match request, repository, commit and comment',()=>{
 const h=harness(),record={id:'id',repo:'owner/repo',number:2,head:'abc',entry:'thread'};
 const value={schema:1,requestId:'id',repo:'owner/repo',number:2,head:'abc',entry:'thread',analysis:'Analysis',proposedFix:'Fix',reply:'Reply'};assert.equal(h.mod.validateProposal(value,record).reply,'Reply');for(const field of ['requestId','repo','number','head','entry'])assert.throws(()=>h.mod.validateProposal({...value,[field]:'wrong'},record));
});
test('typography derives relative sizes from live Herdr settings and configured font families',()=>{
 const h=harness();assert.equal(vm.runInContext('em(1)',h.context),14);
 h.context.settings=()=>({font_size:18,font_family:'User Code',ui_font_family:'User UI'});
 assert.equal(vm.runInContext('em(1)',h.context),18);assert.equal(vm.runInContext('em(0.8)',h.context),14.4);assert.equal(vm.runInContext('codeFont()',h.context),'User Code');
 h.context.settings=()=>({ui_font_size:20,font_size:18});assert.equal(vm.runInContext('em(1.2)',h.context),24);
 for(const mod of ['github-pr']){
  assert.doesNotMatch(fs.readFileSync(`mods/${mod}/main.js`,'utf8'),/\.text_size\(\d/);
  assert.equal(fs.readFileSync(`mods/${mod}/typography.js`,'utf8'),fs.readFileSync('mods/github-pr/typography.js','utf8'));
 }
});

function worktreeHarness() {
 const h=harness(),calls=[],opened=[];h.mod.pr=pr();h.mod.pr.headRefOid='a'.repeat(40);h.mod.showWorktree(h.cx);
 h.mod.worktreeForm.branch.set_value('review/custom');h.mod.worktreeForm.name.set_value('my-review');
 h.context.exec=async(cmd,args,options)=>{
  calls.push({cmd,args,options});
  if(args[0]==='check-ref-format')return{code:0,stdout:args[2]};
  if(args[0]==='remote'&&args.length===1)return{code:0,stdout:'origin\nfork'};
  if(args[0]==='remote')return{code:0,stdout:'https://github.com/owner/repo.git'};
  if(args[0]==='show-ref')return{code:1,stdout:''};
  if(args[0]==='rev-parse')return{code:0,stdout:'a'.repeat(40)};
  return{code:0,stdout:''};
 };
 h.mod.api=async()=>h.mod.pr;h.context.run=(command,args)=>opened.push({command,args});
 return{...h,calls,opened};
}
test('worktree form offers independent names only in All PRs details',()=>{
 const h=worktreeHarness();const tree=h.mod.render();assert.ok(findElement(tree,'pr-create-worktree'));assert.ok(findElement(tree,'pr-worktree-branch'));assert.ok(findElement(tree,'pr-worktree-name'));
 h.mod.mode='branch';assert.equal(findElement(h.mod.render(),'pr-create-worktree'),undefined);
});
test('PR worktree uses chosen names, fetched head and a terminal in the captured space',async()=>{
 const h=worktreeHarness();h.mod.sp.machine='remote';h.mod.worktreeForm.sp.machine='remote';
 const original=h.context.exec;h.context.exec=async(cmd,args,options)=>cmd==='sh'?{code:0,stdout:'/remote/home'}:original(cmd,args,options);
 h.mod.createWorktree(h.cx);h.mod.createWorktree(h.cx);await h.flush();
 const fetch=h.calls.find(c=>c.args[0]==='fetch');assert.deepEqual(Array.from(fetch.args),['fetch','--no-tags','--','https://github.com/owner/repo.git','refs/pull/2/head']);
 const add=h.calls.filter(c=>c.args[0]==='worktree');assert.equal(add.length,1);assert.deepEqual(Array.from(add[0].args),['worktree','add','-b','review/custom','--','/remote/home/.herdr/worktrees/owner-repo/my-review','a'.repeat(40)]);assert.equal(add[0].options.on,'remote');
 assert.equal(h.opened[0].command,'tab.new');assert.equal(h.opened[0].args.space,'space');assert.equal(h.opened[0].args.folder,add[0].args[5]);assert.equal(h.opened[0].args.name,'my-review');
});
test('worktree creation rejects invalid paths, existing branches and unrelated repositories',async()=>{
 for(const scenario of ['path','branch','repo','head','git']){
  const h=worktreeHarness(),original=h.context.exec;
  if(scenario==='path')h.mod.worktreeForm.name.set_value('../escape');
  h.context.exec=async(cmd,args,options)=>{
   if(scenario==='branch'&&args[0]==='show-ref')return{code:0,stdout:''};
   if(scenario==='repo'&&args[0]==='remote'&&args.length>1)return{code:0,stdout:'https://github.com/other/repo.git'};
   if(scenario==='head'&&args[0]==='rev-parse')return{code:0,stdout:'b'.repeat(40)};
   if(scenario==='git'&&args[0]==='worktree')return{code:128,stderr:'Path already exists'};
   return original(cmd,args,options);
  };
  h.mod.createWorktree(h.cx);await h.flush();assert.ok(h.mod.worktreeForm.error,scenario);assert.equal(h.opened.length,0,scenario);assert.equal(h.mod.worktreeForm.busy||false,false);
 }
});
test('public previews cannot create a worktree and terminal failures preserve the checkout for retry',async()=>{
 const h=worktreeHarness();h.mod.preview={repo:'owner/repo'};h.mod.createWorktree(h.cx);await h.flush();assert.equal(h.calls.length,0);
 h.mod.preview=null;h.context.run=()=>{throw Error('unavailable')};h.mod.createWorktree(h.cx);await h.flush();assert.ok(h.mod.worktreeForm.path);assert.match(h.mod.worktreeForm.error,/Could not open/);
 h.mod.createWorktree(h.cx);await h.flush();assert.equal(h.calls.filter(c=>c.args[0]==='worktree').length,1);
 h.context.run=(command,args)=>h.opened.push({command,args});h.mod.openWorktree(h.mod.worktreeForm,h.cx);assert.equal(h.opened[0].command,'tab.new');
});
