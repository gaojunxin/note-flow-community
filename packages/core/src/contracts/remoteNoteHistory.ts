export interface RemoteHistorySummary {uid:string;revision:number;title:string;createdAt:string}
export interface RemoteHistoryDetail extends RemoteHistorySummary {content:string}
export interface RemoteHistoryPage {items:RemoteHistorySummary[];nextBeforeRevision:number|null;hasMore:boolean}
