import { clsx, type ClassValue } from 'clsx'

// cn() merges Tailwind classes. clsx handles conditionals; tailwind-merge
// deduplication is added back when shadcn components need it.
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
