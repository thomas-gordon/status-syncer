import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCurrentEvents, refreshAccessToken } from '@/lib/google-calendar'
import { getSlackStatus } from '@/lib/slack'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const log: string[] = []

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        googleAccount: true,
        slackAccount: true,
        settings: true,
      },
    })

    if (!user || !user.settings) {
      return NextResponse.json({ log: ['No user or settings found'] })
    }

    const { settings } = user

    if (!settings.enableSync) {
      log.push('❌ Sync is disabled in settings')
      return NextResponse.json({ log })
    }

    if (!user.googleAccount) {
      log.push('❌ Google Calendar not connected')
      return NextResponse.json({ log })
    }

    if (!user.slackAccount) {
      log.push('❌ Slack not connected')
      return NextResponse.json({ log })
    }

    log.push('✅ Both integrations connected')
    log.push(`   Google: ${user.googleAccount.email || 'unknown'}`)
    log.push(`   Slack: ${user.slackAccount.teamName}`)

    // Check token
    const accessToken = await refreshAccessToken(userId)
    if (!accessToken) {
      log.push('❌ Failed to get valid Google access token (token may have expired or been revoked)')
      return NextResponse.json({ log })
    }
    log.push('✅ Google access token is valid')

    // Check working hours
    const now = new Date()
    const dayOfWeek = now.getDay()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const enabledDays = settings.workingDays.split(',').map((d) => parseInt(d.trim(), 10))
    const [startH, startM] = settings.workStartTime.split(':').map(Number)
    const [endH, endM] = settings.workEndTime.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM
    const inWorkingHours = enabledDays.includes(dayOfWeek) && currentMinutes >= startMinutes && currentMinutes < endMinutes

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    log.push(`ℹ️  Current time: ${dayNames[dayOfWeek]} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} (server time, UTC offset: ${-now.getTimezoneOffset() / 60})`)
    log.push(`ℹ️  Working hours: ${settings.workStartTime}–${settings.workEndTime} on days [${enabledDays.map((d) => dayNames[d]).join(', ')}]`)

    if (!inWorkingHours) {
      log.push('❌ Outside working hours — sync skipped (check that server timezone matches your timezone)')
      return NextResponse.json({ log })
    }
    log.push('✅ Within working hours')

    // Fetch events
    const events = await getCurrentEvents(userId)
    log.push(`ℹ️  Raw events returned from Google Calendar: ${events.length}`)

    if (events.length === 0) {
      log.push('ℹ️  No current events found — checking if there are events in the broader window...')

      // Fetch raw from Google to help debug
      const calendarId = encodeURIComponent(user.googleAccount.calendarId || 'primary')
      const timeMin = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString()
      const timeMax = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString()
      const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' })
      const resp = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (resp.ok) {
        const data = await resp.json()
        const allEvents = data.items || []
        log.push(`ℹ️  Events in ±8h window: ${allEvents.length}`)
        for (const e of allEvents.slice(0, 5)) {
          const start = e.start?.dateTime || e.start?.date || '?'
          const end = e.end?.dateTime || e.end?.date || '?'
          const startDate = new Date(start)
          const endDate = new Date(end)
          const isNow = startDate <= now && now < endDate
          log.push(`   ${isNow ? '▶' : ' '} "${e.summary || '(no title)'}" [${e.eventType || 'default'}] ${start} → ${end} status=${e.status}`)
        }
        if (allEvents.length > 5) log.push(`   ... and ${allEvents.length - 5} more`)
      }
      return NextResponse.json({ log })
    }

    for (const e of events) {
      const filtered = settings.privateEventMode === 'ignore' && e.visibility === 'private'
      log.push(`ℹ️  Event: "${e.summary || '(no title)'}" [${e.eventType || 'default'}]${filtered ? ' — FILTERED (private, ignore mode)' : ''}`)
    }

    // Apply private event filter
    let filtered = events
    if (settings.privateEventMode === 'ignore') {
      filtered = filtered.filter((e) => e.visibility !== 'private')
    }

    if (filtered.length === 0) {
      log.push('❌ All events filtered out (all are private and privateEventMode=ignore)')
      return NextResponse.json({ log })
    }

    // Find best event
    const getPriority = (eventType?: string): number => {
      if (eventType === 'outOfOffice') return 3
      if (eventType === 'focusTime') return 2
      return 1
    }
    const sortedEvents = [...filtered].sort((a, b) => getPriority(b.eventType) - getPriority(a.eventType))

    let selectedEvent = null
    for (const event of sortedEvents) {
      const et = event.eventType
      if (et === 'outOfOffice' && !settings.outOfOfficeEnabled) {
        log.push(`   Skipping outOfOffice event (disabled in settings)`)
        continue
      }
      if (et === 'focusTime' && !settings.focusTimeEnabled) {
        log.push(`   Skipping focusTime event (disabled in settings)`)
        continue
      }
      if (et !== 'outOfOffice' && et !== 'focusTime' && !settings.regularEventsEnabled) {
        log.push(`   Skipping regular event (disabled in settings)`)
        continue
      }
      selectedEvent = event
      break
    }

    if (!selectedEvent) {
      log.push('❌ No enabled event type found — check Event Types settings')
      return NextResponse.json({ log })
    }

    log.push(`✅ Selected event: "${selectedEvent.summary || 'Meeting'}" [${selectedEvent.eventType || 'default'}]`)

    // Check lastSetEventId
    if (settings.lastSetEventId === selectedEvent.id) {
      log.push('ℹ️  Same event already synced — status is already set, nothing to do')
      return NextResponse.json({ log })
    }

    log.push(`ℹ️  DB state: lastSetStatusText="${settings.lastSetStatusText}", lastSetEventId="${settings.lastSetEventId}"`)

    // Check respectManualStatus
    if (settings.respectManualStatus && settings.lastSetStatusText) {
      const currentStatus = await getSlackStatus(user.slackAccount.accessToken)
      log.push(`ℹ️  Current Slack status: "${currentStatus?.statusText ?? 'null'}"`)

      if (currentStatus && currentStatus.statusText !== '' && currentStatus.statusText !== settings.lastSetStatusText) {
        log.push(`❌ Respect Manual Status: Slack status "${currentStatus.statusText}" differs from last set "${settings.lastSetStatusText}" — assuming manual change, skipping`)
        return NextResponse.json({ log })
      }
    }

    log.push('✅ All checks passed — sync would set status (this is a dry-run, no changes made)')
    log.push(`   Would set: "${selectedEvent.summary || 'Meeting'}"`)

    return NextResponse.json({ log })
  } catch (error) {
    log.push(`❌ Error: ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ log }, { status: 500 })
  }
}
