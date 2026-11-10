export type NativeCoreDomain = 'notes' | 'tasks' | 'workspace' | 'search' | 'media' | 'sync' | 'knowledge' | 'canvas'
/** Public diagnostic event contracts, without native execution strategies. */
export const NATIVE_SHADOW_RESULT_EVENT = 'note-flow:native-shadow-result'
export const NATIVE_CANARY_RESULT_EVENT = 'note-flow:native-canary-result'

export type ShadowValueSummary = {
  kind: 'null' | 'array' | 'object' | 'primitive'
  count: number
  hash: string
}

export type NativeShadowResult = {
  domain: NativeCoreDomain
  status: 'match' | 'difference' | 'error'
  durationMs: number
  legacy: ShadowValueSummary
  native?: ShadowValueSummary
  difference?: { path: string; kind: 'type' | 'missing' | 'value' | 'length' }
  error?: { code: string; retryable: boolean }
}
