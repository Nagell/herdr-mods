const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(existingStorage) {
  const pending = [], storage = existingStorage ?? new Map(), timers = [];
  const cx = { focus_handle:()=>({focus(){}}), stop_propagation() {}, notify() {}, open_url(u) { cx.opened=u; }, spawn(fn) { const p = fn(cx); pending.push(p); }, timer: { every() {}, after(_ms,fn) { timers.push(fn); } } };
  function el() {
    const data = { nodes: [], handlers: {} }; let proxy;
    proxy = new Proxy(data,{get(t,k){if(k in t)return t[k];if(k==='child')return c=>{t.nodes.push(c);return proxy};if(k==='children')return cs=>{t.nodes.push(...cs);return proxy};if(k==='when')return(b,f)=>{if(b)f(proxy);return proxy};return(...a)=>{if(k==='id')t.elementId=a[0];if(k==='trigger'||k==='content')t.nodes.push(a[0]);if(k.startsWith('on_'))t.handlers[k.slice(3)]=a[0];if(k==='on_click')t.handlers.click=a[0];return proxy}}}); return proxy;
  }
  const state = ({ value = '' } = {}) => ({ text: value, value() { return this.text; }, set_value(v) { this.text = v; }, handlers:{}, on(event,fn) { this.handlers[event]=fn; }, focus() { this.focused=true; }, type(v,cx) { this.text=v; this.handlers.change?.({},cx); } });
  const live = { spaces: [], panes: [], agents: [] };
  const context = { View: class {}, div: el, svg: el, Popover:{new:(id)=>el().id(id)}, v_flex: el, h_flex: el, InputState: {new:state}, TextareaState:{new:state}, Input:{new:el}, Textarea:{new:el}, TextView:{markdown:(_id,text)=>el().child(text)},
    spaces:()=>live.spaces, panes:()=>live.panes, agents:()=>live.agents,
    shared:()=>null,setShared:(k,v)=>{context.sharedWrites.push([k,v])},sharedWrites:[],settings:()=>({font_size:14}),run:(command,args)=>{context.runs.push({command,args})},runs:[],props:()=>({}),nextCommand:()=>new Promise(()=>{}),theme:()=>({}),home:()=>'/home/user',appHome:()=>'/app',exec:async()=>({code:0,stdout:'{}'}),hc:async()=>({code:0}),knownAgents:async()=>[{key:'claude',name:'Claude Code',run:['claude'],installed:true},{key:'codex',name:'Codex',run:['codex'],installed:false}],
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, console };
  vm.createContext(context);
  const typography=fs.readFileSync('mods/branch-issue/typography.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function');
  vm.runInContext(typography,context);
  const settingsSource=fs.readFileSync('mods/branch-issue/settings.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export async function','async function');
  vm.runInContext(settingsSource,context);
  const source=fs.readFileSync('mods/branch-issue/main.js','utf8').replace(/^import\s+[\s\S]*?;\n/gm,'').replace('export default class LinearIssues','globalThis.Mod = class LinearIssues').replaceAll('export function','function');
  vm.runInContext(source,context);
  const mod=new context.Mod(); mod.init({},cx); pending.length=0; mod.sp={id:'space',folder:'/repo'};mod.spaceKey='space';mod.me={id:'me',name:'Me'};mod.teams=[{key:'ENG',name:'Engineering'}];
  return {mod,cx,live,storage,context,tick:()=>{for(const fn of timers.splice(0))fn(cx)},flush:async()=>{while(pending.length)await Promise.all(pending.splice(0))}};
}
const issue = (extra={}) => ({id:'uuid-1',identifier:'ENG-7',title:'Fix login',url:'https://linear.app/t/issue/ENG-7',description:'Login breaks',priority:2,priorityLabel:'High',branchName:'me/eng-7-fix-login',state:{id:'s1',name:'Todo',type:'unstarted',color:'#aaa'},assignee:null,labels:[],attachments:[{id:'a1',title:'PR #4',url:'https://github.com/o/r/pull/4'}],children:[],team:{id:'t',key:'ENG',name:'Engineering',states:[{id:'s1',name:'Todo',type:'unstarted',position:1},{id:'s2',name:'In Progress',type:'started',position:2}],members:[{id:'me',name:'Me'},{id:'u2',name:'Bea',active:true}],labels:[{id:'l1',name:'Bug',color:'#f00'},{id:'l2',name:'Feature',color:'#0f0'},{id:'lg',name:'Area',isGroup:true}]},comments:[{id:'c1',body:'Root comment',url:'https://linear.app/c1',createdAt:'2026-01-01',user:{id:'u2',name:'Bea'}},{id:'c2',body:'A reply',createdAt:'2026-01-02',user:{id:'me',name:'Me'},parent:{id:'c1'}}],...extra});
function strings(node) { if(typeof node==='string')return node;return (node?.nodes??[]).map(strings).join('\n'); }
function findElement(node,id){ if(!node||typeof node==='string')return undefined; if(node.elementId===id)return node; for(const c of node.nodes??[]){const f=findElement(c,id); if(f)return f;} }

test('identifiers are parsed from branch names and bindings, uppercase and unique',()=>{
 const h=harness();const ids=vm.runInContext('identifiersIn',h.context);
 assert.deepEqual([...ids('tawsif/eng-123-fix-login-eng-123')],['ENG-123']);
 assert.deepEqual([...ids('ENG-1,ops-22')],['ENG-1','OPS-22']);
 assert.deepEqual([...ids('main')],[]);assert.deepEqual([...ids('release-2024')],['RELEASE-2024']);
});
test('branch mode prefers the git binding, confirms candidates with Linear and remembers the chosen one',async()=>{
 const h=harness();h.mod.mode='branch';const requests=[];
 h.context.exec=async(cmd,args)=>{ if(cmd!=='git')return{code:0,stdout:'{}'}; if(args[0]==='symbolic-ref')return{code:0,stdout:'me/eng-7-fix-login\n'}; if(args[0]==='config')return{code:0,stdout:'OPS-3\n'}; return{code:0,stdout:''}; };
 h.mod.api=async r=>{requests.push(r);return{items:[issue({identifier:'OPS-3',id:'u3'}),issue()]}};
 h.mod.loadBranchIssues(h.cx);await h.flush();
 assert.equal(requests[0].identifiers.join(','),'OPS-3,ENG-7');assert.equal(h.mod.issue.identifier,'OPS-3');assert.equal(h.mod.branchIssues.length,2);
 h.mod.selectBranchIssue('ENG-7',h.cx);assert.equal(h.storage.get(h.mod.branchPreferenceKey()),'ENG-7');
 h.mod.loadBranchIssues(h.cx);await h.flush();assert.equal(h.mod.issue.identifier,'ENG-7');
 const tree=h.mod.render();assert.ok(findElement(tree,'issue-branch-trigger'));assert.ok(findElement(tree,'issue-browser-toggle'));assert.match(strings(tree),/Fix login/);
});
test('an empty branch offers a link field that writes the binding after Linear confirms the issue',async()=>{
 const h=harness();h.mod.mode='branch';h.mod.branch='feature/x';const writes=[];
 h.context.exec=async(cmd,args)=>{ if(args[0]==='config'&&args[1]!=='--get'){writes.push(args);return{code:0,stdout:''}} if(args[0]==='config')return{code:1,stdout:''}; if(args[0]==='symbolic-ref')return{code:0,stdout:'feature/x\n'}; return{code:0,stdout:''}; };
 const tree=h.mod.render();assert.ok(findElement(tree,'issue-link-input'));assert.match(strings(tree),/No Linear issue linked to feature\/x/);
 h.mod.api=async r=>r.action==='detail'?issue():{items:[issue()]};
 h.mod.linkInput.set_value('eng-7');h.mod.linkIssue(h.cx);await h.flush();
 assert.equal(Array.from(writes[0]).join(' '),'config branch.feature/x.herdr-issue ENG-7');
 // Once bound, the sidebar shows the issue with an Unlink control that drops the binding.
 h.context.exec=async(cmd,args)=>{ if(args[0]==='config'&&args[1]==='--get')return{code:0,stdout:'ENG-7\n'}; if(args[0]==='config'){writes.push(args);return{code:0,stdout:''}} if(args[0]==='symbolic-ref')return{code:0,stdout:'feature/x\n'}; return{code:0,stdout:''}; };
 h.mod.loadBranchIssues(h.cx);await h.flush();assert.equal(h.mod.issue.identifier,'ENG-7');
 const unlink=findElement(h.mod.render(),'issue-unlink');assert.ok(unlink);unlink.handlers.click({},h.cx);await h.flush();
 assert.equal(Array.from(writes.at(-1)).join(' '),'config --unset branch.feature/x.herdr-issue');
});
test('an identifier that is in the branch name cannot be unlinked',async()=>{
 const h=harness();h.mod.mode='branch';
 h.context.exec=async(cmd,args)=>{ if(args[0]==='symbolic-ref')return{code:0,stdout:'me/eng-7-fix\n'}; if(args[0]==='config')return{code:0,stdout:'ENG-7\n'}; return{code:0,stdout:''}; };
 h.mod.api=async()=>({items:[issue()]});h.mod.loadBranchIssues(h.cx);await h.flush();
 assert.equal(findElement(h.mod.render(),'issue-unlink'),undefined);
});
test('a missing key is a plain error with Retry and nothing else loads',()=>{
 const h=harness();h.mod.mode='branch';h.mod.error='LINEAR_API_KEY is not set. Export a key, then refresh.';
 const tree=h.mod.render();assert.ok(findElement(tree,'issue-retry'));assert.equal(findElement(tree,'issue-key-input'),undefined);assert.match(strings(tree),/LINEAR_API_KEY is not set/);
});
test('browser list sends scope, state, team and search, groups by state and opens details',async()=>{
 const h=harness();const requests=[];h.mod.api=async r=>{requests.push(r);return r.action==='list'?{items:[issue(),issue({id:'u2',identifier:'ENG-8',title:'Other',state:{id:'s2',name:'In Progress',color:'#0f0'}})],cursor:'next'}:issue()};
 h.mod.teams=[{key:'ENG',name:'Engineering'},{key:'OPS',name:'Ops'}];h.mod.scope='cycle';h.mod.state='started';h.mod.team='ENG';h.mod.loadList(h.cx);await h.flush();
 assert.equal(requests[0].scope,'cycle');assert.equal(requests[0].state,'started');assert.equal(requests[0].team,'ENG');
 let tree=h.mod.render();const text=strings(tree);assert.match(text,/Todo[\s\S]*In Progress/);assert.ok(findElement(tree,'issue-more'));assert.ok(findElement(tree,'issue-team-trigger'));
 findElement(tree,'issue-uuid-1').handlers.click({},h.cx);await h.flush();assert.equal(h.mod.issue.identifier,'ENG-7');
 h.mod.search.set_value('ab');h.mod.searchChanged(h.cx);h.tick();await h.flush();assert.equal(requests.filter(r=>r.action==='list').length,1);
 h.mod.issue=null;h.mod.search.set_value('login');h.mod.searchChanged(h.cx);h.tick();await h.flush();assert.equal(requests.at(-1).search,'login');
});
test('detail renders quick-edit pickers, threaded comments with Edit on own replies, links and footer-free browser',()=>{
 const h=harness();h.mod.adoptIssue(issue());h.mod.section='comments';
 const tree=h.mod.render();const text=strings(tree);
 assert.ok(findElement(tree,'issue-state-trigger'));assert.ok(findElement(tree,'issue-priority-trigger'));assert.ok(findElement(tree,'issue-assignee-trigger'));assert.ok(findElement(tree,'issue-start-work'));
 assert.match(text,/Root comment[\s\S]*A reply/);assert.ok(findElement(tree,'issue-edit-c2'));assert.equal(findElement(tree,'issue-edit-c1'),undefined);
 assert.equal(findElement(tree,'issue-footer'),undefined);
 h.mod.section='links';assert.match(strings(h.mod.render()),/PR #4/);
 h.mod.section='children';h.mod.issue.children=[{id:'k',identifier:'ENG-9',title:'Child',state:{color:'#000'}}];assert.ok(findElement(h.mod.render(),'issue-tab-children'));
});
test('quick edits send the matching update and merge the returned fields',async()=>{
 const h=harness();h.mod.adoptIssue(issue());const requests=[];
 h.mod.api=async r=>{requests.push(r);return{issueUpdate:{success:true,issue:{state:{id:'s2',name:'In Progress',type:'started',color:'#0f0'}}}}};
 const tree=h.mod.render();findElement(tree,'issue-issue-state').handlers.open_change(true,h.cx);
 const menu=findElement(h.mod.render(),'issue-issue-state-menu');findElement(menu,'issue-issue-state-s2').handlers.click({},h.cx);await h.flush();
 assert.equal(requests[0].stateId,'s2');assert.equal(h.mod.issue.state.name,'In Progress');assert.match(h.mod.notice,/State saved/);
 h.mod.update({unassign:true},'Assignee',h.cx);await h.flush();assert.equal(requests[1].unassign,true);
 h.mod.update({priority:0},'Priority',h.cx);await h.flush();assert.equal(requests[2].priority,0);
});
test('labels add through the picker and remove from the pill',async()=>{
 const h=harness();h.mod.adoptIssue(issue({labels:[{id:'l1',name:'Bug',color:'#f00'}]}));const requests=[];
 h.mod.api=async r=>{requests.push(r);return{issueUpdate:{success:true,issue:{labels:r.labels.map(id=>({id,name:id}))}}}};
 findElement(h.mod.render(),'issue-labels').handlers.open_change(true,h.cx);
 const menu=findElement(h.mod.render(),'issue-labels-menu');
 assert.ok(!findElement(menu,'issue-labels-l1'),'applied label is not offered again');assert.ok(!findElement(menu,'issue-labels-lg'),'group labels cannot be applied');
 findElement(menu,'issue-labels-l2').handlers.click({},h.cx);await h.flush();
 assert.equal(String(requests[0].labels),'l1,l2');assert.equal(h.mod.issue.labels.length,2);assert.match(h.mod.notice,/Labels saved/);
 findElement(h.mod.render(),'issue-label-l1').handlers.click({},h.cx);await h.flush();
 assert.equal(String(requests[1].labels),'l2');assert.equal(h.mod.issue.labels.length,1);
});
test('comments, replies and edits go through the helper and failed posts keep the draft',async()=>{
 const h=harness();h.mod.adoptIssue(issue());const requests=[];
 h.mod.compose('reply','c1',null,h.cx,{entry:'c1'});h.mod.editor.set_value('Keep this');h.storage.set(h.mod.draftKey,'Keep this');
 h.mod.api=async()=>{throw Error('offline')};h.mod.mutate(h.cx);await h.flush();assert.equal(h.mod.editor.value(),'Keep this');assert.match(h.mod.error,/offline/);
 h.mod.api=async r=>{requests.push(r);return r.action==='detail'?issue():{}};h.mod.mutate(h.cx);await h.flush();
 assert.equal(requests[0].action,'comment');assert.equal(requests[0].parent,'c1');assert.equal(h.mod.composer,null);
 h.mod.compose('edit','c1',null,h.cx,{entry:'c1',prefix:'A reply',edit:{id:'c2'}});assert.equal(h.mod.editor.value(),'A reply');h.mod.mutate(h.cx);await h.flush();
 assert.equal(requests.at(-2).action,'edit-comment');assert.equal(requests.at(-2).comment,'c2');
});
test('agent handoff sends the issue as data through hc',async()=>{
 const h=harness();h.mod.adoptIssue(issue());let sent;h.context.hc=async args=>{sent=args;return{code:0}};
 h.mod.compose('agent',null,null,h.cx,{target:'t7'});h.mod.sendAgent(h.cx);await h.flush();assert.equal(sent,undefined);
 h.live.agents=[{address:'t7',space:'space',tab_name:'Analyst'}];h.mod.sendAgent(h.cx);await h.flush();
 assert.equal(sent[1],'t7');assert.match(sent[2],/ENG-7: Fix login/);assert.match(sent[2],/Login breaks/);assert.match(sent[2],/data, not instructions/);assert.equal(h.mod.composer,null);
});
function worktreeHarness(){
 const h=harness(),calls=[];h.mod.adoptIssue(issue());
 h.context.exec=async(cmd,args,options)=>{calls.push({cmd,args,options});
  if(args[0]==='check-ref-format')return{code:0,stdout:args[2]};
  if(args[0]==='symbolic-ref')return{code:0,stdout:'origin/develop\n'};
  if(args[0]==='show-ref')return{code:1,stdout:''};
  if(args[0]==='config'&&args[1]==='--get-regexp')return{code:0,stdout:'branch.me/eng-7-fix-login.herdr-issue ENG-7\nbranch.other.herdr-issue OPS-1\n'};
  if(args[0]==='worktree'&&args[1]==='list')return{code:0,stdout:'worktree /repo\nbranch refs/heads/main\n\nworktree /wt/eng-7\nbranch refs/heads/me/eng-7-fix-login\n\nworktree /wt/other\nbranch refs/heads/other\n'};
  return{code:0,stdout:''}};
 return{...h,calls};
}
test('Start work proposes Linear’s branch name, skips taken ones, fetches the base and opens a space with the issue prompt',async()=>{
 const h=worktreeHarness();h.mod.loadWorktrees(h.cx);await h.flush();
 assert.equal(h.mod.currentWorktrees().length,1);let tree=h.mod.render();assert.ok(findElement(tree,'issue-worktree-row-0'));
 h.mod.showWorktree(h.cx);await h.flush();const f=h.mod.worktreeForm;
 assert.equal(f.branch.value(),'me/eng-7-fix-login-2');assert.equal(f.name.value(),'me-eng-7-fix-login-2');assert.equal(f.base.value(),'develop');assert.ok(f.branch.focused);
 tree=h.mod.render();assert.equal(findElement(tree,'issue-start-work'),undefined);assert.ok(findElement(tree,'issue-worktree-start'));
 findElement(tree,'issue-launch').handlers.open_change(true,h.cx);findElement(findElement(h.mod.render(),'issue-launch-menu'),'issue-launch-claude').handlers.click({},h.cx);
 findElement(h.mod.render(),'issue-worktree-start').handlers.click({},h.cx);
 const requests=[];h.mod.api=async r=>{requests.push(r);return r.action==='detail'?issue():{issueUpdate:{success:true}}};
 h.mod.createWorktree(h.cx);await h.flush();
 const add=h.calls.find(c=>c.args[0]==='worktree'&&c.args[1]==='add');assert.deepEqual(Array.from(add.args),['worktree','add','-b','me/eng-7-fix-login-2','--','/home/user/.herdr/worktrees/repo/me-eng-7-fix-login-2','FETCH_HEAD']);
 assert.ok(h.calls.some(c=>c.args[0]==='fetch'&&c.args[3]==='develop'));
 assert.ok(h.calls.some(c=>c.args[0]==='config'&&c.args[1]==='branch.me/eng-7-fix-login-2.herdr-issue'&&c.args[2]==='ENG-7'));
 assert.equal(requests[0].action,'update');assert.equal(requests[0].stateId,'s2');
 const open=h.context.runs.find(r=>r.command==='space.new');assert.equal(open.args.folder,'/home/user/.herdr/worktrees/repo/me-eng-7-fix-login-2');assert.equal(open.args.argv[0],'claude');assert.match(open.args.argv[1],/ENG-7: Fix login/);
 assert.equal(h.mod.worktreeForm,null);assert.ok(h.context.sharedWrites.some(([k])=>k==='linear.issue-status'));
});
test('worktree creation refuses bad names and existing branches, and a space-open failure keeps the checkout',async()=>{
 const h=worktreeHarness();h.mod.showWorktree(h.cx);await h.flush();
 h.mod.worktreeForm.name.set_value('../x');h.mod.createWorktree(h.cx);await h.flush();assert.match(h.mod.worktreeForm.error,/letters/);
 h.mod.worktreeForm.name.set_value('ok');const original=h.context.exec;h.context.exec=async(c,a,o)=>a[0]==='show-ref'?{code:0,stdout:''}:original(c,a,o);
 h.mod.createWorktree(h.cx);await h.flush();assert.match(h.mod.worktreeForm.error,/already exists/);
 h.context.exec=original;h.context.run=()=>{throw Error('unavailable')};h.mod.createWorktree(h.cx);await h.flush();
 assert.ok(h.mod.worktreeForm.path);assert.match(h.mod.worktreeForm.error,/Could not open/);
 h.mod.createWorktree(h.cx);await h.flush();assert.equal(h.calls.filter(c=>c.args[0]==='worktree'&&c.args[1]==='add').length,1);
});
test('All issues opens one browser tab per space and reuses it',()=>{
 const h=harness();h.mod.mode='branch';h.live.spaces=[{active:true,id:'space',folder:'/repo',tabs:[{id:'tab',active:true}]}];
 h.mod.openBrowser(h.cx);assert.equal(h.context.runs[0].command,'tab.new');assert.equal(h.context.runs[0].args.name,'All issues');assert.equal(h.context.runs[0].args.props.mode,'browser');
 h.live.panes=[{tab:'tab',mod:'branch-issue'}];h.mod.openBrowser(h.cx);assert.equal(h.context.runs[1].command,'tab.select');
});

test('settings from mod.json set list defaults, worktree defaults and report problems',async()=>{
 const h=harness();h.context.readTextFile=async()=>JSON.stringify({settings:{list:{default:{scope:'all',state:'started'}},worktrees:{root:'~/wt',move_to_started:true,open_with:'claude'},tracker:'jira',nope:1}});
 h.mod.applySettings(h.cx);await h.flush();
 assert.equal(h.mod.scope,'all');assert.equal(h.mod.state,'started');
 assert.equal(JSON.stringify(h.mod.settingsProblems),JSON.stringify(['nope is not a setting','tracker "jira" is not supported yet; using linear']));
 h.mod.mode='browser';h.mod.adoptIssue(issue());h.mod.showWorktree(h.cx);assert.equal(h.mod.worktreeForm.start,true);assert.equal(h.mod.worktreeForm.launch,'claude');
 assert.match(strings(h.mod.render()),/~\/wt\//);assert.match(strings(h.mod.render()),/nope is not a setting/);
});

test('list defaults reload the list unless a saved view exists',async()=>{
 const settings=async()=>JSON.stringify({settings:{list:{default:{scope:'all'}}}});
 let h=harness();h.context.readTextFile=settings;h.mod.mode='browser';let loads=0;h.mod.loadList=()=>loads++;
 h.mod.applySettings(h.cx);await h.flush();assert.equal(h.mod.scope,'all');assert.equal(loads,1);
 h=harness();h.context.readTextFile=settings;h.mod.mode='browser';loads=0;h.mod.loadList=()=>loads++;h.mod.viewWasSaved=true;
 h.mod.applySettings(h.cx);await h.flush();assert.equal(h.mod.scope,'mine');assert.equal(loads,0);
});
