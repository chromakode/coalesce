import { Buffer as NodeBuffer } from 'node:buffer'
import { awarenessProtocol, Y, streams } from '../deps.ts'
import { redisClient, minioClient, minioBucket } from './main.ts'
import { storePath } from '../lib/constants.ts'
import { fromNodeStream, generateId } from '../lib/utils.ts'

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

  for await (const entry of fromNodeStream(
    minioClient.listObjects(
      minioBucket,
      storePath.projectDocPath(projectId, ''),
    ),
  )) {
    try {
      const resp = await minioClient.getObject(minioBucket, entry.key)
      const ab = await streams.toArrayBuffer(fromNodeStream(resp))
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
    try {
      Y.applyUpdateV2(mergeDoc, version)
    } catch (err) {
      // TODO remove after projects migrated
      console.warn('Error loading doc', err)
      Y.applyUpdate(mergeDoc, version)
    }
  }

  const mergeData = Y.encodeStateAsUpdateV2(mergeDoc)

  await minioClient.putObject(
    minioBucket,
    storePath.projectDocPath(projectId, generateId()),
    NodeBuffer.from(mergeData),
  )

  for (const seenKey of seenKeys) {
    try {
      await minioClient.removeObject(minioBucket, seenKey)
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
    minioBucket,
    storePath.projectDocPath(projectId, generateId()),
    NodeBuffer.from(data),
  )
}
