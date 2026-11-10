import type {NoteEntity} from '@note-flow/core'
/** Local heuristics only: missing literals are review prompts, never a proof of semantic completeness. */
export function reviewConsolidationSources(notes:NoteEntity[],draft:string){
 const text=draft.normalize('NFKC')
 return notes.map((note,index)=>{
  const source=(note.content||'').normalize('NFKC')
  const links=[...new Set(Array.from(source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),match=>match[1]))]
  const numbers=[...new Set(Array.from(source.matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,:/-]\d+)*(?:%|元|万|亿|天|年|月|小时|分钟)?/gu),match=>match[0]).filter(value=>value.length>1))]
  const numbersInDraft=new Set(Array.from(text.matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,:/-]\d+)*(?:%|元|万|亿|天|年|月|小时|分钟)?/gu),match=>match[0]))
  const missingLinks=links.filter(value=>!text.includes(value)),missingNumbers=numbers.filter(value=>!numbersInDraft.has(value))
  return {uid:note.uid,title:note.title,index:index+1,missingLinks,missingNumbers,hasSourceMarker:new RegExp(`\\[来源\\s*${index+1}\\]`).test(text)}
 })
}
