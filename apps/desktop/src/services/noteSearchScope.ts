import {isRegularNote,type NoteEntity} from '@note-flow/core'
import type {SearchPage} from '@note-flow/core/search'

/** 按命中的当前本机记录校验范围，不把页面已加载列表当作全库；空候选页继续到下一页。 */
export async function readScopedNoteSearch<T extends {uid:string}>(options:{
 page:number;areaUid?:string;signal?:AbortSignal;
 readPage:(page:number)=>Promise<SearchPage<T>>;
 readNote:(uid:string)=>Promise<NoteEntity|undefined>;
}):Promise<SearchPage<T>>{
 let page=options.page
 for(;;){
  options.signal?.throwIfAborted()
  const result=await options.readPage(page)
  options.signal?.throwIfAborted()
  if(result.page!==page)throw Error('笔记搜索返回了无效分页，请重试')
  const current=await Promise.all(result.items.map(async hit=>({hit,note:await options.readNote(hit.uid)})))
  options.signal?.throwIfAborted()
  const items=current.filter(({hit,note})=>note&&note.uid===hit.uid&&!note.deleted&&note.status!=='archived'&&isRegularNote(note)&&(!options.areaUid||note.areaUid===options.areaUid)).map(({hit})=>hit)
  // total 仍是索引候选总数；界面只展示已加载命中数，不冒充过滤后的全库总数。
  if(items.length||!result.hasMore)return{...result,items}
  page++
 }
}
