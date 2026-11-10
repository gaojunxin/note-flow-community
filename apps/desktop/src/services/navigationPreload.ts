/** Prepare code only. Calling this loader does not mount a page or load its data. */
export function createNavigationLoader<T>(importPage: () => Promise<T>) {
  let pending: Promise<T> | undefined
  return () => {
    if (!pending) {
      const request = Promise.resolve().then(importPage)
      pending = request
      void request.catch(() => { if (pending === request) pending = undefined })
    }
    return pending
  }
}

/** Speculative failure must not interrupt the current page; navigation may retry. */
export function preloadNavigationCode(loader: (() => Promise<unknown>) | undefined) {
  if (loader) void loader().catch(() => {})
}
