import { ChakraProvider } from '@chakra-ui/react'
import '@fontsource-variable/roboto-flex/full.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import './index.css'
import theme from './theme'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <App />
    </ChakraProvider>
  </React.StrictMode>,
)
