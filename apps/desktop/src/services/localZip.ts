function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
export function createZip(files:{name:string;bytes:Uint8Array}[]){if(files.length>65535||files.some(file=>file.bytes.length>0xffffffff))throw Error('归档超过ZIP格式限制');const parts:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0,centralSize=0;for(const file of files){const name=new TextEncoder().encode(file.name),crc=crc32(file.bytes),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,file.bytes.length,true);h.setUint32(22,file.bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);parts.push(header,file.bytes);const c=new Uint8Array(46+name.length),v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,file.bytes.length,true);v.setUint32(24,file.bytes.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);c.set(name,46);central.push(c);centralSize+=c.length;offset+=header.length+file.bytes.length}const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end] as BlobPart[],{type:'application/zip'})}
const MAX_BYTES=64*1024*1024,MAX_ENTRIES=10000
export interface ZipReadOptions {maxArchiveBytes?:number;include?:(name:string)=>boolean;maxEntryBytes?:number;maxSelectedBytes?:number;signal?:AbortSignal}
export async function readZip(blob:Blob,options:ZipReadOptions={}):Promise<Map<string,Uint8Array>>{
 const assertActive=()=>{if(options.signal?.aborted)throw new DOMException('已取消归档读取','AbortError')}
 assertActive()
 // 只有显式知识回导提高预算；压缩文件、声明解压总量及实际输出仍分别校验。
 const archiveLimit=options.maxArchiveBytes??MAX_BYTES
 if(!Number.isSafeInteger(archiveLimit)||archiveLimit<0||archiveLimit>256*1024*1024)throw Error('ZIP 读取限制无效')
 const entryLimit=options.maxEntryBytes??archiveLimit,selectedLimit=options.maxSelectedBytes??archiveLimit
 if(!Number.isSafeInteger(entryLimit)||entryLimit<0||entryLimit>archiveLimit||!Number.isSafeInteger(selectedLimit)||selectedLimit<0||selectedLimit>archiveLimit)throw Error('ZIP 读取限制无效')
 let selectedBytes=0
 if(blob.size>archiveLimit)throw Error(`本地 ZIP 最大支持 ${archiveLimit/1024/1024} MiB`)
 const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map<string,Uint8Array>();let end=-1,total=0
 assertActive()
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break}
 if(end<0)throw Error('ZIP 文件不完整')
 const count=view.getUint16(end+10,true);let offset=view.getUint32(end+16,true)
 if(count>MAX_ENTRIES||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('不支持此 ZIP 结构')
 const names=new Set<string>()
 for(let i=0;i<count;i++){
  assertActive()
  if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw Error('ZIP 目录无效')
  const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),crc=view.getUint32(offset+16,true),compressed=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),nameSize=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),start=view.getUint32(offset+42,true)
  if(offset+46+nameSize+extra+comment>end)throw Error('ZIP 目录不完整')
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(offset+46,offset+46+nameSize)),key=name.toLocaleLowerCase()
  if(!name||name.startsWith('/')||/[\\:\x00]/.test(name)||name.split('/').some(p=>p==='..'||p==='.')||names.has(key))throw Error('ZIP 包含不安全或重复路径')
  names.add(key);offset+=46+nameSize+extra+comment;total+=size
  if(total>archiveLimit||flags&1||![0,8].includes(method))throw Error('ZIP 体积过大、已加密或压缩方式不支持')
  if(start+30>bytes.length||view.getUint32(start,true)!==0x04034b50)throw Error('ZIP 文件头无效')
  const body=start+30+view.getUint16(start+26,true)+view.getUint16(start+28,true)
  if(body+compressed>bytes.length)throw Error('ZIP 内容不完整')
  if(options.include&&!options.include(name))continue
  selectedBytes+=size
  if(size>entryLimit||selectedBytes>selectedLimit)throw Error('ZIP 选定内容超过限制')
  let data=bytes.slice(body,body+compressed)
  if(method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks:Uint8Array[]=[];let length=0;try{for(;;){const next=await reader.read();if(next.done)break;assertActive();length+=next.value.length;if(length>size||length>entryLimit||length>selectedLimit)throw Error('ZIP 解压超过限制');chunks.push(next.value)}}finally{await reader.cancel().catch(()=>undefined)}data=new Uint8Array(length);let position=0;for(const chunk of chunks){data.set(chunk,position);position+=chunk.length}}
  assertActive()
  if(data.length!==size||crc32(data)!==crc)throw Error('ZIP 内容校验失败')
  if(!name.endsWith('/'))files.set(name,data)
 }
 return files
}
