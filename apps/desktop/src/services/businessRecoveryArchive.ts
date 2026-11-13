import {businessState} from './businessState'
import {businessOwner} from './businessRecord'
import {aiDataScope} from './aiDataScope'
import {blobDigest} from './blobDigest'
import {notificationStorageKey,legacyNotificationStorageKey} from './notificationPersistence'

type Port=ReturnType<typeof businessState>
interface BusinessRecoveryBase {version:1;scope:string;entries:Array<[string,string]>}
export interface BusinessRecoveryArchive extends BusinessRecoveryBase {archives?:BusinessRecoveryBase[]}
const domains=['notifications:','folder-transfer:','focus-checkpoint:']
/** 这些记录含未知请求或计时状态，完整备份只保存核对档案，不恢复执行资格。 */
export function validateBusinessRecoveryArchive(source:unknown):BusinessRecoveryArchive {
 const value=source as BusinessRecoveryArchive
 if(!value||value.version!==1||typeof value.scope!=='string'||!value.scope||!Array.isArray(value.entries)||value.entries.length>20000)throw Error('业务恢复档案格式无效')
 if(value.archives!==undefined){if(!Array.isArray(value.archives)||value.archives.some(row=>!row||'archives' in row))throw Error('业务恢复档案不能嵌套');for(const row of value.archives)validateBusinessRecoveryArchive(row)}
 const seen=new Set<string>()
 for(const row of value.entries){if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!domains.some(domain=>row[0].startsWith(domain))||typeof row[1]!=='string'||seen.has(row[0]))throw Error('业务恢复档案记录无效');seen.add(row[0]);JSON.parse(row[1])}
 if(new TextEncoder().encode(JSON.stringify(value)).length>32*1024*1024)throw Error('业务恢复档案超过本机写入上限')
 return value
}
/** 只读捕获已迁移状态与当前空间未迁移旧源；调用方复核采集期间是否变化。 */
export async function captureBusinessRecoveryArchive(profileId:string,origin:string,port:Port=businessState(businessOwner()),dataScope:()=>string=aiDataScope):Promise<BusinessRecoveryArchive>{
 const scope=dataScope(),check=()=>{port.check();if(scope!==dataScope())throw Error('数据空间已切换')}
 const entries=new Map<string,string>()
 for(const domain of domains){for(const row of await port.list(domain))entries.set(...row);check()}
 const legacyKeys=[['notifications',notificationStorageKey(origin,profileId)],['notifications',legacyNotificationStorageKey(profileId)],['notifications',`note-flow-notification-center-v1:${origin}:${notificationStorageKey(origin,profileId)}`],['focus-checkpoint',`note-flow-focus-clock:v1:${port.scope}`]]
 const prefix=`note-flow-folder-transfer:${scope}:`
 for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith(prefix))legacyKeys.push(['folder-transfer',key])}
 for(const [domain,key] of legacyKeys){const id=domain+':'+key;if(!entries.has(id)){const raw=localStorage.getItem(key);if(raw!==null)entries.set(id,raw)}}
 const archives=(await port.list('business-recovery:')).map(([,raw])=>validateBusinessRecoveryArchive(JSON.parse(raw)))
 if(archives.some(archive=>archive.archives!==undefined))throw Error('本机恢复档案格式无效')
 check();return validateBusinessRecoveryArchive({version:1,scope:port.scope,entries:[...entries].sort(([a],[b])=>a.localeCompare(b)),...(archives.length?{archives}:{})})
}
/** 恢复仅写去重档案；不会让消息已读请求、目录迁移或专注计时自动重新运行。 */
export async function restoreBusinessRecoveryArchive(source:unknown,port:Port=businessState(businessOwner())){
 const archive:BusinessRecoveryArchive=JSON.parse(JSON.stringify(validateBusinessRecoveryArchive(source)))
 // 平铺保存旧档案；再次备份恢复不嵌套增长，也不覆盖当前活跃记录。
 for(const base of [{version:archive.version,scope:archive.scope,entries:archive.entries},...(archive.archives||[])]){
  const raw=JSON.stringify(base),digest=await blobDigest(new Blob([raw]));port.check()
  const key='business-recovery:'+digest,prior=await port.read(key);port.check()
  if(prior===raw)continue
  if(prior!==null)throw Error('业务恢复档案身份冲突')
  try{await port.write(key,null,raw)}catch(error){if(await port.read(key)!==raw)throw error;port.check()}
 }
}
