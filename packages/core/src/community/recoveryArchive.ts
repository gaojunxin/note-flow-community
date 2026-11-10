import type {DecodedRecoveryArchive, SyncRecoveryArchiveV1} from '../contracts/recovery'

export class RecoveryArchiveError extends Error {
  constructor(readonly code:'ARCHIVE_INVALID'|'ARCHIVE_VERSION_UNSUPPORTED',message:string) {
    super(message)
    this.name='RecoveryArchiveError'
  }
}
const invalid=():never=>{throw new RecoveryArchiveError('ARCHIVE_INVALID','恢复档案格式不完整或不明确')}
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0
const rows=(value:unknown)=>object(value)&&Object.values(value).every(Array.isArray)
const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key)

/** Validate and classify serialized archives without changing fields or interpreting/replaying operations. */
export function decodeSyncRecoveryArchive(serialized:string):DecodedRecoveryArchive {
  let value:unknown
  try {value=JSON.parse(serialized)} catch {return invalid()}
  if(!object(value)||value.schema!=='jiyu-sync-recovery')return invalid()
  if(value.version!==1)throw new RecoveryArchiveError('ARCHIVE_VERSION_UNSUPPORTED','恢复档案版本暂不支持')
  if(!text(value.id)||!text(value.createdAt))return invalid()
  for(const key of ['tables','stores'])if(own(value,key)&&!rows(value[key]))return invalid()
  if(own(value,'reason')) {
    if(!text(value.reason))return invalid()
    for(const key of ['entityUid','source'])if(own(value,key)&&!text(value[key]))return invalid()
    if(own(value,'conflict')&&!object(value.conflict))return invalid()
    if(own(value,'operations')&&!Array.isArray(value.operations))return invalid()
    return {kind:'action',serialized,archive:value as unknown as Extract<SyncRecoveryArchiveV1,{reason:string}>}
  }
  if(!(value.fromEpoch===null||typeof value.fromEpoch==='string')||!text(value.toEpoch))return invalid()
  if(own(value,'tables')===own(value,'stores'))return invalid()
  return own(value,'tables')
    ? {kind:'pc-epoch',serialized,archive:value as unknown as Extract<SyncRecoveryArchiveV1,{tables:unknown;reason?:never}>}
    : {kind:'mobile-epoch',serialized,archive:value as unknown as Extract<SyncRecoveryArchiveV1,{stores:unknown;reason?:never}>}
}
