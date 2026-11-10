import 'fake-indexeddb/auto'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createInterface} from 'node:readline'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {deleteDB} from 'idb'
import {createNativeLocalHost} from '@note-flow/core/local-storage-native'
import type {NativeLocalTransport} from '@note-flow/core/local-storage-native'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
import {createLocalEntityRepository, createCommunityTasks, CoreProviderError, importRecoveryArchive, importRecoveryArchiveWithMedia} from '@note-flow/core/community'
import type {CoreErrorCode} from '@note-flow/core/contracts'

const binary = process.env.NOTEFLOW_NATIVE_LOCAL_BRIDGE
if (!binary) throw Error('Set NOTEFLOW_NATIVE_LOCAL_BRIDGE to the cargo-built json_bridge example')
const context = {profileId:'test',storageSchemaVersion:1}
let directory: string
const processes: ReturnType<typeof spawn>[] = []
const hosts: Array<{close():Promise<void>}> = []
const idbNames: string[] = []
function transport(file: string): NativeLocalTransport {
 const child=spawn(binary!,[file],{stdio:['pipe','pipe','pipe']}); processes.push(child)
 const lines=createInterface({input:child.stdout!})
 let nextId=0
 const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>()
 lines.on('line',line=>{const response=JSON.parse(line),waiter=pending.get(response.id);if(!waiter)return;pending.delete(response.id);response.error?waiter.reject(new CoreProviderError(response.error.code as CoreErrorCode,'原生仓储操作失败')):waiter.resolve(response.result)})
 child.on('error',error=>{for(const item of pending.values())item.reject(error);pending.clear()})
 child.on('exit',()=>{for(const item of pending.values())item.reject(Error('Local bridge exited'));pending.clear()})
 return {request(input){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});child.stdin!.write(JSON.stringify({id,...input})+'\n')})}}
}
function host(file=join(directory,'local.sqlite')) {const instance=createNativeLocalHost(transport(file));hosts.push(instance);return instance}
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'nf-native-local-'))})
afterEach(async()=>{
 for(const item of hosts.splice(0))await item.close()
 for(const child of processes.splice(0)){if(child.exitCode===null){const exit=once(child,'exit');child.stdin!.end();await exit}}
 for(const name of idbNames.splice(0))await deleteDB(name)
 await rm(directory,{recursive:true,force:true})
})
describe('public host through real Rust SQLite bridge',()=>{
 it('edits retains unknown fields and restores tombstones with monotonic logs',async()=>{
  const storage=host(),notes=createLocalEntityRepository(storage,context,'note')
  const initial=await notes.create({title:'native',custom:{preserve:true},blob:new Blob([new Uint8Array([1,128,255])],{type:'image/png'})})
  const edit=await notes.update({...initial.entity,title:'edited'},initial.revision)
  await notes.remove(edit.entity,edit.revision)
  const tombstone=(await notes.get(edit.entity.uid,true))!
  expect(tombstone.deleted).toBe(true)
  const restored=await notes.restore(edit.entity.uid,tombstone.revision)
  expect(restored.entity.custom).toEqual({preserve:true})
  expect([...new Uint8Array(await (restored.entity.blob as Blob).arrayBuffer())]).toEqual([1,128,255])
  const first=await storage.listChanges(context,{limit:2})
  expect(first.items.map(item=>item.action)).toEqual(['create','update'])
  expect((await storage.listChanges(context,{afterSequence:first.nextSequence})).items.map(item=>item.action)).toEqual(['delete','create'])
  expect((await storage.listChanges({...context,profileId:'other'})).items).toEqual([])
 })
 it('rejects stale writes from a second connection and rolls back a failed log',async()=>{
  const a=host(),b=host(),notes=createLocalEntityRepository(a,context,'note')
  const created=await notes.create({title:'before'})
  let resume!:()=>void,ready!:()=>void
  const gate=new Promise<void>(resolve=>{resume=resolve}),observed=new Promise<void>(resolve=>{ready=resolve})
  const pending=a.transaction(context,async tx=>{const row=await tx.get({entityType:'note',entityUid:created.entity.uid});ready();await gate;const after=await tx.put({entityType:'note',entityUid:created.entity.uid},{title:'stale'},row!.revision);await tx.appendChange({profileId:'test',entityType:'note',entityUid:created.entity.uid,changeId:'stale',action:'update',beforeRevision:row!.revision,afterRevision:after.revision,createdAt:new Date().toISOString()})})
  await observed
  const updated=await createLocalEntityRepository(b,context,'note').update({...created.entity,title:'winner'},created.revision)
  resume();await expect(pending).rejects.toMatchObject({code:'REVISION_CONFLICT'})
  expect((await notes.get(created.entity.uid))?.revision).toBe(updated.revision)
  await expect(a.transaction(context,tx=>tx.put({entityType:'note',entityUid:'no-log'},{title:'bad'},null))).rejects.toMatchObject({code:'INVALID_CHANGE'})
  expect(await notes.get('no-log')).toBeUndefined()
 })
 it('round trips backup between Web and native stores including binary media',async()=>{
  const name=`nf-native-backup-${crypto.randomUUID()}`;idbNames.push(name)
  const web=createIndexedDbLocalHost(name);hosts.push(web)
  const notes=createLocalEntityRepository(web,context,'note')
  const note=await notes.create({title:'web origin',media:new Blob(['bytes']),future:undefined})
  const native=host();await native.restoreWorkspace(context,await web.exportWorkspace(context))
  const restored=createLocalEntityRepository(native,context,'note')
  expect(await ((await restored.get(note.entity.uid))!.entity.media as Blob).text()).toBe('bytes')
  await expect(native.restoreWorkspace(context,await web.exportWorkspace(context))).rejects.toMatchObject({code:'PROFILE_BUSY'})
  const other={...context,profileId:'round-trip'}
  await web.restoreWorkspace(other,await native.exportWorkspace(context))
  expect((await createLocalEntityRepository(web,other,'note').get(note.entity.uid))?.entity.title).toBe('web origin')
 })
 it('advances repeat tasks atomically through the same repository implementation',async()=>{
  const storage=host(),tasks=createCommunityTasks(storage,context)
  const initial=await tasks.create({title:'monthly',dueAt:'2026-01-31T09:00:00',timezone:'Asia/Shanghai',recurrenceRule:JSON.stringify({frequency:'monthly',interval:1,count:2})})
  const result=await tasks.resolve(initial.entity.uid,initial.revision,'complete')
  expect(result.next?.entity.dueAt).toBe('2026-02-28T09:00:00')
  expect((await storage.listChanges(context)).items).toHaveLength(3)
  expect((await tasks.list()).items).toHaveLength(2)
 })
 it('pages entities and rejects use after close',async()=>{
  const storage=host(),notes=createLocalEntityRepository(storage,context,'note')
  for(const uid of ['a','b','c'])await notes.create({uid,title:uid})
  const first=await storage.listEntities(context,{entityType:'note',limit:2})
  expect(first.hasMore).toBe(true)
  expect((await storage.listEntities(context,{entityType:'note',limit:2,afterKey:first.nextKey})).items.map(row=>row.entityUid)).toEqual(['c'])
  await storage.close()
  await expect(notes.get('a')).rejects.toMatchObject({code:'DISPOSED'})
 })
})

it('imports a legacy recovery archive through real SQLite and preserves it across connection reopen',async()=>{
 const first=host()
 const serialized=JSON.stringify({schema:'jiyu-sync-recovery',version:1,id:'native-recovery',createdAt:'2026-10-08T00:00:00Z',fromEpoch:'old',toEpoch:'new',tables:{notes:[{uid:'old-note',entity_json:JSON.stringify({uid:'old-note',title:'Recovered',content:'pending body',syncStatus:'conflict',future:{kept:true}})},{uid:'deleted-note',entity_json:JSON.stringify({uid:'deleted-note',deleted:true,content:'tombstone body'})}],outbox:[{operation_json:'{"sent":true}'}],metadata:[{key:'sync_cursor',value:'old-cursor'}]}})
 await importRecoveryArchive(first,context,serialized)
 const reopened=host(),notes=createLocalEntityRepository(reopened,context,'note')
 expect((await notes.get('old-note'))?.entity).toMatchObject({content:'pending body',syncStatus:'conflict',future:{kept:true}})
 expect(await notes.get('deleted-note')).toBeUndefined()
 expect((await notes.get('deleted-note',true))?.entity.content).toBe('tombstone body')
 const snapshot=await reopened.exportWorkspace(context)
 expect(snapshot.entities.find(row=>row.entityType==='recovery_archive')?.value.serialized).toBe(serialized)
 expect(snapshot.entities.map(row=>row.entityType).sort()).toEqual(['note','note','recovery_archive'])
 expect(snapshot.changes).toHaveLength(3)
 await expect(importRecoveryArchive(reopened,context,serialized)).rejects.toMatchObject({code:'PROFILE_BUSY'})
 expect((await reopened.exportWorkspace(context)).entities).toHaveLength(3)
 const other={...context,profileId:'independent'}
 expect((await reopened.exportWorkspace(other)).entities).toEqual([])
 const name=`nf-recovered-roundtrip-${crypto.randomUUID()}`;idbNames.push(name)
 const web=createIndexedDbLocalHost(name);hosts.push(web)
 await web.restoreWorkspace(other,snapshot)
 expect((await web.exportWorkspace(other)).entities.find(row=>row.entityType==='recovery_archive')?.value.serialized).toBe(serialized)
})

it('restores verified archive media through SQLite including immutable binary change snapshots',async()=>{
 const storage=host(),blob=new Blob([new Uint8Array([0,128,255])],{type:'audio/webm'})
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')
 const source=JSON.stringify({schema:'jiyu-sync-recovery',version:1,id:'media-native',createdAt:'2026-10-08T00:00:00Z',fromEpoch:'old',toEpoch:'new',stores:{attachments:[{uid:'media',sha256,sizeBytes:3,localPath:'/old/file',future:7}]}})
 await importRecoveryArchiveWithMedia(storage,context,source,[{entityType:'attachment',entityUid:'media',blob}])
 const reopened=host(),snapshot=await reopened.exportWorkspace(context)
 const attachment=snapshot.entities.find(row=>row.entityType==='attachment')!
 expect(attachment.value).toMatchObject({localPath:'/old/file',future:7})
 expect([...new Uint8Array(await (attachment.value.blob as Blob).arrayBuffer())]).toEqual([0,128,255])
 const logged=snapshot.changes.find(row=>row.entityType==='attachment')?.entity?.blob as Blob
 expect([...new Uint8Array(await logged.arrayBuffer())]).toEqual([0,128,255])
 expect(snapshot.entities.find(row=>row.entityType==='recovery_archive')?.value.serialized).toBe(source)
})
