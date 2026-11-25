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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PageFooterProvider } from '@/components/layout/components/page-footer'
import { UserModelUsageReport } from '@/features/dashboard/components/users/user-model-usage-report'
import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

const REPORT_URL = '/api/data/user-models'
const OPTIONS_URL = '/api/data/user-models/options'

interface ReportPayload {
  items: Record<string, unknown>[]
  total: number
  summary?: Record<string, number>
}

let client: QueryClient
let reportResponses: Array<ReportPayload | Error>

function requestedUrls(): string[] {
  return vi
    .mocked(api.get)
    .mock.calls.map((call) => String(call[0]))
    .filter((url) => url.startsWith(REPORT_URL))
}

beforeEach(() => {
  reportResponses = []
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith(`${OPTIONS_URL}?`)) {
      return { data: { success: true, data: [] } }
    }
    if (!url.startsWith(`${REPORT_URL}?`)) {
      throw new Error(`Unexpected report request: ${url}`)
    }
    const next = reportResponses.shift()
    if (!next) throw new Error('No report response queued')
    if (next instanceof Error) throw next
    return { data: { success: true, data: next } }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

function renderReport(enabled = true) {
  function Fixture() {
    const [footer, setFooter] = useState<HTMLDivElement | null>(null)
    return (
      <PageFooterProvider container={footer}>
        <UserModelUsageReport enabled={enabled} />
        <div ref={setFooter} />
      </PageFooterProvider>
    )
  }

  return render(
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>
  )
}

describe('user model usage report', () => {
  it('issues no request and renders nothing when the admin gate is closed', async () => {
    renderReport(false)

    await act(async () => {
      await Promise.resolve()
    })

    expect(requestedUrls()).toEqual([])
    expect(
      screen.queryByRole('group', { name: 'Total Tokens' })
    ).not.toBeInTheDocument()
  })

  it('shows the shared failure state instead of empty totals when the request fails', async () => {
    reportResponses.push(new Error('usage backend offline'))
    renderReport()

    expect(await screen.findByText('usage backend offline')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
    // A failed request must not be reported as a real zero result.
    expect(
      screen.queryByRole('group', { name: 'Total Tokens' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('No recorded usage found')
    ).not.toBeInTheDocument()
  })

  it('renders the all-result totals and rows from the report payload', async () => {
    reportResponses.push({
      items: [
        {
          user_id: 7,
          username: 'alice',
          model_name: 'gpt-4o',
          token_used: 1200,
          cache_read_tokens: 300,
          cache_creation_tokens: 40,
          quota: 500000,
        },
      ],
      total: 1,
      summary: {
        token_used: 1200,
        cache_read_tokens: 300,
        cache_creation_tokens: 40,
        quota: 500000,
      },
    })
    renderReport()

    expect(await screen.findByText('alice')).toBeVisible()
    expect(screen.getByText('gpt-4o')).toBeVisible()
    expect(
      screen.getByRole('group', { name: 'Total Tokens' })
    ).toHaveTextContent('1,200')
    expect(screen.getByRole('group', { name: 'Cache Read' })).toHaveTextContent(
      '300'
    )
    expect(
      screen.getByRole('group', { name: 'Cache Write' })
    ).toHaveTextContent('40')
    expect(
      screen.getByRole('group', { name: 'Historical recorded fees' })
    ).toHaveTextContent('$1')
    expect(screen.getByText('Filtered totals')).toBeVisible()
  })

  it('clears previous rows while a different filter is loading, so totals never mix filters', async () => {
    let releaseSecond: (() => void) | undefined
    reportResponses.push({
      items: [
        { user_id: 1, username: 'alice', model_name: 'gpt-4o', quota: 1 },
      ],
      total: 1,
      summary: { quota: 1 },
    })
    renderReport()

    expect(await screen.findByText('alice')).toBeVisible()

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith(`${OPTIONS_URL}?`)) {
        return { data: { success: true, data: [] } }
      }
      await new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      return {
        data: {
          success: true,
          data: {
            items: [{ user_id: 2, username: 'bob', model_name: 'o3' }],
            total: 1,
            summary: { quota: 2 },
          },
        },
      }
    })

    const username = screen.getByLabelText('Username')
    await userEvent.type(username, 'bob')
    await userEvent.click(screen.getByRole('button', { name: 'Apply Filters' }))

    // While the new filter is in flight, the previous filter's rows and totals
    // must be gone rather than relabelled as the new result. The summary stays
    // as placeholders, and the table shows a loading skeleton.
    await waitFor(() =>
      expect(screen.queryByText('alice')).not.toBeInTheDocument()
    )
    for (const group of screen.getAllByRole('group')) {
      expect(group).toHaveAttribute('aria-busy', 'true')
    }
    expect(screen.queryByText('1,200')).not.toBeInTheDocument()
    expect(screen.queryByText('$1')).not.toBeInTheDocument()

    releaseSecond?.()
    expect(await screen.findByText('bob')).toBeVisible()
  })

  it('requests page 1 again after applying filters from a later page', async () => {
    reportResponses.push({
      items: [
        { user_id: 1, username: 'alice', model_name: 'gpt-4o', quota: 1 },
      ],
      total: 45,
      summary: { quota: 1 },
    })
    reportResponses.push({
      items: [
        { user_id: 1, username: 'alice', model_name: 'gpt-4o', quota: 1 },
      ],
      total: 45,
      summary: { quota: 1 },
    })
    renderReport()

    await screen.findByText('alice')
    await userEvent.click(
      screen.getByRole('button', { name: 'Go to next page' })
    )
    await waitFor(() => expect(requestedUrls().at(-1)).toContain('p=2'))

    reportResponses.push({
      items: [{ user_id: 2, username: 'bob', model_name: 'o3', quota: 2 }],
      total: 1,
      summary: { quota: 2 },
    })
    await userEvent.type(screen.getByLabelText('Username'), 'bob')
    await userEvent.click(screen.getByRole('button', { name: 'Apply Filters' }))

    await waitFor(() => {
      const last = requestedUrls().at(-1) ?? ''
      expect(last).toContain('username=bob')
      expect(last).toContain('p=1')
    })
  })
})
