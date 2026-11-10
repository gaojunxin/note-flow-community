import type {TaskEntity,TaskListEntity} from '../services/tasks'

export type TaskDestination =
 | {kind:'inbox'}
 | {kind:'list';list:TaskListEntity}
 | {kind:'project';project:{uid:string;areaUid?:string|null}|null;areaUid?:string|null}

/** A task has one destination. Moving it also replaces the destination's scope. */
export function taskLocation(destination:TaskDestination):Partial<TaskEntity>{
 if(destination.kind==='list'){
  const list=destination.list
  return {taskListId:list.id,taskListUid:list.uid,listName:list.name,areaUid:list.areaUid||null,projectUid:list.projectUid||null}
 }
 return {taskListId:null,taskListUid:null,listName:'收集箱',areaUid:destination.kind==='project'?(destination.project?.areaUid||destination.areaUid||null):null,projectUid:destination.kind==='project'?(destination.project?.uid||null):null}
}

/** List selection owns its scope, including explicit nulls for an unscoped list. */
export function taskCreateLocation(task:Partial<TaskEntity>,lists:TaskListEntity[]):Partial<TaskEntity>{
 const list=task.taskListUid?lists.find(value=>value.uid===task.taskListUid):task.taskListId?lists.find(value=>value.id===Number(task.taskListId)):undefined
 if((task.taskListUid||task.taskListId)&&!list)throw Error('所选任务清单不可用，请重新选择')
 return list?taskLocation({kind:'list',list}):{taskListId:null,taskListUid:null,listName:'收集箱',areaUid:task.areaUid||null,projectUid:task.projectUid||null}
}
