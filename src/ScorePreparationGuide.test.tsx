// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ScorePreparationGuide } from './ScorePreparationGuide'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('local score preparation guidance', () => {
  it('states that conversion is external and import is not recognition', () => {
    render(<ScorePreparationGuide />)
    expect(screen.getByText(/does not recognize notes/).textContent).toContain('Importing MusicXML is not optical music recognition')
    expect(screen.getByText(/separate local desktop OMR/)).toBeTruthy()
    expect(screen.getByText(/successful import does not prove/)).toBeTruthy()
  })
  it('offers native, initially closed disclosure without selecting a file', () => {
    const { container } = render(<ScorePreparationGuide />)
    const disclosure = container.querySelector('details')!
    expect(disclosure.open).toBe(false)
    expect(disclosure.querySelector('summary')?.textContent).toMatch(/PDF or photo/)
    expect(container.querySelector('input, form, iframe, img, object, embed')).toBeNull()
  })
  it('uses explicit external links without referrer or opener access', () => {
    render(<ScorePreparationGuide />)
    const links = screen.getAllByRole('link', { hidden: true })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/(audiveris.github.io\/audiveris\/|github.com\/Audiveris\/audiveris\/)/)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(link.textContent).toContain('external, new tab')
    }
  })
  it('does not access files, network or storage during mount or repeated toggles', () => {
    const fetch = vi.fn(() => { throw Error('Unexpected network access') })
    vi.stubGlobal('fetch', fetch)
    const fileRead = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    const get = vi.spyOn(Storage.prototype, 'getItem')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const remove = vi.spyOn(Storage.prototype, 'removeItem')
    const { container, unmount } = render(<ScorePreparationGuide />)
    const disclosure = container.querySelector('details')!
    for (const open of [true, false, true, false]) {
      disclosure.open = open
      fireEvent(disclosure, new Event('toggle'))
    }
    unmount()
    for (const spy of [fetch, fileRead, get, set, remove]) expect(spy).not.toHaveBeenCalled()
  })
  it('warns about rights, local-only handling, backups and incomplete verification', () => {
    render(<ScorePreparationGuide />)
    for (const pattern of [/permission to process/, /outside cloud-synced folders/, /backup of your current song/, /have not been verified on your device/]) {
      expect(screen.getByText(pattern)).toBeTruthy()
    }
  })
})
