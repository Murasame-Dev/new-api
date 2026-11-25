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
import { describe, expect, test } from 'vitest'

import {
  buildDefaultUserModelUsageFilters,
  buildUserModelUsageOptionsSearch,
  buildUserModelUsageSearch,
  userModelUsageTimeRange,
} from '../user-model-usage'

describe('user model usage query building', () => {
  test('repeats model and group keys instead of using a bracketed array form', () => {
    const search = buildUserModelUsageSearch({
      start: 100,
      end: 200,
      models: ['gpt-4o', 'claude-3'],
      groups: ['vip', 'default'],
      page: 2,
      pageSize: 50,
    })

    expect(search.toString()).toBe(
      'start_timestamp=100&end_timestamp=200&model=gpt-4o&model=claude-3&group=vip&group=default&p=2&page_size=50'
    )
    expect(search.toString()).not.toContain('%5B')
  })

  test('omits blank username and empty selections while defaulting the page', () => {
    const search = buildUserModelUsageSearch({
      start: 100,
      end: 200,
      username: '   ',
      models: ['', '  '],
      groups: [],
    })

    expect(search.has('username')).toBe(false)
    expect(search.getAll('model')).toEqual([])
    expect(search.has('group')).toBe(false)
    expect(search.get('p')).toBe('1')
    expect(search.get('page_size')).toBe('20')
  })

  test('sends an exact trimmed username when one is entered', () => {
    const search = buildUserModelUsageSearch({
      start: 1,
      end: 2,
      username: ' alice ',
    })

    expect(search.get('username')).toBe('alice')
  })

  test('narrows option search by kind and query without cross-dimension filters', () => {
    const search = buildUserModelUsageOptionsSearch({
      start: 10,
      end: 20,
      kind: 'group',
      q: 'vi',
      username: 'bob',
    })

    expect(search.get('kind')).toBe('group')
    expect(search.get('q')).toBe('vi')
    expect(search.get('username')).toBe('bob')
    expect(search.has('model')).toBe(false)
    expect(search.has('group')).toBe(false)
  })

  test('default filters cover a rolling day and convert dates to Unix seconds', () => {
    const filters = buildDefaultUserModelUsageFilters()
    const range = userModelUsageTimeRange(filters)

    expect(filters.models).toEqual([])
    expect(filters.groups).toEqual([])
    expect(range.end - range.start).toBe(24 * 3600)
    expect(Number.isInteger(range.start)).toBe(true)
    expect(Number.isInteger(range.end)).toBe(true)
  })
})
