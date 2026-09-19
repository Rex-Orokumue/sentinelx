import type { Endpoint } from '../define-endpoint'
import { configEndpoint } from './config'

// Single source of truth for the OpenAPI document. Append each new endpoint here.
export const ALL_ENDPOINTS: Endpoint[] = [configEndpoint]
