import type { FaqItem } from './schema/faq'

export const HOMEPAGE_FAQS: FaqItem[] = [
  {
    question: 'What is Sentinel X?',
    answer:
      "Sentinel X is Nigeria's home of mobile esports — a platform where players compete in tournaments, watch live matches and replays, connect with the community, and trade gaming accounts and items safely. It supports Dream League Soccer today and is built to grow across other mobile games.",
  },
  {
    question: 'How do I join a tournament?',
    answer:
      'Create a free Sentinel X account, open a tournament from the Tournaments page, and register before the deadline. Once registration closes, players are placed into groups or a straight knockout bracket depending on the number of entrants, and matches are scheduled from there.',
  },
  {
    question: 'How much does it cost to enter a tournament?',
    answer:
      "Each tournament sets its own entry fee, shown on that tournament's page before you register. Payment is handled securely through Paystack.",
  },
  {
    question: 'How are match results verified?',
    answer:
      "After a match, the winner submits a screenshot and screen recording through their Player Dashboard. A Sentinel X admin reviews the submission and confirms the result before the bracket or group table updates — nothing updates automatically from a player's own submission.",
  },
  {
    question: 'How do I withdraw prize money?',
    answer:
      "Once your bank account is verified on your Dashboard, you can request a withdrawal of any prize money you've won. Payouts are reviewed and processed by the Sentinel X team.",
  },
  {
    question: 'Is Sentinel X free to use?',
    answer:
      "Yes — browsing tournaments, watching matches on Sentinel X TV, viewing rankings, and joining the community are all free. The only cost is each tournament's entry fee, and that's only charged if you choose to compete.",
  },
]

export const TOURNAMENT_FAQS: FaqItem[] = [
  {
    question: 'How do I register?',
    answer:
      'Open a tournament from this page, pay the entry fee through Paystack, and you\'re registered. You can track your registration from your Player Dashboard.',
  },
  {
    question: 'How are matches played?',
    answer:
      'Once registration closes, players are auto-grouped or placed straight into a knockout bracket depending on entrant count. Matches happen on the game itself — you and your opponent arrange a time and play.',
  },
  {
    question: 'When will I get my match code?',
    answer:
      'Match details appear on your Dashboard and the Match Centre page once the admin schedules your round — usually shortly after the previous round\'s results are confirmed.',
  },
  {
    question: 'How are winners paid?',
    answer:
      'After the tournament ends, verified prize winners can request a withdrawal from their Dashboard once their payout bank account is verified. Payouts are reviewed and processed by the Sentinel X team.',
  },
  {
    question: 'What if I face a problem?',
    answer:
      'Submit your match result with a screenshot and recording as usual — if something goes wrong, message the Sentinel X WhatsApp community and an admin will step in to review it.',
  },
]
