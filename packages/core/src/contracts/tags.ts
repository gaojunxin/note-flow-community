/** Existing local tag and relation data, independent of synchronization execution. */
export type TagRecord = { uid: string; name: string; color?: string; version: number; id?: number; deleted?: boolean; syncStatus?: string }
export type NoteTagRelation = { uid: string; noteUid: string; tagUid: string; version: number; deleted?: boolean; syncStatus?: string }
