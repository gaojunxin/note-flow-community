import {createLocalEntityRepository, createCommunityTasks, createLocalOnlyProvider} from '@note-flow/core/community'
import {createCommunityStorage} from './platformStorage'
import type {CoreContext} from '@note-flow/core/contracts'

export const COMMUNITY_PROFILE_KEY = 'note-flow-community-profile-v1'
export const COMMUNITY_DB_NAME = 'note-flow-community-workspace-v1'

export function createCommunityWorkspace(profileId: string, host = createCommunityStorage(COMMUNITY_DB_NAME)) {
  const context: CoreContext = {profileId, storageSchemaVersion: 1}
  const provider = createLocalOnlyProvider()
  const repository = (entityType: string) => createLocalEntityRepository(host, context, entityType)
  return {host, context, provider, initialize: () => provider.initialize(context), notes: repository('note'), tasks: createCommunityTasks(host, context),
    projects: repository('project'), areas: repository('area'), folders: repository('folder'), tags: repository('tag'), taskLists: repository('task_list'), attachments: repository('attachment'),
    async dispose() {await provider.dispose(); await host.close()},
  }
}
