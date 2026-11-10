/** 仅保全旧社区卡片库；业务入口关闭后，不迁移、改写或重放旧操作。 */
export interface LegacyKnowledgeBackup {schema:'community-legacy-knowledge';version:1;profileId:string;database:string;stores:Array<{name:string;keys:IDBValidKey[];values:unknown[]}>}
function existingDatabase(name:string):Promise<IDBDatabase|undefined>{
 return new Promise((resolve,reject)=>{
  let absent=false,blocked=false
  // 不指定版本以只读既有结构；库不存在时中止创建，兼容不支持databases()的旧WebView。
  const request=indexedDB.open(name)
  request.onupgradeneeded=()=>{absent=true;request.transaction?.abort()}
  request.onblocked=()=>{blocked=true;reject(Error('旧知识数据库正被占用，请关闭其他窗口后备份'))}
  request.onerror=()=>absent?resolve(undefined):reject(request.error)
  request.onsuccess=()=>{if(blocked){request.result.close();return}resolve(request.result)}
 })
}
export async function captureLegacyKnowledge(profileId:string):Promise<LegacyKnowledgeBackup|undefined>{
 const database=`note-flow-community-cards:${profileId}`,db=await existingDatabase(database)
 if(!db)return undefined
 try{
  const names=Array.from(db.objectStoreNames)
  const stores=await new Promise<LegacyKnowledgeBackup['stores']>((resolve,reject)=>{
   if(!names.length){resolve([]);return}
   const tx=db.transaction(names,'readonly'),result:LegacyKnowledgeBackup['stores']=[]
   tx.onabort=()=>reject(tx.error||Error('历史知识备份读取中断'));tx.onerror=()=>reject(tx.error)
   for(const name of names){const store=tx.objectStore(name),row={name,keys:[] as IDBValidKey[],values:[] as unknown[]};result.push(row);const keys=store.getAllKeys(),values=store.getAll();keys.onsuccess=()=>row.keys=keys.result;values.onsuccess=()=>row.values=values.result}
   tx.oncomplete=()=>resolve(result)
  })
  return{schema:'community-legacy-knowledge',version:1,profileId,database,stores}
 }finally{db.close()}
}
export function validateLegacyKnowledge(value:unknown,profileId:string):LegacyKnowledgeBackup{
 const input=value as LegacyKnowledgeBackup
 if(!input||input.schema!=='community-legacy-knowledge'||input.version!==1||input.profileId!==profileId||input.database!==`note-flow-community-cards:${profileId}`||!Array.isArray(input.stores))throw Error('历史知识备份空间或格式无效')
 const names=new Set<string>()
 for(const row of input.stores){if(!row||typeof row.name!=='string'||!row.name||names.has(row.name)||!Array.isArray(row.keys)||!Array.isArray(row.values)||row.keys.length!==row.values.length)throw Error('历史知识备份数据不完整');names.add(row.name)}
 return input
}
