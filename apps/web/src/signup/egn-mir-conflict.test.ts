import { describe, expect, it, vi } from 'vitest'
import { coveredBySameMir, coveredByNumberLabel, planEgnGuard } from './designation-duplicates'
import { egnMirConfirmText, egnMirConflict, egnMirConflictMessage, withOtherMirConfirm, withOtherMirConfirmIds } from './egn-mir-conflict'

describe('egnMirConflict', () => {
  it('same МИР is silent; another МИР names the lowest number', () => {
    expect(egnMirConflict([{ kind: 'partner', number: 512, mir: '23' }], '234600011')).toBeNull()
    expect(egnMirConflict([], '234600011')).toBeNull()
    expect(egnMirConflict([{ kind: 'partner', number: 512, mir: '25' }], '')).toBeNull()
    // Any holder in the section's МИР covers it, even if another holder is elsewhere.
    expect(egnMirConflict([{ kind: 'signup', number: 503, mir: '25' }, { kind: 'partner', number: 512, mir: '23' }], '234600011')).toBeNull()
    const conflict = egnMirConflict([{ kind: 'partner', number: 540, mir: '25' }, { kind: 'signup', number: 509, mir: '04' }], '234600011')
    expect(conflict).toEqual({ number: 509, mir: '04', partner: false, section: '234600011', sectionMir: '23' })
  })

  it('message names the number and both МИР', () => {
    const message = egnMirConflictMessage({ number: 512, mir: '25', partner: true, section: '234600011', sectionMir: '23' })
    expect(message).toBe('Внимание: това ЕГН вече има пълномощно № 512 за МИР 25 („И аз“). Секция 234600011 е в МИР 23 — пълномощното не важи там.')
    expect(egnMirConfirmText([message])).toContain('Да запиша ли въпреки това?')
  })
})

describe('confirm flow', () => {
  const needs = { ok: false as const, needsConfirm: 'egn_other_mir' as const, message: 'Внимание' }

  it('re-sends with the flag only on OK', async () => {
    const run = vi.fn(async (confirm: boolean) => (confirm ? { ok: true as const, message: 'saved' } : needs))
    expect(await withOtherMirConfirm(run, () => true)).toEqual({ ok: true, message: 'saved' })
    expect(run).toHaveBeenLastCalledWith(true)
    run.mockClear()
    const declined = await withOtherMirConfirm(run, () => false)
    expect(declined).toMatchObject({ ok: false, message: 'Внимание Не е записано.' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('no prompt when the server did not ask', async () => {
    const ask = vi.fn(() => true)
    await withOtherMirConfirm(async () => ({ ok: true as const }), ask)
    expect(ask).not.toHaveBeenCalled()
  })

  it('bulk: one prompt, re-run with the held ids', async () => {
    const run = vi.fn(async (ids: string[]) => ({ held: ids.length ? [] : [{ id: 'a', message: 'm1' }, { id: 'b', message: 'm2' }] }))
    const ask = vi.fn(() => true)
    const { second } = await withOtherMirConfirmIds(run, (result) => result.held, ask)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith(['a', 'b'])
    expect(second).toEqual({ held: [] })
  })
})

describe('same МИР is covered, not a duplicate', () => {
  it('planEgnGuard skips with same_mir; another МИР stays a duplicate', () => {
    const holders = [{ id: 'pp-1', kind: 'partner' as const, egnKey: 'K', mir: '23', number: 512, published: 1 }]
    const same = planEgnGuard([{ id: 's-1', kind: 'signup', egnKey: 'K', mir: '23' }], holders as never)
    expect(same.skipped).toMatchObject([{ id: 's-1', reason: 'same_mir', keeper: { number: 512, mir: '23' } }])
    const other = planEgnGuard([{ id: 's-1', kind: 'signup', egnKey: 'K', mir: '25' }], holders as never)
    expect(other.skipped).toMatchObject([{ id: 's-1', reason: 'duplicate' }])
  })

  it('coveredBySameMir and its label', () => {
    expect(coveredBySameMir({ number: null, mir: '04' }, { number: 512, mir: '04', keeperId: 'x' })).toBe(true)
    expect(coveredBySameMir({ number: null, mir: '04' }, { number: 512, mir: '14', keeperId: 'x' })).toBe(false)
    expect(coveredBySameMir({ number: 600, mir: '04' }, { number: 512, mir: '04', keeperId: 'x' })).toBe(false)
    expect(coveredByNumberLabel({ number: 512, mir: '04', partner: true })).toBe('Покрит от № 04/512 („И аз“) — същото ЕГН, същия МИР')
  })
})
