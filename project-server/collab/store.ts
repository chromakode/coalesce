import { Buffer as NodeBuffer } from 'node:buffer'
import { awarenessProtocol, Y } from '../deps.ts'
import { redisClient, minioClient } from './main.ts'
import { storePath } from '../lib/constants.ts'
import { generateId } from '../lib/utils.ts'

export async function getAwarenessData(
  projectId: string,
): Promise<Uint8Array | null> {
  return (await redisClient.sendCommand(
    'GET',
    [`project:${projectId}.awareness`],
    { returnUint8Arrays: true },
  )) as Uint8Array
}

export async function saveAwarenessData(projectId: string, data: Uint8Array) {
  await redisClient.setex(
    `project:${projectId}.awareness`,
    awarenessProtocol.outdatedTimeout,
    NodeBuffer.from(data),
  )
}

export async function coalesceCollabDoc(
  projectId: string,
): Promise<Uint8Array | null> {
  // Merging fetcher to allow lock-free persistince.
  //
  // Minio guarantees strict list-after-write behavior:
  // https://github.com/minio/minio/blob/master/docs/distributed/README.md#consistency-guarantees
  //
  // To get the latest version of the doc:
  // 1. Fetch all versions in the bucket and merge together
  // 2. Write new merged version
  // 3. Delete seen old versions
  const seenKeys = []
  const versions = []

  for await (const entry of minioClient.listObjects({
    prefix: storePath.projectDocPath(projectId, ''),
  })) {
    try {
      const resp = await minioClient.getObject(entry.key)
      const ab = await resp.arrayBuffer()
      versions.push(new Uint8Array(ab))
      seenKeys.push(entry.key)
    } catch (err) {
      console.warn('Error fetching collab doc version', entry.key, err)
      continue
    }
  }

  if (versions.length === 0) {
    return null
  } else if (versions.length === 1) {
    // If only one version exists, no need to merge.
    return versions[0]
  }

  const mergeDoc = new Y.Doc({ gc: true })
  for (const version of versions) {
    Y.applyUpdate(mergeDoc, version)
  }

  const mergeData = Y.encodeStateAsUpdate(mergeDoc)

  await minioClient.putObject(
    storePath.projectDocPath(projectId, generateId()),
    mergeData,
  )

  for (const seenKey of seenKeys) {
    try {
      await minioClient.deleteObject(seenKey)
    } catch (err) {
      console.warn('Error deleting collab doc version', seenKey, err)
      continue
    }
  }

  return mergeData
}

export async function saveCollabDoc(projectId: string, data: Uint8Array) {
  // Store the doc w/ a random version id
  await minioClient.putObject(
    storePath.projectDocPath(projectId, generateId()),
    data,
  )

  // Merge existing versions together
  coalesceCollabDoc(projectId)
}
