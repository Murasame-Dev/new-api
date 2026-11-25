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
import type { UserModelUsageFilters } from '@/features/dashboard/types'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'

export interface UserModelUsageQuery {
  start: number
  end: number
  username?: string
  models?: string[]
  groups?: string[]
  page?: number
  pageSize?: number
}

export interface UserModelUsageOptionsQuery {
  start: number
  end: number
  kind: 'model' | 'group'
  q?: string
  username?: string
}

/** One hour, matching the hourly buckets the usage table is aggregated into. */
export const DEFAULT_USER_MODEL_USAGE_RANGE_HOURS = 24

export function buildDefaultUserModelUsageFilters(): UserModelUsageFilters {
  const { start, end } = getRollingDateRange(
    DEFAULT_USER_MODEL_USAGE_RANGE_HOURS / 24
  )
  return { start, end, username: '', models: [], groups: [] }
}

export function userModelUsageTimeRange(filters: UserModelUsageFilters): {
  start: number
  end: number
} {
  return {
    start: dateToUnixTimestamp(filters.start),
    end: dateToUnixTimestamp(filters.end),
  }
}

/**
 * Repeated `model` / `group` keys, never a bracketed array form, because the
 * gateway binds them with `c.QueryArray`.
 */
export function buildUserModelUsageSearch(
  params: UserModelUsageQuery
): URLSearchParams {
  const search = new URLSearchParams()
  search.set('start_timestamp', String(params.start))
  search.set('end_timestamp', String(params.end))

  const username = params.username?.trim()
  if (username) search.set('username', username)

  for (const raw of params.models ?? []) {
    const model = raw.trim()
    if (model) search.append('model', model)
  }
  for (const raw of params.groups ?? []) {
    const group = raw.trim()
    if (group) search.append('group', group)
  }

  search.set('p', String(params.page ?? 1))
  search.set('page_size', String(params.pageSize ?? 20))
  return search
}

/**
 * Option lists always describe the whole range, independent of the selections
 * in the other dimension, so narrowing models never removes group choices.
 */
export function buildUserModelUsageOptionsSearch(
  params: UserModelUsageOptionsQuery
): URLSearchParams {
  const search = new URLSearchParams()
  search.set('start_timestamp', String(params.start))
  search.set('end_timestamp', String(params.end))
  search.set('kind', params.kind)

  const q = params.q?.trim()
  if (q) search.set('q', q)

  const username = params.username?.trim()
  if (username) search.set('username', username)

  return search
}
