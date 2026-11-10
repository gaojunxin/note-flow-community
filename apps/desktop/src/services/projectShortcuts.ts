import type { ProjectEntity } from '@note-flow/core'
import { scopedPreferenceKey } from './clientContext'

export interface ProjectShortcutPreferences {
  pinnedUids: string[]
  recent: Record<string, number>
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const STORAGE_NAME = 'note-flow-project-shortcuts'
const empty = (): ProjectShortcutPreferences => ({ pinnedUids: [], recent: {} })

export function readProjectShortcutPreferences(userId: string | number, storage: StorageLike = localStorage): ProjectShortcutPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(scopedPreferenceKey(STORAGE_NAME, userId)) || 'null')
    if (!parsed || !Array.isArray(parsed.pinnedUids) || typeof parsed.recent !== 'object' || !parsed.recent) return empty()
    const pinnedUids = parsed.pinnedUids.filter((uid: unknown): uid is string => typeof uid === 'string' && Boolean(uid))
    const recent: Record<string, number> = {}
    for (const [uid, at] of Object.entries(parsed.recent as Record<string, unknown>)) {
      if (uid && typeof at === 'number' && Number.isFinite(at)) recent[uid] = at
    }
    return { pinnedUids: [...new Set<string>(pinnedUids)], recent }
  } catch { return empty() }
}

export function writeProjectShortcutPreferences(userId: string | number, value: ProjectShortcutPreferences, storage: StorageLike = localStorage): void {
  storage.setItem(scopedPreferenceKey(STORAGE_NAME, userId), JSON.stringify(value))
}

export function recordRecentProject(userId: string | number, projectUid: string, at = Date.now(), storage: StorageLike = localStorage): ProjectShortcutPreferences {
  const value = readProjectShortcutPreferences(userId, storage)
  if (!projectUid.trim()) return value
  value.recent[projectUid] = at
  writeProjectShortcutPreferences(userId, value, storage)
  return value
}

export function selectProjectShortcuts(
  projects: ProjectEntity[],
  preferences: ProjectShortcutPreferences,
  options: { areaUid?: string; limit?: number } = {},
): ProjectEntity[] {
  const limit = Math.max(3, Math.min(5, options.limit ?? 5))
  const pinnedOrder = new Map(preferences.pinnedUids.map((uid, index) => [uid, index]))
  return projects
    .filter(project => !project.deleted && project.status !== 'archived' && (!options.areaUid || project.areaUid === options.areaUid))
    .filter(project => pinnedOrder.has(project.uid) || preferences.recent[project.uid] != null)
    .sort((a, b) => {
      const aPinned = pinnedOrder.get(a.uid), bPinned = pinnedOrder.get(b.uid)
      if (aPinned != null || bPinned != null) return aPinned == null ? 1 : bPinned == null ? -1 : aPinned - bPinned
      return (preferences.recent[b.uid] || 0) - (preferences.recent[a.uid] || 0)
    })
    .slice(0, limit)
}
