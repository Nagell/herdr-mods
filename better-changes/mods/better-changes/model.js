export function changedFiles(status, numstats) {
  const groups=numstats.map(text=>{
    const stats={};
    for(const entry of text.split("\0")){
      const [add,del,...parts]=entry.split("\t");if(!parts.length)continue;
      stats[parts.join("\t")]={add:Number(add)||0,del:Number(del)||0,binary:add==="-"};
    }
    return stats;
  });
  const empty={add:0,del:0};
  return status.split("\0").filter(Boolean).map(entry=>{
    const xy=entry.slice(0,2),path=entry.slice(3),fresh=xy==="??";
    const conflict=xy.includes("U")||xy==="AA"||xy==="DD";
    const stagedStats=groups[0]?.[path] ?? empty,unstagedStats=groups[1]?.[path] ?? empty;
    return {path,fresh,conflict,staged:!fresh&&!conflict&&xy[0]!==" "&&xy[0]!=="?",unstaged:fresh||conflict||xy[1]!==" ",
      status:conflict ? "U" : xy.includes("D") ? "D" : fresh||xy.includes("A") ? "A" : "M",
      stagedStatus:conflict?"U":xy[0],unstagedStatus:fresh?"A":conflict?"U":xy[1],
      stagedStats,unstagedStats,add:stagedStats.add+unstagedStats.add,del:stagedStats.del+unstagedStats.del,binary:Boolean(stagedStats.binary||unstagedStats.binary)};
  }).sort((a,b)=>a.path.localeCompare(b.path));
}

export function fileTree(files,closed=new Set()) {
  const root={dirs:new Map(),files:[]};
  for (const file of files) {
    const parts=file.path.split("/");parts.pop();let node=root,path="";
    for (const part of parts) {
      path=path ? `${path}/${part}` : part;
      if (!node.dirs.has(part)) node.dirs.set(part,{path,dirs:new Map(),files:[]});
      node=node.dirs.get(part);
    }
    node.files.push(file);
  }
  const rows=[];
  function walk(node,depth) {
    for (const [name,dir] of [...node.dirs].sort(([a],[b])=>a.localeCompare(b))) {
      rows.push({kind:"folder",name,path:dir.path,depth});
      if (!closed.has(dir.path)) walk(dir,depth+1);
    }
    for (const file of node.files) rows.push({kind:"file",file,depth});
  }
  walk(root,0);return rows;
}
export function diffRows(lines) {
  let old=0,next=0;
  return lines.map(text=>{
    const match=/^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);
    if(match){old=+match[1];next=+match[2];return{kind:"@",text};}
    const kind=text[0];
    if(kind==="-") return {kind,old:old++,text:text.slice(1)};
    if(kind==="+") return {kind,next:next++,text:text.slice(1)};
    if(kind===" ") return {kind,old:old++,next:next++,text:text.slice(1)};
    return {kind:"",text};
  });
}

// Pair each contiguous replacement block without crossing a hunk or context line.
export function splitDiffRows(rows) {
  const paired=[],removed=[],added=[];
  const flush=()=>{
    for(let i=0;i<Math.max(removed.length,added.length);i++)paired.push({kind:"pair",left:removed[i] ?? null,right:added[i] ?? null});
    removed.length=0;added.length=0;
  };
  for(const row of rows){
    if(row.kind==="-")removed.push(row);
    else if(row.kind==="+")added.push(row);
    else{
      flush();
      paired.push(row.kind===" " ? {kind:"pair",left:row,right:row} : row);
    }
  }
  flush();return paired;
}
