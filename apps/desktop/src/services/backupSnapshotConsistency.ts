import {digest} from 'lib0/hash/sha256'
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')
/** Compare logical SQL rows independently of query order; retain duplicate counts. */
export function backupTableFingerprint(rows:ReadonlyArray<Record<string,unknown>>){
 const encoder=new TextEncoder(),hashes=rows.map(row=>hex(digest(encoder.encode(JSON.stringify(Object.keys(row).sort().map(key=>[key,row[key]])))))).sort()
 return hex(digest(encoder.encode(JSON.stringify(hashes))))
}
/** Detach live auxiliary state before later edits can mutate the exported copy. */
export function snapshotBackupValue<T>(value:T):T{
 try{return JSON.parse(JSON.stringify(value)) as T}catch{throw Error('辅助备份数据无法序列化，未导出备份')}
}
export function backupValueFingerprint(value:unknown){
 const json=JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
 return hex(digest(new TextEncoder().encode(json)))
}
