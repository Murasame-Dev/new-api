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
import { useQuery } from '@tanstack/react-query'

import { getUserModelUsageOptions } from '@/features/dashboard/api'
import { buildUserModelUsageOptionsSearch } from '@/features/dashboard/lib/user-model-usage'
import { requireServerSuccess } from '@/lib/server-error-message'

interface UseUserModelUsageOptionsParams {
  kind: 'model' | 'group'
  timeRange: { start: number; end: number }
  username?: string
  enabled: boolean
  /** Debounced query typed into the picker. */
  query: string
}

/**
 * Bounded, per-dimension option search. `enabled` is false until the admin
 * opens the picker, so the report issues no option requests while idle.
 */
export function useUserModelUsageOptions(
  params: UseUserModelUsageOptionsParams
) {
  return useQuery({
    queryKey: [
      'dashboard',
      'user-model-usage-options',
      params.kind,
      params.timeRange.start,
      params.timeRange.end,
      params.username ?? '',
      params.query,
    ],
    enabled: params.enabled,
    staleTime: 60_000,
    // Picker options fail silently: the field keeps its current choices and a
    // toast on every keystroke would be noise.
    meta: { errorToast: false },
    queryFn: async ({ signal }) => {
      const search = buildUserModelUsageOptionsSearch({
        kind: params.kind,
        start: params.timeRange.start,
        end: params.timeRange.end,
        username: params.username,
        q: params.query,
      })
      const result = requireServerSuccess(
        await getUserModelUsageOptions(search, signal)
      )
      return result.success ? (result.data ?? []) : []
    },
  })
}
