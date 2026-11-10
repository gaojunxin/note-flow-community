/** 社区附件仅在本机保存，不执行官方云端附件同步阶段。 */
export async function syncPendingNoteAttachments(_ownerId:string){return {uploaded:0,failed:0}}
