/** 知识卡片的跨端数据与事务端口；本地能力不得依赖私有同步组件。 */
export type CardStatus='draft'|'active'|'paused'
export type CardRating='forgotten'|'uncertain'|'remembered'
export type CardReviewMode='daily'|'practice'
export type CardSourceState='none'|'current'|'changed'|'missing'
export type CardDisposition='scheduled'|'practice_only'|'history_only_conflict'|'history_only_content_changed'|'history_only_clock_order'
export interface CardSourceLocator {namespace:string;path:string;anchor?:string}
export interface KnowledgeCard {
 uid:string;version:number;contentVersion:number;learningGeneration:number;question:string;answer:string;explanation:string;status:CardStatus
 directoryUid?:string|null;areaUid:string|null;primaryTopicUid:string|null;sourceKnowledgeUid:string|null;sourceVersion:number|null;sourceState:CardSourceState;sourceHeading?:string;sourceExcerpt?:string
 externalSourceLocator?:CardSourceLocator|null;questionRefs?:string[];mediaDigests?:CardMediaDigest[];mediaReferences?:string[];mediaReady?:boolean;createdAt:string;updatedAt:string;deleted:boolean
 localRevision?:number;syncStatus?:'synced'|'pending'|'conflict'|'permanent_failed';serverBaseline?:Record<string,unknown>;[key:string]:unknown
}
export interface CardSchedule {uid:string;version:number;contentVersion:number;learningGeneration:number;streak:number;lastEventUid:string|null;lastCommandUid:string|null;lastReviewedAt:string|null;dueAt:string|null;deleted?:boolean;serverBaseline?:CardSchedule;syncStatus?:string}
export interface CardSessionItem {entryUid:string;cardUid:string;contentVersion:number;learningGeneration:number;originalKind:'new'|'due';baseScheduleVersion:number;state:'pending'|'completed'|'skipped'|'invalid';revealed?:boolean;eventUid?:string;skipCommandUid?:string}
export interface CardReviewSession {uid:string;version:number;mode:CardReviewMode;scope:{areaUid:string|null;topicUid:string|null};learningDate:string;timezone:string;items:CardSessionItem[];status:'active'|'interrupted'|'completed'|'ended';originDeviceUid:string;parentSessionUid:string|null;createdAt:string;updatedAt:string;syncStatus?:string;localRevision?:number;lastEventUid?:string|null}
export interface CardReviewEvent {uid:string;cardUid:string;sessionUid:string;entryUid:string;contentVersion:number;learningGeneration:number;mode:CardReviewMode;rating:CardRating;baseScheduleVersion:number;predecessorEventUid:string|null;predecessorRetractionUid:string|null;originalKind:'new'|'due';reviewedAt:string;algorithmVersion:'simple-v1';disposition:CardDisposition;beforeSchedule:CardSchedule;afterSchedule:CardSchedule|null;retracted?:boolean;syncStatus?:string;version?:number;[key:string]:unknown}
export interface CardReviewPreferences {uid:string;version:number;timezone:string;newLimit:number;dueLimit:number;syncStatus?:string}
export interface CardImportSource {uid:string;cardUid:string;namespace:string;key:string;version:number;contentHash:string;baseline:CardImportContent;deleted?:boolean;syncStatus?:string}
export interface CardMediaDigest {path:string;sha256:string;role:'question'|'answer'|'explanation'}
export interface CardImportContent {mediaDigests?:CardMediaDigest[];question:string;answer:string;explanation:string;externalSourceLocator:CardSourceLocator|null;questionRefs:string[]}
export interface ParsedKnowledgeCard extends CardImportContent {namespace:string;key:string;filePath:string;line:number;mediaPaths:string[];remoteImages:string[];importMedia?:Array<{path:string;role:'question'|'answer'|'explanation';blob:Blob;name:string}>}
export interface ParsedCardFile {namespace:string;title:string;cards:ParsedKnowledgeCard[];warnings:string[]}
/** 独立于知识主题的卡片目录；parentUid只引用同账号目录，deleted不表示删除卡片。 */
export interface CardDirectory {uid:string;version:number;name:string;parentUid:string|null;deleted:boolean;syncStatus?:string}
export type CardStore='card_directories'|'knowledge_cards'|'card_schedules'|'card_review_events'|'card_review_retractions'|'card_review_sessions'|'card_review_preferences'|'card_import_sources'|'card_attachment_references'|'card_sync_state'|'outbox'|'conflicts'
/** 回调只等待该事务自己的数据库请求；不能等待网络或WebCrypto。 */
export interface CardTransaction {
 get<T=Record<string,unknown>>(store:CardStore,key:string):Promise<T|undefined>
 list<T=Record<string,unknown>>(store:CardStore):Promise<T[]>
 put(store:CardStore,value:unknown):Promise<void>
 delete(store:CardStore,key:string):Promise<void>
}
export interface CardStoragePort {transaction<T>(mode:'readonly'|'readwrite',action:(tx:CardTransaction)=>Promise<T>):Promise<T>}
export interface CardRepositoryContext {
 scope():string;localOnly():boolean;deviceId():string;now?():string;uuid?():string
 /** 宿主可用完整知识镜像计算来源状态；缺失缓存应返回undefined而非missing。 */
 sourceState?(uid:string,version:number):CardSourceState|undefined
 sourceProjection?(uid:string):{version:number;deleted?:boolean;areaUid?:string|null;primaryTopicUid?:string|null}|undefined
 /** 在事务外把媒体转为可持久化资源；返回引用计划，随后与卡片同事务保存。 */
 prepareImportMedia?(card:ParsedKnowledgeCard,cardUid:string):Promise<Array<Record<string,unknown>>>
}
export interface CardFilter {areaUid?:string|null;topicUid?:string|null;topicUids?:string[];q?:string;status?:CardStatus;includeDeleted?:boolean}
export interface SaveCardInput extends Partial<KnowledgeCard> {question:string;answer:string;editPolicy?:'reset'|'preserve';command?:'save'|'move_directory'|'confirm_source'|'detach_source'|'reset_learning'|'restore';expectedSourceVersion?:number}
export interface CardSummary {total:number;due:number;newCards:number;pending:number;pendingOperations:number;activeSession:CardReviewSession|null;preferences:CardReviewPreferences;completedToday:number}
export interface CardImportPreviewItem {card:ParsedKnowledgeCard;contentHash:string;existing?:KnowledgeCard;mapping?:CardImportSource;status:'new'|'unchanged'|'update'|'conflict'|'deleted';conflictingFields:string[];merged:CardImportContent}
export interface CardImportPreview {uid:string;scope:string;items:CardImportPreviewItem[];createdAt:string}
export interface CardImportOptions {areaUid?:string|null;topicUid?:string|null;activate?:boolean;preserveProgress?:boolean;selectedKeys?:string[];resolve?:Record<string,'incoming'|'local'|'skip'|'restore'>}
export interface CardImportResult {saved:number;skipped:number;unchanged:number;cardUids:string[]}
export interface KnowledgeCardRepository {
 listDirectories():Promise<CardDirectory[]>;saveDirectory(value:{uid?:string;name:string;parentUid?:string|null}):Promise<CardDirectory>;migrateDirectories(topics:Array<{uid:string;name:string;parentUid?:string|null}>):Promise<void>

 list(filter?:CardFilter):Promise<KnowledgeCard[]>;get(uid:string):Promise<KnowledgeCard|undefined>;saveCard(value:SaveCardInput):Promise<KnowledgeCard>;changeStatus(uid:string,status:CardStatus|'deleted'|'restore'):Promise<KnowledgeCard>
 getSchedule(uid:string):Promise<CardSchedule|undefined>;getSummary(filter?:CardFilter):Promise<CardSummary>;getPreferences():Promise<CardReviewPreferences>;savePreferences(value:Partial<CardReviewPreferences>):Promise<CardReviewPreferences>
 createSession(options?:{mode?:CardReviewMode;areaUid?:string|null;topicUid?:string|null;topicUids?:string[];append?:number}):Promise<CardReviewSession>;getSession(uid:string):Promise<CardReviewSession|undefined>;listSessions():Promise<CardReviewSession[]>;listReviewEvents(sessionUid?:string):Promise<CardReviewEvent[]>;resumeAsNewSession(uid:string):Promise<CardReviewSession>
 reveal(sessionUid:string):Promise<CardReviewSession>;rate(sessionUid:string,rating:CardRating):Promise<CardReviewEvent>;skip(sessionUid:string):Promise<CardReviewSession>;retract(sessionUid:string):Promise<CardReviewSession>;interrupt(sessionUid:string):Promise<CardReviewSession>
 previewImport(cards:ParsedKnowledgeCard[]):Promise<CardImportPreview>;importCards(preview:CardImportPreview,options?:CardImportOptions):Promise<CardImportResult>
 listConflicts():Promise<Array<Record<string,any>>>;resolveConflict(conflictId:string,choice:'server'|'copy'|'merge',input?:SaveCardInput):Promise<void>
 applyRemote(type:string,value:Record<string,unknown>):Promise<void>;applyPushResult(operationId:string,result:Record<string,unknown>):Promise<void>
}
