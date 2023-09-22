import { ory } from '../deps.ts'
import { APP_ORIGIN } from '../env.ts'
import { initOryAdmin } from '../service.ts'

const [email, password] = Deno.args
if (!email) {
  console.log('Usage: createUser <email> [password?]')
  Deno.exit(1)
}

const authAdmin = initOryAdmin()

let identity: ory.Identity

try {
  const resp = await authAdmin.createIdentity({
    createIdentityBody: {
      schema_id: 'default',
      traits: {
        email,
      },
      credentials: password
        ? {
            password: { config: { password } },
          }
        : undefined,
    },
  })
  identity = resp.data
} catch (err) {
  if (err?.response?.data.error.code === 409) {
    console.log('User', email, 'already exists')
    const resp = await authAdmin.listIdentities({
      credentialsIdentifier: email,
    })
    identity = resp.data[0]
  } else {
    console.error(err?.response?.data ?? err)
    Deno.exit(1)
  }
}

try {
  const { data: recovery } = await authAdmin.createRecoveryLinkForIdentity({
    createRecoveryLinkForIdentityBody: {
      expires_in: '168h',
      identity_id: identity.id,
    },
  })
  console.log(
    `${recovery.recovery_link}&return_to=${encodeURIComponent(APP_ORIGIN)}`,
  )
} catch (err) {
  console.error(err?.response?.data ?? err)
  Deno.exit(1)
}
