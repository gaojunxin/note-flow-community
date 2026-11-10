/** 公共附件及独立引用；传输与同步队列由宿主负责，不以来源删除推断媒体可回收。 */
export type AttachmentUploadStatus='local'|'pending'|'uploading'|'uploaded_needs_link'|'uploaded'|'failed'|'deleted'
export interface AttachmentItem {uid:string;noteUid?:string;taskUid?:string;knowledgeUid?:string;cardUid?:string;originalPath?:string;sourceFilePath?:string;pathAliases?:string[];relationUid?:string;relationVersion?:number;role?:string;version:number;originalFilename:string;mediaType?:string;sizeBytes:number;sha256:string;uploadState?:string;contentUrl:string}
export interface AttachmentReference {kind:'note'|'task'|'knowledge'|'knowledge_card'|'recording';uid:string;title?:string;noteUid?:string;noteTitle?:string;taskUid?:string;knowledgeUid?:string;cardUid?:string;version?:number}
export interface LibraryAttachment extends AttachmentItem {createdAt:string;updatedAt:string;referenceCount:number;references:AttachmentReference[]}
export interface AttachmentLibraryPage {notice?:string;items:LibraryAttachment[];total:number;page:number;size:number;hasMore:boolean}
export interface AttachmentLibrarySummary {total:number;images:number;audio:number;files:number;orphan:number;totalBytes:number}
export interface LocalAttachment {uid:string;noteUid?:string;taskUid?:string;name:string;mediaType:string;sizeBytes:number;sha256:string;blob?:Blob;localPath?:string;status:AttachmentUploadStatus;serverUid?:string;relationUid?:string;relationVersion?:number;cancelledRelationVersion?:number;localCancellation?:boolean;contentUrl?:string;attempts:number;lastError?:string;createdAt:string;updatedAt:string}
