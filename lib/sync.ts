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
  workingDays: string
): boolean {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sunday, 1 = Monday...

  const enabledDays = workingDays
    .split(',')
    .map((d) => parseInt(d.trim(), 10))

  if (!enabledDays.includes(dayOfWeek)) {
    return false
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
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
        settings.workingDays
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
    const events = await getCurrentEvents(userId)

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
    // someone changed it manually — skip
    if (settings.respectManualStatus && settings.lastSetStatusText) {
      const currentStatus = await getSlackStatus(user.slackAccount.accessToken)
      if (
        currentStatus &&
        currentStatus.statusText !== settings.lastSetStatusText
      ) {
        return
      }
    }

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
