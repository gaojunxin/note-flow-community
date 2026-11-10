import {CORE_CONTRACT_VERSION} from '../contracts/provider.ts'
import type {CoreCapabilities, CoreContext, CoreErrorCode} from '../contracts/provider.ts'

export class CoreProviderError extends Error {
  readonly code: CoreErrorCode
  constructor(code: CoreErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'CoreProviderError'
  }
}

export function validateCoreContext(context: CoreContext): void {
  if (!context || typeof context.profileId !== 'string' || !context.profileId.trim()
    || !Number.isSafeInteger(context.storageSchemaVersion) || context.storageSchemaVersion < 1) {
    throw new CoreProviderError('INVALID_CONTEXT', '本地空间或数据库版本无效')
  }
}

/** Validate unknown component metadata before allowing any component operations. */
export function validateCoreCapabilities(value: unknown, context: CoreContext): CoreCapabilities {
  validateCoreContext(context)
  if (!value || typeof value !== 'object') throw new CoreProviderError('INVALID_CAPABILITIES', '组件能力声明无效')
  const candidate = value as Partial<CoreCapabilities>
  const range = candidate.storageSchemaRange
  const features = candidate.features
  if (!Number.isSafeInteger(candidate.contractVersion) || typeof candidate.componentVersion !== 'string' || !candidate.componentVersion.trim()
    || !range || !Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max) || range.min < 1 || range.max < range.min
    || !features || ['sync', 'crossDeviceRecovery', 'advancedRecurrence', 'automation'].some(key => typeof features[key as keyof typeof features] !== 'boolean')) {
    throw new CoreProviderError('INVALID_CAPABILITIES', '组件能力声明无效')
  }
  if (candidate.contractVersion !== CORE_CONTRACT_VERSION) throw new CoreProviderError('CONTRACT_INCOMPATIBLE', '组件接口版本不兼容')
  if (context.storageSchemaVersion < range.min || context.storageSchemaVersion > range.max) throw new CoreProviderError('SCHEMA_INCOMPATIBLE', '组件不支持当前数据库版本')
  // Copy only known metadata; do not retain mutable component-owned references.
  return {
    contractVersion: candidate.contractVersion,
    componentVersion: candidate.componentVersion,
    storageSchemaRange: {min: range.min, max: range.max},
    features: {sync: features.sync, crossDeviceRecovery: features.crossDeviceRecovery, advancedRecurrence: features.advancedRecurrence, automation: features.automation},
  }
}
