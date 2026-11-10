/** 补齐旧WebKit缺少的缓冲区转移操作；字体数据打包在worker中也会调用此API。 */
export function installPdfBufferCompatibility(){
  if(typeof (ArrayBuffer.prototype as ArrayBuffer & {transferToFixedLength?:unknown}).transferToFixedLength==='function')return
  const byteLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!
  Object.defineProperty(ArrayBuffer.prototype,'transferToFixedLength',{
    configurable:true,writable:true,
    value:function(this:ArrayBuffer,newLength?:number){
      const currentLength=byteLength.call(this) as number
      // 先验证接收者和分配结果；非法长度、已分离缓冲区及分配失败不得分离原数据。
      const source=new Uint8Array(this)
      const requested=newLength===undefined?currentLength:+newLength
      const length=Number.isNaN(requested)?0:Math.trunc(requested)
      if(length<0||length>Number.MAX_SAFE_INTEGER)throw new RangeError('Invalid ArrayBuffer length')
      const result=new ArrayBuffer(length)
      new Uint8Array(result).set(source.subarray(0,Math.min(currentLength,length)))
      // 复制并不等于转移：必须使用平台传输列表分离原缓冲区，保留PDF.js的资源所有权语义。
      structuredClone(this,{transfer:[this]})
      return result
    },
  })
}

installPdfBufferCompatibility()
