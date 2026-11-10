export type NativeCoreStatus = { available: boolean; engine: 'rust' | 'typescript' }

export interface NativeCoreTransport {
  status(): Promise<NativeCoreStatus>
  invoke<TRequest, TResponse>(operation: string, request: TRequest): Promise<TResponse>
}

export type NativeCoreExecution<T> = {
  value: T
  engine: 'rust' | 'typescript'
  durationMs: number
  fallbackReason?: 'unavailable' | 'native-error' | 'invalid-response' | 'circuit-open'
}

export function createNativeCoreClient(transport: NativeCoreTransport) {
  let circuitOpen = false
  let statusPromise: Promise<NativeCoreStatus> | undefined
  const status = () => statusPromise ||= transport.status().catch(() => ({ available: false, engine: 'typescript' as const }))

  return {
    status,
    async execute<TRequest, TResponse>(options: {
      operation: string
      request: TRequest
      fallback: () => TResponse | Promise<TResponse>
      validate: (value: unknown) => value is TResponse
    }): Promise<NativeCoreExecution<TResponse>> {
      const started = performance.now()
      const legacy = async (fallbackReason: NativeCoreExecution<TResponse>['fallbackReason']) => ({
        value: await options.fallback(), engine: 'typescript' as const,
        durationMs: performance.now() - started, fallbackReason
      })
      if (circuitOpen) return legacy('circuit-open')
      if (!(await status()).available) return legacy('unavailable')
      try {
        const value = await transport.invoke<TRequest, TResponse>(options.operation, options.request)
        if (!options.validate(value)) { circuitOpen = true; return legacy('invalid-response') }
        return { value, engine: 'rust', durationMs: performance.now() - started }
      } catch {
        circuitOpen = true
        return legacy('native-error')
      }
    },
    resetCircuitForTesting() { circuitOpen = false; statusPromise = undefined }
  }
}

