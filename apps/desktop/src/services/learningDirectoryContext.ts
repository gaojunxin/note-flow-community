import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import type {LearningDirectorySnapshot} from '@note-flow/core/ai-learning'
export const asksAboutNoteDirectories=(question:string)=>/目录|文件夹|folder|director(?:y|ies)|taxonomy|笔记.{0,16}(分类|组织|划分|层级|归属|结构)|(分类|组织|划分|层级|归属|结构).{0,16}笔记/i.test(question)
/** Only names, hierarchy, eligible titles and counts. Bodies never enter this snapshot. */
export function buildDirectorySnapshot(folders:FolderEntity[],notes:NoteEntity[],scope:{areaUid:string},names:{areas:Array<{uid:string;name:string}>;projects:Array<{uid:string;name:string}>},budget=12000):LearningDirectorySnapshot{
 const eligible=notes.filter(n=>!n.deleted&&n.status!=='archived'&&n.aiPolicy!=='excluded'&&(!scope.areaUid||n.areaUid===scope.areaUid))
 const scoped=folders.filter(f=>!('deleted'in f&&f.deleted)&&(!scope.areaUid||f.areaUid===scope.areaUid)),ordered:FolderEntity[]=[],seen=new Set<string>(),byId=new Map(scoped.filter(f=>f.id!=null).map(f=>[f.id,f])),byUid=new Map(scoped.map(f=>[f.uid,f]))
 const parentOf=(f:FolderEntity)=>f.parentUid||(f.parentId!=null?byId.get(f.parentId)?.uid:undefined)||null
 const children=new Map<string|null,FolderEntity[]>();for(const folder of scoped){const parent=parentOf(folder);const list=children.get(parent)||[];list.push(folder);children.set(parent,list)}
 const pending=[...(children.get(null)||[])].reverse();while(pending.length){const folder=pending.pop()!;if(seen.has(folder.uid))continue;seen.add(folder.uid);ordered.push(folder);const descendants=children.get(folder.uid)||[];for(let index=descendants.length-1;index>=0;index--)pending.push(descendants[index])}
 for(const folder of scoped)if(!seen.has(folder.uid)){seen.add(folder.uid);ordered.push(folder)}
 const ids=new Map(ordered.map((f,index)=>[f.uid,index+1])),noteFolder=(n:NoteEntity)=>{const folder=n.folderUid?byUid.get(n.folderUid):n.folderId!=null?byId.get(n.folderId):undefined;return folder?ids.get(folder.uid)!:null},counts=new Map<number,number>()
 for(const note of eligible){const id=noteFolder(note);if(id!==null)counts.set(id,(counts.get(id)||0)+1)}
 const data:{schema:string;scope:string;coverage:{totalFolders:number;includedFolders:number;totalNotes:number;includedTitles:number;complete:boolean;bodyIncluded:boolean};folders:Array<{id:number;name:string;parentId:number|null;area:string;project:string;notes:number;missingParent?:boolean}>;notes:Array<{folderId:number|null;title:string;area?:string;project?:string}>}={schema:'note-flow-directory-context/1',scope:scope.areaUid?names.areas.find(a=>a.uid===scope.areaUid)?.name||`领域 ${scope.areaUid}`:'当前空间全部领域',coverage:{totalFolders:ordered.length,includedFolders:0,totalNotes:eligible.length,includedTitles:0,complete:false,bodyIncluded:false},folders:[],notes:[]}
 const label=(uid:string|null|undefined,kind:'areas'|'projects')=>uid?(()=>{const name=names[kind].find(n=>n.uid===uid)?.name;return name?name+(names[kind].filter(n=>n.name===name).length>1?` [${uid}]`:''):`${kind==='areas'?'领域':'项目'} ${uid}`})():kind==='areas'?'未指定领域':'不关联项目'
 // Reserve room for the final counters rather than exceeding the transport budget.
 const fits=()=>JSON.stringify(data).length<=budget-160
 const included=new Set<number>(),noteUids:string[]=[]
 for(const folder of ordered){const parent=parentOf(folder),parentId=parent?ids.get(parent)||null:null,id=ids.get(folder.uid)!;const row={id,name:folder.name,parentId,area:label(folder.areaUid,'areas'),project:label(folder.projectUid,'projects'),notes:counts.get(id)||0,...(parent&&(!parentId||!included.has(parentId))?{missingParent:true}:{})};data.folders.push(row);if(!fits()){data.folders.pop();break}included.add(id)}
 for(const note of eligible){const folderId=noteFolder(note);if(folderId!==null&&!included.has(folderId))continue;const row={folderId,title:note.title||'未命名笔记',...(folderId===null?{area:label(note.areaUid,'areas'),project:label(note.projectUid,'projects')}:{})};data.notes.push(row);if(!fits()){data.notes.pop();break}noteUids.push(note.uid)}
 data.coverage.includedFolders=data.folders.length;data.coverage.includedTitles=data.notes.length;data.coverage.complete=data.folders.length===ordered.length&&data.notes.length===eligible.length
 return {noteUids,schema:'note-flow-directory-context/1',areaUid:scope.areaUid,areaLabel:data.scope,capturedAt:new Date().toISOString(),folderCount:ordered.length,includedFolders:data.folders.length,noteCount:eligible.length,includedTitles:data.notes.length,complete:data.coverage.complete,content:JSON.stringify(data)}
}
