import { Text } from '@chakra-ui/react'
import prettyMilliseconds from 'pretty-ms'
import { useEffect, useState } from 'react'

export function DisplayMS({ ms }: { ms: number }) {
  return (
    <Text
      color="gray.700"
      fontWeight="medium"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {prettyMilliseconds(Math.round(ms / 1000) * 1000, {
        colonNotation: true,
      })}
    </Text>
  )
}
export function DisplaySinceMS({
  start,
  since,
}: {
  start: number
  since: number
}) {
  const [ms, setMS] = useState(start + (Date.now() - since))

  useEffect(() => {
    let timeout = 0

    function tick() {
      const now = Date.now()
      setMS(start + (now - since))
      timeout = window.setTimeout(tick, Math.max(50, 1000 - (now % 1000)))
    }
    tick()

    return () => {
      clearTimeout(timeout)
    }
  }, [start, since])

  return <DisplayMS ms={ms} />
}
