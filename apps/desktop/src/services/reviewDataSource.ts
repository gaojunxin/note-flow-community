import {isCommunityEdition} from './clientCapabilities'
import {readAccountSetting} from './accountStorage'
import api from './api'
import { createPcNotesService } from './notes'
import { tasksService } from './tasks'
import { workspaceService } from './workspace'
import { localFocusService, type FocusSession } from './localPersonal'
import { isDesktopClient } from './serverConfig'
import { createReviewDataLoader } from './reviewData'

const userId = () => {
  try { return String(JSON.parse(readAccountSetting('note-flow-pc-user') || 'null')?.userId || '') }
  catch { return '' }
}

export const loadReviewData = createReviewDataLoader({
  tasks: () => tasksService.list(),
  notes: () => createPcNotesService(userId()).list(),
  projects: async areaUid => (await workspaceService.projects(areaUid, true)).map(project => ({ uid:project.uid, areaUid:project.areaUid })),
  logs: projectUid => workspaceService.logs(projectUid),
  focuses: async (from, to) => {
    if (isCommunityEdition || isDesktopClient()) return localFocusService.list(from, to)
    const response = await api.get<{ data: FocusSession[] }>('/focus/sessions', { params:{ from, to } })
    return response.data.data || []
  }
})
