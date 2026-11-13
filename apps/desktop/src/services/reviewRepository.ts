import {isTauri} from '@tauri-apps/api/core'
import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {clientOwnerScope} from './clientContext'
import {trackedInvoke} from './performanceCapture'
export type ReviewKind='history'|'consolidation'|'series'|'archives'
export interface ReviewRow {uid:string;value:string}
/** 句柄绑定发起账号/生命周期/数据世代；社区恢复可预写未启用目标，但仍受原空间围栏保护。 */
export function reviewBinding(scope:string,staged=false){
 const native=isTauri(),revision=accountLifecycleRevision(),get=(key:string)=>typeof localStorage==='undefined'?null:localStorage.getItem(key)
 const source=get('note-flow-community-profile-v1'),sourceGeneration=get(`note-flow-ai-data-generation:community-${source}`),base=scope.split(':reset:')[0],generation=get('note-flow-ai-data-generation:'+base)
 const owner=native&&!staged?String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local'):'',profile=staged?base:native?clientOwnerScope(owner):''
 if(staged&&!/^community-[^:]+$/.test(base))throw Error('草稿恢复目标空间无效')
 if(native&&!staged&&scope!==profile&&!scope.startsWith(profile+':reset:'))throw Error('历史或草稿不属于当前空间')
 const check=()=>{if(revision!==accountLifecycleRevision()||get('note-flow-community-profile-v1')!==source||get('note-flow-ai-data-generation:'+base)!==generation||(native&&!staged&&profile!==clientOwnerScope(owner))||(staged&&(get('note-flow-community-profile-v1')!==source||get(`note-flow-ai-data-generation:community-${source}`)!==sourceGeneration)))throw Error('账号或数据空间已切换，请重新打开历史或草稿')}
 return {native,profile,check}
}
/** 原生适配器只迁移当前类别/空间；旧IDB保留，不双写，SQL失败不降级。
 * 调用方提供完整旧源校验，不能过滤坏行后把半份数据标记为已迁移。
 */
export async function reviewRepository(kind:ReviewKind,scope:string,legacy:()=>Promise<ReviewRow[]>,validate:(rows:ReviewRow[])=>void,binding=reviewBinding(scope)){
 const {native,profile,check}=binding
 async function invoke<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
  check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:profile}});check()
  const value=await trackedInvoke<T>('native_review_repository',{request:{requestId:crypto.randomUUID(),profileId:profile,scope,kind,action,...data}});check();return value
 }
 if(native&&!await invoke<boolean>('status')){const rows=await legacy();check();validate(rows);await invoke('migrate',{rows})}
 return {native,check,invoke}
}
