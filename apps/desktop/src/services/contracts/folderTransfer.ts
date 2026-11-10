/** 目录整棵迁移的公开预览契约；是否允许执行由宿主能力决定。 */
export interface FolderTransferTarget {areaUid:string|null;projectUid:string|null;parentUid:string|null}
interface Head {uid:string;areaUid:string|null;projectUid:string|null;version:number;deleted:boolean;updatedAt?:string}
export interface FolderTransferImpact {schema:'note-flow-folder-transfer/1';rootUid:string;target:FolderTransferTarget;token:string;folderCount:number;noteCount:number;archivedNoteCount:number;trashNoteCount:number;folders:Array<Head&{name:string;parentUid:string|null}>;notes:Array<Head&{title:string;type:string;status:string;folderUid:string;contentHash:string}>;operationUid?:string;resuming?:boolean}
export interface FolderTransferRequest {operationUid:string;token:string;target:FolderTransferTarget}
