import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it} from 'vitest'
import {openDB, deleteDB} from 'idb'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
import type {LocalWriteTransaction} from '@note-flow/core/contracts'
const context = {profileId: 'a', storageSchemaVersion: 1}
const ref = {entityType: 'note', entityUid: 'n'}
const hosts: Array<ReturnType<typeof createIndexedDbLocalHost>> = []
const names: string[] = []
const setup = () => {
 const name = `local-host-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
 hosts.push(host); names.push(name); return {host, name}
}
const save = async (tx: LocalWriteTransaction, expected: string | null = null, id = crypto.randomUUID()) => {
 const after = await tx.put(ref, {title: 'draft', custom: true}, expected)
 await tx.appendChange({...ref, changeId: id, profileId: 'a', action: expected ? 'update' : 'create', beforeRevision: expected ?? undefined, afterRevision: after.revision, createdAt: new Date().toISOString()})
 return after.revision
}
afterEach(async () => {await Promise.all(hosts.splice(0).map(h => h.close())); await Promise.all(names.splice(0).map(n => deleteDB(n)))})
describe('local IDB atomic host', () => {
 it('persists logs and preserves unknown fields across reopen', async () => {
  const {host, name} = setup(), revision = await host.transaction(context, tx => save(tx))
  await host.transaction(context, async tx => {
   const next = await tx.put(ref, {title: 'changed'}, revision)
   await tx.appendChange({...ref, changeId: 'update', profileId: 'a', action: 'update', beforeRevision: revision, afterRevision: next.revision, createdAt: new Date().toISOString()})
  })
  await host.close()
  const reopened = createIndexedDbLocalHost(name); hosts.push(reopened)
  expect((await reopened.transaction(context, tx => tx.get(ref)))?.value).toEqual({title: 'changed', custom: true})
  const db = await openDB(name); expect(await db.count('local_changes')).toBe(2); db.close()
 })
 it('rolls back missing logs, callback failures and duplicate log writes', async () => {
  const {host, name} = setup()
  await expect(host.transaction(context, tx => tx.put(ref, {}, null))).rejects.toMatchObject({code: 'INVALID_CHANGE'})
  await expect(host.transaction(context, async tx => {await save(tx); throw Error('cancel')})).rejects.toThrow('cancel')
  const revision = await host.transaction(context, tx => save(tx, null, 'same'))
  await expect(host.transaction(context, tx => save(tx, revision, 'same'))).rejects.toBeDefined()
  expect((await host.transaction(context, tx => tx.get(ref)))?.revision).toBe(revision)
  const db = await openDB(name); expect(await db.count('local_changes')).toBe(1); db.close()
 })
 it('rejects stale concurrent snapshots at commit', async () => {
  const {host} = setup(), revision = await host.transaction(context, tx => save(tx))
  let resume!: () => void, captured!: () => void
  const ready = new Promise<void>(r => {captured = r}), gate = new Promise<void>(r => {resume = r})
  const slow = host.transaction(context, async tx => {await tx.get(ref); captured(); await gate; await save(tx, revision)})
  await ready
  const winner = await host.transaction(context, tx => save(tx, revision))
  resume()
  await expect(slow).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
  expect((await host.transaction(context, tx => tx.get(ref)))?.revision).toBe(winner)
 })
 it('isolates profiles and rejects escaped handles and forged logs', async () => {
  const {host} = setup(); let escaped!: LocalWriteTransaction
  await host.transaction(context, async tx => {escaped = tx; await save(tx)})
  await expect(escaped.get(ref)).rejects.toMatchObject({code: 'TRANSACTION_CLOSED'})
  expect(await host.transaction({...context, profileId: 'b'}, tx => tx.get(ref))).toBeUndefined()
  await expect(host.transaction({...context, profileId: 'b'}, tx => save(tx))).rejects.toMatchObject({code: 'INVALID_CHANGE'})
  await expect(host.transaction({...context, storageSchemaVersion: 2}, tx => tx.get(ref))).rejects.toMatchObject({code: 'SCHEMA_INCOMPATIBLE'})
 })
 it('retains tombstones and matching delete logs', async () => {
  const {host, name} = setup(), revision = await host.transaction(context, tx => save(tx))
  await host.transaction(context, async tx => {
   const next = await tx.delete(ref, revision)
   await tx.appendChange({...ref, profileId: 'a', changeId: 'delete', action: 'delete', beforeRevision: revision, afterRevision: next.revision, createdAt: new Date().toISOString()})
  })
  expect(await host.transaction(context, tx => tx.get(ref))).toBeUndefined()
  await expect(host.transaction(context, tx => save(tx))).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
  const db = await openDB(name); expect((await db.getAll('local_entities'))[0].deleted).toBe(true); expect(await db.count('local_changes')).toBe(2); db.close()
 })
 it('paginates entities and monotonic logs without skipping later random IDs', async () => {
  const {host} = setup()
  for (const [index, uid] of ['a', 'b', 'c'].entries()) {
   await host.transaction(context, async tx => {
    const entity = {...ref, entityUid: uid}, next = await tx.put(entity, {title: uid}, null)
    await tx.appendChange({...entity, profileId: 'a', changeId: ['z', 'm', 'a'][index], action: 'create', afterRevision: next.revision, createdAt: new Date().toISOString()})
   })
  }
  const first = await host.listEntities(context, {limit: 2})
  expect(first.items.map(item => item.entityUid)).toEqual(['a', 'b'])
  expect(first.hasMore).toBe(true)
  const last = await host.listEntities(context, {afterKey: first.nextKey, limit: 2})
  expect(last.items.map(item => item.entityUid)).toEqual(['c'])
  expect(last.hasMore).toBe(false)
  const logs = await host.listChanges(context, {limit: 2})
  expect(logs.items.map(item => item.changeId)).toEqual(['z', 'm'])
  expect((await host.listChanges(context, {afterSequence: logs.nextSequence})).items.map(item => item.changeId)).toEqual(['a'])
  expect((await host.listChanges({...context, profileId: 'b'})).items).toEqual([])
  await expect(host.listChanges(context, {limit: 0})).rejects.toMatchObject({code: 'INVALID_CONTEXT'})
 })
 it('upgrades prototype logs without losing records', async () => {
  const name = `local-host-${crypto.randomUUID()}`; names.push(name)
  const old = await openDB(name, 1, {upgrade(db) {
   const entities = db.createObjectStore('local_entities', {keyPath: 'key'}); entities.createIndex('by-profile', 'profileId')
   const changes = db.createObjectStore('local_changes', {keyPath: 'key'}); changes.createIndex('by-profile', 'profileId')
  }})
  await old.put('local_changes', {...ref, key: JSON.stringify(['a', 'legacy']), profileId: 'a', changeId: 'legacy', action: 'create', afterRevision: 'r', createdAt: new Date().toISOString()})
  old.close()
  const host = createIndexedDbLocalHost(name); hosts.push(host)
  expect((await host.listChanges(context)).items[0]).toMatchObject({changeId: 'legacy', sequence: 1})
  await host.transaction(context, tx => save(tx))
  expect((await host.listChanges(context)).items.map(item => item.sequence)).toEqual([1, 2])
 })

})
