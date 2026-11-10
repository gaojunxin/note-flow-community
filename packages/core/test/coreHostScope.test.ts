import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {deleteDB} from 'idb'
import {createCoreHostScope} from '@note-flow/core/community'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
import type {CoreHostServices, LocalWriteTransaction} from '@note-flow/core/contracts'

const context = {profileId: 'contract-scope', storageSchemaVersion: 1}
const ref = {entityType: 'note', entityUid: 'n'}
const opened: Array<{name: string; host: ReturnType<typeof createIndexedDbLocalHost>}> = []
const setup = () => {
  const name = `scope-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
  opened.push({name, host}); return host
}
const write = async (tx: LocalWriteTransaction) => {
  const next = await tx.put(ref, {title: 'local', untouched: {future: true}}, null)
  await tx.appendChange({...ref, profileId: context.profileId, changeId: 'c', action: 'create',
    afterRevision: next.revision, createdAt: new Date().toISOString()})
}
afterEach(async () => {for (const {name, host} of opened.splice(0)) {await host.close(); await deleteDB(name)}})

describe('controlled component host scope', () => {
  it('returns exact durable media bytes and keeps read failures distinct from missing bytes', async () => {
    const host = setup(), bytes = new Uint8Array([0, 128, 255, 13, 10]), blob = new Blob([bytes])
    const media = {readMedia: vi.fn(async () => blob as Blob | undefined)}
    const scope = createCoreHostScope({transactions: host, media}, context)
    const mediaRef = {...ref, contentRef: 'persistent-binary'}
    expect(new Uint8Array(await (await scope.readMedia(mediaRef))!.arrayBuffer())).toEqual(bytes)
    media.readMedia.mockResolvedValueOnce(undefined)
    expect(await scope.readMedia(mediaRef)).toBeUndefined()
    media.readMedia.mockRejectedValueOnce(Object.assign(Error('media unavailable'), {code: 'STORAGE_ERROR'}))
    await expect(scope.readMedia(mediaRef)).rejects.toMatchObject({code: 'STORAGE_ERROR'})
    expect((await host.listChanges(context)).items).toEqual([])
  })
  it('uses the original transaction and rolls back entities/logs on precommit cancellation', async () => {
    const host = setup(), controller = new AbortController()
    const scope = createCoreHostScope({transactions: host}, context, {signal: controller.signal})
    await expect(scope.transaction(async tx => {await write(tx); controller.abort('private reason')}))
      .rejects.toMatchObject({code: 'CANCELLED', message: '操作已取消'})
    expect((await host.exportWorkspace(context)).entities).toEqual([])
    expect((await host.listChanges(context)).items).toEqual([])
    // Local editing remains available and uses the same host after a component failure.
    await host.transaction(context, write)
    expect((await host.listChanges(context)).items).toHaveLength(1)
  })
  it('rejects stale context inside a transaction and does not undo accepted commits', async () => {
    const host = setup(); let current = true
    const controller = new AbortController()
    const scope = createCoreHostScope({transactions: host}, context, {isCurrent: () => current, signal: controller.signal})
    await expect(scope.transaction(async tx => {await write(tx); current = false}))
      .rejects.toMatchObject({code: 'CONTEXT_CHANGED'})
    expect((await host.listEntities(context)).items).toHaveLength(0)
    current = true
    await scope.transaction(write)
    controller.abort()
    expect((await host.listEntities(context)).items).toHaveLength(1)
    await expect(scope.transaction(async () => undefined)).rejects.toMatchObject({code: 'CANCELLED'})
  })
  it('copies the captured context and leaves missing media distinct from absent capability', async () => {
    const host = setup(), input = {...context}
    const media = {readMedia: vi.fn(async () => undefined)}
    const scope = createCoreHostScope({transactions: host, media}, input)
    input.profileId = 'another'
    const mediaRef = {...ref, contentRef: 'durable-local-id'}
    expect(await scope.readMedia(mediaRef)).toBeUndefined()
    expect(media.readMedia).toHaveBeenCalledWith(context, mediaRef, {signal: undefined})
    await expect(createCoreHostScope({transactions: host}, context).readMedia(mediaRef))
      .rejects.toMatchObject({code: 'CAPABILITY_UNAVAILABLE'})
  })
  it('discards late media responses after profile switch without writing or falling back to network', async () => {
    const host = setup(); let current = true
    const scope = createCoreHostScope({transactions: host,
      media: {async readMedia() {current = false; return new Blob(['bytes'])}}}, context, {isCurrent: () => current})
    await expect(scope.readMedia({...ref, contentRef: 'local'})).rejects.toMatchObject({code: 'CONTEXT_CHANGED'})
    expect((await host.listChanges(context)).items).toHaveLength(0)
  })
  it('requires host authorization and blocks token use after asynchronous session switch', async () => {
    const host = setup(), binding = {accountId: 'a', sessionRevision: 'login-2'}
    const action = vi.fn(async () => 'response'); let current = true
    await expect(createCoreHostScope({transactions: host}, context).withAccessToken(binding, action))
      .rejects.toMatchObject({code: 'AUTH_REQUIRED'})
    const services: CoreHostServices = {transactions: host, credentials: {
      async withAccessToken(ctx, received, callback) {
        expect(ctx).toEqual(context); expect(received).toEqual(binding)
        current = false // simulate sign-out while the host refreshes the token
        return callback('never-log-this-token')
      },
    }}
    await expect(createCoreHostScope(services, context, {isCurrent: () => current}).withAccessToken(binding, action))
      .rejects.toMatchObject({code: 'CONTEXT_CHANGED'})
    expect(action).not.toHaveBeenCalled()
    expect((await host.listChanges(context)).items).toHaveLength(0)
  })
  it('passes authorized requests through once, and cancels before credential acquisition', async () => {
    const host = setup(), controller = new AbortController()
    const credential = vi.fn(async (_ctx, _binding, callback) => callback('token'))
    const scope = createCoreHostScope({transactions: host, credentials: {withAccessToken: credential}}, context, {signal: controller.signal})
    const binding = {accountId: 'a', sessionRevision: 'r'}
    expect(await scope.withAccessToken(binding, async token => token.length)).toBe(5)
    controller.abort()
    await expect(scope.withAccessToken(binding, async () => 1)).rejects.toMatchObject({code: 'CANCELLED'})
    expect(credential).toHaveBeenCalledTimes(1)
  })
})
