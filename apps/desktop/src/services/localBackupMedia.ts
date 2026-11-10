import {blobDigest} from './blobDigest'
export interface BackupMedia {relativePath:string;fileName:string;sha256:string;base64:string;sizeBytes?:number}
export interface PreparedBackupMedia {source:BackupMedia;kind:'attachments'|'recordings';bytes:number[];sha256:string}
export async function prepareBackupMedia(media:unknown):Promise<PreparedBackupMedia[]>{
 if(!Array.isArray(media))throw Error('备份媒体列表无效')
 const seen=new Set<string>(),prepared:PreparedBackupMedia[]=[]
 for(const value of media){
  const item=value as BackupMedia
  if(!item||typeof item.relativePath!=='string'||! /^(attachments|recordings)\/[^/\\]+$/.test(item.relativePath)||item.relativePath.split('/')[1].includes('..')||typeof item.fileName!=='string'||!item.fileName||typeof item.base64!=='string'||typeof item.sha256!=='string'||item.sha256&&!/^[a-f\d]{64}$/i.test(item.sha256))throw Error('备份媒体格式或路径无效')
  if(seen.has(item.relativePath))throw Error('备份包含重复媒体路径')
  seen.add(item.relativePath)
  let raw:string;try{raw=atob(item.base64)}catch{throw Error('备份媒体编码损坏')}
  const bytes=Array.from(raw,character=>character.charCodeAt(0))
  if(item.sizeBytes!==undefined&&(!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<0||bytes.length!==item.sizeBytes))throw Error('备份媒体大小校验失败')
  const sha256=await blobDigest(new Blob([new Uint8Array(bytes)]))
  if(item.sha256&&item.sha256.toLowerCase()!==sha256)throw Error('备份媒体 SHA256 校验失败，未写入数据')
  prepared.push({source:item,kind:item.relativePath.startsWith('recordings/')?'recordings':'attachments',bytes,sha256})
 }
 return prepared
}
/** Recovery archives can themselves contain previously imported archives. */
export function collectBackupMediaRows(tables:Record<string,Record<string,unknown>[]>,depth=0):Record<string,unknown>[] {
 if(depth>8)throw Error('备份恢复队列嵌套过深')
 const rows=[...(tables.local_attachments||[]),...(tables.recordings||[])]
 for(const row of tables.sync_recovery||[])if(typeof row.archive_json==='string'){
  const archive=JSON.parse(row.archive_json)
  if(archive.tables)rows.push(...collectBackupMediaRows(archive.tables,depth+1))
 }
 return rows
}
export function remapBackupMediaRows(tables:Record<string,Record<string,unknown>[]>,paths:Map<string,string>,depth=0){
 if(depth>8)throw Error('备份恢复队列嵌套过深')
 const result=JSON.parse(JSON.stringify(tables)) as typeof tables
 for(const table of ['local_attachments','recordings'])for(const row of result[table]||[]){
  if(typeof row.local_path==='string'&&paths.has(row.local_path))row.local_path=paths.get(row.local_path)!
  if(typeof row.entity_json==='string'){
   const entity=JSON.parse(row.entity_json)
   if(entity&&typeof entity.localPath==='string'&&paths.has(entity.localPath)){entity.localPath=paths.get(entity.localPath);row.entity_json=JSON.stringify(entity)}
  }
 }
 for(const row of result.sync_recovery||[])if(typeof row.archive_json==='string'){
  const archive=JSON.parse(row.archive_json)
  if(archive.tables){archive.tables=remapBackupMediaRows(archive.tables,paths,depth+1);row.archive_json=JSON.stringify(archive)}
 }
 return result
}

/** Every local media reference must be present in a complete archive. */
export function validateBackupMediaReferences(tables:Record<string,Record<string,unknown>[]>,media:PreparedBackupMedia[],depth=0){
 if(depth>8)throw Error('备份恢复队列嵌套过深')
 const files=new Map(media.map(item=>[item.source.relativePath,item]))
 for(const table of ['local_attachments','recordings'])for(const row of tables[table]||[]){
  let entity:Record<string,unknown>={}
  if(typeof row.entity_json==='string'){const parsed=JSON.parse(row.entity_json);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('备份媒体记录无效');entity=parsed}
  // SQLite columns and the JSON snapshot describe the same media identity.
  // Readers use both forms; accepting disagreement makes restoration ambiguous.
  if(row.uid!==undefined&&entity.uid!==undefined&&row.uid!==entity.uid)throw Error('备份媒体记录标识不一致，未写入数据')
  if(row.local_path&&entity.localPath&&row.local_path!==entity.localPath)throw Error('备份媒体记录路径不一致，未写入数据')
  for(const path of [row.local_path,entity.localPath])if(path){
   if(typeof path!=='string'||!files.has(path))throw Error('备份缺少附件或录音文件，未写入数据')
   const file=files.get(path)!
   if((table==='recordings'?'recordings':'attachments')!==file.kind)throw Error('备份媒体类型与记录不一致')
   for(const hash of [row.sha256,entity.sha256])if(hash&&(typeof hash!=='string'||hash.toLowerCase()!==file.sha256))throw Error('备份媒体校验值与记录不一致')
  }
 }
 for(const row of tables.sync_recovery||[])if(typeof row.archive_json==='string'){
  const archive=JSON.parse(row.archive_json)
  if(archive.tables)validateBackupMediaReferences(archive.tables,media,depth+1)
 }
}
