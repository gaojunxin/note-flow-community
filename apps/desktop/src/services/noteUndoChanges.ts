import type { NoteEntity } from '@note-flow/core'

// Restore only fields owned by the action; later unrelated edits must survive.
export function noteUndoChanges(action: 'move'|'archive'|'organize'|'pending'|'pin', original: NoteEntity): Partial<NoteEntity> {
  if (action === 'pin') return { pinned: original.pinned }
  if (action === 'organize' || action === 'pending') return { organizationStatus: original.organizationStatus, organizedAt: original.organizedAt }
  if (action === 'archive') return { status: original.status || 'inbox' }
  return { areaUid: original.areaUid || null, projectUid: original.projectUid || null, folderId: original.folderId || null, folderUid: original.folderUid || null }
}
