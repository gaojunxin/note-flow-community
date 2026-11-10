import type {TaskListEntity} from '../services/tasks'
export function visibleTaskLists(lists: TaskListEntity[], areaUid: string, projectUid: string) {
  return lists.filter(item => projectUid ? item.projectUid === projectUid : !item.projectUid && (!areaUid || item.areaUid === areaUid)).sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0))
}
