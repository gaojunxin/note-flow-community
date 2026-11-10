import type {FocusSettings,FocusSession,LocalRecording} from '../../services/contracts/localPersonal'
import {createEntity,listEntities,getEntityRecord,updateEntity,removeEntity,attachRevision,communityUnavailable} from '../runtime'
export type {FocusSettings,FocusSession,LocalRecording} from '../../services/contracts/localPersonal'
const defaults:FocusSettings={focusMinutes:25,shortBreakMinutes:5,longBreakMinutes:15,roundsBeforeLongBreak:4,autoStartBreak:false,version:0}
type SettingsEntity=FocusSettings&{uid:string}
type StoredRecording=LocalRecording&{blob:Blob;mediaType?:string}
const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')
export const localFocusService={
 async settings():Promise<FocusSettings>{const row=await getEntityRecord<SettingsEntity>('focus_settings','default');return row?attachRevision({...defaults,...row.entity},row.revision):{...defaults}},
 async saveSettings(value:FocusSettings){if(![value.focusMinutes,value.shortBreakMinutes,value.longBreakMinutes].every(number=>Number.isInteger(number)&&number>=1&&number<=1440)||!Number.isInteger(value.roundsBeforeLongBreak)||value.roundsBeforeLongBreak<1)throw Error('专注时长与轮次数量无效');const row=await getEntityRecord<SettingsEntity>('focus_settings','default');return row?updateEntity('focus_settings',attachRevision({...row.entity,...value},row.revision)):createEntity<SettingsEntity>('focus_settings',{...value,uid:'default'})},
 async list(from?:string,to?:string):Promise<FocusSession[]>{return(await listEntities<FocusSession>('focus_session')).filter(value=>(!from||value.startedAt>=from)&&(!to||value.startedAt<to)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))},
 async save(value:FocusSession){if(!value.uid||!Number.isFinite(value.actualSeconds)||value.actualSeconds<0||!Number.isFinite(value.plannedSeconds)||value.plannedSeconds<0||!Number.isFinite(Date.parse(value.startedAt))||!Number.isFinite(Date.parse(value.endedAt)))throw Error('专注记录无效');const row=await getEntityRecord<FocusSession>('focus_session',value.uid);const entity={...value,syncStatus:'local'};return row?updateEntity('focus_session',attachRevision({...row.entity,...entity},row.revision)):createEntity<FocusSession>('focus_session',entity)},
}
export const localRecordingsService={
 async list():Promise<LocalRecording[]>{return(await listEntities<StoredRecording>('recording')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))},
 async save(file:File,noteUid?:string,durationMs=0){if(!file.size||!Number.isFinite(durationMs)||durationMs<0)throw Error('录音内容或时长无效');const uid=crypto.randomUUID();return createEntity<StoredRecording>('recording',{uid,noteUid:noteUid||null,name:file.name||'录音',durationMs,fileSize:file.size,createdAt:new Date().toISOString(),localPath:`community-recording:${uid}`,sha256:await digest(file),syncStatus:'local',blob:file,mediaType:file.type||'audio/webm'})},
 async content(value:LocalRecording){const row=await getEntityRecord<StoredRecording>('recording',value.uid);if(!row||!(row.entity.blob instanceof Blob))throw Error('本地录音内容缺失');const blob=row.entity.blob;if(blob.size!==row.entity.fileSize||await digest(blob)!==row.entity.sha256)throw Error('本地录音内容校验失败');return blob},
 async remove(value:LocalRecording){const row=await getEntityRecord<StoredRecording>('recording',value.uid);if(!row)throw Error('本地录音不存在');await removeEntity('recording',attachRevision(row.entity,row.revision))},
}
export async function restoreEditionRecording(..._args:unknown[]):Promise<never>{return communityUnavailable('官方原仓录音回写；请使用版本切换导入流程')}
