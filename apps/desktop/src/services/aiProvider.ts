import api from './api'

const body=<T>(response:{data?:{data?:T}|T})=>((response.data as {data?:T})?.data??response.data) as T
export interface AiProviderConfig{personalAllowed:boolean;systemAvailable:boolean;configured:boolean;providerType?:'openai'|'deepseek';model?:string;enabled?:boolean;connectionStatus?:'untested'|'connected'|'failed';lastTestedAt?:string;maskedApiKey?:string}
export const aiProviderService={
  get:async()=>body<AiProviderConfig>(await api.get('/api/v1/user/ai-provider')),
  save:async(value:{providerType:string;apiKey?:string;model:string;enabled:boolean})=>body<AiProviderConfig>(await api.put('/api/v1/user/ai-provider',value)),
  test:async()=>body<{connected:boolean}>(await api.post('/api/v1/user/ai-provider/test')),
  remove:async()=>{await api.delete('/api/v1/user/ai-provider')}
}
