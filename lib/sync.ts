import { prisma } from '@/lib/db'
import { getCurrentEvents } from '@/lib/google-calendar'
import {
  setSlackStatus,
  clearSlackStatus,
  getSlackStatus,
  setDnd,
} from '@/lib/slack'

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function isWithinWorkingHours(
  workStartTime: string,
  workEndTime: string,
  workingDays: string,
  timezone: string | null
): boolean {
  const now = new Date()
  const tz = timezone || process.env.TZ || 'UTC'

  // Format current time in the target timezone to extract day/hour/minute
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || ''
  const hourStr = parts.find((p) => p.type === 'hour')?.value || '0'
  const minuteStr = parts.find((p) => p.type === 'minute')?.value || '0'

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const dayOfWeek = dayMap[weekdayStr] ?? new Date().getDay()

  const enabledDays = workingDays
    .split(',')
    .map((d) => parseInt(d.trim(), 10))

  if (!enabledDays.includes(dayOfWeek)) {
    return false
  }

  // Intl may format midnight as "24" in some locales; coerce to 0
  const hour = parseInt(hourStr, 10) % 24
  const currentMinutes = hour * 60 + parseInt(minuteStr, 10)
  const startMinutes = timeToMinutes(workStartTime)
  const endMinutes = timeToMinutes(workEndTime)

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

export async function syncUser(userId: string): Promise<void> {
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
      return
    }

    const { settings } = user

    // Only sync if enabled and both integrations connected
    if (!settings.enableSync) {
      return
    }

    if (!user.googleAccount || !user.slackAccount) {
      return
    }

    // Check working hours
    if (
      !isWithinWorkingHours(
        settings.workStartTime,
        settings.workEndTime,
        settings.workingDays,
        settings.timezone
      )
    ) {
      // Outside working hours — clear status if we set one
      if (settings.clearStatusOnEnd && settings.lastSetStatusText) {
        await clearSlackStatus(user.slackAccount.accessToken)
        await prisma.settings.update({
          where: { userId },
          data: {
            lastSetStatusText: null,
            lastSetEventId: null,
          },
        })
      }
      return
    }

    // Get current calendar events
    let events = await getCurrentEvents(userId)

    // Filter out working location events (e.g. "Home", "Office")
    events = events.filter((e) => e.eventType !== 'workingLocation')

    // Handle private events per user setting
    if (settings.privateEventMode === 'ignore') {
      events = events.filter((e) => e.visibility !== 'private')
    } else {
      // mask: replace title with "Busy" for private events
      events = events.map((e) =>
        e.visibility === 'private' ? { ...e, summary: 'Busy' } : e
      )
    }

    if (events.length === 0) {
      // No current events — clear status if clearStatusOnEnd and we set it
      if (settings.clearStatusOnEnd && settings.lastSetStatusText) {
        await clearSlackStatus(user.slackAccount.accessToken)
        await prisma.settings.update({
          where: { userId },
          data: {
            lastSetStatusText: null,
            lastSetEventId: null,
          },
        })
      }
      return
    }

    // Priority: outOfOffice (3) > focusTime (2) > default (1)
    const getPriority = (eventType?: string): number => {
      if (eventType === 'outOfOffice') return 3
      if (eventType === 'focusTime') return 2
      return 1
    }

    const sortedEvents = [...events].sort(
      (a, b) => getPriority(b.eventType) - getPriority(a.eventType)
    )

    // Find the best event to sync
    let selectedEvent = null
    let selectedEmoji = settings.regularEventsEmoji

    for (const event of sortedEvents) {
      const eventType = event.eventType

      if (eventType === 'outOfOffice') {
        if (!settings.outOfOfficeEnabled) continue
        selectedEmoji = settings.outOfOfficeEmoji
      } else if (eventType === 'focusTime') {
        if (!settings.focusTimeEnabled) continue
        selectedEmoji = settings.focusTimeEmoji
      } else {
        if (!settings.regularEventsEnabled) continue
        selectedEmoji = settings.regularEventsEmoji
      }

      selectedEvent = event
      break
    }

    if (!selectedEvent) {
      // No enabled event type found
      if (settings.clearStatusOnEnd && settings.lastSetStatusText) {
        await clearSlackStatus(user.slackAccount.accessToken)
        await prisma.settings.update({
          where: { userId },
          data: {
            lastSetStatusText: null,
            lastSetEventId: null,
          },
        })
      }
      return
    }

    // Skip if same event already set
    if (settings.lastSetEventId === selectedEvent.id) {
      return
    }

    // Respect manual status: if current Slack status differs from what we set,
    // someone changed it manually — skip.
    // Exception: an empty status means our previous status expired naturally
    // (Slack cleared it at the expiry time). Don't block the new event in that case.
    if (settings.respectManualStatus && settings.lastSetStatusText) {
      const currentStatus = await getSlackStatus(user.slackAccount.accessToken)
      if (
        currentStatus &&
        currentStatus.statusText !== '' &&
        currentStatus.statusText !== settings.lastSetStatusText
      ) {
        return
      }
    }

    console.log(`[sync] Setting status for user ${userId}: "${selectedEvent.summary}" [${selectedEvent.eventType || 'default'}]`)

    const eventTitle = selectedEvent.summary || 'Meeting'
    const endStr =
      selectedEvent.end?.dateTime || selectedEvent.end?.date
    const endTime = endStr ? new Date(endStr) : null
    const expirationUnix = endTime
      ? Math.floor(endTime.getTime() / 1000)
      : 0

    // Set Slack status
    const success = await setSlackStatus(
      user.slackAccount.accessToken,
      eventTitle,
      selectedEmoji,
      expirationUnix
    )

    if (!success) {
      return
    }

    // Set DND if muteDnd enabled
    if (settings.muteDnd && endTime) {
      const now = new Date()
      const remainingMinutes = Math.ceil(
        (endTime.getTime() - now.getTime()) / (1000 * 60)
      )
      if (remainingMinutes > 0) {
        await setDnd(user.slackAccount.accessToken, remainingMinutes)
      }
    }

    // Update DB
    await prisma.settings.update({
      where: { userId },
      data: {
        lastSetStatusText: eventTitle,
        lastSetEventId: selectedEvent.id,
      },
    })
  } catch (error) {
    console.error(`Error syncing user ${userId}:`, error)
  }
}

export async function runSync(): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: {
        settings: {
          enableSync: true,
        },
        googleAccount: {
          isNot: null,
        },
        slackAccount: {
          isNot: null,
        },
      },
      select: { id: true },
    })

    await Promise.allSettled(users.map((user) => syncUser(user.id)))
  } catch (error) {
    console.error('Error running sync:', error)
  }
}
