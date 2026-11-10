let revision=0
const key=(name:string)=>`note-flow-community-settings:${name}`
export const accountSessionRevision=()=>revision
// Local settings changes conservatively invalidate in-flight workspace actions.
export const accountLifecycleRevision=()=>revision
export const initializeAccountStorage=async()=>{}
export const flushAccountStorage=async()=>{}
export const readAccountSetting=(name:string)=>localStorage.getItem(key(name))
export function writeAccountSetting(name:string,value:string|null){revision++;if(value===null)localStorage.removeItem(key(name));else localStorage.setItem(key(name),value)}
