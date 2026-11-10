export interface SyncCompatibility {state:'supported'|'legacy';minimumClientVersion?:string;checkedAt:number}
const parse=(value:string)=>{if(typeof value!=='string'||value.length>100)throw Error('无效版本号');const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);if(!match)throw Error('无效版本号');const pre=match[4]?.split('.')||[];if(pre.some(item=>/^\d+$/.test(item)&&item.length>1&&item.startsWith('0')))throw Error('无效版本号');return {numbers:match.slice(1,4).map(BigInt),pre}}
export function compareClientVersions(left:string,right:string){const a=parse(left),b=parse(right);for(let i=0;i<3;i++){if(a.numbers[i]!==b.numbers[i])return a.numbers[i]>b.numbers[i]?1:-1}if(!a.pre.length||!b.pre.length)return !a.pre.length?(!b.pre.length?0:1):-1;for(let i=0;i<Math.min(a.pre.length,b.pre.length);i++){const x=a.pre[i],y=b.pre[i];if(x===y)continue;const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);if(xn&&yn)return BigInt(x)>BigInt(y)?1:-1;if(xn!==yn)return xn?-1:1;return x>y?1:-1}return Math.sign(a.pre.length-b.pre.length)}
const failure=(message:string,code:string)=>Object.assign(Error(message),{code})
export function createSyncCompatibilityChecker(get:(path:string)=>Promise<{data:{data?:unknown}}>,now=()=>Date.now()){
 const cache=new Map<string,SyncCompatibility>(),flights=new Map<string,Promise<SyncCompatibility>>()
 return async(scope:string,version:string):Promise<SyncCompatibility>=>{
  const key=JSON.stringify([scope,version]),prior=cache.get(key)
  if(prior&&now()-prior.checkedAt<60_000)return prior
  if(flights.has(key))return flights.get(key)!
  const flight=(async()=>{
   let result:SyncCompatibility
   try{
    const response=await get('/api/v2/sync/compatibility'),value=response?.data?.data as {contract?:string;protocolVersions?:number[];minimumClientVersion?:string}
    if(value?.contract!=='note-flow-client-compatibility/1'||!Array.isArray(value.protocolVersions))throw failure('无法确认服务器同步兼容性，请更新后端或检查服务器配置','SYNC_COMPATIBILITY_INVALID')
    if(!value.protocolVersions.includes(2))throw failure('服务器不支持当前同步协议，本机内容已保留，请更新客户端或后端','SYNC_PROTOCOL_UNSUPPORTED')
    let comparison:number;try{comparison=compareClientVersions(version,value.minimumClientVersion!)}catch{throw failure('服务器返回的客户端版本要求无效，请检查后端配置','SYNC_COMPATIBILITY_INVALID')}
    if(comparison<0)throw failure(`服务器要求客户端 ${value.minimumClientVersion} 或更新版本。本机内容已保留，请升级后同步。`,'CLIENT_UPDATE_REQUIRED')
    result={state:'supported',minimumClientVersion:value.minimumClientVersion,checkedAt:now()}
   }catch(source){const error=source as {status?:number;response?:{status?:number};message?:string};const status=error.status||error.response?.status;if(status===404||status===405||status===200&&/请求方式不支持/.test(error.message||''))result={state:'legacy',checkedAt:now()};else throw source}
   cache.set(key,result);while(cache.size>8)cache.delete(cache.keys().next().value!);return result
  })().finally(()=>flights.delete(key))
  flights.set(key,flight);return flight
 }
}
