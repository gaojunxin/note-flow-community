import {describe, expect, it} from 'vitest'
import {createLocalOnlyProvider, validateCoreCapabilities} from '@note-flow/core/community'

const context = {profileId: 'local-test', storageSchemaVersion: 5}
const metadata = () => ({contractVersion: 1, componentVersion: 'test/1', storageSchemaRange: {min: 4, max: 6}, features: {sync: true, crossDeviceRecovery: true, advancedRecurrence: false, automation: false}})

describe('component compatibility', () => {
  it('accepts inclusive schema boundaries and detaches mutable metadata', () => {
    const input = metadata()
    const accepted = validateCoreCapabilities(input, {...context, storageSchemaVersion: 4})
    validateCoreCapabilities(input, {...context, storageSchemaVersion: 6})
    input.features.sync = false
    input.storageSchemaRange.min = 99
    expect(accepted.features.sync).toBe(true)
    expect(accepted.storageSchemaRange.min).toBe(4)
  })
  it('rejects incompatible contract/schema and malformed runtime metadata', () => {
    expect(() => validateCoreCapabilities({...metadata(), contractVersion: 2}, context)).toThrow(expect.objectContaining({code: 'CONTRACT_INCOMPATIBLE'}))
    expect(() => validateCoreCapabilities(metadata(), {...context, storageSchemaVersion: 7})).toThrow(expect.objectContaining({code: 'SCHEMA_INCOMPATIBLE'}))
    for (const value of [null, {}, {...metadata(), features: {sync: 'true'}}, {...metadata(), storageSchemaRange: {min: 6, max: 4}}]) {
      expect(() => validateCoreCapabilities(value, context)).toThrow(expect.objectContaining({code: 'INVALID_CAPABILITIES'}))
    }
    expect(() => validateCoreCapabilities(metadata(), {...context, profileId: ''})).toThrow(expect.objectContaining({code: 'INVALID_CONTEXT'}))
  })
})

describe('local-only provider', () => {
  it('reports local status and never pretends to sync, resolve or recover', async () => {
    const provider = createLocalOnlyProvider()
    const statuses: string[] = []
    const unsubscribe = provider.subscribeStatus(status => { statuses.push(status.phase); status.phase = 'syncing' })
    expect((await provider.initialize(context)).features.sync).toBe(false)
    const next: string[] = []
    provider.subscribeStatus(status => next.push(status.phase))
    expect(next).toEqual(['local'])
    expect(await provider.listConflicts()).toEqual([])
    for (const action of [() => provider.startSync(), () => provider.resolveConflict('c', 'r', 'keepLocal'), () => provider.prepareRecovery(), () => provider.applyRecovery({planId: 'p', profileId: context.profileId, localRevision: 'r', summary: {affected: 1, archived: 1}})]) {
      await expect(action()).rejects.toMatchObject({code: 'CAPABILITY_UNAVAILABLE'})
    }
    await provider.cancelSync()
    expect(statuses).toEqual(['local'])
    unsubscribe(); unsubscribe()
    await provider.dispose()
  })
  it('isolates profile/schema and detaches caller context', async () => {
    const provider = createLocalOnlyProvider()
    const input = {...context}
    await provider.initialize(input)
    input.profileId = 'other'
    await provider.initialize(context)
    await expect(provider.initialize(input)).rejects.toMatchObject({code: 'PROFILE_BUSY'})
    await expect(provider.initialize({...context, storageSchemaVersion: 6})).rejects.toMatchObject({code: 'PROFILE_BUSY'})
    expect((await provider.initialize(context)).storageSchemaRange).toEqual({min: 5, max: 5})
  })
  it('enforces initialization and disposal without reviving released instances', async () => {
    const provider = createLocalOnlyProvider()
    await expect(provider.startSync()).rejects.toMatchObject({code: 'NOT_INITIALIZED'})
    await expect(provider.initialize({...context, storageSchemaVersion: NaN})).rejects.toMatchObject({code: 'INVALID_CONTEXT'})
    await provider.initialize(context)
    await provider.dispose(); await provider.dispose()
    await expect(provider.initialize(context)).rejects.toMatchObject({code: 'DISPOSED'})
    await expect(provider.listConflicts()).rejects.toMatchObject({code: 'DISPOSED'})
    expect(() => provider.subscribeStatus(() => {})).toThrow(expect.objectContaining({code: 'DISPOSED'}))
  })
})
