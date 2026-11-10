import type { ProjectEntity, ProjectLogEntity } from './workspace'

export const logsViewCache: {
  projects: ProjectEntity[]
  oldLogs: ProjectLogEntity[]
  loadedAt: number
} = {
  projects: [],
  oldLogs: [],
  loadedAt: 0,
}
