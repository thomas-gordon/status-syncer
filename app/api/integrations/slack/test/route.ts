import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { setSlackStatus } from '@/lib/slack'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const slackAccount = await prisma.slackAccount.findUnique({
      where: { userId: session.user.id },
    })

    if (!slackAccount) {
      return NextResponse.json(
        { error: 'Slack not connected' },
        { status: 400 }
      )
    }

    // Set a test status for 5 minutes
    const fiveMinutesFromNow = Math.floor(Date.now() / 1000) + 5 * 60

    const success = await setSlackStatus(
      slackAccount.accessToken,
      'Testing Status Watcher',
      '🧪',
      fiveMinutesFromNow
    )

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to set Slack status' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Slack test error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
