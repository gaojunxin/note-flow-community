import {describe,expect,it} from 'vitest'
import {decodeSyncRecoveryArchive,RecoveryArchiveError} from '@note-flow/core/community'
const base={schema:'jiyu-sync-recovery',version:1,id:'synthetic-archive',createdAt:'2026-10-08T00:00:00.000Z'}
const variants=[
 {kind:'pc-epoch',data:{fromEpoch:'old',toEpoch:'new',tables:{outbox:[{operation_json:'{"sent":true,"future":1}'}]}}},
 {kind:'mobile-epoch',data:{fromEpoch:null,toEpoch:'new',stores:{outbox:[{operationId:'pending',sent:true}]}}},
 {kind:'action',data:{reason:'discard-failed-task',entityUid:'task',tables:{tasks:[{entity_json:'{"title":"unsent"}'}],outbox:[]}}},
 {kind:'action',data:{reason:'resolve-folder-conflict',conflict:{serverEntity:{version:2}},operations:[{operationId:'old'}],local:{deleted:true}}},
 {kind:'action',data:{reason:'legacy-migration-marker-missing',source:'legacy-db',stores:{notes:[{uid:'note',future:{kept:true}}]}}},
] as const

describe('public legacy recovery archive reader',()=>{
 for(const [index,fixture] of variants.entries())it(`reads existing v1 shape ${index+1} without changing its data`,()=>{
  const archive={...base,...fixture.data,futureTopLevel:{preserved:true}}
  const decoded=decodeSyncRecoveryArchive(JSON.stringify(archive))
  expect(decoded.kind).toBe(fixture.kind)
  expect(decoded.archive).toEqual(archive)
 })
 it('rejects corrupt row maps, ambiguous epochs and incomplete fields',()=>{
  for(const value of [null,[],{}, {...base,fromEpoch:null,toEpoch:'new'}, {...base,fromEpoch:null,toEpoch:'new',tables:{},stores:{}}, {...base,fromEpoch:null,toEpoch:'new',tables:{notes:{}}}, {...base,reason:''}, {...base,reason:'action',operations:{}}, {...base,reason:'action',conflict:[]}, {...base,reason:'action',stores:[]}, {...base,id:'',reason:'action'}]) {
   expect(()=>decodeSyncRecoveryArchive(JSON.stringify(value))).toThrow(RecoveryArchiveError)
  }
  expect(()=>decodeSyncRecoveryArchive('{broken')).toThrow(RecoveryArchiveError)
 })
 it('reports future versions explicitly instead of interpreting or downgrading them',()=>{
  try{decodeSyncRecoveryArchive(JSON.stringify({...base,...variants[0].data,version:2}));throw Error('accepted future format')}
  catch(error){expect(error).toMatchObject({code:'ARCHIVE_VERSION_UNSUPPORTED'})}
 })
 it('retains original serialized data when unknown numeric literals exceed JS precision',()=>{
  const serialized='{"schema":"jiyu-sync-recovery","version":1,"id":"a","createdAt":"now","reason":"future-action","futureSeq":9007199254740995}'
  expect(decodeSyncRecoveryArchive(serialized).serialized).toBe(serialized)
 })
 it('preserves unknown data and prototype-shaped keys as inert JSON fields',()=>{
  const serialized='{"schema":"jiyu-sync-recovery","version":1,"id":"a","createdAt":"now","reason":"future-action","__proto__":{"archivePolluted":true},"future":{"seq":"9007199254740995"}}'
  const decoded=decodeSyncRecoveryArchive(serialized)
  expect(Object.prototype.hasOwnProperty.call(decoded.archive,'__proto__')).toBe(true)
  expect(({} as Record<string,unknown>).archivePolluted).toBeUndefined()
  expect(JSON.parse(JSON.stringify(decoded.archive))).toEqual(JSON.parse(serialized))
 })
})
