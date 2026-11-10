export interface FocusIdentity {uid:string;deleted?:boolean;version?:number;updatedAt?:string}
/** Resolve repeated receipts before filtering; a tombstone must participate. */
export function uniqueFocusRecords<T extends FocusIdentity>(rows:readonly T[]):T[]{
 const records=new Map<string,T>()
 for(const row of rows){
  if(!row?.uid)continue
  const previous=records.get(row.uid)
  if(previous){
   const oldVersion=Number(previous.version),newVersion=Number(row.version)
   if(Number.isFinite(oldVersion)&&Number.isFinite(newVersion)&&oldVersion!==newVersion){if(newVersion>oldVersion)records.set(row.uid,row);continue}
   const oldTime=Date.parse(previous.updatedAt||''),newTime=Date.parse(row.updatedAt||'')
   if(Number.isFinite(oldTime)&&Number.isFinite(newTime)&&oldTime!==newTime){if(newTime>oldTime)records.set(row.uid,row);continue}
   if(previous.deleted&&!row.deleted)continue
  }
  records.set(row.uid,row)
 }
 return [...records.values()]
}
