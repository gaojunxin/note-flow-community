/** Public local graph DTOs; no official service dependency. */
export interface GraphNode{uid:string;entityType:'knowledge'|'note';title:string;summary?:string;subtitle?:string;current?:boolean}
export interface GraphEdge{uid:string;fromUid:string;toUid:string;edgeType:string;relationType?:string;statement?:string;confidence?:string;status?:string}
export interface KnowledgeGraph{centerUid:string;depth:number;nodes:GraphNode[];edges:GraphEdge[]}
