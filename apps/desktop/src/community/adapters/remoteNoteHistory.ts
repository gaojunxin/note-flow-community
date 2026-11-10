import type {RemoteHistoryPage,RemoteHistoryDetail} from '@note-flow/core/remote-note-history'
/** Community history stays local; these typed methods never open a connection. */
export function remoteNoteHistoryAvailable(){return false}
export function captureRemoteNoteHistory(_assertSource:()=>void){
 const unavailable=():never=>{throw Error('社区版仅支持本机历史记录')}
 return{list:async(_uid:string,_before?:number):Promise<RemoteHistoryPage>=>unavailable(),get:async(_uid:string,_versionUid:string):Promise<RemoteHistoryDetail>=>unavailable()}
}
