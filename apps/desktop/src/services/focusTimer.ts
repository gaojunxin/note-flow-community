import {reactive,watch} from 'vue'
import {focusCheckpointStorage} from './focusCheckpointStorage'
import {FocusClock} from './focusClock'
import {focusReadBinding} from './focusRecordSource'
import {scopedPreferenceKey} from './clientContext'
import {readAccountSetting} from './accountStorage'
import {localFocusService,type FocusSession} from './localPersonal'
import {isDesktopClient} from './serverConfig'
import {isCommunityEdition} from './clientCapabilities'
import {appLock} from './appLock'
import api from './api'
const local=()=>isCommunityEdition||isDesktopClient()
const owner=()=>{try{return String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local')}catch{return'local'}}
async function save(session:FocusSession,binding:string){
 if(binding!==focusReadBinding()||appLock.locked.value)throw Error('账号、空间或锁定状态已改变，未保存到其他空间。')
 if(local()){await localFocusService.save(session);return;}
 // A lost POST receipt is reconciled by stable UID before retrying the create-only API.
 const from=session.startedAt,to=new Date(Date.parse(session.endedAt)+1000).toISOString();
 const existing=(await api.get<{code:number;data:FocusSession[]}>('/focus/sessions',{params:{from,to}})).data;
 if(binding!==focusReadBinding())throw Error('账号或空间已切换。');
 if(existing.code!==200||!Array.isArray(existing.data))throw Error('无法核对已有记录，请重试。');
 const found=existing.data.find(row=>row.uid===session.uid);
 if(found){if(found.actualSeconds!==session.actualSeconds||found.sessionType!==session.sessionType)throw Error('已有记录与本次计时不一致，请在记录页检查。');return;}
 const response=(await api.post<{code:number}>('/focus/sessions',session)).data;if(response.code!==200)throw Error('保存失败，请重试。')
}
export const focusTimer=reactive(new FocusClock({now:()=>Date.now(),uid:()=>crypto.randomUUID(),context:()=>({key:scopedPreferenceKey('note-flow-focus-clock:v1',owner()),binding:focusReadBinding()}),storage:focusCheckpointStorage,save}))
let started=false
export async function prepareFocusTimer(){
 const checkpointBinding=focusReadBinding();await focusCheckpointStorage.prepare(scopedPreferenceKey('note-flow-focus-clock:v1',owner()));if(checkpointBinding!==focusReadBinding())return;focusTimer.enter();if(!started&&typeof window!=='undefined'){started=true;setInterval(()=>focusTimer.tick(),250);window.addEventListener('pagehide',()=>focusTimer.pause());const changed=()=>{const changedBinding=focusReadBinding();focusTimer.enter();void prepareFocusTimer().catch(()=>{if(changedBinding===focusReadBinding())focusTimer.error='专注检查点恢复失败，请重试'})};window.addEventListener('note-flow:profile-change',changed);window.addEventListener('note-flow:workspace-change',changed);watch(appLock.locked,locked=>{if(locked)focusTimer.pause()});}
 const binding=focusReadBinding();const value=local()?await localFocusService.settings():(await api.get<{data:Awaited<ReturnType<typeof localFocusService.settings>>}>('/focus/settings')).data.data;
 if(binding!==focusReadBinding())return;
 const durations=[value.focusMinutes,value.shortBreakMinutes,value.longBreakMinutes];if(!durations.every(n=>Number.isInteger(n)&&n>=1&&n<=1440)||!Number.isInteger(value.roundsBeforeLongBreak)||value.roundsBeforeLongBreak<1)throw Error('专注设置无效，请在设置中调整。');focusTimer.durations=durations;focusTimer.autoBreak=value.autoStartBreak;focusTimer.roundInterval=value.roundsBeforeLongBreak;
}
