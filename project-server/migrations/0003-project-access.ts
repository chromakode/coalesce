import { USER_ROLE } from '@shared/constants'
import { Kysely, sql } from '../deps.ts'
import { DB } from '../lib/service.ts'

export async function up(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createType('user_role')
    .asEnum(Object.values(USER_ROLE))
    .execute()

  await db.schema
    .createTable('project_users')
    .addColumn('project_id', 'text', (col) =>
      col.references('project.project_id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'text')
    .addColumn('role', sql`user_role`, (col) => col.notNull())
    .addPrimaryKeyConstraint('project_users_pk', ['project_id', 'user_id'])
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropType('user_role')
  await db.schema.dropTable('project_users').cascade().execute()
}
