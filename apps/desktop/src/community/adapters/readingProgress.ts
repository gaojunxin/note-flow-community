import {createLocalReadingProgress} from '../../../../../packages/core/src/asyncReadingProgress'
import {createReadingProgressStore} from '../../services/readingProgressStorage'
export {clearReadingProgress} from '../../services/readingProgressStorage'
/** 社区版保留本机异步阅读位置，不装配云端回执或请求。 */
export function readingProgress(ownerId:string){return createLocalReadingProgress(createReadingProgressStore(ownerId))}
