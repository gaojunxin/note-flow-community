import {registerPlugin} from '@capacitor/core'
export interface CommunityBackActions {
  dismissDialog(): boolean
  saveDraft(): Promise<void>
  navigateBack(): boolean
  close(): Promise<void>
}
/** Rejecting a save leaves the current editor intact. Repeated back presses share no second exit. */
export function createCommunityBackHandler(actions: CommunityBackActions) {
  let pending = false
  return async () => {
    if (pending) return
    pending = true
    try {
      if (actions.dismissDialog()) return
      await actions.saveDraft()
      if (!actions.navigateBack()) await actions.close()
    } finally {pending = false}
  }
}
export async function closeCommunityMobile() {
  const plugin = registerPlugin<{close(): Promise<void>}>('CommunityLifecycle')
  await plugin.close()
}
