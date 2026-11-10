import {clearKnowledgeArchives} from './knowledgeStartup'
import {clearLogCaptureScope} from './logCaptureJournal'
import {clearConsolidationDrafts} from './consolidationDraft'
import {aiLocalScope} from './aiClientConfig'
/** A reset invalidates old discussions, drafts and queued actions without moving credentials. */
const generationKey=()=>`note-flow-ai-data-generation:${aiLocalScope()}`
export function aiDataScope(){const generation=typeof localStorage==='undefined'?null:localStorage.getItem(generationKey());return aiLocalScope()+(generation?`:reset:${generation}`:'')}
if(typeof window!=='undefined')window.addEventListener('note-flow:account-data-reset',event=>{if((event as CustomEvent).detail?.localOnly)return;const previous=aiDataScope(),importScope=JSON.stringify([aiLocalScope(),previous]);void clearKnowledgeArchives(importScope).catch(()=>undefined);void import('./learningWorkspaceStore').then(({clearWorkspacePlans})=>clearWorkspacePlans(previous)).catch(()=>undefined);void clearConsolidationDrafts(previous).catch(()=>undefined);void clearLogCaptureScope(previous).catch(()=>undefined);localStorage.removeItem(`note-flow-ai-local:v1:${previous}`);localStorage.removeItem(`note-flow-ai-local:v1:${previous}:recovery`);localStorage.setItem(generationKey(),crypto.randomUUID())})
