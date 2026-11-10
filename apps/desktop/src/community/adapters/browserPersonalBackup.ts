/** Community backups are local; official Web transport is never installed. */
interface BackupInspection {encryptedSpaces:number;cloudNotes:number;localNotes:number;tasks:number;files:number;archives:number;unavailableRefs:number}
export function createBrowserPersonalBackup(_credentials?:unknown){
 const unavailable=():never=>{throw Error('社区版请使用本地空间备份')}
 return{assertCurrent:unavailable,inspect:async(_source:unknown):Promise<BackupInspection>=>unavailable(),capture:async()=>unavailable(),restore:async(_source:unknown)=>unavailable(),dispose(){}}
}
