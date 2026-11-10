/** Build-selected capabilities; no private implementation is imported here. */
export const isCommunityEdition = import.meta.env.VITE_NOTE_FLOW_EDITION === 'community'
export const remoteServicesAvailable = !isCommunityEdition

/** 知识库、卡片及复习仅在高级版开放；共享阅读组件和历史备份不受此开关影响。 */
export const knowledgeAvailable = !isCommunityEdition
