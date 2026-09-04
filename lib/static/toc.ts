export type TocEntry = { id: string; title: string }

/**
 * Turn a section heading into a stable URL anchor. Pages pass EXPLICIT ids to
 * LegalDocShell (a translated heading must never shift an anchor), so this
 * helper is for authoring those id lists — it is not run on request-time
 * translated strings.
 */
export function slugifySection(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/^\s*\d+[.)]\s*/, '') // drop a leading "1. " / "1) "
    .toLowerCase()
    .replace(/['’]/g, '') // fold apostrophes rather than turning them into separators
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildToc(sections: { id: string; title: string }[]): TocEntry[] {
  return sections.map(({ id, title }) => ({ id, title }))
}
