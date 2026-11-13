import {clearKnowledgeArchives} from './knowledgeStartup'
import {clearLogCaptureScope} from './logCaptureJournal'
import {aiLocalScope} from './aiClientConfig'
/** 重置旋转业务世代，使旧讨论、恢复镜像与排队操作不可再成为当前数据；凭据作用域不变。 */
const generationKey=()=>`note-flow-ai-data-generation:${aiLocalScope()}`
export function aiDataScope(){const generation=typeof localStorage==='undefined'?null:localStorage.getItem(generationKey());return aiLocalScope()+(generation?`:reset:${generation}`:'')}
if(typeof window!=='undefined')window.addEventListener('note-flow:account-data-reset',event=>{if((event as CustomEvent).detail?.localOnly)return;const previous=aiDataScope(),importScope=JSON.stringify([aiLocalScope(),previous]);void clearKnowledgeArchives(importScope).catch(()=>undefined);void clearLogCaptureScope(previous).catch(()=>undefined);localStorage.removeItem(`note-flow-ai-local:v1:${previous}`);localStorage.removeItem(`note-flow-ai-local:v1:${previous}:recovery`);localStorage.setItem(generationKey(),crypto.randomUUID())})
