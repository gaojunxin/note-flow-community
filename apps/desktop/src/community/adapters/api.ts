import type {AxiosRequestConfig,AxiosResponse} from 'axios'
export const TOKEN_KEY='note-flow-community-unused-token'
/** Shared pages can import the public transport shape; this host never opens a connection. */
function unavailable():never{throw Object.assign(new Error('社区版本地模式不提供服务器接口；请使用本地操作'),{code:'COMPONENT_UNAVAILABLE'})}
const api={
 get<T=any>(_url:string,_config?:AxiosRequestConfig):Promise<AxiosResponse<T>>{return Promise.reject(unavailableError())},
 post<T=any>(_url:string,_data?:unknown,_config?:AxiosRequestConfig):Promise<AxiosResponse<T>>{return Promise.reject(unavailableError())},
 put<T=any>(_url:string,_data?:unknown,_config?:AxiosRequestConfig):Promise<AxiosResponse<T>>{return Promise.reject(unavailableError())},
 delete<T=any>(_url:string,_config?:AxiosRequestConfig):Promise<AxiosResponse<T>>{return Promise.reject(unavailableError())},
 patch<T=any>(_url:string,_data?:unknown,_config?:AxiosRequestConfig):Promise<AxiosResponse<T>>{return Promise.reject(unavailableError())},
 defaults:{baseURL:''},
}
function unavailableError(){return Object.assign(new Error('社区版本地模式未接入服务器服务'),{code:'COMPONENT_UNAVAILABLE'})}
export const tauriAdapter=async()=>unavailable()
export default api

export async function accountAiStream(_messages:Array<{role:string;content:string}>,_signal?:AbortSignal):Promise<Response>{throw unavailableError()}
