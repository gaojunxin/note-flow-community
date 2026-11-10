import type {CanvasDocumentFields} from '../canvasDocument'
export interface CanvasEntity extends CanvasDocumentFields{uid:string;title:string;areaUid?:string|null;projectUid?:string|null;sceneData:string;textIndex:string;sceneChecksum?:string;sourceFormat?:'native'|'obsidian'|'migrated';sourcePath?:string;status:'active'|'archived';version:number;deleted:boolean;createdAt:string;updatedAt:string}
export interface CanvasSnapshot{version:number;sceneChecksum:string;createdAt:string}
