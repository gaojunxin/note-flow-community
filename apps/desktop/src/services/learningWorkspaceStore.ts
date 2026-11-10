import {openDB} from 'idb'
import {aiDataScope} from './aiDataScope'
import {accountSessionRevision,readAccountSetting} from './accountStorage'
import {createPcNotesService} from './notes'
import {foldersService} from './folders'
import {workspaceService} from './workspace'
import {LearningWorkspace,type WorkspacePlan,type WorkspaceScope} from './learningWorkspace'
const database=()=>openDB('note-flow-learning-workspace',1,{upgrade(db){db.createObjectStore('plans',{keyPath:'key'})}})
export function workspacePlanStore(scope:string,sessionUid:string){const key=JSON.stringify([scope,sessionUid]);return {
 async read():Promise<WorkspacePlan|undefined>{const db=await database();try{return (await db.get('plans',key))?.plan}finally{db.close()}},
 async save(plan:WorkspacePlan,expected:number,guard?:()=>void){const db=await database();try{const tx=db.transaction('plans','readwrite'),prior=await tx.store.get(key);guard?.();if((prior?.plan.revision||0)!==expected){tx.abort();await tx.done.catch(()=>{});throw Error('工作区方案已在其他窗口变化，请重新加载')}await tx.store.put({key,plan:JSON.parse(JSON.stringify(plan))});await tx.done;window.dispatchEvent(new CustomEvent('note-flow:learning-workspace-updated',{detail:{scope,sessionUid}}))}finally{db.close()}},
 async clear(expected:number){const db=await database();try{const tx=db.transaction('plans','readwrite'),prior=await tx.store.get(key);if((prior?.plan.revision||0)!==expected||prior&&['applying','partial'].includes(prior.plan.status)){tx.abort();await tx.done.catch(()=>{});throw Error('执行中的方案不能丢弃，请先确认未完成操作')}await tx.store.delete(key);await tx.done}finally{db.close()}}
}}
export function createLearningWorkspace(sessionUid:string,plan:WorkspacePlan,assertActive?:()=>void){const scope=aiDataScope(),revision=accountSessionRevision(),owner=String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local'),notes=createPcNotesService(owner),store=workspacePlanStore(scope,sessionUid)
 const check=()=>{assertActive?.();if(scope!==aiDataScope()||revision!==accountSessionRevision())throw Error('账号或空间已切换，已停止工作区操作')}
 return new LearningWorkspace(plan,{check,save:(value,expected)=>store.save(value,expected,check),load:async()=>{check();const [n,folders,areas,projects]=await Promise.all([notes.list('active'),foldersService.list(),workspaceService.areas(),workspaceService.projects(undefined,true)]);check();return {notes:n,folders,areas,projects}},getNote:uid=>notes.getForMutation(uid),createNote:note=>notes.create(note,{ifAbsent:true}),updateNote:(note,expected)=>notes.update(note,{expected}),createFolder:(name,parent,scope)=>foldersService.create(name,parent?.id??null,scope),updateFolder:(before,after,parent)=>foldersService.workspaceUpdate(before,after,parent),previewTransfer:async(before,target)=>{const impact=await foldersService.treeTransferPreview(before,target),pending=foldersService.pendingTreeTransfer(before.uid);return pending?.sent?{...impact,operationUid:pending.request.operationUid}:impact},transfer:(before,target,impact,options)=>foldersService.transferTree(before,target,impact,options)})
}
export async function withWorkspaceLock<T>(scope:string,sessionUid:string,work:()=>Promise<T>):Promise<T>{if(!navigator.locks)throw Error('当前环境不支持工作区跨窗口锁，请使用桌面客户端或安全的网页访问地址');return navigator.locks.request('note-flow-workspace:'+JSON.stringify([scope,sessionUid]),{ifAvailable:true},async lock=>{if(!lock)throw Error('此讨论的笔记工作区正在另一窗口处理，请稍后重试');return work()})}

export async function clearWorkspacePlans(scope:string){const db=await database();try{const tx=db.transaction('plans','readwrite');for(const key of await tx.store.getAllKeys()){try{if(JSON.parse(String(key))[0]===scope)await tx.store.delete(key)}catch{/* Ignore an unrelated malformed key. */}}await tx.done}finally{db.close()}}
