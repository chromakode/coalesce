import { Kysely, sql } from '../deps.ts'
import { DB } from '../service.ts'

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .alterTable('project_tracks')
    .addColumn('color', 'text')
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.alterTable('project_tracks').dropColumn('color').execute()
}
