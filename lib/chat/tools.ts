// Groq's OpenAI-compatible tool schema (confirmed via console.groq.com/docs/tool-use).
// Only one tool exists — get_account_snapshot — and it takes no arguments,
// by design (Global Constraints: it always runs against the real session's
// player_id, never a model-supplied one).
export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_account_snapshot',
      description:
        "Returns the logged-in player's own account data: upcoming matches, tournament registrations, wallet balance, SX Score/tier, recent withdrawals, KYC status, friendly matches, and unread notification count. Takes no arguments.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]
