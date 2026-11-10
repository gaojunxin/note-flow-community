/** Public note data and legacy transport contracts, without execution. */


export type NoteScope = 'active' | 'archived' | 'trash'

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'conflict' | 'error'

export type NoteOrganizationStatus = 'inbox' | 'pending' | 'in_progress' | 'organized' | 'ignored'

export type NoteLinkType = 'source' | 'related' | 'follow_up'

export type NoteType = 'note' | 'mindmap' | 'file' | 'knowledge' | 'meeting' | 'work_log' | 'problem_analysis' | 'journal'

export type FileKind = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'xmind' | 'other'

export type AiPolicy = 'normal' | 'confirm' | 'excluded'


export interface NoteEntity {
  id?: number
  uid: string
  title: string
  content: string
  /** Known values use NoteType; string keeps older imported/custom values readable. */
  type?: NoteType | string
  contentFormat?: 'markdown' | 'file' | string | null
  fileKind?: FileKind | string | null
  attachmentUid?: string | null
  mediaType?: string | null
  fileName?: string | null
  fileExtension?: string | null
  sizeBytes?: number | null
  sha256?: string | null
  status?: string
  aiPolicy?: AiPolicy
  organizationStatus?: NoteOrganizationStatus
  organizedAt?: string | null
  captureSource?: string | null
  summary?: string | null
  folderUid?: string | null
  areaUid?: string | null
  projectUid?: string | null
  journalSeriesUid?: string | null
  periodType?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  periodKey?: string | null
  reportGeneratedAt?: string | null
  folderId?: number | null
  tagUids?: string[]
  tagIds?: number[]
  pinned?: boolean
  deleted?: boolean
  version?: number
  createdAt?: string
  updatedAt?: string
  syncStatus?: 'synced' | 'pending' | 'conflict'
}


export interface NoteLinkEntity {
  uid: string
  sourceNoteUid: string
  targetNoteUid: string
  linkType: NoteLinkType
  version?: number
  deleted?: boolean
  createdAt?: string
  updatedAt?: string
  syncStatus?: 'synced' | 'pending' | 'conflict'
}


export type NoteListItem = Omit<NoteEntity, 'content'> & { excerpt: string }


export interface NoteOperation {
  operationId: string
  entityType: 'note'
  entityUid: string
  action: 'create' | 'update' | 'delete'
  baseVersion: number
  payload?: NoteEntity
  status: 'pending' | 'failed'
  createdAt: string
  attempts: number
  lastError?: string
}


export interface NoteSyncTransport {
  current?(uid:string):Promise<NoteEntity&{bodyState?:string}>
  list(scope: NoteScope): Promise<NoteEntity[]>
  push(deviceId: string, operations: NoteOperation[]): Promise<{ results: Array<Record<string, unknown>> }>
  pull(cursor: string | number, limit: number): Promise<{ changes: Array<Record<string, any>>; nextCursor?: string | number; hasMore?: boolean }>
  acknowledge?(deviceId: string, cursor: string | number): Promise<void>
  bootstrap?(pageToken: string | undefined, limit: number): Promise<{ snapshotId:string;highWatermark:string;items:Array<Record<string,any>>;nextPageToken?:string;hasMore:boolean }>
}


export interface NoteConflict {
  conflictId: string
  operationId: string
  entityUid: string
  localEntity?: NoteEntity
  serverEntity?: NoteEntity
  createdAt: string
}


export interface LocalNoteSearchHit { uid: string; title: string; summary: string; updatedAt?: string }
