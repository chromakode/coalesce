import { createContext, useContext } from 'react'
import { CoalesceAPIClient } from '../lib/api'

export const APIContext = createContext(new CoalesceAPIClient())
export const useAPI = () => useContext(APIContext)
