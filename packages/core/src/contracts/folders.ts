/** Local folder data shared by public storage and private synchronization. */
export interface FolderEntity {
  id: number
  uid: string
  parentId: number | null
  parentUid?: string | null
  areaUid?: string | null
  projectUid?: string | null
  name: string
  sortOrder?: number
  version: number
}

/** Public conflict data shape; resolution remains an optional private capability. */
export interface FolderConflict {conflictId:string;operationId:string;entityUid:string;entityType:'folder';createdAt:string;localEntity?:Partial<FolderEntity>&{deleted?:boolean}&Record<string,unknown>;serverEntity:Partial<FolderEntity>&{deleted?:boolean}&Record<string,unknown>}
