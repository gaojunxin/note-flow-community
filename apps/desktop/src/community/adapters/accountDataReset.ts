export interface AccountResetPreview { cards:number;cardReviewEvents:number;notes:number;tasks:number;taskLists:number;canvases:number;projects:number;areas:number;projectLogs:number;journalSeries:number;knowledge:number;knowledgeTopics:number;knowledgeRelations:number;folders:number;tags:number;noteTemplates:number;focusSessions:number;focusSettings:number;importBatches:number;importRecords:number;attachments:number;attachmentBytes:number;recordings:number;syncOperations:number;activeDevices:number;cloudVault:boolean;aiCredentials:boolean;learningSessions:number;learningResults:number;notifications:number }
export interface AccountResetResult { operationId:string;status:string;effectiveSyncEpoch:string;removed:Record<string,number>;filesScheduled:number }

const unavailable = async (): Promise<never> => {throw new Error('社区版没有云端账号数据，云端重置不可用；本地数据保持保留')}
export const accountDataResetService = {
 preview: (): Promise<AccountResetPreview> => unavailable(),
 challenge: (_password: string): Promise<{challengeToken: string; expiresAt: string}> => unavailable(),
 reset: (_input: unknown, _idempotencyKey?: string): Promise<AccountResetResult> => unavailable(),
 resetAndWait: (_input: unknown, _idempotencyKey: string, _onStatus?: (message: string) => void): Promise<AccountResetResult> => unavailable(),
 recover: (_idempotencyKey: string, _onStatus?: (message: string) => void): Promise<AccountResetResult> => unavailable(),
 operation: (_operationId: string): Promise<AccountResetResult> => unavailable(),
 byIdempotency: (_idempotencyKey: string): Promise<AccountResetResult> => unavailable(),
}
