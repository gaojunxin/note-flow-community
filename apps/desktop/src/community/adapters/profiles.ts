import type { NoteFlowUser } from '@note-flow/core'

// Deliberately separate from the official account/profile keys on every platform.
const PROFILE_ID_KEY = 'note-flow-community-profile-v1'
const PROFILE_DETAILS_KEY = 'note-flow-community-profile-details-v1'
export interface ServerBinding { serverUrl: string; serverFingerprint: string; userId: string; userName: string }
export interface LocalProfile {
  profileId: string; storageKey: string; displayName: string; createdAt: string
  serverBinding?: ServerBinding
  connectionState: 'local' | 'connected' | 'disconnected'
}
export function profileServerFingerprint(_value: string): string { return 'community-local' }
export function currentProfile(): LocalProfile | null {
  const profileId = localStorage.getItem(PROFILE_ID_KEY)
  if (!profileId) return null
  let details: Partial<LocalProfile> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PROFILE_DETAILS_KEY) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed as Partial<LocalProfile>
  } catch { /* Preserve the profile ID even when optional display metadata is invalid. */ }
  return { profileId, storageKey: `community-${profileId}`, displayName: details.profileId === profileId && typeof details.displayName === 'string' ? details.displayName : '本地用户', createdAt: details.profileId === profileId && typeof details.createdAt === 'string' ? details.createdAt : new Date().toISOString(), connectionState: 'local' }
}
export function saveProfile(profile: LocalProfile): LocalProfile {
  if (!profile.profileId || typeof profile.profileId !== 'string') throw new Error('本地空间标识无效')
  const local: LocalProfile = { profileId: profile.profileId, storageKey: `community-${profile.profileId}`, displayName: profile.displayName || '本地用户', createdAt: profile.createdAt || new Date().toISOString(), connectionState: 'local' }
  localStorage.setItem(PROFILE_DETAILS_KEY, JSON.stringify(local))
  localStorage.setItem(PROFILE_ID_KEY, local.profileId)
  window.dispatchEvent(new CustomEvent('note-flow:profile-change', { detail: local }))
  return local
}
export function ensureDesktopProfile(_cachedUser?: NoteFlowUser | null): LocalProfile {
  return currentProfile() || saveProfile({ profileId: crypto.randomUUID(), storageKey: '', displayName: '本地用户', createdAt: new Date().toISOString(), connectionState: 'local' })
}
export function profileUser(profile = ensureDesktopProfile()): NoteFlowUser {
  return { userId: profile.profileId, userName: 'local', nickName: profile.displayName, roles: [], permissions: [] }
}
export function bindProfileToServer(_user: NoteFlowUser, _serverUrl: string, _migration?: { localEpoch: string; remoteEpoch: string }): never {
  throw Object.assign(new Error('社区版仅保存在本机，不支持连接同步服务器；本地空间和数据保持不变。'), { code: 'COMPONENT_UNAVAILABLE' })
}
export function disconnectProfile(): LocalProfile { return ensureDesktopProfile() }
export function activeStorageKey(_fallbackUserId: string | number): string { return ensureDesktopProfile().storageKey }
export function activeProfileId(_fallbackUserId: string | number = 'local'): string { return ensureDesktopProfile().profileId }
export function syncAvailable(): boolean { return false }
