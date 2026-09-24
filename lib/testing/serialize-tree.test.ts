import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { serializeTree } from './serialize-tree'

function Card(_: { name: string; onClick?: () => void }) { return null }

describe('serializeTree', () => {
  it('serializes nested elements, props, functions, arrays and maps', () => {
    const tree = createElement('div', { className: 'x' }, 'hi', createElement(Card, { name: 'A', onClick: () => {} }), [1, 2])
    expect(serializeTree(tree)).toEqual({
      t: 'div',
      props: { className: 'x' },
      children: ['hi', { t: 'Card', props: { name: 'A', onClick: '[fn]' }, children: null }, [1, 2]],
    })
  })
  it('serializes Map props deterministically', () => {
    const tree = createElement(Card as never, { name: 'A', by: new Map([['k', 1]]) })
    expect(serializeTree(tree)).toMatchObject({ props: { by: { __map: [['k', 1]] } } })
  })
})
