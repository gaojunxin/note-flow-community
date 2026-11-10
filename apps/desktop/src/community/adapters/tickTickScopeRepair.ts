/** Community CSV imports remain local; server history repair is unavailable. */
export interface TickTickScopeRepair {sourceTaskId:string;taskUid:string;expectedVersion:number;taskListUid:string;expectedAreaUid:string|null;expectedProjectUid:string|null}
export interface TickTickScopeInspection {repairs:TickTickScopeRepair[];consistent:number;blocked:Record<string,number>}
export function createTickTickScopeRepair(_file:File,_digest:string,_assertCurrent?:()=>void){
 const unavailable=():never=>{throw Error('社区版不提供服务器导入记录修复')}
 return{inspect:async():Promise<TickTickScopeInspection>=>unavailable(),apply:async():Promise<{repaired:number;skipped:number}>=>unavailable()}
}
