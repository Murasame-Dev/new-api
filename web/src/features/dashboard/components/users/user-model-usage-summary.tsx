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
import { Coins, Download, Layers, Upload, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { UserModelUsageSummary } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

interface UserModelUsageSummaryBarProps {
  summary?: UserModelUsageSummary
  loading: boolean
}

interface SummaryCell {
  key: string
  label: string
  value: string
  icon: LucideIcon
  tone: IconBadgeTone
}

/**
 * Totals across every row matching the applied filters, not just the visible
 * page. Values are sums of recorded usage; nothing here is a new charge.
 */
export function UserModelUsageSummaryBar(props: UserModelUsageSummaryBarProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const cells: SummaryCell[] = [
    {
      key: 'tokens',
      label: t('Total Tokens'),
      value: formatNumber(props.summary?.token_used ?? 0, locale),
      icon: Layers,
      tone: 'chart-4',
    },
    {
      key: 'cacheRead',
      label: t('Cache Read'),
      value: formatNumber(props.summary?.cache_read_tokens ?? 0, locale),
      icon: Download,
      tone: 'chart-3',
    },
    {
      key: 'cacheWrite',
      label: t('Cache Write'),
      value: formatNumber(props.summary?.cache_creation_tokens ?? 0, locale),
      icon: Upload,
      tone: 'chart-5',
    },
    {
      key: 'quota',
      label: t('Historical recorded fees'),
      value: formatQuotaWithCurrency(props.summary?.quota ?? 0, {
        digitsLarge: 2,
        digitsSmall: 4,
        abbreviate: true,
        locale,
      }),
      icon: Coins,
      tone: 'success',
    },
  ]

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='border-b px-3 py-1.5 sm:px-4'>
        <span className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
          {t('Filtered totals')}
        </span>
      </div>
      <div className='divide-border/60 grid min-w-0 grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0'>
        {cells.map((cell) => {
          const Icon = cell.icon
          return (
            <div
              key={cell.key}
              role='group'
              aria-label={cell.label}
              aria-busy={props.loading}
              className='min-w-0 px-3 py-2 sm:py-2.5'
            >
              <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11px] leading-4 font-medium tracking-wide'>
                <IconBadge tone={cell.tone} size='xs' className='size-3.5'>
                  <Icon />
                </IconBadge>
                <span className='truncate' title={cell.label}>
                  {cell.label}
                </span>
              </div>
              {props.loading ? (
                <Skeleton className='mt-1.5 h-5 w-20' />
              ) : (
                <div
                  className='text-foreground mt-1 truncate font-mono text-sm font-semibold tabular-nums sm:text-base'
                  title={cell.value}
                >
                  {cell.value}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
