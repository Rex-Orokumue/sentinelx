import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { RegistrationFieldsPanel } from '@/components/admin/RegistrationFieldsPanel'

export const metadata: Metadata = { title: 'Game Designer · Admin · SentinelX' }

export default async function GameDesignerPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: game } = await supabase.from('games').select('id, name, category, active').eq('id', params.id).maybeSingle()
  if (!game) notFound()

  const { data: fieldRows } = await supabase
    .from('game_registration_fields')
    .select('id, field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket, active')
    .eq('game_id', game.id)
    .eq('active', true)
    .order('seq')

  const fields = (fieldRows ?? []).map((f) => ({
    id: f.id,
    fieldKey: f.field_key,
    label: f.label,
    placeholder: f.placeholder,
    inputType: f.input_type as 'text' | 'number' | 'url',
    required: f.required,
    validationPattern: f.validation_pattern,
    validationMessage: f.validation_message,
    showOnBracket: f.show_on_bracket,
  }))

  return (
    <section className="max-w-2xl space-y-8">
      <Link href="/admin/games" className="text-sm text-violet-400 hover:text-violet-300">
        ← Games
      </Link>
      <h2 className="text-base font-bold text-white">{game.name} <span className="font-normal text-slate-500">— {game.category} · {game.active ? 'Active' : 'Inactive'}</span></h2>

      <RegistrationFieldsPanel gameId={game.id} fields={fields} />
    </section>
  )
}
