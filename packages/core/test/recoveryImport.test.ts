import 'fake-indexeddb/auto'
import {afterEach,expect,it} from 'vitest'
import {deleteDB} from 'idb'
import {importRecoveryArchive,prepareRecoveryArchiveImport,importRecoveryArchiveWithMedia,prepareRecoveryArchiveImportWithMedia,createLocalEntityRepository} from '@note-flow/core/community'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
const base={schema:'jiyu-sync-recovery',version:1,id:'old-archive',createdAt:'2026-10-08T00:00:00Z',fromEpoch:'old',toEpoch:'new'}
const resources:Array<{name:string;host:ReturnType<typeof createIndexedDbLocalHost>}>=[]
const setup=()=>{const name=`recovery-import-${crypto.randomUUID()}`,host=createIndexedDbLocalHost(name);resources.push({name,host});return host}
afterEach(async()=>{for(const {name,host} of resources.splice(0)){await host.close();await deleteDB(name)}})
it('imports PC entities, conflicts and advanced rules losslessly as local data and archives operations without replay',async()=>{
 const host=setup(),context={profileId:'fresh',storageSchemaVersion:1}
 const rule='{"frequency":"yearly","calendar":"lunar","futureRule":1}'
 const value={uid:'task',title:'local pending',syncStatus:'conflict',recurrenceRule:rule,future:{kept:true},version:4}
 const serialized=JSON.stringify({...base,tables:{tasks:[{uid:'task',entity_json:JSON.stringify(value)}],outbox:[{operation_json:'{"sent":true}'}],conflicts:[{conflict_json:'{"future":true}'}],metadata:[{key:'sync_cursor',value:'old'}]}}).replace('"version":1','"version":1,"futureSeq":9007199254740995')
 const summary=await importRecoveryArchive(host,context,serialized)
 expect(summary.entities).toBe(1)
 expect(summary.preservedStores).toEqual(['outbox','conflicts','metadata'])
 const snapshot=await host.exportWorkspace(context)
 expect(snapshot.entities.find(row=>row.entityType==='task')?.value).toEqual(value)
 expect(snapshot.entities.find(row=>row.entityType==='recovery_archive')?.value.serialized).toBe(serialized)
 expect(snapshot.entities.map(row=>row.entityType).sort()).toEqual(['recovery_archive','task'])
 expect(snapshot.changes.every(row=>row.profileId==='fresh')).toBe(true)
 expect(snapshot.changes[0].entity).toEqual(value)
})
it('restores mobile tombstones and isolates the destination, refusing an occupied target',async()=>{
 const host=setup(),context={profileId:'new',storageSchemaVersion:1}
 const source={...base,stores:{notes:[{uid:'note',localKey:'note',content:'trash body',deleted:true,futureBlobRef:'private-file'}],outbox:[{entityUid:'note'}]}}
 await importRecoveryArchive(host,context,JSON.stringify(source))
 const notes=createLocalEntityRepository(host,context,'note')
 expect(await notes.get('note')).toBeUndefined()
 expect((await notes.get('note',true))?.entity.content).toBe('trash body')
 expect((await host.exportWorkspace({...context,profileId:'other'})).entities).toEqual([])
 await expect(importRecoveryArchive(host,context,JSON.stringify(source))).rejects.toMatchObject({code:'PROFILE_BUSY'})
 expect((await host.exportWorkspace(context)).entities).toHaveLength(2)
})
it('rejects corrupt or ambiguous entities before writing any target state',async()=>{
 const host=setup(),context={profileId:'empty',storageSchemaVersion:1}
 for(const rows of [[{uid:'x',entity_json:'broken'}],[{uid:'x',entity_json:'{"uid":"other"}'}],[{entity_json:'{}'}],[{uid:'x',entity_json:'{"uid":"x"}'},{uid:'x',entity_json:'{"uid":"x"}'}]]){
  await expect(importRecoveryArchive(host,context,JSON.stringify({...base,tables:{notes:rows}}))).rejects.toMatchObject({code:'ARCHIVE_INVALID'})
  expect((await host.exportWorkspace(context)).entities).toEqual([])
 }
 expect(()=>prepareRecoveryArchiveImport(JSON.stringify({...base,reason:'conflict',conflict:{}}),context)).toThrow(expect.objectContaining({code:'RECOVERY_REQUIRED'}))
})

it('maps the actual PC local table names and preserves folder and tag relation identities',()=>{
 const tables={local_folders:[{uid:'folder',entity_json:JSON.stringify({uid:'folder',parentUid:'parent',name:'Folder'})}],local_tags:[{uid:'tag',entity_json:JSON.stringify({uid:'tag',name:'Tag'})}],local_note_tags:[{uid:'edge',entity_json:JSON.stringify({uid:'edge',noteUid:'note',tagUid:'tag',deleted:true})}]}
 const {snapshot}=prepareRecoveryArchiveImport(JSON.stringify({...base,tables}),{profileId:'fresh',storageSchemaVersion:1})
 expect(snapshot.entities.filter(row=>row.entityType!=='recovery_archive').map(row=>[row.entityType,row.entityUid,row.deleted])).toEqual([['folder','folder',false],['tag','tag',false],['note_tag','edge',true]])
 expect(snapshot.entities[2].value).toEqual({uid:'edge',noteUid:'note',tagUid:'tag',deleted:true})
})

it('verifies and restores binary media without rewriting source paths or unknown metadata',async()=>{
 const host=setup(),context={profileId:'media',storageSchemaVersion:1},blob=new Blob([new Uint8Array([0,128,255])],{type:'audio/webm'})
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')
 const attachment={uid:'media',sha256,sizeBytes:3,localPath:'/old/private/file',future:{kept:true}}
 const serialized=JSON.stringify({...base,tables:{local_attachments:[{uid:'media',entity_json:JSON.stringify(attachment)}],recordings:[{uid:'recording',entity_json:JSON.stringify({uid:'recording',sha256,fileSize:3})}]}})
 const result=await importRecoveryArchiveWithMedia(host,context,serialized,[{entityType:'attachment',entityUid:'media',blob}])
 expect(result.media).toEqual({attached:1,missing:[{entityType:'recording',entityUid:'recording'}]})
 const snapshot=await host.exportWorkspace(context),row=snapshot.entities.find(row=>row.entityType==='attachment')!
 expect(row.value).toMatchObject(attachment)
 expect([...new Uint8Array(await (row.value.blob as Blob).arrayBuffer())]).toEqual([0,128,255])
 expect(snapshot.changes.find(row=>row.entityType==='attachment')?.entity?.blob).toBeInstanceOf(Blob)
 expect(snapshot.entities.find(row=>row.entityType==='recovery_archive')?.value.serialized).toBe(serialized)
})
it('rejects missing hashes, wrong bytes, wrong sizes, unknown identities and duplicates before any writes',async()=>{
 const host=setup(),context={profileId:'media-empty',storageSchemaVersion:1},blob=new Blob(['correct'])
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')
 const archive=(value:Record<string,unknown>)=>JSON.stringify({...base,stores:{attachments:[{uid:'file',...value}]}})
 const file={entityType:'attachment' as const,entityUid:'file',blob}
 for(const [serialized,files,code] of [
  [archive({}),[file],'RECOVERY_REQUIRED'],
  [archive({sha256}),[{...file,blob:new Blob(['wrong'])}],'INVALID_CHANGE'],
  [archive({sha256,sizeBytes:2}),[file],'INVALID_CHANGE'],
  [archive({sha256}),[{...file,entityUid:'unknown'}],'INVALID_CHANGE'],
  [archive({sha256}),[file,file],'INVALID_CHANGE'],
 ] as const){
  await expect(importRecoveryArchiveWithMedia(host,context,serialized,files)).rejects.toMatchObject({code})
  expect((await host.exportWorkspace(context)).entities).toEqual([])
 }
 const preview=await prepareRecoveryArchiveImportWithMedia(archive({sha256}),context,[])
 expect(preview.media.missing).toEqual([{entityType:'attachment',entityUid:'file'}])
})

it('preserves native attachment cancellation tombstones during edition recovery',()=>{
 const source={...base,tables:{local_attachments:[{uid:'synthetic-deleted-json',entity_json:JSON.stringify({uid:'synthetic-deleted-json',status:'deleted',serverUid:'synthetic-server',relationUid:'synthetic-edge',relationVersion:1})},{uid:'synthetic-deleted-column',sync_status:'deleted',entity_json:JSON.stringify({uid:'synthetic-deleted-column',status:'uploaded'})}]}}
 const result=prepareRecoveryArchiveImport(JSON.stringify(source),{profileId:'synthetic-destination',storageSchemaVersion:1})
 const attachments=result.snapshot.entities.filter(row=>row.entityType==='attachment')
 expect(attachments).toHaveLength(2);expect(attachments.every(row=>row.deleted)).toBe(true)
 expect(result.snapshot.changes.filter(row=>row.entityType==='attachment').every(row=>row.action==='delete')).toBe(true)
 expect(attachments[0].value).toMatchObject({serverUid:'synthetic-server',relationUid:'synthetic-edge',relationVersion:1})
})
