import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from './folders'
import {sameFolderScope} from './folderDestinations'
export interface SeriesFolder {key:string;name:string;parentKey:string|null}
export interface SeriesNote {key:string;uid:string;title:string;content:string;folderKey:string|null;selected:boolean}
export interface NoteSeries {assessment:string;folders:SeriesFolder[];notes:SeriesNote[]}
export interface SeriesScope {areaUid:string|null;projectUid:string|null}
export interface SeriesProgress {folders:Record<string,string>;notes:string[];started:boolean}
export const newSeriesProgress=():SeriesProgress=>({folders:{},notes:[],started:false})
export function validateNoteSeries(text:string):NoteSeries{
 let raw:any;try{raw=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}catch{throw Error('模型未返回有效方案，请重新生成')}
 if(!raw||typeof raw.assessment!=='string'||raw.assessment.length>5000||!Array.isArray(raw.folders)||raw.folders.length>40||!Array.isArray(raw.notes)||!raw.notes.length||raw.notes.length>30)throw Error('每次最多创建 40 个目录、30 篇笔记')
 const keys=new Set<string>(),siblings=new Set<string>()
 const folders:SeriesFolder[]=raw.folders.map((f:any)=>{
  if(!f||typeof f.key!=='string'||!f.key||f.key.length>80||keys.has(f.key)||typeof f.name!=='string'||!f.name.trim()||f.name.length>100||/[\\/\u0000-\u001f]/.test(f.name)||f.parentKey!==null&&typeof f.parentKey!=='string')throw Error('目录名称或标识无效')
  keys.add(f.key);const sibling=JSON.stringify([f.parentKey,f.name.trim().toLocaleLowerCase()]);if(siblings.has(sibling))throw Error('方案包含同级同名目录');siblings.add(sibling);return {key:f.key,name:f.name.trim(),parentKey:f.parentKey}
 })
 for(const folder of folders){const seen=new Set<string>();let current:SeriesFolder|undefined=folder;while(current){if(seen.has(current.key))throw Error('目录层级存在循环');seen.add(current.key);if(seen.size>8)throw Error('目录最多支持 8 层');if(current.parentKey===null)break;current=folders.find(f=>f.key===current!.parentKey);if(!current)throw Error('父目录不存在')}}
 const noteKeys=new Set<string>(),titles=new Set<string>();let length=0
 const notes:SeriesNote[]=raw.notes.map((n:any)=>{
  if(!n||typeof n.key!=='string'||!n.key||n.key.length>80||noteKeys.has(n.key)||typeof n.title!=='string'||!n.title.trim()||n.title.length>200||typeof n.content!=='string'||!n.content.trim()||n.content.length>50000||n.folderKey!==null&&!keys.has(n.folderKey))throw Error('笔记标题、正文或目录无效')
  length+=n.content.length;if(length>180000)throw Error('本次笔记正文总计不能超过 180,000 字符')
  const title=JSON.stringify([n.folderKey,n.title.trim()]);if(titles.has(title))throw Error('方案包含同目录同名笔记');titles.add(title);noteKeys.add(n.key)
  return {key:n.key,uid:crypto.randomUUID(),title:n.title.trim(),content:n.content,folderKey:n.folderKey,selected:true}
 })
 return {assessment:raw.assessment,folders,notes}
}
export function seriesFolderPath(plan:NoteSeries,key:string|null):string{
 if(key===null)return '';const folder=plan.folders.find(f=>f.key===key);if(!folder)return '';return [seriesFolderPath(plan,folder.parentKey),folder.name].filter(Boolean).join(' / ')
}
export async function applyNoteSeries(plan:NoteSeries,scope:SeriesScope,base:FolderEntity|undefined,progress:SeriesProgress,allowSameTitle:boolean,deps:{check:()=>void;save:()=>Promise<void>;folders:()=>Promise<FolderEntity[]>;notes:()=>Promise<NoteEntity[]>;get:(uid:string)=>Promise<NoteEntity|undefined>;createFolder:(name:string,parentId:number|null,scope:SeriesScope)=>Promise<FolderEntity>;createNote:(note:Partial<NoteEntity>&{uid:string;title:string;content:string},options:{ifAbsent:boolean})=>Promise<NoteEntity>}){
 deps.check();const selected=plan.notes.filter(n=>n.selected);if(!selected.length)throw Error('请至少选择一篇笔记')
 progress.started=true;await deps.save();deps.check()
 const all=await deps.folders();deps.check();const folders=all.filter(f=>sameFolderScope(f,scope)),root=base?folders.find(f=>f.uid===base.uid):undefined
 if(base&&(!root||root.name!==base.name||root.parentUid!==base.parentUid||root.parentId!==base.parentId))throw Error('保存起点已变化，请保留草稿并检查目录')
 const needed=new Set<string>();for(const note of selected){let key=note.folderKey;while(key!==null&&!needed.has(key)){needed.add(key);key=plan.folders.find(f=>f.key===key)!.parentKey}}
 const resolved=new Map<string,FolderEntity>();let pending=plan.folders.filter(f=>needed.has(f.key))
 while(pending.length){const ready=pending.filter(f=>f.parentKey===null||resolved.has(f.parentKey));if(!ready.length)throw Error('目录层级无效')
  for(const row of ready){deps.check();const parent=row.parentKey===null?root:resolved.get(row.parentKey),recorded=progress.folders[row.key]
   const matches=folders.filter(f=>f.name===row.name&&(f.parentUid?f.parentUid===parent?.uid:(f.parentId??null)===(parent?.id??null)))
   if(matches.length>1)throw Error(`同一层级存在多个“${row.name}”目录，请先处理重名`)
   let folder=matches[0];if(recorded&&folder?.uid!==recorded)throw Error('已创建的目录发生变化，已停止重试')
   if(!folder){folder=await deps.createFolder(row.name,parent?.id??null,scope);deps.check();folders.push(folder)}
   resolved.set(row.key,folder);progress.folders[row.key]=folder.uid;await deps.save()
  }pending=pending.filter(f=>!resolved.has(f.key))
 }
 const existing=await deps.notes();deps.check()
 for(const row of selected){const folder=row.folderKey===null?root:resolved.get(row.folderKey),sameTitle=existing.some(n=>n.uid!==row.uid&&!n.deleted&&sameFolderScope(n,scope)&&n.title===row.title&&(n.folderUid?n.folderUid===folder?.uid:(n.folderId??null)===(folder?.id??null)))
  if(sameTitle&&!allowSameTitle&&!progress.notes.includes(row.uid))throw Error(`目录中已有同名笔记“${row.title}”；请修改标题或允许另建副本`)
 }
 for(const row of selected){deps.check();const current=await deps.get(row.uid);deps.check()
  if(progress.notes.includes(row.uid)){if(!current||current.deleted)throw Error('已创建的笔记无法读取或已删除，已停止重试');continue}
  const folder=row.folderKey===null?root:resolved.get(row.folderKey)
  if(current){if(current.deleted||!sameFolderScope(current,scope)||current.title!==row.title||current.content!==row.content||(current.folderUid||null)!==(folder?.uid||null))throw Error('笔记标识已存在且内容不同，未覆盖原记录')}
  else {await deps.createNote({uid:row.uid,title:row.title,content:row.content,type:'note',status:'active',...scope,folderUid:folder?.uid||null,folderId:folder?.id??null},{ifAbsent:true});deps.check();const saved=await deps.get(row.uid);deps.check();if(!saved||saved.deleted||saved.title!==row.title||saved.content!==row.content||!sameFolderScope(saved,scope)||(saved.folderUid||null)!==(folder?.uid||null))throw Error('创建后的内容或归属校验失败，已保留草稿并停止')}
  progress.notes.push(row.uid);await deps.save()
 }
}
