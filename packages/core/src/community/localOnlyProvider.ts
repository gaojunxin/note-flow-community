import {CORE_CONTRACT_VERSION} from '../contracts/provider'
import type {CoreCapabilities, CoreContext, CoreProvider, CoreStatus} from '../contracts/provider'
import {CoreProviderError, validateCoreContext} from './compatibility'

/** No storage or network dependencies: absence of sync cannot mutate user data. */
export function createLocalOnlyProvider(): CoreProvider {
  let context: CoreContext | undefined
  let disposed = false
  const listeners = new Set<(status: CoreStatus) => void>()
  const assertAlive = () => {
    if (disposed) throw new CoreProviderError('DISPOSED', '组件已释放')
  }
  const assertReady = () => {
    assertAlive()
    if (!context) throw new CoreProviderError('NOT_INITIALIZED', '组件尚未初始化')
  }
  const unavailable = async (): Promise<never> => {
    assertReady()
    throw new CoreProviderError('CAPABILITY_UNAVAILABLE', '当前为本地模式，该能力不可用')
  }
  return {
    async initialize(value) {
      assertAlive()
      validateCoreContext(value)
      if (context && (context.profileId !== value.profileId || context.storageSchemaVersion !== value.storageSchemaVersion)) {
        throw new CoreProviderError('PROFILE_BUSY', '请为其他本地空间或数据库版本创建独立组件')
      }
      context = {...value}
      // This provider never reads the database; it supports the caller's local schema.
      const capabilities: CoreCapabilities = {
        contractVersion: CORE_CONTRACT_VERSION, componentVersion: 'local-only/1',
        storageSchemaRange: {min: value.storageSchemaVersion, max: value.storageSchemaVersion},
        features: {sync: false, crossDeviceRecovery: false, advancedRecurrence: false, automation: false},
      }
      return capabilities
    },
    startSync: unavailable,
    async cancelSync() { assertReady() },
    subscribeStatus(listener) {
      assertAlive()
      listeners.add(listener)
      try { listener({phase: 'local'}) } catch (error) { listeners.delete(listener); throw error }
      return () => { listeners.delete(listener) }
    },
    async listConflicts() { assertReady(); return [] },
    resolveConflict: unavailable,
    prepareRecovery: unavailable,
    applyRecovery: unavailable,
    async dispose() { disposed = true; context = undefined; listeners.clear() },
  }
}
