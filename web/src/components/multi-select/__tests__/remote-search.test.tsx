/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MultiSelect } from '@/components/multi-select'

interface FixtureProps {
  options: { value: string; label: string }[]
  initialSelected?: string[]
  onSearchChange?: (query: string) => void
  onOpenChange?: (open: boolean) => void
}

function Fixture(props: FixtureProps) {
  const [selected, setSelected] = useState(props.initialSelected ?? [])

  return (
    <>
      <MultiSelect
        options={props.options}
        selected={selected}
        onChange={setSelected}
        onSearchChange={props.onSearchChange}
        onOpenChange={props.onOpenChange}
        searchDebounceMs={0}
      />
      <output aria-label='Selected values'>{selected.join(',')}</output>
    </>
  )
}

describe('multi-select remote option search', () => {
  it('reports open state so a caller can gate option requests', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Fixture options={[]} onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('combobox'))

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('reports the trimmed typed query without client-side filtering', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(<Fixture options={[]} onSearchChange={onSearchChange} />)
    const input = screen.getByRole('combobox')

    await user.click(input)
    await user.type(input, '  vip  ')

    await waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith('vip'))
  })

  it('keeps a selected value visible and removable after the option list no longer returns it', async () => {
    const { rerender } = render(
      <Fixture
        options={[
          { value: 'vip', label: 'vip' },
          { value: 'default', label: 'default' },
        ]}
        initialSelected={['vip']}
        onSearchChange={() => undefined}
      />
    )

    // A later remote page for another query no longer mentions `vip`.
    rerender(
      <Fixture
        options={[{ value: 'default', label: 'default' }]}
        initialSelected={['vip']}
        onSearchChange={() => undefined}
      />
    )

    const chips = document.querySelector('[data-slot="combobox-chips"]')
    expect(chips).not.toBeNull()
    expect(within(chips as HTMLElement).getByText('vip')).toBeVisible()
    expect(screen.getByLabelText('Selected values')).toHaveTextContent(/^vip$/)
  })

  it('does not report search queries before the popup opens', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(
      <Fixture
        options={[{ value: 'a', label: 'a' }]}
        onSearchChange={onSearchChange}
      />
    )

    await user.click(document.body)

    expect(onSearchChange).not.toHaveBeenCalled()
  })
})
