import { Kysely } from '../deps.ts'
import { DB } from '../lib/service.ts'

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .alterTable('project')
    .addColumn('guest_edit_key', 'text')
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.alterTable('project').dropColumn('guest_edit_key').execute()
}
