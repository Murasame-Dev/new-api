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
import { createFileRoute, redirect } from '@tanstack/react-router'
import * as z from 'zod'

import { Dashboard } from '@/features/dashboard'
import {
  DASHBOARD_SECTION_IDS,
  DASHBOARD_DEFAULT_SECTION,
  DASHBOARD_ADMIN_ONLY_SECTION_IDS,
} from '@/features/dashboard/section-registry'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const dashboardSearchSchema = z.object({
  // Sub-view of the User Analytics section. Unknown values fall back to charts.
  view: z.enum(['charts', 'usage']).optional().catch(undefined),
})

const ADMIN_ONLY_SECTIONS = new Set(DASHBOARD_ADMIN_ONLY_SECTION_IDS)

export const Route = createFileRoute('/_authenticated/dashboard/$section')({
  beforeLoad: ({ params }) => {
    const validSections = DASHBOARD_SECTION_IDS as unknown as string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/dashboard/$section',
        params: { section: DASHBOARD_DEFAULT_SECTION },
      })
    }

    // Admin-only sections refuse a direct link, not just a hidden tab.
    const user = useAuthStore.getState().auth.user
    if (
      ADMIN_ONLY_SECTIONS.has(params.section) &&
      (!user || user.role < ROLE.ADMIN)
    ) {
      throw redirect({ to: '/403' })
    }
  },
  validateSearch: dashboardSearchSchema,
  component: Dashboard,
})
