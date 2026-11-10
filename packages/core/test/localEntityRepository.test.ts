import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it} from 'vitest'
import {deleteDB} from 'idb'
import {createLocalEntityRepository} from '@note-flow/core/community'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
const context = {profileId: 'local', storageSchemaVersion: 1}
const resources: Array<{host: ReturnType<typeof createIndexedDbLocalHost>; name: string}> = []
const setup = () => {
 const name = `repository-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
 resources.push({host, name})
 return {host, notes: createLocalEntityRepository(host, context, 'note'), tasks: createLocalEntityRepository(host, context, 'task')}
}
afterEach(async () => {for (const {host, name} of resources.splice(0)) {await host.close(); await deleteDB(name)}})
describe('community local entity repository', () => {
 it('creates edits deletes and restores without a login or network transport', async () => {
  const {host, notes, tasks} = setup()
  const created = await notes.create({title: '本地笔记', content: '# 内容', extension: {retained: true}})
  expect(created.entity.uid).toBeTruthy()
  expect(await tasks.get(created.entity.uid)).toBeUndefined()
  const updated = await notes.update({...created.entity, title: '更新'}, created.revision)
  expect(updated.entity.createdAt).toBe(created.entity.createdAt)
  await notes.remove(updated.entity, updated.revision)
  expect(await notes.get(updated.entity.uid)).toBeUndefined()
  const deleted = await notes.get(updated.entity.uid, true)
  expect(deleted?.deleted).toBe(true)
  const restored = await notes.restore(updated.entity.uid, deleted!.revision)
  expect(restored.entity.extension).toEqual({retained: true})
  expect((await notes.list()).items).toHaveLength(1)
  const changes = await host.listChanges(context)
  expect(changes.items.map(item => item.action)).toEqual(['create', 'update', 'delete', 'create'])
  expect(changes.items[0].entity?.title).toBe('本地笔记')
  expect(changes.items[1].entity?.title).toBe('更新')
 })
 it('rejects stale updates and validation errors without adding a log', async () => {
  const {host, notes} = setup()
  const created = await notes.create({title: '原文'})
  await notes.update({...created.entity, title: '新文'}, created.revision)
  await expect(notes.update({...created.entity, title: '旧文'}, created.revision)).rejects.toMatchObject({code: 'REVISION_CONFLICT'})
  const guarded = createLocalEntityRepository(host, context, 'guarded', async () => {throw Error('invalid')})
  await expect(guarded.create({title: 'reject'})).rejects.toThrow('invalid')
  expect((await host.listChanges(context)).items).toHaveLength(2)
  expect((await guarded.list()).items).toHaveLength(0)
 })
})
