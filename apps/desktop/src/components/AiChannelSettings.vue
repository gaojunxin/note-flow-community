<script setup lang="ts">
import {computed,onBeforeUnmount,ref} from 'vue'
import {aiClientConfig,savedAiChannelConfig,saveAiClientConfig,removeAiClientKey,testAiClientConnection,type AiChannel} from '../services/aiClientConfig'
import {isCommunityEdition} from '../services/clientCapabilities'
import {isDesktopClient} from '../services/serverConfig'
const props=defineProps<{disabled?:boolean}>(),emit=defineEmits<{changed:[];selected:[channel:AiChannel]}>()
const config=ref(aiClientConfig()),key=ref(''),error=ref(''),notice=ref(''),busy=ref(false),testing=ref(false)
const provider=ref(config.value.endpoint.replace(/\/$/,'').match(/^https:\/\/api\.deepseek\.com(?:\/v1)?$/)?'deepseek':'custom')
const choices=computed(()=>[{value:'personal' as AiChannel,title:'个人 API',description:'使用自己的 Key，直接连接 DeepSeek 等服务'},{value:'local' as AiChannel,title:'本地模型',description:'连接本机或内网的 Ollama 等兼容服务'},...(!isCommunityEdition?[{value:'server' as AiChannel,title:'账号服务',description:'通过已登录的迹语服务器调用模型'}]:[])])
let controller:AbortController|undefined
function chooseChannel(channel:AiChannel){
 if(busy.value||props.disabled)return
 config.value=savedAiChannelConfig(channel)||{channel,endpoint:channel==='personal'?'https://api.deepseek.com/v1':'http://127.0.0.1:11434/v1',model:'',hasKey:false}
 provider.value=/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.value.endpoint)?'deepseek':'custom'
 key.value='';error.value='';notice.value='';emit('selected',channel)
}
function changed(){error.value='';notice.value=''}
function chooseProvider(){config.value.endpoint=provider.value==='deepseek'?'https://api.deepseek.com/v1':'';config.value.hasKey=false;key.value='';changed()}
function failure(source:unknown){const message=source instanceof Error?source.message:typeof source==='string'?source:'操作未完成，请重试';const status=message.match(/HTTP (\d{3})/)?.[1];return status==='401'?'授权失败，请检查 API Key。':status==='402'?'模型账户额度不足，请到供应商控制台检查。':status==='403'?'当前 Key 无权调用此模型，请检查授权。':status==='404'?'找不到模型或接口，请检查模型 ID 和接口地址。':status==='429'?'请求过于频繁或额度受限，请稍后重试。':status&&Number(status)>=500?'模型服务暂时不可用，请稍后重试。':message}
async function save(){busy.value=true;error.value='';notice.value='';try{config.value=await saveAiClientConfig(config.value,key.value||undefined);key.value='';notice.value='已保存，AI 助手将使用此模型。';emit('changed');return true}catch(e){error.value=failure(e);return false}finally{busy.value=false}}
async function test(){busy.value=true;testing.value=true;error.value='';notice.value='';controller=new AbortController();try{await testAiClientConnection(config.value,key.value||undefined,controller.signal,saved=>{config.value=saved;key.value='';emit('changed')});notice.value='连接成功，可以开始对话。'}catch(e){error.value=controller.signal.aborted?'连接测试已取消。':failure(e)}finally{busy.value=false;testing.value=false;controller=undefined}}
async function activateServer(){if(busy.value)return false;config.value={...config.value,channel:'server'};return save()}
defineExpose({activateServer})
async function clearKey(){busy.value=true;error.value='';notice.value='';try{await removeAiClientKey(config.value);config.value={...config.value,hasKey:false};key.value='';notice.value='个人 Key 已删除。';emit('changed')}catch(e){error.value=failure(e)}finally{busy.value=false}}
onBeforeUnmount(()=>controller?.abort())
</script>
<template>
 <section class="ai-channel-settings" aria-label="AI 调用设置">
  <h2>选择使用方式</h2>
  <div class="ai-channel-choices" role="group" aria-label="使用方式">
   <button v-for="choice in choices" :key="choice.value" type="button" :aria-pressed="config.channel===choice.value" :disabled="disabled||busy" @click="chooseChannel(choice.value)"><strong>{{choice.title}}</strong><span>{{choice.description}}</span></button>
  </div>
  <form v-if="config.channel!=='server'" class="ai-model-form" @submit.prevent="save">
   <p class="ai-destination">{{config.channel==='personal'?'内容直接发送到所选模型供应商，需要联网。无需登录迹语服务器。':'内容发送到你配置的本地模型服务。请先启动服务并安装模型。'}}</p>
   <label v-if="config.channel==='personal'">服务商<select v-model="provider" :disabled="disabled||busy" @change="chooseProvider"><option value="deepseek">DeepSeek</option><option value="custom">自定义兼容接口</option></select></label>
   <label v-if="config.channel==='local'||provider==='custom'">接口地址<input v-model.trim="config.endpoint" :disabled="disabled||busy" :placeholder="config.channel==='local'?'http://127.0.0.1:11434/v1':'https://模型服务地址/v1'" @input="config.hasKey=false;config.allowInsecureHttp=false;changed()"/></label>
   <p v-else class="ai-endpoint">接口地址：{{config.endpoint}}</p>
   <label v-if="config.channel==='personal'&&provider==='deepseek'" class="thinking-setting"><span><input v-model="config.thinking" type="checkbox" :disabled="disabled||busy" @change="changed"/>开启思考模式</span><small>默认关闭，普通问答优先速度；开启后模型可能先思考再输出正文。</small></label>
   <label v-if="/^http:\/\//i.test(config.endpoint)" class="thinking-setting"><span><input v-model="config.allowInsecureHttp" type="checkbox" :disabled="disabled||busy" @change="changed"/>允许此接口使用 HTTP 明文传输</span><small>内网 HTTP 会明文传输消息和 Key，仅连接可信服务。本机 localhost 无需勾选。HTTPS 网页访问内网 HTTP 受浏览器限制，建议使用桌面客户端；网页还需服务允许跨域。</small></label>
   <label>模型 ID<input v-model.trim="config.model" :disabled="disabled||busy" placeholder="填写供应商控制台或本地服务中的模型 ID" @input="changed"/></label>
   <label v-if="config.channel==='personal'">API Key<input v-model="key" type="password" autocomplete="new-password" :disabled="disabled||busy" :placeholder="config.hasKey?'已配置，留空不修改':'粘贴 API Key'" @input="changed"/></label>
   <p v-if="config.channel==='personal'" class="ai-help">{{isDesktopClient()?'Key 保存在本机系统安全凭据中。':'浏览器仅临时使用 Key，刷新后需要重新输入；供应商接口需允许浏览器跨域。'}}</p>
   <div class="ai-form-actions"><button class="ai-save" type="submit" :disabled="disabled||busy">保存配置</button><button type="button" :disabled="disabled||busy" @click="test">{{testing?'正在测试…':'保存并测试'}}</button><button v-if="testing" type="button" @click="controller?.abort()">取消测试</button><button v-if="config.channel==='personal'&&config.hasKey" type="button" :disabled="disabled||busy" @click="clearKey">删除个人 Key</button></div>
   <p class="ai-help">测试会保存当前配置并发送一条简短消息，不发送笔记或讨论内容，可能产生少量模型费用。</p>
  </form>
  <div v-else class="ai-account-settings"><slot name="server"><p>请在设置中的账号服务配置模型。</p><button type="button" :disabled="disabled||busy" @click="activateServer">使用账号服务</button></slot></div>
  <p v-if="error" class="ai-feedback error" role="alert">{{error}}</p><p v-else-if="notice" class="ai-feedback" role="status">{{notice}}</p>
 </section>
</template>
<style scoped>
.ai-channel-settings{font-size:13px;max-width:820px}.ai-channel-settings h2{font-size:14px;margin:0 0 14px}.ai-channel-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:22px}.ai-channel-choices button{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:8px;padding:16px;background:var(--pc-bg,#fff);border:1px solid var(--pc-border,#e4ebe6);border-radius:10px}.ai-channel-choices button[aria-pressed=true]{border-color:var(--pc-primary,#34775c);background:var(--pc-primary-soft,#eef7f2)}.ai-channel-choices strong{font-size:14px}.ai-channel-choices span{font-size:12px;color:var(--pc-muted,#718078);line-height:1.6}.ai-model-form{display:grid;gap:16px;max-width:560px}label{display:grid;gap:8px;font-weight:500}input,select{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--pc-border,#dfe6e1);border-radius:8px;background:var(--pc-bg,#fff);color:inherit;font:inherit}p{margin:0;line-height:1.7}.ai-destination{margin-bottom:2px;color:var(--pc-muted,#718078)}.ai-endpoint,.ai-help{font-size:12px;color:var(--pc-muted,#718078);overflow-wrap:anywhere}.ai-form-actions{display:flex;gap:10px;flex-wrap:wrap}button{padding:9px 14px;border:1px solid var(--pc-border,#dfe6e1);border-radius:8px;background:var(--pc-bg,#fff);color:inherit;font:inherit;cursor:pointer}button:disabled{opacity:.55;cursor:default}.ai-save{background:var(--pc-primary,#34775c);color:white;border-color:transparent}.ai-feedback{margin-top:16px;color:var(--pc-primary,#34775c)}.error{color:var(--pc-danger,#b04c43)}@media(max-width:680px){.ai-channel-choices{grid-template-columns:1fr}.ai-channel-choices button{padding:12px}.ai-channel-choices span{font-size:12px}}
</style>

<style scoped>.thinking-setting span{display:flex;gap:8px;align-items:center}.thinking-setting input{width:auto}.thinking-setting small{font-size:12px;color:var(--pc-muted,#718078);font-weight:400}</style>
