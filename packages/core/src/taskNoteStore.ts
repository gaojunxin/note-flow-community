/** 任务关联仓储契约；官方实现由私有装配提供，社区可据此保全旧记录与备份。 */
export interface TaskNoteSyncRelation {uid:string;taskUid:string;noteUid?:string;relationType?:string;version:number;deleted?:boolean}
export interface TaskNoteSyncOperation<R> {uid:string;action:'create'|'delete';value:R}
export interface TaskNoteSyncDatabase<R> {
  transaction(stores:Array<'relations'|'pending'>,mode:'readwrite'):any
  getAll(store:'relations'):Promise<R[]>
  getAll(store:'pending'):Promise<TaskNoteSyncOperation<R>[]>
  put(store:'relations',value:R):Promise<unknown>
  delete(store:'relations'|'pending',key:string):Promise<unknown>
}
export interface TaskNoteSnapshot<R>{relations:R[];pending:TaskNoteSyncOperation<R>[]}
export interface TaskNoteStore<R extends TaskNoteSyncRelation>{
 check():void
 snapshot():Promise<TaskNoteSnapshot<R>>
 enqueue(operation:TaskNoteSyncOperation<R>):Promise<void>
 receipt(operation:TaskNoteSyncOperation<R>,saved?:R):Promise<void>
 merge(taskUid:string,values:R[],before?:TaskNoteSnapshot<R>):Promise<R[]>
 stop(operation:TaskNoteSyncOperation<R>):Promise<void>
}
