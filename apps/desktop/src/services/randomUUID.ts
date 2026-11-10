/** UUID v4 compatibility for LAN HTTP previews. Random bytes still come from Web Crypto. */
export function ensureRandomUUID(api:Crypto=globalThis.crypto){
 if(typeof api?.randomUUID==='function')return
 if(typeof api?.getRandomValues!=='function')throw Error('当前浏览器缺少安全随机数，请使用现代浏览器或桌面客户端')
 Object.defineProperty(api,'randomUUID',{configurable:true,value:()=>{
  const bytes=api.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
 }})
}
