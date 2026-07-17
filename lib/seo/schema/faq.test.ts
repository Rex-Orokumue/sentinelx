import { describe, it, expect } from 'vitest'
import { buildFaqJsonLd } from './faq'

describe('buildFaqJsonLd', () => {
  it('maps question/answer pairs into FAQPage Question/Answer entities', () => {
    const result = buildFaqJsonLd([
      { question: 'What is Sentinel X?', answer: "Nigeria's home of mobile esports." },
    ])
    expect(result['@type']).toBe('FAQPage')
    expect(result.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'What is Sentinel X?',
        acceptedAnswer: { '@type': 'Answer', text: "Nigeria's home of mobile esports." },
      },
    ])
  })
})
