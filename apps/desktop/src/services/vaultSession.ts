import { ref, shallowRef } from 'vue'
import type { VaultItem } from './vault'

export const vaultSessionKey = shallowRef<CryptoKey | null>(null)
export const vaultSessionOwner = ref('')
export const vaultSessionItems = shallowRef<VaultItem[]>([])

let sessionRevision=0
export function vaultSessionRevision(){return sessionRevision}
function changed(){sessionRevision++;if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('note-flow:vault-session-change'))}

let lockTimer: ReturnType<typeof setTimeout> | undefined

export function openVaultSession(ownerId: string, key: CryptoKey) {
  vaultSessionOwner.value = ownerId
  vaultSessionKey.value = key
  changed()
  return key
}

export function clearVaultSession() {
  clearTimeout(lockTimer)
  lockTimer = undefined
  vaultSessionKey.value = null
  vaultSessionOwner.value = ''
  vaultSessionItems.value = []
  changed()
}

export function ensureVaultSessionOwner(ownerId: string) {
  if (vaultSessionKey.value && vaultSessionOwner.value !== ownerId) clearVaultSession()
}

export function armVaultSessionLock(minutes: number) {
  clearTimeout(lockTimer)
  lockTimer = undefined
  if (vaultSessionKey.value && minutes > 0) lockTimer = setTimeout(clearVaultSession, minutes * 60_000)
}
