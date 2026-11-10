import {createLocalEntityRepository} from '@note-flow/core/community'
import type {CoreContext,LocalReadHost,LocalTransactionHost} from '@note-flow/core/contracts'
/** 社区画布仅提供基础本地仓储，不包含知识图谱算法。 */
export function createCommunityCanvases(host:LocalReadHost&LocalTransactionHost,context:CoreContext){return createLocalEntityRepository(host,context,'canvas')}
