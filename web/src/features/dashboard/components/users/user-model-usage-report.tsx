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
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { Info } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { getUserModelUsage } from '@/features/dashboard/api'
import {
  buildDefaultUserModelUsageFilters,
  buildUserModelUsageSearch,
  userModelUsageTimeRange,
} from '@/features/dashboard/lib/user-model-usage'
import type {
  UserModelUsageFilters,
  UserModelUsageItem,
  UserModelUsageSummary,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import {
  isServerErrorCancelled,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { UserModelUsageFilterBar } from './user-model-usage-filters'
import { UserModelUsageSummaryBar } from './user-model-usage-summary'

const DEFAULT_PAGE_SIZE = 20

interface UserModelUsageReportProps {
  /** Admin gate; the parent also refuses to render for non-admins. */
  enabled: boolean
}

function useUserModelUsageColumns(): ColumnDef<UserModelUsageItem>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return useMemo(() => {
    const formatFees = (quota: number) =>
      formatQuotaWithCurrency(quota, {
        digitsLarge: 2,
        digitsSmall: 4,
        abbreviate: true,
        locale,
      })

    return [
      {
        id: 'user',
        header: t('User'),
        enableSorting: false,
        cell: ({ row }) => {
          const username = row.original.username || t('Unknown')
          const userId = row.original.user_id
          return (
            <div className='flex min-w-0 flex-col gap-0.5'>
              <span className='min-w-0 truncate text-sm font-medium'>
                {username}
              </span>
              {userId != null && (
                <span
                  data-table-text='secondary'
                  className='text-muted-foreground font-mono text-xs'
                >
                  {t('ID')} {userId}
                </span>
              )}
            </div>
          )
        },
        meta: { mobileTitle: true },
      },
      {
        id: 'model_name',
        header: t('Model'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='block max-w-[16rem] truncate font-mono text-sm'>
            {row.original.model_name || t('Unknown')}
          </span>
        ),
        meta: { mobileOrder: 10 },
      },
      {
        id: 'token_used',
        header: t('Total Tokens'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {formatNumber(row.original.token_used ?? 0, locale)}
          </span>
        ),
        meta: { mobileOrder: 20 },
      },
      {
        id: 'cache_read_tokens',
        header: t('Cache Read'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-sm tabular-nums'>
            {formatNumber(row.original.cache_read_tokens ?? 0, locale)}
          </span>
        ),
        meta: { mobileOrder: 30 },
      },
      {
        id: 'cache_creation_tokens',
        header: t('Cache Write'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-sm tabular-nums'>
            {formatNumber(row.original.cache_creation_tokens ?? 0, locale)}
          </span>
        ),
        meta: { mobileOrder: 40 },
      },
      {
        id: 'quota',
        header: t('Historical recorded fees'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='font-mono text-sm font-semibold tabular-nums'>
            {formatFees(row.original.quota ?? 0)}
          </span>
        ),
        meta: { mobileOrder: 50 },
      },
    ]
  }, [locale, t])
}

function UserModelUsageNotes() {
  const { t } = useTranslation()
  const notes = [
    t(
      'Usage is summed into hourly buckets; the newest data appears after the next sync.'
    ),
    t(
      'Cache read and cache write tokens are recorded separately and are not simply added to the total token count.'
    ),
    t(
      'Fees are historical recorded amounts and exclude refunds. Showing them charges nothing.'
    ),
    t(
      'Data is unavailable for periods when usage recording or aggregation was turned off.'
    ),
  ]

  return (
    <ul className='text-muted-foreground grid gap-1 text-xs leading-relaxed'>
      {notes.map((note) => (
        <li key={note} className='flex items-start gap-1.5'>
          <Info
            className='mt-0.5 size-3.5 shrink-0 opacity-60'
            aria-hidden='true'
          />
          <span className='min-w-0'>{note}</span>
        </li>
      ))}
    </ul>
  )
}

function buildFilterKey(filters: UserModelUsageFilters): string {
  const { start, end } = userModelUsageTimeRange(filters)
  return JSON.stringify([
    start,
    end,
    filters.username.trim(),
    filters.models,
    filters.groups,
  ])
}

interface UserModelUsageResult {
  items: UserModelUsageItem[]
  total: number
  summary?: UserModelUsageSummary
}

export function UserModelUsageReport(props: UserModelUsageReportProps) {
  const { t } = useTranslation()
  const columns = useUserModelUsageColumns()
  const [applied, setApplied] = useState<UserModelUsageFilters>(() =>
    buildDefaultUserModelUsageFilters()
  )
  const [draft, setDraft] = useState<UserModelUsageFilters>(() => applied)
  // Page state stays local: the report is a sub-view, so its table position is
  // not worth a URL schema of its own.
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  })

  const timeRange = userModelUsageTimeRange(applied)
  const filterKey = buildFilterKey(applied)

  const usageQuery = useQuery<UserModelUsageResult, Error>({
    queryKey: [
      'dashboard',
      'user-model-usage',
      filterKey,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    enabled: props.enabled,
    staleTime: 30_000,
    // The report renders its own inline failure state, so the shared query
    // cache must not also raise a toast for the same failure.
    meta: { errorToast: false },
    // Keep rows only while the same filters are merely re-paged, so a total is
    // never shown next to a different filter's rows.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === filterKey ? previousData : undefined,
    queryFn: async ({ signal }) => {
      const search = buildUserModelUsageSearch({
        ...timeRange,
        username: applied.username,
        models: applied.models,
        groups: applied.groups,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      })
      const result = requireServerSuccess(
        await getUserModelUsage(search, signal)
      )
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
        summary: result.data?.summary,
      }
    },
  })

  const items = usageQuery.data?.items ?? []
  const total = usageQuery.data?.total ?? 0
  const summary: UserModelUsageSummary | undefined = usageQuery.data?.summary
  // A cancelled request is not a data failure: React Query exposes it on the
  // query's own state while the restarted attempt is still in flight.
  const queryFailed =
    usageQuery.isError && !isServerErrorCancelled(usageQuery.error)

  const { table } = useDataTable({
    data: items,
    columns,
    totalCount: total,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    columnFilters: [],
    pagination,
    onPaginationChange: setPagination,
    enableSorting: false,
    ensurePageInRange: (pageCount) => {
      if (
        usageQuery.isSuccess &&
        !usageQuery.isFetching &&
        pagination.pageIndex >= Math.max(1, pageCount)
      ) {
        setPagination((previous) => ({
          ...previous,
          pageIndex: Math.max(0, pageCount - 1),
        }))
      }
    },
  })

  const applyFilters = useCallback(() => {
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }
    )
    setApplied(draft)
  }, [draft])

  const resetFilters = useCallback(() => {
    const next = buildDefaultUserModelUsageFilters()
    setDraft(next)
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }
    )
    setApplied(next)
  }, [])

  if (!props.enabled) return null

  return (
    <div className='flex min-h-0 flex-col gap-3'>
      <UserModelUsageFilterBar
        draft={draft}
        onDraftChange={setDraft}
        onApply={applyFilters}
        onReset={resetFilters}
        loading={usageQuery.isFetching}
      />
      {queryFailed ? (
        <ErrorState
          title={t('Failed to load')}
          description={
            usageQuery.error instanceof Error ? usageQuery.error.message : ''
          }
          onRetry={() => void usageQuery.refetch()}
        />
      ) : (
        <>
          <UserModelUsageSummaryBar
            summary={summary}
            loading={usageQuery.isLoading}
          />
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={usageQuery.isLoading}
            isFetching={usageQuery.isFetching}
            emptyTitle={t('No recorded usage found')}
            emptyDescription={t(
              'No recorded usage matches these filters. Try a wider time range or clear the filters.'
            )}
            skeletonKeyPrefix='user-model-usage'
            applyHeaderSize
            afterTable={<UserModelUsageNotes />}
          />
        </>
      )}
    </div>
  )
}
