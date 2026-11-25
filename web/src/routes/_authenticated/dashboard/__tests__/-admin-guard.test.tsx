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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DASHBOARD_ADMIN_ONLY_SECTION_IDS } from '@/features/dashboard/section-registry'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { Route } from '../$section'

type SearchSchema = {
  validateSearch: {
    safeParse: (value: unknown) => {
      success: boolean
      data?: { view?: string }
    }
  }
}

type BeforeLoad = (args: { params: { section: string } }) => void

function validateSearch(search: Record<string, unknown>): { view?: string } {
  const schema = (Route.options as unknown as SearchSchema).validateSearch
  const result = schema.safeParse(search)
  return result.success ? (result.data ?? {}) : {}
}

function runGuard(section: string) {
  return (Route.options as unknown as { beforeLoad: BeforeLoad }).beforeLoad({
    params: { section },
  })
}

function setRole(role: number) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'route-user',
    role,
    quota: 0,
    used_quota: 0,
    request_count: 0,
  })
}

beforeEach(() => {
  setRole(ROLE.ADMIN)
})

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})

describe('dashboard usage sub-view URL contract', () => {
  it('accepts the usage sub-view and defaults to charts otherwise', () => {
    expect(validateSearch({ view: 'usage' })).toEqual({ view: 'usage' })
    expect(validateSearch({ view: 'charts' })).toEqual({ view: 'charts' })
    expect(validateSearch({ view: 'unexpected' }).view).toBeUndefined()
    expect(validateSearch({}).view).toBeUndefined()
  })

  it('marks only User Analytics as admin-only', () => {
    expect(DASHBOARD_ADMIN_ONLY_SECTION_IDS).toEqual(['users'])
  })
})

describe('dashboard admin-only direct link guard', () => {
  it('allows an administrator to open the section', () => {
    setRole(ROLE.ADMIN)

    expect(() => runGuard('users')).not.toThrow()
  })

  it('redirects a signed-in non-admin away from the section', () => {
    setRole(ROLE.USER)

    expect(() => runGuard('users')).toThrow()
  })

  it('redirects when the role was downgraded since the session started', () => {
    setRole(ROLE.ADMIN)
    expect(() => runGuard('users')).not.toThrow()

    setRole(ROLE.USER)

    expect(() => runGuard('users')).toThrow()
  })

  it('keeps the shared sections open to every signed-in user', () => {
    setRole(ROLE.USER)

    expect(() => runGuard('models')).not.toThrow()
    expect(() => runGuard('flow')).not.toThrow()
  })

  it('sends a refused direct link to the 403 page', () => {
    setRole(ROLE.USER)

    let target: string | undefined
    try {
      runGuard('users')
    } catch (error) {
      target = (error as { options?: { to?: string } }).options?.to
    }

    expect(target).toBe('/403')
  })
})
