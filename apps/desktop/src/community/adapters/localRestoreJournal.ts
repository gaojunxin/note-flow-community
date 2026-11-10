/** Community restores publish a new workspace only after import succeeds.
 * They have no official SQLite sync mirror or interrupted-restore journal. */
export async function readRestoreJournal(_profileId:string):Promise<'none'|'pending'|'damaged'>{return 'none' as const}
