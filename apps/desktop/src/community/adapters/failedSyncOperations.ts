/** Community workspaces have no official upload queue or upload diagnostics. */
export interface FailedSyncOperation {
 status?:string;operationId:string;entityUid:string;entityType:string;kind:string;title:string;code:string;message:string;diagnostic:string;retryable:boolean
 context:{action:string;baseVersion:number|null;attempts:number;sent:boolean;contentLength:number|null;hasProject:boolean;hasArea:boolean;occurredAtFormat:string}
}
export function failedSyncDiagnostic(_item:FailedSyncOperation,_version:string):never{throw Error('社区版没有云端上传诊断')}
