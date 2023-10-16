import {
  Link as ChakraLink,
  Container,
  HStack,
  Icon,
  Spacer,
} from '@chakra-ui/react'
import { Link } from 'wouter'
import LogoType from '../logotype.svg?react'
import { useSession } from './SessionContext'

export function AppHeader() {
  const session = useSession()
  if (!session) {
    return null
  }

  return (
    <Container maxW="full">
      <HStack w="full" flexShrink="0">
        <Link href="/">
          <ChakraLink
            display="flex"
            alignSelf="flex-start"
            paddingX="4"
            paddingY="3"
            borderBottomLeftRadius="md"
            borderBottomRightRadius="md"
            bgColor="brand.dark"
            cursor="pointer"
          >
            <Icon as={LogoType} h="6" w="auto" color="brand.light" />
          </ChakraLink>
        </Link>
        <Spacer />
        <HStack gap="4" pr="2">
          <ChakraLink href="/auth/settings">{session.email}</ChakraLink>
          <ChakraLink href={session.logoutURL} fontWeight="medium">
            logout
          </ChakraLink>
        </HStack>
      </HStack>
    </Container>
  )
}
