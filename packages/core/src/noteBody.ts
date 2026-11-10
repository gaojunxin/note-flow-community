import * as Y from 'yjs'

export const NOTE_BODY_TEXT_KEY = 'content'
export const NOTE_BODY_REMOTE_ORIGIN = Symbol('note-flow-remote-body-update')

export interface NoteBodyDocument {
  doc: Y.Doc
  text: Y.Text
  content(): string
  state(): Uint8Array
  stateVector(): Uint8Array
  applyRemote(update: Uint8Array): void
  replace(value: string, origin?: unknown): void
  onLocalUpdate(listener: (update: Uint8Array) => void): () => void
  destroy(): void
}

export function createNoteBodyDocument(options: { state?: Uint8Array; initialText?: string } = {}): NoteBodyDocument {
  const doc = new Y.Doc(), text = doc.getText(NOTE_BODY_TEXT_KEY)
  if (options.state?.length) Y.applyUpdate(doc, options.state, NOTE_BODY_REMOTE_ORIGIN)
  else if (options.initialText) text.insert(0, options.initialText, NOTE_BODY_REMOTE_ORIGIN)

  const replace = (value: string, origin: unknown = undefined) => {
    const current = text.toString()
    if (current === value) return
    let prefix = 0
    while (prefix < current.length && prefix < value.length && current[prefix] === value[prefix]) prefix += 1
    let suffix = 0
    while (suffix < current.length - prefix && suffix < value.length - prefix && current[current.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix += 1
    doc.transact(() => {
      const removed = current.length - prefix - suffix
      if (removed) text.delete(prefix, removed)
      const inserted = value.slice(prefix, value.length - suffix)
      if (inserted) text.insert(prefix, inserted)
    }, origin)
  }
  return {
    doc,text,content:()=>text.toString(),state:()=>Y.encodeStateAsUpdate(doc),stateVector:()=>Y.encodeStateVector(doc),
    applyRemote:update=>Y.applyUpdate(doc,update,NOTE_BODY_REMOTE_ORIGIN),replace,
    onLocalUpdate(listener){const handler=(update:Uint8Array,origin:unknown)=>{if(origin!==NOTE_BODY_REMOTE_ORIGIN)listener(update)};doc.on('update',handler);return()=>doc.off('update',handler)},
    destroy:()=>doc.destroy()
  }
}

export const noteBodyUpdateToBase64 = (update: Uint8Array) => {
  let binary = ''
  for (const value of update) binary += String.fromCharCode(value)
  return globalThis.btoa(binary)
}

export const noteBodyUpdateFromBase64 = (value: string) => {
  const binary = globalThis.atob(value), update = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) update[index] = binary.charCodeAt(index)
  return update
}

export const mergeNoteBodyUpdates = (updates: Uint8Array[]) => Y.mergeUpdates(updates)
