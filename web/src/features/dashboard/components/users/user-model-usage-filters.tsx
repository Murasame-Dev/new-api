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
import { RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimeRangePicker } from '@/components/date-time-range-picker'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUserModelUsageOptions } from '@/features/dashboard/hooks/use-user-model-usage-options'
import { userModelUsageTimeRange } from '@/features/dashboard/lib/user-model-usage'
import type { UserModelUsageFilters } from '@/features/dashboard/types'

interface UserModelUsageFilterBarProps {
  draft: UserModelUsageFilters
  onDraftChange: (filters: UserModelUsageFilters) => void
  onApply: () => void
  onReset: () => void
  loading?: boolean
}

export function UserModelUsageFilterBar(props: UserModelUsageFilterBarProps) {
  const { t } = useTranslation()
  const [modelOpen, setModelOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const timeRange = userModelUsageTimeRange(props.draft)
  const username = props.draft.username.trim()

  const modelOptions = useUserModelUsageOptions({
    kind: 'model',
    timeRange,
    username,
    enabled: modelOpen,
    query: modelQuery,
  })
  const groupOptions = useUserModelUsageOptions({
    kind: 'group',
    timeRange,
    username,
    enabled: groupOpen,
    query: groupQuery,
  })

  const toOptions = (values: string[]) =>
    values.map((value) => ({ value, label: value }))

  const patch = (next: Partial<UserModelUsageFilters>) => {
    props.onDraftChange({ ...props.draft, ...next })
  }

  return (
    <div className='flex flex-wrap items-end gap-2'>
      <div className='flex min-w-0 flex-col gap-1.5 sm:w-[21rem]'>
        <Label className='text-muted-foreground text-xs'>
          {t('Time range')}
        </Label>
        <DateTimeRangePicker
          start={props.draft.start}
          end={props.draft.end}
          onChange={(range) =>
            patch({
              start: range.start ?? props.draft.start,
              end: range.end ?? props.draft.end,
            })
          }
        />
      </div>

      <div className='flex min-w-0 flex-col gap-1.5 sm:w-48'>
        <Label
          htmlFor='user-model-usage-username'
          className='text-muted-foreground text-xs'
        >
          {t('Username')}
        </Label>
        <Input
          id='user-model-usage-username'
          value={props.draft.username}
          placeholder={t('Exact recorded username')}
          className='h-8'
          onChange={(event) => patch({ username: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onApply()
          }}
        />
      </div>

      <div className='flex min-w-0 flex-col gap-1.5 sm:w-[15rem]'>
        <Label
          htmlFor='user-model-usage-groups'
          className='text-muted-foreground text-xs'
        >
          {t('Call groups')}
        </Label>
        <MultiSelect
          id='user-model-usage-groups'
          ariaLabel={t('Call groups')}
          options={toOptions(groupOptions.data ?? [])}
          selected={props.draft.groups}
          onChange={(groups) => patch({ groups })}
          placeholder={t('All call groups')}
          maxVisibleChips={2}
          searchLoading={groupOptions.isFetching}
          onOpenChange={setGroupOpen}
          onSearchChange={setGroupQuery}
        />
      </div>

      <div className='flex min-w-0 flex-col gap-1.5 sm:w-[17rem]'>
        <Label
          htmlFor='user-model-usage-models'
          className='text-muted-foreground text-xs'
        >
          {t('Models')}
        </Label>
        <MultiSelect
          id='user-model-usage-models'
          ariaLabel={t('Models')}
          options={toOptions(modelOptions.data ?? [])}
          selected={props.draft.models}
          onChange={(models) => patch({ models })}
          placeholder={t('All models')}
          maxVisibleChips={2}
          searchLoading={modelOptions.isFetching}
          onOpenChange={setModelOpen}
          onSearchChange={setModelQuery}
        />
      </div>

      <div className='ms-auto flex shrink-0 items-center gap-2'>
        <Button variant='outline' size='sm' onClick={props.onReset}>
          <RotateCcw data-icon='inline-start' />
          {t('Reset')}
        </Button>
        <Button
          size='sm'
          onClick={props.onApply}
          disabled={props.loading}
          aria-busy={props.loading}
        >
          <Search data-icon='inline-start' />
          {t('Apply Filters')}
        </Button>
      </div>
    </div>
  )
}
