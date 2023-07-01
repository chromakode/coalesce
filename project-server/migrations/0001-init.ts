import { Kysely, sql } from '../deps.ts'
import { DB } from '../service.ts'

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable('project')
    .addColumn('project_id', 'text', (col) => col.primaryKey())
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn('title', 'text')
    .addColumn('hidden', 'boolean')
    .execute()

  await db.schema
    .createTable('track')
    .addColumn('track_id', 'text', (col) => col.primaryKey())
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn('original_filename', 'text')
    .addColumn('label', 'text')
    .execute()

  await db.schema
    .createTable('project_tracks')
    .addColumn('project_id', 'text', (col) =>
      col.references('project.project_id').onDelete('cascade').notNull(),
    )
    .addColumn('track_id', 'text', (col) =>
      col.references('track.track_id').onDelete('cascade').notNull(),
    )
    .addPrimaryKeyConstraint('project_tracks_pk', ['project_id', 'track_id'])
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  for (const tableName of ['project', 'track', 'project_tracks']) {
    await db.schema.dropTable(tableName).cascade().execute()
  }
}
