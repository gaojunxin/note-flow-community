import { reactive } from 'vue'

export interface ContextMenuCommand {
  id: string
  label: string
  icon?: string
  iconName?: 'task'|'move'|'download'|'document'|'star'|'star-filled'|'tag'|'check'|'mindmap'|'archive'|'delete'|'restore'
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  run: () => unknown | Promise<unknown>
}

export const contextMenuState = reactive({ open:false, x:0, y:0, commands:[] as ContextMenuCommand[],target:null as HTMLElement|null })

export function openContextMenu(event:MouseEvent,commands:ContextMenuCommand[],target:HTMLElement|null=null){
  event.preventDefault()
  event.stopPropagation()
  contextMenuState.target=target
  contextMenuState.x=event.clientX
  contextMenuState.y=event.clientY
  contextMenuState.commands=commands
  contextMenuState.open=true
}

export function closeContextMenu(){contextMenuState.open=false;contextMenuState.commands=[];contextMenuState.target=null}
