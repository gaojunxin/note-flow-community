import api from './api'

export type RecoveryPoint={uid:string;createdAt:string;reason:string;sizeBytes:number;checksumAvailable:boolean}
export type BackupRun={uid:string;status:'queued'|'running'|'completed'|'failed';reason:string;startedAt:string;completedAt?:string;error?:string}
export type DataProtectionStatus={enabled:boolean;available:boolean;health:'good'|'warning'|'never'|'running'|'unavailable';running:boolean;latest?:RecoveryPoint;recoveryPointCount:number;activeRun?:BackupRun}
export type RecoveryPointVerification={uid:string;valid:boolean;checkedAt:string;checkedFiles:number;error?:string}

export const dataProtectionService={
  async status(){return(await api.get<{data:DataProtectionStatus}>('/api/v1/data-protection/status')).data.data},
  async points(){return(await api.get<{data:RecoveryPoint[]}>('/api/v1/data-protection/recovery-points')).data.data},
  async backup(){return(await api.post<{data:BackupRun}>('/api/v1/data-protection/backups')).data.data},
  async verify(uid:string){return(await api.post<{data:RecoveryPointVerification}>(`/api/v1/data-protection/recovery-points/${encodeURIComponent(uid)}/verify`)).data.data},
  async remove(uid:string){await api.delete(`/api/v1/data-protection/recovery-points/${encodeURIComponent(uid)}`)},
  async download(uid:string){return(await api.get<Blob>(`/api/v1/data-protection/recovery-points/${encodeURIComponent(uid)}/download`,{responseType:'blob',timeout:0})).data}
}
