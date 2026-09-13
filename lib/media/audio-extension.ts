// MediaRecorder's actual mime type varies by browser (Chrome/Firefox default
// to audio/webm;codecs=opus, Safari to audio/mp4) — this picks a storage
// file extension from whatever it reports, defaulting to webm for an
// unrecognised or missing type.
export function extensionForAudioMime(mimeType: string): string {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  switch (type) {
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/webm':
    default:
      return 'webm'
  }
}
