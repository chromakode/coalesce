import { Text } from '@chakra-ui/react'
import prettyMilliseconds from 'pretty-ms'

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
