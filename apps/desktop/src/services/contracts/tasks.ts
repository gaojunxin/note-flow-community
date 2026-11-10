import type {TaskEntity} from '@note-flow/core/contracts'
export interface TaskListEntity { id: number; uid: string; name: string; areaUid?: string|null; projectUid?: string|null; sortOrder?: number; version: number }
export interface TaskActivity { seq: number; entityUid: string; action: 'create'|'update'|'delete'; version: number; entity?: Partial<TaskEntity>; changedAt: string }
export interface TaskNoteRelation {uid:string;taskUid:string;noteUid:string;relationType:string;version:number;deleted?:boolean;noteTitle?:string}
export interface TaskFocusSummary {taskUid:string;todaySeconds:number;totalSeconds:number;sessionCount:number;lastSessionAt?:string|null}
export interface FailedTaskOperation {operationId:string;entityUid:string;title:string;cycle:string;message:string;sent?:boolean;code?:string}
export interface TaskConflict {conflictId:string;operationId:string;entityUid:string;entityType:'task';localEntity?:TaskEntity;serverEntity?:TaskEntity;serverVersion?:number;createdAt:string}

export interface PendingTaskNoteStatus {uid:string;action:'create'|'delete';noteUid:string;unconfirmedIdentity:boolean;stamp:string}
