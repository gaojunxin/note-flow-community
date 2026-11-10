/** OpenAI-compatible SSE decoder. Network chunks are not event or UTF-8 boundaries. */
export type AiStreamStage='connected'|'first-event'|'thinking'|'output'|'buffered'
// 网络分块不等于完整SSE事件；跨块保留解码和事件缓冲，结束时仍要检查服务端完成信号。
export function createAiStreamDecoder(onText:(text:string)=>void,onStage:(stage:AiStreamStage)=>void=()=>{}){
 const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',text='',ended=false,bytes=0,finishReason='',firstEvent=false
 function event(raw:string){
  const data=raw.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n')
  if(raw.startsWith('event: noteflow-transport')){onStage('connected');try{if(JSON.parse(data).buffered)onStage('buffered')}catch{/* ignore unknown transport metadata */}return}
  if(!data)return;if(!firstEvent){firstEvent=true;onStage('first-event')}if(ended)throw Error('模型结束后仍返回内容')
  if(data.trim()==='[DONE]'){ended=true;return}
  let value:any;try{value=JSON.parse(data)}catch{throw Error('模型流式响应格式无效')}
  if(value.error)throw Error('模型流式请求失败，请检查模型服务')
  const choice=value.choices?.[0];if(!choice)return
  if(choice.delta?.tool_calls?.length)throw Error('当前回答不能执行模型工具调用')
  if(choice.finish_reason)finishReason=choice.finish_reason
  if(!text&&choice.delta?.reasoning_content)onStage('thinking')
  const delta=choice.delta?.content;if(delta!=null&&typeof delta!=='string')throw Error('模型返回了不支持的内容格式')
  if(delta){onStage('output');text+=delta;if(text.length>50000)throw Error('模型回答超过 50000 字限制');onText(text)}
 }
 function drain(){buffer=buffer.replace(/\r\n/g,'\n');let boundary:number;while((boundary=buffer.indexOf('\n\n'))>=0){const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);event(raw)}if(buffer.length>256000)throw Error('模型流式事件超过限制')}
 return {write(chunk:Uint8Array){bytes+=chunk.byteLength;if(bytes>2000000)throw Error('模型响应超过限制');buffer+=decoder.decode(chunk,{stream:true});drain()},finish(){buffer+=decoder.decode();drain();if(buffer.trim())event(buffer);if(!ended)throw Error('模型响应中断，已保留收到的内容');if(finishReason==='length')throw Error('模型输出达到长度限制，已保留收到的内容');if(!text.trim())throw Error('模型未返回文本回答');return text}}
}
/** Classify provider errors without displaying echoed prompts, keys, or raw bodies. */
export function aiHttpError(status:number,body=''){
 let raw:any;try{raw=JSON.parse(body)}catch{/* non-JSON proxy error */}
 const detail=raw?.error;const text=[detail?.message,detail?.code,detail?.param,detail?.type].filter(v=>typeof v==='string').join(' ').toLowerCase()
 let hint=''
 if(status===400){
  if(text.includes('reasoning_content'))hint='模型要求补全思考上下文，当前调用兼容性不足'
  else if(/model.*(?:not|invalid|exist|found|support)|invalid.*model/.test(text))hint='模型 ID 无效或当前接口不支持该模型，请核对模型配置'
  else if(/messages|role|content|last message|assistant|user message/.test(text))hint='模型拒绝了消息格式或角色顺序；请尝试新建讨论并检查模型兼容性'
  else if(/context|token|length/.test(text))hint='上下文超出模型限制，请缩小引用范围或新建讨论'
  else if(/stream/.test(text))hint='该接口拒绝流式参数，请核对接口兼容性'
  else hint='模型拒绝请求参数，请核对接口地址、模型 ID 与消息格式'
 }else hint=({401:'请重新保存 API Key',402:'请检查账户余额或额度',403:'请检查 API 权限',404:'请检查接口地址与模型 ID',429:'请求过于频繁或额度不足，请稍后重试'} as Record<number,string>)[status]||''
 return Error(`模型调用失败（HTTP ${status}）${hint?'；'+hint:''}`)
}
async function readErrorBody(response:Response,signal?:AbortSignal){
 if(!response.body)return '';const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0
 try{while(true){if(signal?.aborted)throw new DOMException('已取消','AbortError');const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16384)break;text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
// 取消和异常退出都须释放reader及abort监听器；已经收到部分文本不代表生成已完整成功。
export async function readAiStream(response:Response,onText:(text:string)=>void,signal?:AbortSignal,onStage:(stage:AiStreamStage)=>void=()=>{}){
 onStage('connected')
 if(!response.ok)throw aiHttpError(response.status,await readErrorBody(response,signal))
 if(!response.headers.get('content-type')?.includes('text/event-stream')){onStage('buffered');
  let body='';if(response.body){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;try{while(true){if(signal?.aborted)throw new DOMException('已取消','AbortError');const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000)throw Error('模型响应超过限制');body+=decoder.decode(value,{stream:true})}body+=decoder.decode()}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}}else body=await response.text();if(body.length>2000000)throw Error('模型响应超过限制');let value:any;try{value=JSON.parse(body)}catch{throw Error('模型返回格式无效')}const text=value?.choices?.[0]?.message?.content??value?.data?.answer
  if(typeof text!=='string'||!text.trim())throw Error('模型未返回文本回答');if(text.length>50000)throw Error('模型回答超过 50000 字限制');if(signal?.aborted)throw new DOMException('已取消','AbortError');onStage('first-event');onStage('output');onText(text);return text
 }
 if(!response.body)throw Error('当前环境无法读取流式响应')
 const reader=response.body.getReader(),decoder=createAiStreamDecoder(onText,onStage),cancel=()=>{void reader.cancel().catch(()=>{})};signal?.addEventListener('abort',cancel,{once:true})
 try{while(true){if(signal?.aborted)throw new DOMException('已取消','AbortError');const {value,done}=await reader.read();if(done)break;decoder.write(value)}if(signal?.aborted)throw new DOMException('已取消','AbortError');return decoder.finish()}finally{signal?.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
