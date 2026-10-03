// FormData -> profileEditSchema input for the Settings Server Action.
//
// Lives outside actions.ts because a 'use server' file may only export async functions.
// Hand-mapped on purpose: a field this function forgets to read is dropped silently and the
// default wins, so it is covered by a test that builds a real FormData.
export function parseProfileEditFormData(formData: FormData) {
  const gameInterests = formData.getAll('gameInterests').map(String)
  const consent = formData.get('consentWhatsappUpdates')

  return {
    displayName: String(formData.get('displayName') ?? ''),
    username: String(formData.get('username') ?? ''),
    whatsapp: String(formData.get('whatsapp') ?? ''),
    country: String(formData.get('country') ?? ''),
    bio: String(formData.get('bio') ?? ''),
    // Absent key = leave unchanged (the schema's optional fields), which is also what a
    // client that predates these inputs sends. A present key is always an explicit choice.
    ...(gameInterests.length > 0 ? { gameInterests } : {}),
    ...(consent === 'true' || consent === 'false' ? { consentWhatsappUpdates: consent === 'true' } : {}),
  }
}
