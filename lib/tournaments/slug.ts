// URL-safe slug from a title. Used for every public tournament URL, so it must
// be lowercase and contain only [a-z0-9-].
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (combining marks)
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric runs → single hyphen
    .replace(/-+/g, '-') // collapse
    .replace(/^-|-$/g, '') // trim leading/trailing hyphens
}
