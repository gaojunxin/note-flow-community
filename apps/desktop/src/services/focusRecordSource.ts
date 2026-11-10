import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {clientOwnerScope} from './clientContext'
import {uniqueFocusRecords} from '@note-flow/core/focus-records'
import api from './api'
import {localFocusService} from './localPersonal'
import {isDesktopClient} from './serverConfig'
import {isCommunityEdition} from './clientCapabilities'
import type {FocusRecord} from './focusRecords'
export function focusReadBinding(){let owner='local';try{owner=String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local')}catch{}return JSON.stringify([clientOwnerScope(owner),accountLifecycleRevision()])}
/** Read only: server records are never enqueued as new local focus sessions. */
export async function readFocusRecords(from:string,to:string):Promise<{items:FocusRecord[];localOnly:boolean}>{
 const binding=focusReadBinding(),assertCurrent=()=>{if(binding!==focusReadBinding())throw Error('账号或空间已切换，已停止读取专注记录')}
 const native=isDesktopClient()
 let local:FocusRecord[]=[],localAvailable=false
 if(native||isCommunityEdition){try{local=await localFocusService.list(from,to);localAvailable=true}catch(error){assertCurrent();if(isCommunityEdition)throw error}}
 assertCurrent()
 if(isCommunityEdition)return{items:local,localOnly:false}
 if(typeof navigator!=='undefined'&&navigator.onLine===false){if(native&&localAvailable)return{items:local,localOnly:true};throw Error(native?'本机专注记录读取失败，联网后重试':'当前离线，联网后可查看移动端专注记录')}
 try{
  const response=(await api.get<{code:number;data:FocusRecord[]}>('/focus/sessions',{params:{from,to}})).data
  if(response?.code!==200||!Array.isArray(response.data))throw Error('服务器专注记录响应无效，请稍后重试')
  const remote=response.data
  assertCurrent()
  return{items:uniqueFocusRecords([...local,...remote]).filter(item=>!item.deleted),localOnly:false}
 }catch(error){assertCurrent();if(native&&localAvailable)return{items:local,localOnly:true};if(native)throw Error('本机与服务器专注记录均读取失败，请重试');throw error}
}
