import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it} from 'vitest'
import {deleteDB} from 'idb'
import {createLocalEntityRepository, encodePortableValue, decodePortableValue} from '@note-flow/core/community'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
import type {LocalWorkspaceSnapshot} from '@note-flow/core/contracts'
const context = {profileId: 'original', storageSchemaVersion: 1}
const resources: Array<{name: string; host: ReturnType<typeof createIndexedDbLocalHost>}> = []
const setup = () => {
 const name = `community-backup-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
 resources.push({name,host}); return host
}
afterEach(async () => {for (const {name,host} of resources.splice(0)) {await host.close(); await deleteDB(name)}})
describe('community portable backup', () => {
 it('round trips media, unknown fields, binary, tombstones and immutable change snapshots', async () => {
  const host = setup(), notes = createLocalEntityRepository(host,context,'note')
  const note = await notes.create({title:'正文', content:'原文', custom:{future:'keep'}, media:new Blob([new Uint8Array([0,128,255])],{type:'audio/webm'}), bytes:new Uint8Array([1,2]), missing:undefined})
  await notes.remove(note.entity,note.revision)
  const backup = await host.exportWorkspace(context)
  const portable = JSON.stringify(await encodePortableValue(backup))
  const decoded = decodePortableValue(JSON.parse(portable)) as LocalWorkspaceSnapshot
  const restoredContext = {...context,profileId:'restored'}
  await host.restoreWorkspace(restoredContext,decoded)
  const restored = createLocalEntityRepository(host,restoredContext,'note')
  expect(await restored.get(note.entity.uid)).toBeUndefined()
  const deleted = (await restored.get(note.entity.uid,true))!
  expect(deleted.entity.custom).toEqual({future:'keep'})
  expect([...new Uint8Array(await (deleted.entity.media as Blob).arrayBuffer())]).toEqual([0,128,255])
  expect(deleted.entity.bytes).toEqual(new Uint8Array([1,2]))
  expect(Object.hasOwn(deleted.entity,'missing')).toBe(true)
  expect((await host.listChanges(restoredContext)).items.map(change=>change.profileId)).toEqual(['restored','restored'])
  await restored.restore(note.entity.uid,deleted.revision)
  expect((await restored.get(note.entity.uid))?.entity.content).toBe('原文')
 })
 it('refuses nonempty targets and corrupt backups without losing existing data', async () => {
  const host = setup(), notes = createLocalEntityRepository(host,context,'note')
  const note = await notes.create({title:'preserve'})
  const backup = await host.exportWorkspace(context)
  await expect(host.restoreWorkspace(context,backup)).rejects.toMatchObject({code:'PROFILE_BUSY'})
  const malformed = structuredClone(backup); malformed.entities.push(malformed.entities[0])
  const target = {...context,profileId:'empty'}
  await expect(host.restoreWorkspace(target,malformed)).rejects.toMatchObject({code:'INVALID_CHANGE'})
  expect((await host.listEntities(target)).items).toEqual([])
  expect((await notes.get(note.entity.uid))?.entity.title).toBe('preserve')
 })
 it('preserves reserved object keys as data and rejects malformed encodings', async () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"custom"}')
  const decoded = decodePortableValue(await encodePortableValue(input)) as Record<string,unknown>
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.hasOwn(decoded,'__proto__')).toBe(true)
  expect(({} as Record<string,unknown>).polluted).toBeUndefined()
  expect(()=>decodePortableValue({kind:'object',value:[['a',{kind:'null'}],['a',{kind:'null'}]]})).toThrow()
  const circular: Record<string,unknown> = {}; circular.self = circular
  await expect(encodePortableValue(circular)).rejects.toThrow('循环')
 })
})
