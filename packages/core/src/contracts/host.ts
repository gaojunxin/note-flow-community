import type {CoreContext, LocalEntityRef, LocalTransactionHost} from './provider'

export interface CoreOperationOptions { signal?: AbortSignal }

/** A durable local reference. Never pass filesystem paths or expiring remote URLs. */
export interface CoreMediaRef extends LocalEntityRef { contentRef: string }

export interface CoreMediaHost {
  /** Missing bytes return undefined; access/storage failures reject. No network fallback. */
  readMedia(context: CoreContext, ref: CoreMediaRef, options?: CoreOperationOptions): Promise<Blob | undefined>
}

/** Both values are opaque host-owned identities; sessionRevision changes on re-login. */
export interface CoreAccountBinding { accountId: string; sessionRevision: string }
export interface CoreCredentialHost {
  /**
   * Host verifies profile + account/session binding before invoking action and after
   * refreshing credentials. Missing/expired authorization rejects AUTH_REQUIRED;
   * a changed binding rejects CONTEXT_CHANGED. Never log, persist, or include the
   * token in provider events/errors. The callback may use it only for this request.
   */
  withAccessToken<T>(context: CoreContext, binding: CoreAccountBinding,
    action: (accessToken: string) => Promise<T>, options?: CoreOperationOptions): Promise<T>
}

/**
 * Supplied by the existing repository owner, never constructed by the component.
 * transactions is the same single writer used by local editing. Media mutations
 * must be part of that owner's transaction (entity values may contain Blob);
 * there is deliberately no independent write-media or open-database API.
 * Local editing/export do not depend on credentials or media-read availability.
 */
export interface CoreHostServices {
  transactions: LocalTransactionHost
  media?: CoreMediaHost
  credentials?: CoreCredentialHost
}
