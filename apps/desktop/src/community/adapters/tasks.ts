import type {TaskEntity} from '@note-flow/core/contracts'
import {basicRepeatCapability} from '@note-flow/core/community'
import {communityWorkspace,communityProfileId,entityRevision,attachRevision, listEntities, createEntity, updateEntity, removeEntity, getEntityRecord} from '../runtime'
import {reconcileDesktopTaskReminders,reportCommunityReminderFailure} from './taskReminders'
export type {TaskEntity} from '@note-flow/core/contracts'
import type {TaskListEntity,TaskActivity,TaskNoteRelation,TaskFocusSummary,FailedTaskOperation,TaskConflict} from '../../services/contracts/tasks'
export type {TaskListEntity,TaskActivity,TaskNoteRelation,TaskFocusSummary,FailedTaskOperation,TaskConflict} from '../../services/contracts/tasks'
export const TASKS_BACKGROUND_REFRESH_EVENT='note-flow:tasks-background-refresh'
export const taskDataScope=communityProfileId
export const taskDateForApi=(value?:string|null)=>value?.replace('T',' ')??null
const unavailable=()=>{throw Error('社区版不提供服务器同步与冲突处理')}
function validateRule(value:Partial<TaskEntity>,before?:TaskEntity){
 if(value.recurrenceRule&&value.recurrenceRule!==before?.recurrenceRule&&basicRepeatCapability(value.recurrenceRule).kind==='protected')throw Error('此重复规则需要高级组件；请使用基础重复规则，已有原规则会完整保留')
}
async function afterWrite<T>(operation:Promise<T>){const profile=taskDataScope(),saved=await operation;if(profile===taskDataScope()){try{await reconcileDesktopTaskReminders(await listEntities<TaskEntity>('task'),profile)}catch(error){reportCommunityReminderFailure(error)}}return saved}
export const tasksService={
 async list(){const profile=taskDataScope(),values=await listEntities<TaskEntity>('task');await reconcileDesktopTaskReminders(values,profile);return values},activity:async():Promise<TaskActivity[]>=>[],
 async create(value:Partial<TaskEntity>){validateRule(value);return afterWrite(createEntity<TaskEntity>('task',{title:'',priority:0,completed:false,reminderOffsetsMinutes:[0],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,...value}))},
 async update(value:TaskEntity){const before=(await getEntityRecord<TaskEntity>('task',value.uid))?.entity;validateRule(value,before);return afterWrite(updateEntity('task',value))},
 async complete(value:TaskEntity,completed:boolean){
  if(completed&&(value.recurrenceRule||value.recurrenceSourceUid)){
   const row=await getEntityRecord<TaskEntity>('task',value.uid)
   if(!row||row.entity.version!==value.version||(entityRevision(value)&&entityRevision(value)!==row.revision))throw Error('任务已变化，请重新加载')
   const result=await afterWrite((await communityWorkspace()).tasks.resolve(value.uid,row.revision,'complete'))
   window.dispatchEvent(new CustomEvent(TASKS_BACKGROUND_REFRESH_EVENT,{detail:await listEntities<TaskEntity>('task')}))
   return attachRevision(result.resolved.entity,result.resolved.revision) as unknown as TaskEntity
  }
  return afterWrite(updateEntity('task',value,{completed,completedAt:completed?new Date().toISOString():null}))
 },
 organize:(value:TaskEntity,tagIds:number[])=>afterWrite(updateEntity('task',value,{tagIds})),
 remove:(value:TaskEntity)=>afterWrite(removeEntity('task',value)),
 sync:async():Promise<void>=>unavailable(),
 failedOperations:async():Promise<FailedTaskOperation[]>=>[],
 conflicts:async():Promise<TaskConflict[]>=>[],
 discardFailedOperation:async(_operationId:string):Promise<boolean>=>unavailable(),
 async prepareFailedOperationRepair(_id:string):Promise<{title:string;listName:string;previous:{areaUid:string|null;projectUid:string|null};proposed:{areaUid:string|null;projectUid:string|null}}|null>{return unavailable()},
 retryFailedOperation:async(_operationId:string,_approval?:unknown):Promise<void>=>unavailable(),
 resolveConflict:async(_conflictId:string,_strategy:'local'|'server',_stamp?:unknown):Promise<void>=>unavailable(),
}
let cachedLists:TaskListEntity[]=[],cachedScope=''
export const taskListsService={
 cacheError(){return ''},
 async loadCached():Promise<TaskListEntity[]>{return this.list()},
 cached:()=>cachedScope===taskDataScope()?cachedLists:[],
 async list(){const scope=taskDataScope();const values=await listEntities<TaskListEntity>('task_list');if(scope===taskDataScope()){cachedLists=values;cachedScope=scope}return values},
 async create(name:string,sortOrder:number,scope:{areaUid?:string|null;projectUid?:string|null}={}){const value=await createEntity<TaskListEntity>('task_list',{name,sortOrder,...scope});await this.list();return value},
 async update(value:TaskListEntity,changes:Partial<TaskListEntity>){const saved=await updateEntity('task_list',value,changes);await this.list();return saved},
 async remove(value:TaskListEntity){await removeEntity('task_list',value);await this.list()},
}
export const taskNotesService={
 async pending(_taskUid:string):Promise<import('../../services/contracts/tasks').PendingTaskNoteStatus[]>{return []},
 async stopUnlink(_uid:string,_stamp:string):Promise<void>{unavailable()},
 async byTask(taskUid:string){const [relations,notes]=await Promise.all([listEntities<TaskNoteRelation>('task_note'),listEntities<{uid:string;title:string}>('note')]);return relations.filter(value=>value.taskUid===taskUid).map(value=>({...value,noteTitle:notes.find(note=>note.uid===value.noteUid)?.title}))},
 async link(taskUid:string,noteUid:string,relationType='reference'){return createEntity<TaskNoteRelation>('task_note',{taskUid,noteUid,relationType})},
 unlink:(value:TaskNoteRelation)=>removeEntity('task_note',value),
}
export const taskFocusService={async summary(taskUid:string):Promise<TaskFocusSummary>{
 const values=(await listEntities<{uid:string;taskUid?:string;status?:string;actualSeconds?:number;completedAt?:string;endedAt?:string}>('focus_session')).filter(value=>value.taskUid===taskUid&&value.status==='completed')
 const day=new Date().toLocaleDateString();return{taskUid,totalSeconds:values.reduce((sum,value)=>sum+(value.actualSeconds||0),0),todaySeconds:values.filter(value=>(value.endedAt||value.completedAt)&&new Date(value.endedAt||value.completedAt!).toLocaleDateString()===day).reduce((sum,value)=>sum+(value.actualSeconds||0),0),sessionCount:values.length,lastSessionAt:values.map(value=>value.endedAt||value.completedAt).filter(Boolean).sort().at(-1)}
}}

export const localAiTasks=()=>listEntities<TaskEntity>('task')
export async function createLocalAiTask(value:Partial<TaskEntity>&{uid:string}){const existing=(await localAiTasks()).find(item=>item.uid===value.uid);return existing||tasksService.create({...value,reminderOffsetsMinutes:[]})}
export const syncLocalAiTasks=async()=>{}

/** Community task notes persist locally without an official sync queue. */
export async function syncTaskNoteQueue():Promise<never>{throw Error('社区版不提供任务笔记云端同步')}
