import type {CoreContext, LocalWriteTransaction} from '../contracts/provider'
import type {CoreAccountBinding, CoreHostServices, CoreMediaRef, CoreOperationOptions} from '../contracts/host'
import {CoreProviderError, validateCoreContext} from './compatibility'

/**
 * Scope an operation to the captured profile and caller-owned lifecycle. This
 * delegates to the original writer; it never opens storage or creates a queue.
 * Cancellation observed before the transaction callback returns rolls back.
 * Cancellation after that point does not undo an already accepted commit: the
 * caller must reconcile its result rather than retrying an assumed rollback.
 */
export function createCoreHostScope(services: CoreHostServices, input: CoreContext,
  options: CoreOperationOptions & {isCurrent?: () => boolean} = {}) {
  validateCoreContext(input)
  const context = Object.freeze({...input})
  const {signal, isCurrent} = options
  const check = () => {
    if (signal?.aborted) throw new CoreProviderError('CANCELLED', '操作已取消')
    if (isCurrent && !isCurrent()) throw new CoreProviderError('CONTEXT_CHANGED', '操作所属空间或会话已切换')
  }
  return {
    async transaction<T>(action: (tx: LocalWriteTransaction) => Promise<T>): Promise<T> {
      check()
      return services.transactions.transaction(context, async tx => {
        check()
        const result = await action(tx)
        check()
        return result
      })
    },
    async readMedia(ref: CoreMediaRef): Promise<Blob | undefined> {
      check()
      if (!services.media) throw new CoreProviderError('CAPABILITY_UNAVAILABLE', '本地媒体读取不可用')
      if (!ref || !ref.entityType?.trim() || !ref.entityUid?.trim() || !ref.contentRef?.trim()) {
        throw new CoreProviderError('INVALID_CONTEXT', '媒体引用无效')
      }
      const result = await services.media.readMedia(context, {...ref}, {signal: signal})
      check()
      return result
    },
    async withAccessToken<T>(binding: CoreAccountBinding, action: (accessToken: string) => Promise<T>): Promise<T> {
      check()
      if (!services.credentials) throw new CoreProviderError('AUTH_REQUIRED', '当前没有可用的账号授权')
      if (!binding || !binding.accountId?.trim() || !binding.sessionRevision?.trim()) {
        throw new CoreProviderError('INVALID_CONTEXT', '账号会话绑定无效')
      }
      const result = await services.credentials.withAccessToken(context, {...binding}, async token => {
        check()
        if (!token?.trim()) throw new CoreProviderError('AUTH_REQUIRED', '当前没有可用的账号授权')
        const response = await action(token)
        check()
        return response
      }, {signal: signal})
      check()
      return result
    },
  }
}
