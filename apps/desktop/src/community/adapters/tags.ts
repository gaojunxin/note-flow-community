import type {LocalEntity} from '@note-flow/core/community'
import {createEntity, listEntities, removeEntity, updateEntity} from '../runtime'
export interface TagEntity extends LocalEntity {id: number; uid: string; name: string; color?: string; version: number; deleted?: boolean; syncStatus?: string}
export const tagsService = {
  list: () => listEntities<TagEntity>('tag'),
  create: (name: string) => {if (!name.trim()) throw new Error('标签名称不能为空'); return createEntity<TagEntity>('tag', {name: name.trim(), color: '#2F7D5B'})},
  update: (tag: TagEntity, name: string) => {if (!name.trim()) throw new Error('标签名称不能为空'); return updateEntity('tag', tag, {name: name.trim()})},
  remove: (tag: TagEntity) => removeEntity('tag', tag),
}

export const localAiTags=()=>tagsService.list()
