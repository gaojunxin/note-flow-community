import {createAiStreamDecoder,readAiStream,aiHttpError,type AiStreamStage} from './aiStream'
import {Channel,invoke} from '@tauri-apps/api/core'
import {isDesktopClient} from './serverConfig'
import {isCommunityEdition} from './clientCapabilities'
import {currentProfile} from './profiles'
import {readAccountSetting} from './accountStorage'
import {clientOwnerScope} from './clientContext'
export type AiChannel='local'|'personal'|'server'
export interface AiClientConfig {channel:AiChannel;endpoint:string;model:string;hasKey:boolean;thinking?:boolean;allowInsecureHttp?:boolean}
export function aiLocalScope(){const user=JSON.parse(readAccountSetting('note-flow-pc-user')||'null');return clientOwnerScope(currentProfile()?.profileId||String(user?.userId||'local'))}
const configKey=()=>`note-flow-ai-client:v1:${aiLocalScope()}`
export function aiClientConfig():AiClientConfig {
 let saved:Partial<AiClientConfig>={};try{saved=JSON.parse(localStorage.getItem(configKey())||'{}')}catch{/* defaults */}
 const channel=isCommunityEdition?'local':(saved.channel||((isDesktopClient()&&!currentProfile()?.serverBinding)?'local':'server'))
 return{channel:saved.channel==='personal'?'personal':channel,endpoint:saved.endpoint||'http://127.0.0.1:11434/v1',model:saved.model||'',thinking:saved.thinking===true,allowInsecureHttp:saved.allowInsecureHttp===true,hasKey:Boolean(saved.hasKey)&&(isDesktopClient()||temporaryKeys.has(secretId(saved.endpoint||'http://127.0.0.1:11434/v1')))}
}
export function validateAiEndpoint(value:string,allowInsecureHttp=false){
 let url:URL;try{url=new URL(value)}catch{throw Error('请填写有效的模型接口地址')}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname)
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&(local||allowInsecureHttp)))||url.username||url.password||url.search||url.hash)throw Error('非本机 HTTP 接口需要先确认允许明文传输')
 if(!isDesktopClient()&&typeof location!=='undefined'&&location.protocol==='https:'&&url.protocol==='http:'&&!local)throw Error('HTTPS 网页无法调用内网 HTTP 模型，请使用桌面客户端或 HTTPS 模型接口')
 return url.toString().replace(/\/$/,'')
}
const temporaryKeys=new Map<string,string>()
const secretId=(endpoint:string)=>`${aiLocalScope()}\n${endpoint}`
export async function saveAiClientConfig(value:AiClientConfig,key?:string){
 const endpoint=validateAiEndpoint(value.endpoint,value.allowInsecureHttp),scope=aiLocalScope()
 if(value.channel==='server'&&isCommunityEdition)throw Error('社区版使用客户端直连')
 if(value.channel!=='server'&&!value.model.trim())throw Error('请填写已安装或有权使用的模型 ID')
 let hasKey=value.hasKey
 if(key?.trim()){
  if(/[^\x21-\x7e]/.test(key.trim()))throw Error('API Key 含空格、换行或非英文字符，请从供应商控制台重新复制完整 Key')
  if(isDesktopClient())await invoke('ai_store_key',{scope,endpoint,key:key.trim(),allowInsecureHttp:value.allowInsecureHttp===true})
  else temporaryKeys.set(secretId(endpoint),key.trim())
  hasKey=true
 }
 if(value.channel==='personal'&&!hasKey)throw Error('请填写个人 API Key')
 if(scope!==aiLocalScope())throw Error('当前空间已切换，请重新保存模型配置')
 const saved={channel:value.channel,endpoint,model:value.model.trim(),hasKey,thinking:value.thinking===true,allowInsecureHttp:value.allowInsecureHttp===true}
 const previous=aiClientConfig();let channels:Record<string,AiClientConfig>={};try{channels=JSON.parse(localStorage.getItem(configKey()+':channels')||'{}')}catch{/* damaged preferences */}
 channels[previous.channel]=previous;channels[saved.channel]=saved;
 localStorage.setItem(configKey()+':channels',JSON.stringify(channels));localStorage.setItem(configKey(),JSON.stringify(saved));return saved
}
export async function removeAiClientKey(config=aiClientConfig()){
 const scope=aiLocalScope();if(isDesktopClient())await invoke('ai_store_key',{scope,endpoint:config.endpoint,key:null,allowInsecureHttp:config.allowInsecureHttp===true});if(scope!==aiLocalScope())throw Error('当前空间已切换，请在新空间重新操作')
 temporaryKeys.delete(secretId(config.endpoint));const active=aiClientConfig();if(active.endpoint===config.endpoint&&active.channel===config.channel)localStorage.setItem(configKey(),JSON.stringify({...active,hasKey:false}))
 let channels:Record<string,AiClientConfig>={};try{channels=JSON.parse(localStorage.getItem(configKey()+':channels')||'{}')}catch{/* damaged preferences */}
 for(const value of Object.values(channels))if(value.endpoint===config.endpoint)value.hasKey=false
 localStorage.setItem(configKey()+':channels',JSON.stringify(channels))
}
function nativeAiError(source:unknown):Error{
 if(source instanceof Error)return source
 const text=typeof source==='string'?source:''
 if(/command.*(?:not found|unknown)|unknown.*command/i.test(text))return Error('当前 Windows 客户端缺少 AI 流式接口，请安装更新后的客户端；仅刷新页面不能更新原生接口')
 const status=text.match(/^模型调用失败（HTTP (\d{3})）$/)?.[1]
 if(status)return aiHttpError(Number(status))
 if(/^模型调用失败（HTTP 400）；(?:模型 ID 无效|消息格式无效|上下文超出限制|思考上下文缺失|流式参数不兼容)$/.test(text))return Error(text)
 const allowed=['AI 空间标识无效','系统安全凭据服务不可用','模型接口地址无效','非本机 HTTP 接口需要先确认允许明文传输','安全凭据服务繁忙','请重新保存个人 API Key','模型请求超出限制','模型请求状态不可用','模型请求已存在或过多','无法初始化模型连接','模型服务连接失败或超时','模型响应中断','模型响应超过限制','模型返回格式无效','模型未返回文本回答','模型回答超过限制','回答窗口已关闭','已停止生成']
 return Error(allowed.includes(text)?text:'Windows 模型调用失败，问题与草稿已保留；请检查模型配置或更新客户端')
}
export async function directAiCompletion(messages:Array<{role:string;content:string}>,signal?:AbortSignal,onText:(text:string)=>void=()=>{},onStage:(stage:AiStreamStage)=>void=()=>{}){
 const config=aiClientConfig()
 if(config.channel==='server'){
  if(navigator.onLine===false)throw Error('账号模型需要联网；讨论和草稿已保存在本机，可切换本地模型')
  const {accountAiStream}=await import('./api')
  const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,120000)
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
  try{return await readAiStream(await accountAiStream(messages,controller.signal),onText,controller.signal,onStage)}catch(error){
   if(controller.signal.aborted&&!signal?.aborted)throw Error('模型请求超时，已保留收到的内容');if(!controller.signal.aborted&&[404,405].includes(Number((error as {status?:number}).status))){const {default:api}=await import('./api');const response=await api.post('/api/v1/ai-learning/completion',{messages,confirmed:true},{timeout:120000,signal:controller.signal});const text=response.data?.data?.answer;if(typeof text!=='string'||!text.trim()||text.length>50000)throw Error('账号模型未返回有效回答');window.dispatchEvent(new CustomEvent('note-flow:ai-transport-status',{detail:'当前服务器返回完整回答；更新服务端后可逐段显示'}));onText(text);return text}throw error
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 }
 const scope=aiLocalScope(),endpoint=validateAiEndpoint(config.endpoint,config.allowInsecureHttp)
 if(!config.model)throw Error('请先配置本地模型或个人云端模型')
 const abort=new Promise<never>((_,reject)=>{if(signal?.aborted)reject(new DOMException('已取消','AbortError'));else signal?.addEventListener('abort',()=>reject(new DOMException('已取消','AbortError')),{once:true})})
 const request=(async()=>{
  if(isDesktopClient()){
   let endStream!:()=>void;const ended=new Promise<void>(resolve=>endStream=resolve)
   const requestUid=crypto.randomUUID(),decoder=createAiStreamDecoder(text=>{if(!signal?.aborted&&scope===aiLocalScope())onText(text)},onStage),chunks=new Channel<number[]>();let parseError:unknown
   const cancel=()=>{void invoke('ai_cancel_completion',{requestUid}).catch(()=>{})}
   chunks.onmessage=bytes=>{if(!bytes.length){endStream();return}if(parseError||signal?.aborted)return;try{decoder.write(new Uint8Array(bytes))}catch(error){parseError=error;cancel()}}
   signal?.addEventListener('abort',cancel,{once:true})
   try{if(signal?.aborted)throw new DOMException('已取消','AbortError');await invoke('ai_stream_completion',{requestUid,chunks,request:{scope,endpoint,model:config.model,messages,requireKey:config.channel==='personal',thinking:config.thinking===true,allowInsecureHttp:config.allowInsecureHttp===true}});await ended;if(parseError)throw parseError;if(signal?.aborted)throw new DOMException('已取消','AbortError');return decoder.finish()}catch(error){if(parseError)throw parseError;throw nativeAiError(error)}finally{signal?.removeEventListener('abort',cancel)}
  }
  const key=temporaryKeys.get(secretId(endpoint));if(config.channel==='personal'&&!key)throw Error('浏览器不保存个人 Key，请重新输入后使用')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000)
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true})
  try{
   const response=await fetch(endpoint+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:config.model,messages,stream:true,...(new URL(endpoint).hostname==='api.deepseek.com'?{thinking:{type:config.thinking?'enabled':'disabled'}}:{})}),credentials:'omit',redirect:'error',signal:controller.signal})
   return await readAiStream(response,onText,controller.signal,onStage)
  }catch(error){if(signal?.aborted)throw new DOMException('已取消','AbortError');if(controller.signal.aborted)throw Error('模型请求超时，已保留收到的内容');if(error instanceof TypeError)throw Error('无法连接模型；请检查地址、服务启动状态及浏览器跨域权限');throw error}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 })()
 return Promise.race([request,abort])
}

/** Only non-secret configuration is persisted; browser keys remain in memory. */
export function configuredAiChannels():AiClientConfig[]{
 const active=aiClientConfig();let saved:Record<string,AiClientConfig>={};try{saved=JSON.parse(localStorage.getItem(configKey()+':channels')||'{}')}catch{/* retain current */}
 saved[active.channel]=active;
 return Object.values(saved).filter(value=>['local','personal','server'].includes(value.channel)).map(value=>({...value,hasKey:value.channel==='personal'?Boolean(value.hasKey)&&(isDesktopClient()||temporaryKeys.has(secretId(value.endpoint))):false})).filter(value=>value.channel==='server'?!isCommunityEdition:Boolean(value.model)&&(value.channel==='local'||value.hasKey));
}

/** Restore a channel's non-secret fields without changing the active model. */
export function savedAiChannelConfig(channel:AiChannel):AiClientConfig|undefined {
 const active=aiClientConfig();if(active.channel===channel)return active
 try{const saved=JSON.parse(localStorage.getItem(configKey()+':channels')||'{}')[channel] as AiClientConfig|undefined;if(!saved)return;return{...saved,channel,hasKey:Boolean(saved.hasKey)&&(isDesktopClient()||temporaryKeys.has(secretId(saved.endpoint)))}}catch{return}
}
/** Saves the visible form, then tests the same transport used by discussion. No notes are sent. */
export async function testAiClientConnection(value:AiClientConfig,key?:string,signal?:AbortSignal,onSaved?:(config:AiClientConfig)=>void){
 if(signal?.aborted)throw new DOMException('已取消','AbortError')
 const scope=aiLocalScope(),saved=await saveAiClientConfig(value,key)
 if(scope!==aiLocalScope())throw Error('当前空间已切换，请重新测试')
 if(signal?.aborted)throw new DOMException('已取消','AbortError')
 onSaved?.(saved)
 const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,20000)
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
 try{await directAiCompletion([{role:'user',content:'Reply with OK only.'}],controller.signal)}catch(error){if(controller.signal.aborted){if(signal?.aborted)throw new DOMException('已取消','AbortError');throw Error('连接测试超时，请检查模型服务和网络')}throw error}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
