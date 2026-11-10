import {normalizeSearchPageRequest,type SearchPage as SharedSearchPage} from '@note-flow/core/search'
import {listEntities} from '../runtime'
export type SearchHit={type:'note'|'task';uid:string;title:string;summary:string;updatedAt?:string}
export type SearchPage=SharedSearchPage<SearchHit>
export async function searchNotes(_userId:string,query:string,page=1,size=20,signal?:AbortSignal):Promise<SearchPage>{
 signal?.throwIfAborted();const request=normalizeSearchPageRequest(query,page,size,200),notes=await listEntities<{uid:string;title?:string;content?:string;updatedAt?:string;deleted?:boolean;status?:string}>('note');signal?.throwIfAborted()
 const values=notes.filter(value=>!value.deleted&&value.status!=='deleted'&&`${value.title||''} ${value.content||''}`.normalize('NFKC').toLocaleLowerCase().replace(/[`*_>#\[\](){}!|~]+/g,' ').replace(/\s+/g,' ').includes(request.query)).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).map(value=>({type:'note' as const,uid:value.uid,title:value.title||'未命名笔记',summary:(value.content||'').slice(0,240),updatedAt:value.updatedAt}))
 return{items:values.slice(request.offset,request.offset+request.size),total:values.length,page:request.page,size:request.size,hasMore:request.offset+request.size<values.length}
}
export function searchServerNotes(_query:string,_page=1,_size=20,_signal?:AbortSignal):Promise<SearchPage>{return Promise.reject(Error('社区版仅搜索本地空间，不提供服务器搜索'))}
export function highlightSegments(value:string,query:string){const text=value||'',needle=query.trim();if(!needle)return[{text,match:false}];const lower=text.toLocaleLowerCase(),target=needle.toLocaleLowerCase(),rows:Array<{text:string;match:boolean}>=[];let cursor=0,index=lower.indexOf(target);while(index>=0){if(index>cursor)rows.push({text:text.slice(cursor,index),match:false});rows.push({text:text.slice(index,index+needle.length),match:true});cursor=index+needle.length;index=lower.indexOf(target,cursor)}if(cursor<text.length)rows.push({text:text.slice(cursor),match:false});return rows.length?rows:[{text,match:false}]}
