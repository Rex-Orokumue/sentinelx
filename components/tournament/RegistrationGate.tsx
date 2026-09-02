'use client'
import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

type Mode = 'register' | 'waitlist'
type Step = 'idle' | 'confirm' | 'rules'

// Replaces the plain submit button + "I agree to the rules" checkbox on the
// register / waitlist forms. Flow:
//   1. Confirm modal — "Register for the {game} tournament — {title}?"
//   2. Rules modal (only if there are rules) — one rule at a time, accept each.
// Once cleared it drops a hidden `agreedToRules=true` input into the form and
// submits it programmatically. The server still re-checks agreedToRules — this
// is a UX layer, not a trust boundary.
export function RegistrationGate({
  mode,
  gameName,
  tournamentTitle,
  rules,
  actionLabel,
  pendingLabel,
}: {
  mode: Mode
  gameName: string
  tournamentTitle: string
  rules: string[]
  actionLabel: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()
  const [step, setStep] = useState<Step>('idle')
  const [ruleIdx, setRuleIdx] = useState(0)
  // A monotonic token rather than a boolean, so a retry after a server error
  // re-fires the submit effect.
  const [submitToken, setSubmitToken] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (submitToken > 0) triggerRef.current?.form?.requestSubmit()
  }, [submitToken])

  const hasRules = rules.length > 0
  const verb = mode === 'waitlist' ? 'Join the waitlist for' : 'Register for'

  function openGate() {
    const form = triggerRef.current?.form
    if (form && !form.reportValidity()) return // surface native field errors first
    setRuleIdx(0)
    setStep('confirm')
  }
  function confirmYes() {
    if (hasRules) setStep('rules')
    else finish()
  }
  function acceptRule() {
    if (ruleIdx + 1 < rules.length) setRuleIdx(ruleIdx + 1)
    else finish()
  }
  function finish() {
    setStep('idle')
    setSubmitToken((t) => t + 1)
  }

  return (
    <>
      {submitToken > 0 && <input type="hidden" name="agreedToRules" value="true" />}

      <button
        ref={triggerRef}
        type="button"
        onClick={openGate}
        disabled={pending}
        className="w-full rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
      >
        {pending ? pendingLabel : actionLabel}
      </button>

      {step === 'confirm' && (
        <Modal title="Confirm" onClose={() => setStep('idle')}>
          <p className="text-sm leading-relaxed text-slate-300">
            {verb} the <span className="font-bold text-white">{gameName}</span> tournament —{' '}
            <span className="font-bold text-white">{tournamentTitle}</span>?
          </p>
          {hasRules && (
            <p className="mt-2 text-xs text-slate-500">
              Next you&apos;ll review the {rules.length} tournament rule{rules.length === 1 ? '' : 's'} and
              accept each one.
            </p>
          )}
          <ModalActions>
            <SecondaryButton onClick={() => setStep('idle')}>Cancel</SecondaryButton>
            <PrimaryButton onClick={confirmYes}>
              {hasRules
                ? 'Yes — review the rules'
                : mode === 'waitlist'
                  ? 'Yes, join the waitlist'
                  : 'Yes, continue'}
            </PrimaryButton>
          </ModalActions>
        </Modal>
      )}

      {step === 'rules' && (
        <Modal title={`Rule ${ruleIdx + 1} of ${rules.length}`} onClose={() => setStep('idle')}>
          <div className="max-h-[45vh] overflow-y-auto text-sm leading-relaxed text-slate-200 [&_a]:text-violet-400 [&_a]:underline [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-white [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown>{rules[ruleIdx]}</ReactMarkdown>
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded bg-slate-800">
            <div
              className="h-full rounded bg-violet-500 transition-all"
              style={{ width: `${((ruleIdx + 1) / rules.length) * 100}%` }}
            />
          </div>
          <ModalActions>
            {ruleIdx > 0 ? (
              <SecondaryButton onClick={() => setRuleIdx(ruleIdx - 1)}>← Back</SecondaryButton>
            ) : (
              <SecondaryButton onClick={() => setStep('idle')}>Cancel</SecondaryButton>
            )}
            <PrimaryButton onClick={acceptRule}>
              {ruleIdx + 1 < rules.length ? 'I accept →' : 'I accept — continue'}
            </PrimaryButton>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-md sm:px-4">
        <div className="rounded-t-2xl border border-slate-800 bg-slate-950 p-5 sm:rounded-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-white">{title}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex gap-3">{children}</div>
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500"
    >
      {children}
    </button>
  )
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300 transition-colors hover:border-slate-500"
    >
      {children}
    </button>
  )
}
