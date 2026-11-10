import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import {folderDescendants,sameFolderScope} from './folderDestinations'
import {consolidationEligible,noteStamp} from './noteConsolidation'
export interface DirectoryProposal {key:string;name:string;parentKey:string|null;existingUid?:string}
export interface DirectoryMove {noteUid:string;folderKey:string;reason:string}
export interface DirectoryPlan {assessment:string;folders:DirectoryProposal[];moves:DirectoryMove[]}
export function directorySources(notes:NoteEntity[],scope:{areaUid?:string|null;projectUid?:string|null}){return notes.filter(note=>sameFolderScope(note,scope)&&consolidationEligible(note)&&note.status!=='archived')}
export function directoryInput(folders:FolderEntity[],notes:NoteEntity[]){
 if(folders.length>250||notes.length>500)throw Error('本次最多分析 250 个目录和 500 篇笔记，请缩小范围后再试')
 const result=JSON.stringify({folders:folders.map(f=>({uid:f.uid,name:f.name,parentUid:f.parentUid||folders.find(p=>p.id===f.parentId)?.uid||null})),notes:notes.map(n=>({uid:n.uid,title:n.title,folderUid:n.folderUid||folders.find(f=>f.id===n.folderId)?.uid||null}))})
 if(result.length>50000)throw Error('目录与标题超过 50,000 字符，请缩小范围后再试')
 return result
}
export function validateDirectoryPlan(text:string,folders:FolderEntity[],notes:NoteEntity[]):DirectoryPlan{
 let raw:any;try{raw=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}catch{throw Error('模型未返回有效的目录方案，请重新分析')}
 if(typeof raw.assessment!=='string'||raw.assessment.length>5000||!Array.isArray(raw.folders)||raw.folders.length>100||!Array.isArray(raw.moves)||raw.moves.length>500)throw Error('目录方案格式或数量无效')
 const plan:DirectoryPlan={assessment:raw.assessment,folders:[],moves:[]},keys=new Set<string>(),usedFolders=new Set<string>(),siblings=new Set<string>()
 for(const proposal of raw.folders){
  let row=proposal
  if(row&&row.existingUid!==undefined){const current=folders.find(f=>f.uid===row.existingUid);if(!current||usedFolders.has(current.uid))throw Error('方案引用了不存在或重复的目录');usedFolders.add(current.uid);row={...row,name:current.name,parentKey:null}}
  if(!row)throw Error('目录名称、标识或层级无效')
  if(typeof row.key!=='string'||!row.key||row.key.length>80||keys.has(row.key)||typeof row.name!=='string'||!row.name.trim()||row.name.length>100||/[\/\\\u0000-\u001f]/.test(row.name)||row.parentKey!==null&&typeof row.parentKey!=='string')throw Error('目录名称、标识或层级无效')
  const sibling=JSON.stringify(row.existingUid?['existing',row.existingUid]:['proposed',row.parentKey,row.name.trim().toLocaleLowerCase()]);if(siblings.has(sibling))throw Error('方案存在同级同名目录');siblings.add(sibling);keys.add(row.key);plan.folders.push({key:row.key,name:row.existingUid?row.name:row.name.trim(),parentKey:row.parentKey,...(row.existingUid?{existingUid:row.existingUid}:{})})
 }
 for(const folder of plan.folders){let current:DirectoryProposal|undefined=folder;const seen=new Set<string>();while(current){if(seen.has(current.key))throw Error('目录方案存在循环');seen.add(current.key);if(!current.parentKey)break;current=plan.folders.find(f=>f.key===current!.parentKey);if(!current)throw Error('方案父目录不存在')}}
 const moved=new Set<string>()
 for(const row of raw.moves){if(typeof row.noteUid!=='string'||moved.has(row.noteUid)||!notes.some(n=>n.uid===row.noteUid)||!keys.has(row.folderKey)||typeof row.reason!=='string'||row.reason.length>1000)throw Error('笔记迁移范围或目标无效');moved.add(row.noteUid);plan.moves.push({noteUid:row.noteUid,folderKey:row.folderKey,reason:row.reason})}
 return plan
}
export interface DirectoryProgress {folders:Map<string,FolderEntity>;moved:Set<string>}
export async function applyDirectoryPlan(plan:DirectoryPlan,sources:NoteEntity[],scope:{areaUid?:string|null;projectUid?:string|null},progress:DirectoryProgress,deps:{assertCurrent:()=>void;baseFolder?:FolderEntity;listFolders:()=>Promise<FolderEntity[]>;getNote:(uid:string)=>Promise<NoteEntity|undefined>;createFolder:(name:string,parentId:number|null,scope:any)=>Promise<FolderEntity>;moveNote:(note:NoteEntity,changes:Partial<NoteEntity>)=>Promise<unknown>}){
 deps.assertCurrent();let folders=await deps.listFolders();deps.assertCurrent()
 const base=deps.baseFolder?folders.find(f=>f.uid===deps.baseFolder!.uid):undefined
 if(deps.baseFolder&&(!base||!sameFolderScope(base,scope)||base.name!==deps.baseFolder.name||base.parentUid!==deps.baseFolder.parentUid||base.parentId!==deps.baseFolder.parentId))throw Error('整理起点目录已变化，请重新分析')
 const allowed=base?new Set(folderDescendants(base,folders.filter(f=>sameFolderScope(f,scope))).map(f=>f.uid)):null
 if(allowed&&plan.folders.some(f=>f.existingUid&&!allowed.has(f.existingUid)))throw Error('目标目录已移出所选范围，请重新分析')
 for(const [key,cached] of progress.folders){const current=folders.find(f=>f.uid===cached.uid);if(!current||!sameFolderScope(current,scope)||current.name!==cached.name||allowed&&!allowed.has(current.uid))throw Error('目标目录已变化，请重新分析');progress.folders.set(key,current)}
 const alreadyApplied=(current:NoteEntity,source:NoteEntity,folder:FolderEntity)=>current.folderUid===folder.uid&&current.folderId===folder.id&&noteStamp({...current,folderUid:source.folderUid,folderId:source.folderId,version:source.version,updatedAt:source.updatedAt})===noteStamp(source)
 // Check all sources before creating folders or moving any notes.
 for(const move of plan.moves){if(progress.moved.has(move.noteUid))continue;const source=sources.find(n=>n.uid===move.noteUid),current=await deps.getNote(move.noteUid);deps.assertCurrent();const target=progress.folders.get(move.folderKey);if(source&&current&&target&&alreadyApplied(current,source,target)){progress.moved.add(move.noteUid);continue}if(!source||!current||noteStamp(source)!==noteStamp(current)||!sameFolderScope(current,scope))throw Error('来源笔记已变化，请重新分析；已完成的迁移会保留')}
 for(const row of plan.folders.filter(f=>f.existingUid)){const current=folders.find(f=>f.uid===row.existingUid);if(!current||!sameFolderScope(current,scope)||current.name!==row.name)throw Error('目标目录已变化，请重新分析');progress.folders.set(row.key,current)}
 let pending=plan.folders.filter(f=>!progress.folders.has(f.key))
 while(pending.length){const ready=pending.filter(f=>!f.parentKey||progress.folders.has(f.parentKey));if(!ready.length)throw Error('目录方案层级无效');for(const row of ready){deps.assertCurrent();const parent=row.parentKey?progress.folders.get(row.parentKey)!:base||null;let folder=folders.find(f=>sameFolderScope(f,scope)&&f.name===row.name&&(parent?(f.parentUid?f.parentUid===parent.uid:f.parentId===parent.id):!f.parentUid&&f.parentId==null));if(!folder){folder=await deps.createFolder(row.name,parent?.id??null,scope);folders.push(folder)}deps.assertCurrent();progress.folders.set(row.key,folder)}pending=pending.filter(f=>!progress.folders.has(f.key))}
 for(const move of plan.moves){if(progress.moved.has(move.noteUid))continue;deps.assertCurrent();const current=await deps.getNote(move.noteUid),source=sources.find(n=>n.uid===move.noteUid),folder=progress.folders.get(move.folderKey)!;deps.assertCurrent();if(!current||!source||noteStamp(source)!==noteStamp(current))throw Error('笔记在应用期间有更新，请重新分析');if(current.folderUid!==folder.uid||current.folderId!==folder.id)await deps.moveNote(current,{folderUid:folder.uid,folderId:folder.id});progress.moved.add(move.noteUid)}
}
