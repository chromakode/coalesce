import { ChakraProvider } from '@chakra-ui/react'
import '@fontsource-variable/roboto-flex/full.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import { APIContext } from './components/APIContext'
import './index.css'
import { CoalesceAPIClient } from './lib/api'
import theme from './theme'

const url = new URL(window.location.toString())
const apiClient = new CoalesceAPIClient({
  guestKey: url.searchParams.get('guestEditKey') ?? undefined,
})

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <APIContext.Provider value={apiClient}>
      <ChakraProvider theme={theme}>
        <App />
      </ChakraProvider>
    </APIContext.Provider>
  </React.StrictMode>,
)
