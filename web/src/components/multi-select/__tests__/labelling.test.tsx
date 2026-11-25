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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MultiSelect } from '@/components/multi-select'

describe('multi-select field labelling', () => {
  it('lets an external label focus and name the combobox input', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <label htmlFor='demo-groups'>Call groups</label>
        <MultiSelect
          id='demo-groups'
          options={[{ value: 'vip', label: 'vip' }]}
          selected={[]}
          onChange={vi.fn()}
          placeholder='All call groups'
        />
      </div>
    )

    const input = screen.getByRole('combobox')

    await user.click(screen.getByText('Call groups'))

    expect(input).toHaveFocus()
  })

  it('announces the provided accessible name instead of the placeholder', () => {
    render(
      <MultiSelect
        id='demo-models'
        ariaLabel='Models'
        options={[]}
        selected={[]}
        onChange={vi.fn()}
        placeholder='All models'
      />
    )

    expect(screen.getByRole('combobox', { name: 'Models' })).toBeInTheDocument()
  })
})
