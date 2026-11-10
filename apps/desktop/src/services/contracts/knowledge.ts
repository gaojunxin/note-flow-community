export type AiPolicy='normal'|'confirm'|'excluded'
export type KnowledgeMaturity='emerging'|'draft'|'validated'|'stable'|'obsolete'
export interface KnowledgeEntity{/** 本机导入已完成，但远端身份尚未全部确认；只读且不进入日常编辑队列。 */importPending?:boolean;uid:string;title:string;conclusion:string;content:string;applicability?:string;limitations?:string;maturity:KnowledgeMaturity;confidence:'low'|'medium'|'high';aiPolicy?:AiPolicy;areaUid?:string;primaryTopicUid?:string;parentKnowledgeUid?:string;sortOrder?:number;keyPoints:string[];sources?:KnowledgeSource[];usages?:KnowledgeUsage[];revisions?:Array<Record<string,unknown>>;version:number;lastValidatedAt?:string;updatedAt?:string}
export interface KnowledgeSource{uid:string;sourceType:string;sourceUid?:string;sourceRevision?:number;excerpt?:string;contribution:string;confirmedByUser:boolean}
export interface KnowledgeTopic{uid:string;parentUid?:string;name:string;description?:string;sortOrder:number;archived?:boolean;version:number;documentCount?:number;childTopicCount?:number}
export interface KnowledgeUsage{uid:string;knowledgeUid:string;title?:string;conclusion?:string;targetType:string;targetUid:string;usageType:'referenced'|'applied'|'validated'|'challenged';feedback?:string;version:number}
export type KnowledgeRelationType='prerequisite'|'part_of'|'implemented_by'|'solves'|'compares_with'|'evolves_to'|'misconception_of'|'symptom_of'|'diagnosed_by'|'applied_in'|'validated_by'|'supports'
export interface KnowledgeRelation{uid:string;fromUid:string;fromTitle:string;toUid:string;toTitle:string;relationType:KnowledgeRelationType;statement:string;evidenceLevel:'official'|'system-note'|'personal-practice'|'work-context'|'inference';confidence:'low'|'medium'|'high';status:'active'|'proposed'|'rejected';version:number;updatedAt?:string}
export interface GraphNode{uid:string;entityType:'knowledge'|'note';title:string;summary?:string;subtitle?:string;current?:boolean}
export interface GraphEdge{uid:string;fromUid:string;toUid:string;edgeType:string;relationType?:string;statement?:string;confidence?:string;status?:string}
export interface KnowledgeGraph{centerUid:string;depth:number;nodes:GraphNode[];edges:GraphEdge[]}

/** 导出目录只含定位和层级字段；正文必须从详情入口读取，不能假定分页响应携带全文。 */
export type KnowledgeExportEntry=Pick<KnowledgeEntity,'uid'|'title'|'primaryTopicUid'|'parentKnowledgeUid'|'areaUid'|'sortOrder'|'version'|'updatedAt'>
