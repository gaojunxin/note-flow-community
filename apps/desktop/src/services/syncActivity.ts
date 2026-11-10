import {reactive} from 'vue'
export const syncActivity=reactive({running:0,phase:'尚未开始同步',detail:'',completed:0,total:0,startedAt:0,finishedAt:0,logs:[] as Array<{at:number;message:string;error:boolean}>})
let revision=0
export const syncActivityRevision=()=>revision
const jobs=new Set<number>();let sequence=0
const checks=new Set<{phase:string;id?:number}>()
export function resetSyncActivity(){revision++;jobs.clear();checks.clear();Object.assign(syncActivity,{running:0,phase:'尚未开始同步',detail:'',completed:0,total:0,startedAt:0,finishedAt:0,logs:[]})}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('note-flow:account-lifecycle-change',resetSyncActivity)
/** Background checks stay invisible until a request transfers real changes. */
export function promoteSyncChecks(){for(const check of checks)if(check.id===undefined)check.id=beginSyncActivity(check.phase)}
export async function trackSyncCheck<T>(phase:string,work:()=>Promise<T>):Promise<T>{
  const binding=revision
  const check:{phase:string;id?:number}={phase};checks.add(check)
  try{const result=await work();if(check.id!==undefined)endSyncActivity(check.id);return result}
  catch(error){if(binding!==revision)throw error;if(check.id!==undefined)endSyncActivity(check.id,error);else syncLog(error instanceof Error?error.message:String(error),true);throw error}
  finally{checks.delete(check)}
}
export function syncLog(message:string,error=false){syncActivity.logs.unshift({at:Date.now(),message,error});syncActivity.logs.splice(60)}
export function syncStepProgress(phase:string,detail='',completed=0,total=0){if(checks.size && !jobs.size)return;Object.assign(syncActivity,{phase,detail,completed,total});syncLog([phase,detail].filter(Boolean).join(' · '))}
export function beginSyncActivity(phase:string,detail='',total=0){if(!jobs.size){syncActivity.startedAt=Date.now();syncActivity.finishedAt=0}const id=++sequence;jobs.add(id);syncActivity.running=jobs.size;syncStepProgress(phase,detail,0,total);return id}
export function endSyncActivity(id:number,error?:unknown){if(!jobs.delete(id))return;syncActivity.running=jobs.size;if(error)syncLog(error instanceof Error?error.message:String(error),true);if(!jobs.size){syncActivity.finishedAt=Date.now();syncActivity.phase=error?'同步未完成':'本轮同步结束';syncActivity.completed=syncActivity.total}}
export async function trackSync<T>(phase:string,work:()=>Promise<T>):Promise<T>{const id=beginSyncActivity(phase);try{const result=await work();endSyncActivity(id);return result}catch(error){endSyncActivity(id,error);throw error}}
const labels:Record<string,string>={note:'笔记',note_body_update:'笔记正文',folder:'目录',tag:'标签',note_tag:'标签关联',task:'任务',project:'项目',area:'领域',journal_series:'日志系列',project_log:'项目进展',canvas:'画布'}
export function describeSyncItems(items:Array<Record<string,any>>){const counts=new Map<string,number>();for(const item of items){const name=labels[item.entityType]||'关联内容';counts.set(name,(counts.get(name)||0)+1)}const names=items.map(item=>item.payload?.title||item.payload?.name||item.entity?.title||item.entity?.name).filter(Boolean).slice(0,2);return [...counts].map(([name,count])=>`${name} ${count} 项`).join('、')+(names.length?`${items.length>1?' · 本批包含：':' · '}${names.join('、')}`:'')}
