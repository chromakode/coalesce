import { sql, keyBy } from '../deps.ts'
import { ProjectInfo, TrackInfo } from '@shared/types'
import { initPostgres } from './service.ts'

export const db = await initPostgres()

export async function getBatchTrackInfo(
  projectId: string,
  trackIds: string[],
): Promise<Record<string, TrackInfo>> {
  const results = await db
    .selectFrom('track')
    .innerJoin('projectTracks', 'projectTracks.trackId', 'track.trackId')
    .where('projectTracks.projectId', '=', projectId)
    .where('track.trackId', 'in', trackIds)
    .select([
      'track.trackId',
      'track.createdAt',
      'track.label',
      'track.originalFilename',
      'track.audioMetadata',
      'projectTracks.color',
    ])
    .execute()
  return keyBy(results, 'trackId')
}

export async function getTrackInfo(
  projectId: string,
  trackId: string,
): Promise<TrackInfo> {
  const infos = await getBatchTrackInfo(projectId, [trackId])
  return infos[trackId]
}

function projectQuery() {
  return db.selectFrom('project').select(({ selectFrom }) => [
    'project.projectId',
    'project.createdAt',
    'project.title',
    'project.hidden',
    'project.guestEditKey',
    sql<Record<string, TrackInfo>>`(select coalesce(json_object_agg(
      ${sql.id('info', 'trackId')}, row_to_json(info)
    ), '{}') from ${selectFrom('track')
      .innerJoin('projectTracks', (join) =>
        join
          .onRef('track.trackId', '=', 'projectTracks.trackId')
          .onRef('project.projectId', '=', 'projectTracks.projectId'),
      )
      .select([
        'track.trackId',
        'track.createdAt',
        'track.label',
        'track.originalFilename',
        'track.audioMetadata',
        'projectTracks.color',
      ])
      .as('info')})`.as('tracks'),
  ])
}

export async function getProjectInfo(projectId: string): Promise<ProjectInfo> {
  return await projectQuery()
    .where('project.projectId', '=', projectId)
    .executeTakeFirstOrThrow()
}

export async function listProjects(userId: string): Promise<ProjectInfo[]> {
  return await projectQuery()
    .innerJoin('projectUsers', 'projectUsers.projectId', 'project.projectId')
    .where('projectUsers.userId', '=', userId)
    .execute()
}
