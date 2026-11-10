import { getDesktopServerUrl, isDesktopClient } from './serverConfig'
import { activeStorageKey, currentProfile } from './profiles'

export const serverFingerprint=(value:string)=>{let hash=2166136261;for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(36)}
export const clientServerUrl=()=>typeof window==='undefined'?'local-test':isDesktopClient()?getDesktopServerUrl():window.location.origin
export const clientServerFingerprint=()=>serverFingerprint(clientServerUrl()||'same-origin')
export const clientOwnerScope=(userId:string|number)=>currentProfile()?.storageKey||`${clientServerFingerprint()}-${String(userId).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)}`
export const scopedPreferenceKey=(key:string,userId:string|number)=>`${key}:${clientOwnerScope(userId)}`
export const clientStorageKey=(userId:string|number)=>activeStorageKey(userId)
