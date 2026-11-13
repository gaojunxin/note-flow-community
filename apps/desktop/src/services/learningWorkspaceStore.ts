import {learningExecutionRepository} from './learningExecutionRepository'
import {aiDataScope} from './aiDataScope'
import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {createPcNotesService} from './notes'
import {foldersService} from './folders'
import {workspaceService} from './workspace'
import {LearningWorkspace,type WorkspacePlan,type WorkspaceScope} from './learningWorkspace'
/** 方案句柄绑定创建时的空间/生命周期；版本比较与不可丢弃状态由仓储真实事务执行。 */
export function workspacePlanStore(scope:string,sessionUid:string,initialUid?:string){const key=JSON.stringify([scope,sessionUid]),revision=accountLifecycleRevision();let loadedUid:string|undefined=initialUid,ready:ReturnType<typeof learningExecutionRepository>|undefined
 const check=()=>{if(scope!==aiDataScope()||revision!==accountLifecycleRevision())throw Error('账号或工作区方案空间已切换')}
 const repository=()=>{check();if(!ready){const pending=learningExecutionRepository(scope);ready=pending;void pending.catch(()=>{if(ready===pending)ready=undefined})}return ready}
 return {
 async read():Promise<WorkspacePlan|undefined>{const value=await(await repository()).read('plans',sessionUid);check();loadedUid=value?.plan.uid;return value?.plan},
 async save(plan:WorkspacePlan,expected:number,guard?:()=>void){const record={key,plan:JSON.parse(JSON.stringify(plan))},expectedUid=loadedUid??(expected>0?plan.uid:undefined);check();guard?.();await(await repository()).savePlan(record,expected,()=>{check();guard?.()},expectedUid);loadedUid=record.plan.uid;window.dispatchEvent(new CustomEvent('note-flow:learning-workspace-updated',{detail:{scope,sessionUid}}))},
 async clear(expected:number,expectedUid=loadedUid){await(await repository()).clearPlan(sessionUid,expected,expectedUid);check();loadedUid=undefined},
 }
}
export function createLearningWorkspace(sessionUid:string,plan:WorkspacePlan,assertActive?:()=>void,expectedPlanUid=plan.revision>0?plan.uid:undefined){const scope=aiDataScope(),revision=accountLifecycleRevision(),owner=String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local'),notes=createPcNotesService(owner),store=workspacePlanStore(scope,sessionUid,expectedPlanUid)
 const check=()=>{assertActive?.();if(scope!==aiDataScope()||revision!==accountLifecycleRevision())throw Error('账号或空间已切换，已停止工作区操作')}
 return new LearningWorkspace(plan,{check,save:(value,expected)=>store.save(value,expected,check),load:async()=>{check();const [n,folders,areas,projects]=await Promise.all([notes.list('active'),foldersService.list(),workspaceService.areas(),workspaceService.projects(undefined,true)]);check();return {notes:n,folders,areas,projects}},getNote:uid=>notes.getForMutation(uid),createNote:note=>notes.create(note,{ifAbsent:true}),updateNote:(note,expected)=>notes.update(note,{expected}),createFolder:(name,parent,scope)=>foldersService.create(name,parent?.id??null,scope),updateFolder:(before,after,parent)=>foldersService.workspaceUpdate(before,after,parent),previewTransfer:async(before,target)=>{const impact=await foldersService.treeTransferPreview(before,target),pending=await foldersService.loadPendingTreeTransfer(before.uid);return pending?.sent?{...impact,operationUid:pending.request.operationUid}:impact},transfer:(before,target,impact,options)=>foldersService.transferTree(before,target,impact,options)})
}
export async function withWorkspaceLock<T>(scope:string,sessionUid:string,work:()=>Promise<T>):Promise<T>{const revision=accountLifecycleRevision(),check=()=>{if(scope!==aiDataScope()||revision!==accountLifecycleRevision())throw Error('工作区锁等待期间账号或空间已切换')};check();if(!navigator.locks)throw Error('当前环境不支持工作区跨窗口锁，请使用桌面客户端或安全的网页访问地址');return navigator.locks.request('note-flow-workspace:'+JSON.stringify([scope,sessionUid]),{ifAvailable:true},async lock=>{check();if(!lock)throw Error('此讨论的笔记工作区正在另一窗口处理，请稍后重试');return work()})}

/** 仅清理当前空间已停止执行的方案；未知执行进度必须保留，账号重置通过数据世代隔离。 */
export async function clearWorkspacePlans(scope:string){if(scope!==aiDataScope())throw Error('不能清理其他执行空间');await(await learningExecutionRepository(scope)).clearPlans()}
