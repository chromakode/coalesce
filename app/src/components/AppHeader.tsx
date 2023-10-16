import {
  Button,
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
        {session && (
          <HStack>
            <Button as="a" href="/auth/settings" variant="ghost">
              {session.email}
            </Button>
            <Button as="a" href={session.logoutURL} variant="ghost">
              Logout
            </Button>
          </HStack>
        )}
      </HStack>
    </Container>
  )
}
