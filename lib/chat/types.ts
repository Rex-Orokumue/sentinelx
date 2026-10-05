export type ChatRole = 'user' | 'assistant'
export interface ChatMessage { role: ChatRole; content: string }
export type ChatLocale = 'en' | 'fr' | 'pcm'
export const CHAT_LOCALES: readonly ChatLocale[] = ['en', 'fr', 'pcm']
export const DESTINATIONS = ['tournaments', 'matches', 'wallet', 'profile', 'notifications', 'rules', 'safety', 'help'] as const
export type Destination = (typeof DESTINATIONS)[number]
export type ChatEvent =
  | { t: 'status'; state: 'checking_account' }
  | { t: 'delta'; text: string }
  | { t: 'actions'; items: Destination[] }
  | { t: 'done'; persisted: boolean }
  | { t: 'error'; code: 'chat_upstream' | 'chat_truncated' | 'internal' }
