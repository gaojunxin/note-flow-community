export const CONSOLIDATION_UNSUPPORTED='当前服务器尚未支持笔记整合替换，请更新后端后重试；也可以先仅保存整合稿，原笔记不会被删除。'
export async function ensureConsolidationCapability(get:(path:string)=>Promise<{data:{data?:unknown}}>){
 let value:unknown
 try{value=(await get('/notes/consolidations/capabilities')).data.data}
 catch(source){const error=source as {status?:number;response?:{status?:number};message?:string};if([404,405].includes(Number(error.status||error.response?.status))||/请求方式不支持|Method Not Allowed/i.test(error.message||''))throw Error(CONSOLIDATION_UNSUPPORTED);throw Error('无法确认服务端整合能力，请检查网络后重试；原笔记未修改。')}
 const capability=value as {contract?:string;replace?:boolean}
 if(capability?.contract!=='note-flow-note-consolidation/1'||capability.replace!==true)throw Error(CONSOLIDATION_UNSUPPORTED)
}
/** Explicit rejections can be edited; timeouts/proxy failures retain the idempotency key. */
export function consolidationRejected(source:unknown){const error=source as {status?:number;code?:string};return [400,404,405,409,422].includes(Number(error?.status))||error?.status===200&&error?.code==='500'}
