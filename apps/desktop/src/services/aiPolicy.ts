import type { AiPolicy } from '@note-flow/core'
export const effectiveAiPolicy=(value:{aiPolicy?:AiPolicy}|null|undefined):AiPolicy=>value?.aiPolicy||'normal'
export const canUseAi=(value:{aiPolicy?:AiPolicy}|null|undefined)=>effectiveAiPolicy(value)!=='excluded'
