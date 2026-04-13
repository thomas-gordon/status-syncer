import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import DashboardClient from './DashboardClient'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string }
}) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/login')
  }

  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      googleAccount: true,
      slackAccount: true,
      settings: true,
    },
  })

  if (!user) {
    redirect('/login')
  }

  // Ensure settings exist
  if (!user.settings) {
    await prisma.settings.create({
      data: { userId },
    })
  }

  const settings = user.settings ?? {
    enableSync: true,
    clearStatusOnEnd: true,
    respectManualStatus: true,
    muteDnd: false,
    regularEventsEnabled: true,
    regularEventsEmoji: '🧑‍💻',
    focusTimeEnabled: true,
    focusTimeEmoji: '🎯',
    outOfOfficeEnabled: true,
    outOfOfficeEmoji: '🌴',
    workStartTime: '09:00',
    workEndTime: '18:30',
    workingDays: '1,2,3,4,5',
    privateEventMode: 'mask',
  }

  let connectionMessage: string | undefined
  let errorMessage: string | undefined

  if (searchParams.connected === 'google') {
    connectionMessage = 'Google Calendar connected successfully!'
  } else if (searchParams.connected === 'slack') {
    connectionMessage = 'Slack connected successfully!'
  } else if (searchParams.error) {
    const errorMap: Record<string, string> = {
      google_auth_failed: 'Google authorization was denied or failed.',
      google_token_failed: 'Failed to get Google access token.',
      google_callback_failed: 'Google connection failed. Please try again.',
      slack_auth_failed: 'Slack authorization was denied or failed.',
      slack_token_failed: 'Failed to get Slack access token.',
      slack_callback_failed: 'Slack connection failed. Please try again.',
    }
    errorMessage = errorMap[searchParams.error] || 'An error occurred. Please try again.'
  }

  return (
    <DashboardClient
      user={{
        email: user.email,
        name: user.name,
        memberSince: user.createdAt,
      }}
      isGoogleConnected={!!user.googleAccount}
      googleEmail={user.googleAccount?.email ?? null}
      isSlackConnected={!!user.slackAccount}
      slackTeamName={user.slackAccount?.teamName ?? null}
      initialSettings={{
        enableSync: settings.enableSync,
        clearStatusOnEnd: settings.clearStatusOnEnd,
        respectManualStatus: settings.respectManualStatus,
        muteDnd: settings.muteDnd,
        regularEventsEnabled: settings.regularEventsEnabled,
        regularEventsEmoji: settings.regularEventsEmoji,
        focusTimeEnabled: settings.focusTimeEnabled,
        focusTimeEmoji: settings.focusTimeEmoji,
        outOfOfficeEnabled: settings.outOfOfficeEnabled,
        outOfOfficeEmoji: settings.outOfOfficeEmoji,
        workStartTime: settings.workStartTime,
        workEndTime: settings.workEndTime,
        workingDays: settings.workingDays,
        privateEventMode: settings.privateEventMode,
      }}
      connectionMessage={connectionMessage}
      errorMessage={errorMessage}
    />
  )
}
