import { Kysely } from '../deps.ts'
import { DB } from '../lib/service.ts'

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .alterTable('track')
    .addColumn('audio_metadata', 'jsonb')
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.alterTable('track').dropColumn('audio_metadata').execute()
}
