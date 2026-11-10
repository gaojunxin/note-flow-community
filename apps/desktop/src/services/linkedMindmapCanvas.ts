import type {NoteEntity} from '@note-flow/core'
import {createLinkedMindmapCanvasInput} from '../canvas/mindmapEditor'
import type {CanvasEntity} from './canvases'

export interface LinkedMindmapCanvasService {
  list():Promise<CanvasEntity[]>
  create(input:Partial<CanvasEntity>):Promise<CanvasEntity>
}

/**
 * A note owns at most one default linked mind-map view. The canvas stores a
 * disposable projection for offline display; sourceNoteUid remains the source
 * of truth and is used to rebuild the projection when the note changes.
 */
export async function openOrCreateLinkedMindmapCanvas(
  service:LinkedMindmapCanvasService,
  note:Pick<NoteEntity,'uid'|'title'|'content'|'updatedAt'|'areaUid'|'projectUid'>,
):Promise<{canvas:CanvasEntity;reused:boolean}>{
  const existing=(await service.list()).find(canvas=>
    !canvas.deleted&&canvas.status!=='archived'&&canvas.canvasType==='mindmap'&&
    canvas.sourceMode==='linked'&&canvas.sourceNoteUid===note.uid,
  )
  if(existing)return{canvas:existing,reused:true}
  return{canvas:await service.create(createLinkedMindmapCanvasInput(note)),reused:false}
}
