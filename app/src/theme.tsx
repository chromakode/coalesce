import { extendTheme } from '@chakra-ui/react'

const theme = extendTheme({
  fonts: {
    body: 'Roboto Flex Variable',
    heading: 'Roboto Flex Variable',
  },
  colors: {
    brand: {
      dark: '#0e4085',
      light: '#f6f8fa',
    },
  },
})

export default theme
