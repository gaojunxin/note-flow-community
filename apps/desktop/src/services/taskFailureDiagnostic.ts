/** Export only protocol metadata; task titles, dates and payloads stay local. */
export function taskFailureDiagnostic(item:{operationId:string;entityUid:string;code?:string;action?:string;baseVersion?:number;attempts?:number;sent?:boolean;hasTaskList?:boolean;hasArea?:boolean;hasProject?:boolean},clientVersion:string){
 const uid=(value:string)=>/^[a-zA-Z0-9-]{1,64}$/.test(value)?value:undefined
 const count=(value?:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined
 return {schema:'note-flow-task-sync-failure/1',clientVersion,operationId:uid(item.operationId),entityUid:uid(item.entityUid),entityType:'task',code:item.code&&/^[A-Z][A-Z0-9_]{0,79}$/.test(item.code)?item.code:'UNKNOWN',context:{action:['create','update','delete'].includes(item.action||'')?item.action:undefined,baseVersion:count(item.baseVersion),attempts:count(item.attempts),sent:item.sent===true,hasTaskList:item.hasTaskList===true,hasArea:item.hasArea===true,hasProject:item.hasProject===true}}
}
