import {communityUnavailable} from '../runtime'
import type {VaultBackup} from '../../services/vault'
export interface RemoteVaultSnapshot {payload:string;payloadSha256:string;version:number;updatedAt?:string}
export interface VaultHistoryItem {version:number;createdAt:string}
export type VaultSyncResult={status:'uploaded'|'downloaded'|'unchanged';version:number;updatedAt?:string}|{status:'conflict';version:number;remote:RemoteVaultSnapshot}
export async function getRemoteVault():Promise<RemoteVaultSnapshot|null>{return communityUnavailable('保险箱云端同步')}
export async function listVaultHistory():Promise<VaultHistoryItem[]>{return communityUnavailable('保险箱云端历史')}
export async function syncVault(_ownerId:string):Promise<VaultSyncResult>{return communityUnavailable('保险箱云端同步')}
export async function restoreRemoteVault(_ownerId:string,_remote?:RemoteVaultSnapshot,_onlyIfMissing?:boolean):Promise<VaultBackup>{return communityUnavailable('保险箱云端恢复')}
export async function overwriteRemoteVault(_ownerId:string,_version:number):Promise<number>{return communityUnavailable('保险箱云端覆盖')}
export async function restoreVaultHistory(_ownerId:string,_version:number,_baseVersion:number):Promise<RemoteVaultSnapshot>{return communityUnavailable('保险箱云端历史恢复')}
export function clearVaultSyncState(_ownerId:string):void{/* Community has no server cursor or cloud snapshot state; local encrypted vault remains untouched. */}
