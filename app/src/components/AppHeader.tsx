import {
  Button,
  Link as ChakraLink,
  Container,
  HStack,
  Icon,
  Spacer,
} from '@chakra-ui/react'
import LogoType from '@shared/assets/logotype.svg?react'
import { Link } from 'wouter'
import { useSession } from './SessionContext'

const { VITE_AUTH_BASE } = import.meta.env

export function AppHeader() {
  const session = useSession()

  return (
    <Container maxW="full">
      <HStack w="full" flexShrink="0">
        <Link href="/home">
          <ChakraLink
            display="flex"
            alignSelf="flex-start"
            ml="calc(clamp(0rem, 100vw - 1040px, .5rem))"
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
            <Button as="a" href={`${VITE_AUTH_BASE}/settings`} variant="ghost">
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
