import {digest as sha256} from 'lib0/hash/sha256'
import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from './folders'
import type {FolderTransferImpact,FolderTransferTarget} from './folderTreeTransfer'
import {sameFolderScope} from './folderDestinations'
import {consolidationEligible} from './noteConsolidation'
// Workspace previews compare content and metadata without depending on official sync.
const writeFingerprint=(value:object)=>JSON.stringify(Object.keys(value).filter(key=>!['version','updatedAt','syncStatus'].includes(key)).sort().map(key=>[key,(value as Record<string,unknown>)[key]]))
export interface WorkspaceScope {areaUid:string}
export interface WorkspaceSnapshot {notes:NoteEntity[];folders:FolderEntity[];areas:{uid:string;name:string;archived?:boolean}[];projects:{uid:string;name:string;areaUid?:string|null;status?:string}[]}
interface ActionBase {key:string;sent?:boolean;done?:boolean;error?:string}
export interface WorkspaceNoteAction extends ActionBase {kind:'note';uid:string;before?:NoteEntity;after:{title:string;content:string;folderUid:string|null;areaUid:string|null;projectUid:string|null};result?:NoteEntity}
export interface WorkspaceFolderAction extends ActionBase {kind:'folder';before?:FolderEntity;after:{name:string;parentUid:string|null;areaUid:string|null;projectUid:string|null};result?:FolderEntity}
export interface WorkspaceTransferAction extends ActionBase {kind:'transfer';operationUid?:string;before:FolderEntity;target:FolderTransferTarget;impact:FolderTransferImpact}
export type WorkspaceAction=WorkspaceNoteAction|WorkspaceFolderAction|WorkspaceTransferAction
export interface WorkspacePlan {uid:string;revision:number;scope:WorkspaceScope;status:'draft'|'applying'|'partial'|'completed';actions:WorkspaceAction[];sources?:Record<string,string>;trace:{tool:string;summary:string}[];updatedAt:string}
export interface WorkspaceDeps {
 check:()=>void;load:()=>Promise<WorkspaceSnapshot>;getNote:(uid:string)=>Promise<NoteEntity|undefined>
 save:(plan:WorkspacePlan,expected:number)=>Promise<void>
 createNote:(note:Partial<NoteEntity>&{uid:string;title:string;content:string})=>Promise<NoteEntity>
 updateNote:(note:NoteEntity,expected:NoteEntity)=>Promise<NoteEntity>
 createFolder:(name:string,parent:FolderEntity|null,scope:{areaUid:string|null;projectUid:string|null})=>Promise<FolderEntity>
 updateFolder:(before:FolderEntity,after:WorkspaceFolderAction['after'],parent:FolderEntity|null)=>Promise<FolderEntity>
 previewTransfer:(before:FolderEntity,target:FolderTransferTarget)=>Promise<FolderTransferImpact>
 transfer:(before:FolderEntity,target:FolderTransferTarget,impact:FolderTransferImpact,options:{operationUid:string;resuming:boolean})=>Promise<unknown>
}
export const newWorkspacePlan=(scope:WorkspaceScope):WorkspacePlan=>({uid:crypto.randomUUID(),revision:0,scope:{...scope},status:'draft',actions:[],trace:[],updatedAt:new Date().toISOString()})
export const workspaceInScope=(value:{areaUid?:string|null},scope:WorkspaceScope)=>!scope.areaUid||value.areaUid===scope.areaUid
const eligible=(note:NoteEntity)=>consolidationEligible(note)&&note.status!=='archived'
const sourceHash=(n:NoteEntity)=>Array.from(sha256(new TextEncoder().encode(writeFingerprint(n))),b=>b.toString(16).padStart(2,'0')).join('')
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
function object(value:unknown,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('工具参数包含未支持的字段');return value as Record<string,any>}
function text(value:unknown,max:number,label:string){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}无效或超过长度限制`);return value.trim()}
function ref(value:unknown):string|null{if(value===null)return null;return text(value,128,'位置标识')}
function range(value:unknown,fallback:number,max:number){if(value===undefined)return fallback;if(!Number.isInteger(value)||Number(value)<0||Number(value)>max)throw Error('分页参数超出限制');return Number(value)}
const parentUid=(f:FolderEntity,rows:FolderEntity[])=>f.parentUid||rows.find(p=>p.id===f.parentId)?.uid||null
export function workspaceSummary(plan:WorkspacePlan){return {planUid:plan.uid,revision:plan.revision,status:plan.status,scope:plan.scope,actions:plan.actions.map(a=>a.kind==='transfer'?{key:a.key,kind:a.kind,name:a.before.name,target:a.target,folders:a.impact.folderCount,notes:a.impact.noteCount,done:a.done,error:a.error}:a.kind==='folder'?{key:a.key,kind:a.kind,uid:a.before?.uid||`draft:${a.key}`,before:a.before?{name:a.before.name,parentUid:a.before.parentUid}:null,after:a.after,done:a.done,error:a.error}:{key:a.key,kind:a.kind,uid:a.uid,before:a.before?{title:a.before.title,folderUid:a.before.folderUid}:null,after:{...a.after,content:undefined,contentLength:a.after.content.length},done:a.done,error:a.error})}}
export class LearningWorkspace {
 readonly plan:WorkspacePlan
 private approvedPatch?:{uid:string;stamp:string}
 forgetRead(uid:string){this.readRanges.delete(uid)}
 private readRanges=new Map<string,{stamp:string;ranges:[number,number][]}>()
 constructor(plan:WorkspacePlan,private deps:WorkspaceDeps){this.plan=copy(plan)}
 async persist(){this.deps.check();const revision=this.plan.revision;const next={...copy(this.plan),revision:revision+1,updatedAt:new Date().toISOString()};await this.deps.save(next,revision);this.deps.check();this.plan.revision=next.revision;this.plan.updatedAt=next.updatedAt}
 private async snapshot(){this.deps.check();const all=await this.deps.load();this.deps.check();const notes=all.notes.filter(n=>eligible(n)&&workspaceInScope(n,this.plan.scope));const required=new Set([...Object.keys(this.plan.sources||{}),...this.plan.actions.flatMap(a=>a.kind==='note'&&a.before?[a.uid]:[])]);if([...required].some(uid=>!notes.some(n=>n.uid===uid)))throw Error('工作区来源已删除、归档、排除 AI 或超出授权范围，请结束原方案并重新选择资料');return {...all,notes,folders:all.folders.filter(f=>!('deleted'in f&&f.deleted)&&workspaceInScope(f,this.plan.scope))}}
 async ensureSources(){await this.snapshot()}
 private remember(notes:NoteEntity[]){let sources={...this.plan.sources};for(const n of notes)sources={...sources,[n.uid]:sourceHash(n)};if(Object.keys(sources).length>2000)throw Error('本批次来源超过2000项，请缩小范围分批处理');this.plan.sources=sources}
 private projected(snapshot:WorkspaceSnapshot){const folders=snapshot.folders.map(f=>({...f})),notes=snapshot.notes.map(n=>({...n}))
  for(const a of this.plan.actions){if(a.kind==='folder'){const row={...(a.before||{id:-folders.length-1,parentId:null,uid:`draft:${a.key}`,sortOrder:0,version:0}),...a.after,parentId:null};const i=folders.findIndex(f=>f.uid===row.uid);if(i<0)folders.push(row);else folders[i]=row}
   if(a.kind==='note'){const row={...(a.before||{uid:a.uid,type:'note',status:'active'}),...a.after,uid:a.uid} as NoteEntity;const i=notes.findIndex(n=>n.uid===row.uid);if(i<0)notes.push(row);else notes[i]=row}}
  return {folders,notes}
 }
 private location(args:Record<string,any>,fallback:{areaUid?:string|null;projectUid?:string|null},target:FolderEntity|undefined,s:WorkspaceSnapshot){
  const areaUid='areaUid'in args?ref(args.areaUid):target?(target.areaUid||null):fallback.areaUid??(this.plan.scope.areaUid||null)
  const projectUid='projectUid'in args?ref(args.projectUid):target?(target.projectUid||null):fallback.projectUid??null
  if(!workspaceInScope({areaUid},this.plan.scope))throw Error('目标位置超出本次授权领域')
  if(areaUid&&!s.areas.some(a=>a.uid===areaUid&&!a.archived))throw Error('目标领域不存在或已归档')
  if(projectUid&&!s.projects.some(p=>p.uid===projectUid&&(p.areaUid||null)===areaUid&&p.status!=='archived'))throw Error('目标项目不存在、已归档或与领域不匹配')
  if(target&&!sameFolderScope(target,{areaUid,projectUid}))throw Error('目标目录与指定领域或项目不匹配')
  return {areaUid,projectUid}
 }
 private validateDraft(s:WorkspaceSnapshot){const {folders,notes}=this.projected(s),byUid=new Map(folders.map(f=>[f.uid,f])),affected=new Set(this.plan.actions.flatMap(a=>a.kind==='folder'?[a.before?.uid||`draft:${a.key}`]:[]));let length=0
  for(const f of folders){if(!affected.has(f.uid))continue;const p=parentUid(f,folders),parent=p?byUid.get(p):undefined;if(p&&(!parent||!sameFolderScope(parent,f)))throw Error('目录父级不存在或归属不一致');const seen=new Set<string>([f.uid]);let next=parent;while(next){if(seen.has(next.uid)||seen.size>12)throw Error('目录层级存在循环或超过 12 层');seen.add(next.uid);next=byUid.get(parentUid(next,folders)||'')}
   if(folders.some(other=>other.uid!==f.uid&&sameFolderScope(f,other)&&parentUid(other,folders)===p&&other.name.toLocaleLowerCase()===f.name.toLocaleLowerCase()))throw Error('目标层级存在同名目录，请复用已有目录或调整名称')}
  for(const a of this.plan.actions){if(a.kind!=='note')continue;length+=a.after.content.length;const f=a.after.folderUid?byUid.get(a.after.folderUid):undefined;if(a.after.folderUid&&(!f||!sameFolderScope(f,a.after)))throw Error('笔记目录不存在或归属不一致')}
  if(length>180000||this.plan.actions.length>40)throw Error('单批最多 40 项变更、180000 字正文，请分批处理')
  for(const a of this.plan.actions.filter((a):a is WorkspaceNoteAction=>a.kind==='note'&&!a.before)){if(notes.some(n=>n.uid!==a.uid&&n.title===a.after.title&&sameFolderScope(n,a.after)&&(n.folderUid||null)===a.after.folderUid))throw Error('目标目录已有同名笔记，请修改标题或编辑已有笔记')}
 }
 async tool(name:string,input:unknown):Promise<unknown>{this.deps.check();const s=await this.snapshot(),view=this.projected(s),allowedAreas=s.areas.filter(a=>!a.archived&&workspaceInScope({areaUid:a.uid},this.plan.scope)),allowedProjects=s.projects.filter(p=>p.status!=='archived'&&workspaceInScope(p,this.plan.scope))
  const noteHead=(n:NoteEntity)=>({uid:n.uid,title:n.title,folderUid:n.folderUid||s.folders.find(f=>f.id===n.folderId)?.uid||null,areaUid:n.areaUid||null,projectUid:n.projectUid||null,length:n.content.length})
  let result:unknown
  if(name==='list_directory'){const a=object(input,['offset','limit']),offset=range(a.offset,0,100000),limit=range(a.limit,30,50)||1;this.remember(s.notes.filter(n=>view.notes.slice(offset,offset+limit).some(v=>v.uid===n.uid)));result={folders:view.folders.slice(offset,offset+limit).map(f=>({uid:f.uid,name:f.name,parentUid:parentUid(f,view.folders),areaUid:f.areaUid||null,projectUid:f.projectUid||null})),notes:view.notes.slice(offset,offset+limit).map(noteHead),folderCount:view.folders.length,noteCount:view.notes.length,nextOffset:Math.max(view.folders.length,view.notes.length,allowedAreas.length,allowedProjects.length)>offset+limit?offset+limit:null,areas:allowedAreas.slice(offset,offset+limit),projects:allowedProjects.slice(offset,offset+limit)}}
  else if(name==='search_notes'){const a=object(input,['query','offset','limit']),query=text(a.query,200,'搜索词').toLocaleLowerCase(),offset=range(a.offset,0,100000),limit=range(a.limit,10,20)||1,rows=view.notes.filter(n=>(n.title+'\n'+n.content).toLocaleLowerCase().includes(query));this.remember(s.notes.filter(n=>rows.slice(offset,offset+limit).some(v=>v.uid===n.uid)));result={items:rows.slice(offset,offset+limit).map(n=>({...noteHead(n),excerpt:n.content.slice(Math.max(0,n.content.toLocaleLowerCase().indexOf(query)-60),Math.max(0,n.content.toLocaleLowerCase().indexOf(query)-60)+240)})),total:rows.length,nextOffset:rows.length>offset+limit?offset+limit:null}}
  else if(name==='read_note'){const a=object(input,['uid','offset','length']),uid=text(a.uid,128,'笔记标识'),note=view.notes.find(n=>n.uid===uid);if(!note)throw Error('笔记不存在、已排除 AI 或不在授权范围');const offset=range(a.offset,0,note.content.length),length=range(a.length,8000,10000)||1,end=Math.min(note.content.length,offset+length),original=s.notes.find(n=>n.uid===uid)
   if(original)this.remember([original]);{const stamp=writeFingerprint(note),entry=this.readRanges.get(uid);if(!entry||entry.stamp!==stamp)this.readRanges.set(uid,{stamp,ranges:[[offset,end]]});else entry.ranges.push([offset,end])}
   result={...noteHead(note),content:note.content.slice(offset,end),offset,nextOffset:end<note.content.length?end:null}}
  else if(name==='patch_note'){const a=object(input,['key','uid','oldText','newText']),uid=text(a.uid,128,'笔记标识'),note=view.notes.find(n=>n.uid===uid);if(!note)throw Error('笔记不在授权范围');if(typeof a.oldText!=='string'||!a.oldText.trim()||a.oldText.length>5000||typeof a.newText!=='string'||a.newText.length>10000)throw Error('局部修改需提供5000字以内的原文及10000字以内的替换内容');const at=note.content.indexOf(a.oldText),evidence=this.readRanges.get(uid);let covered=at;for(const [start,end]of [...(evidence?.ranges||[])].sort((x,y)=>x[0]-y[0]))if(start<=covered)covered=Math.max(covered,end);if(at<0||at!==note.content.lastIndexOf(a.oldText))throw Error('原文未找到或重复出现，请读取更多上下文以精确定位');if(evidence?.stamp!==writeFingerprint(note)||covered<at+a.oldText.length)throw Error('请先使用 read_note 读取待修改段落');this.approvedPatch={uid,stamp:writeFingerprint(note)};try{return await this.tool('stage_note',{key:a.key,uid,content:note.content.slice(0,at)+a.newText+note.content.slice(at+a.oldText.length)})}finally{this.approvedPatch=undefined}}
  else if(name==='get_plan'){object(input,[]);result=workspaceSummary(this.plan)}
  else {if(this.plan.status!=='draft')throw Error('本批次已开始执行，请先完成或重试原方案，不能修改正在执行的方案')
   const prior=copy(this.plan.actions)
   try{
    if(name==='remove_change'){const a=object(input,['key']);const key=text(a.key,80,'变更键');if(!this.plan.actions.some(v=>v.key===key))throw Error('变更不存在');this.plan.actions=this.plan.actions.filter(v=>v.key!==key)}
    else if(name==='stage_note'){const a=object(input,['key','uid','title','content','folderUid','areaUid','projectUid']),key=text(a.key,80,'变更键'),old=this.plan.actions.find(v=>v.key===key);if(old&&old.kind!=='note')throw Error('变更键已用于其他类型');const previous=old as WorkspaceNoteAction|undefined,uid=a.uid===undefined?previous?.uid:text(a.uid,128,'笔记标识'),existing=uid?s.notes.find(n=>n.uid===uid):undefined;if(uid&&!existing&&!previous)throw Error('不能编辑未授权、已归档或不存在的笔记');if(previous&&a.uid!==undefined&&a.uid!==previous.uid)throw Error('不能修改变更对应的笔记');if(previous?.before&&existing&&writeFingerprint(previous.before)!==writeFingerprint(existing))throw Error('原笔记在预览后已变化，请先 remove_change 取消原变更，再 read_note 读取当前正文并重新准备')
     if(existing&&a.content!==undefined&&a.content!==(previous?.after.content??existing.content)){const readTarget=view.notes.find(n=>n.uid===existing.uid)||existing,evidence=this.readRanges.get(existing.uid),ranges=(evidence?.ranges||[]).sort((x,y)=>x[0]-y[0]);let through=0;for(const [start,end]of ranges)if(start<=through)through=Math.max(through,end);if(!(this.approvedPatch?.uid===existing.uid&&this.approvedPatch.stamp===writeFingerprint(readTarget))&&(evidence?.stamp!==writeFingerprint(readTarget)||through<readTarget.content.length))throw Error('修改正文前必须读取当前完整正文；请使用 read_note 分页继续读取')}
     const base=previous?.after||existing,folderRef='folderUid'in a?ref(a.folderUid):(previous?previous.after.folderUid:existing?.folderUid||s.folders.find(f=>f.id===existing?.folderId)?.uid||null),folder=folderRef?view.folders.find(f=>f.uid===folderRef):undefined;if(folderRef&&!folder)throw Error('目录不存在，请先创建目录变更或读取真实目录标识')
     const location=this.location(a,base||{},folder,s),title=a.title===undefined?base?.title:text(a.title,200,'笔记标题'),content=a.content===undefined?base?.content:a.content;if(!title||typeof content!=='string'||content.length>50000||!content.trim()&&!existing)throw Error('新笔记需有完整标题和正文，单篇最多50000字')
     const action:WorkspaceNoteAction={kind:'note',key,uid:previous?.uid||existing?.uid||crypto.randomUUID(),before:previous?.before||existing,after:{title,content,folderUid:folderRef,...location}};if(existing&&this.plan.actions.some(v=>v.kind==='note'&&v.uid===existing.uid&&v.key!==key))throw Error('同一笔记已有变更，请更新原变更键');this.upsert(action)}
    else if(name==='stage_folder'){const a=object(input,['key','uid','name','parentUid','areaUid','projectUid']),key=text(a.key,80,'变更键'),old=this.plan.actions.find(v=>v.key===key);if(old&&old.kind!=='folder')throw Error('变更键已用于其他类型');const previous=old as WorkspaceFolderAction|undefined,uid=a.uid===undefined?previous?.before?.uid:text(a.uid,128,'目录标识'),existing=uid?s.folders.find(f=>f.uid===uid):undefined;if(uid&&!existing)throw Error('目录不存在或不在授权范围');if(previous?.before?.uid!==undefined&&a.uid!==undefined&&a.uid!==previous.before.uid)throw Error('不能修改变更对应的目录');if(existing&&this.plan.actions.some(v=>v.kind==='folder'&&v.before?.uid===uid&&v.key!==key))throw Error('同一目录已有变更，请更新原变更键')
     const base=previous?.after||existing,parentRef='parentUid'in a?ref(a.parentUid):(previous?previous.after.parentUid:existing?parentUid(existing,s.folders):null),parent=parentRef?view.folders.find(f=>f.uid===parentRef):undefined;if(parentRef&&!parent)throw Error('父目录不存在');const location=this.location(a,base||{},parent,s);if(existing&&!sameFolderScope(existing,location))throw Error('跨领域整树迁移请使用 stage_folder_transfer，不能拆开更新目录归属');const name=a.name===undefined?base?.name:text(a.name,100,'目录名称');if(!name||/[\\/\u0000-\u001f]/.test(name))throw Error('目录名称不能包含路径分隔符或控制字符');this.upsert({kind:'folder',key,before:previous?.before||existing,after:{name,parentUid:parentRef,...location}})}
    else if(name==='stage_folder_transfer'){const a=object(input,['key','uid','areaUid','projectUid','parentUid']),key=text(a.key,80,'变更键'),folder=s.folders.find(f=>f.uid===a.uid);if(!folder)throw Error('来源目录不存在或不在授权范围');if(this.plan.actions.some(v=>v.key!==key))throw Error('整树跨领域迁移需单独确认一个批次，请先完成其他变更');const p='parentUid'in a?ref(a.parentUid):null,parent=p?view.folders.find(f=>f.uid===p):undefined;if(p&&!parent)throw Error('目标目录不存在或不在授权范围');const location=this.location(a,{},parent,s),target={...location,parentUid:p},impact=await this.deps.previewTransfer(folder,target);this.deps.check();this.upsert({kind:'transfer',key,operationUid:impact.operationUid||crypto.randomUUID(),before:copy(folder),target,impact})}
    else throw Error('未支持的工具，不执行任意代码、SQL、删除或网络请求')
    if(this.plan.actions.some(a=>a.kind==='transfer')&&this.plan.actions.length>1)throw Error('整树跨领域迁移需单独确认一个批次')
    this.validateDraft(s);await this.persist();result=workspaceSummary(this.plan)
   }catch(e){this.plan.actions=prior;throw e}
  }
  return result
 }
 private upsert(action:WorkspaceAction){const i=this.plan.actions.findIndex(v=>v.key===action.key);if(i<0)this.plan.actions.push(copy(action));else this.plan.actions[i]=copy(action)}
 async apply(){this.deps.check();if(!this.plan.actions.length)throw Error('没有待应用的变更');if(this.plan.status==='completed')return
  const snapshot=await this.snapshot();if(this.plan.status==='draft'){this.validateDraft(snapshot);for(const [uid,stamp]of Object.entries(this.plan.sources||{})){const current=snapshot.notes.find(n=>n.uid===uid);if(!current||sourceHash(current)!==stamp)throw Error('方案引用的资料在预览后发生变化，请重新读取并调整方案')}for(const a of this.plan.actions){if(a.kind==='note'&&a.before){const current=await this.deps.getNote(a.uid);this.deps.check();if(!current||writeFingerprint(current)!==writeFingerprint(a.before))throw Error('笔记在预览后发生变化，请通过聊天重新读取并调整方案')}else if(a.kind!=='note'&&a.before){const current=snapshot.folders.find(f=>f.uid===a.before!.uid);if(!current||writeFingerprint(current)!==writeFingerprint(a.before))throw Error('目录在预览后发生变化，请重新读取并调整方案')}}}
  this.plan.status='applying';await this.persist()
  try{const folders=()=>this.deps.load().then(s=>{this.deps.check();return s.folders}),resolve=async(uid:string|null)=>{if(!uid)return null;if(uid.startsWith('draft:')){const action=this.plan.actions.find(a=>a.key===uid.slice(6));if(action?.kind!=='folder'||!action.result)throw Error('父目录尚未创建');const current=(await folders()).find(f=>f.uid===action.result!.uid&&!('deleted'in f&&f.deleted));if(!current||writeFingerprint(current)!==writeFingerprint(action.result))throw Error('已完成的目标目录发生变化，未继续写入');return current}const f=(await folders()).find(f=>f.uid===uid);if(!f)throw Error('目标目录已不存在');return f}
   const pending=this.plan.actions.filter((a):a is WorkspaceFolderAction=>a.kind==='folder'&&!a.done)
   while(pending.length){const ready=pending.filter(a=>!a.after.parentUid||!pending.some(parent=>a.after.parentUid===(parent.before?.uid||`draft:${parent.key}`)));if(!ready.length)throw Error('目录依赖无法解析');for(const a of ready){this.deps.check();const all=await folders(),parent=await resolve(a.after.parentUid);this.deps.check();let current=a.before?all.find(f=>f.uid===a.before!.uid):undefined
     if(a.before){if(!current)throw Error('目录已不存在');const desired={...a.after,parentUid:parent?.uid||null};if(a.sent&&current.name===desired.name&&parentUid(current,all)===desired.parentUid&&sameFolderScope(current,desired))a.result=current;else{if(writeFingerprint(current)!==writeFingerprint(a.before))throw Error('目录已变化，未覆盖');a.sent=true;await this.persist();a.result=await this.deps.updateFolder(current,desired,parent)}}
     else{const matches=all.filter(f=>sameFolderScope(f,a.after)&&parentUid(f,all)===(parent?.uid||null)&&f.name.toLocaleLowerCase()===a.after.name.toLocaleLowerCase());if(matches.length>1||matches.length&&!a.sent)throw Error('目标层级已有同名目录，请重新预览');if(matches.length)a.result=matches[0];else{a.sent=true;await this.persist();a.result=await this.deps.createFolder(a.after.name,parent,{areaUid:a.after.areaUid,projectUid:a.after.projectUid})}}
     this.deps.check();if(!a.result||a.result.name!==a.after.name||!sameFolderScope(a.result,a.after)||(a.result.parentUid||null)!==(parent?.uid||null))throw Error('目录写入结果未通过校验');a.done=true;a.error=undefined;await this.persist();pending.splice(pending.indexOf(a),1)}}
   for(const a of this.plan.actions){if(a.done)continue;this.deps.check();if(a.kind==='transfer'){const resuming=Boolean(a.sent);a.operationUid||=a.impact.operationUid||crypto.randomUUID();a.sent=true;await this.persist();await this.deps.transfer(a.before,a.target,a.impact,{operationUid:a.operationUid!,resuming});this.deps.check();a.done=true;await this.persist();continue}if(a.kind!=='note')continue
    const folder=await resolve(a.after.folderUid),current=await this.deps.getNote(a.uid);this.deps.check();if(folder&&!sameFolderScope(folder,a.after))throw Error('目标目录的领域或项目已变化，未写入笔记');const desired={...(a.before||{uid:a.uid,type:'note',status:'active'}),...a.after,folderUid:folder?.uid||null,folderId:folder?.id??null,uid:a.uid} as NoteEntity
    const matches=(n:NoteEntity)=>{const keys=['title','content','type','status','folderUid','areaUid','projectUid',...(a.before?['aiPolicy','tagUids','tagIds','pinned','organizationStatus','journalSeriesUid','reportGeneratedAt']:[])];return !n.deleted&&keys.every(k=>JSON.stringify((n as any)[k]??null)===JSON.stringify((desired as any)[k]??null))}
    if(a.sent&&current&&matches(current))a.result=current
    else{if(a.before&&(!current||writeFingerprint(current)!==writeFingerprint(a.before)))throw Error('笔记已变化，未覆盖当前内容');if(!a.before&&current)throw Error('新笔记标识已存在且内容不同');a.sent=true;await this.persist();a.result=a.before?await this.deps.updateNote(desired,a.before):await this.deps.createNote(desired);this.deps.check();const saved=await this.deps.getNote(a.uid);this.deps.check();if(!saved||!matches(saved))throw Error('笔记写入后的正文或归属校验失败');a.result=saved}
    a.done=true;a.error=undefined;await this.persist()
   }
   this.plan.status='completed';await this.persist()
  }catch(e){this.plan.status=(e as {code?:string}).code==='FOLDER_TRANSFER_REJECTED'&&!this.plan.actions.some(a=>a.done)?'draft':'partial';const failed=this.plan.actions.find(a=>!a.done);if(failed)failed.error=e instanceof Error?e.message:'执行失败';await this.persist();throw e}
 }
}
