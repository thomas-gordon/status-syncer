import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  console.log('Settings GET - session:', JSON.stringify(session))

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const settings = await prisma.settings.findUnique({
      where: { userId: session.user.id },
    })

    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Settings GET error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  console.log('Settings PUT - session:', JSON.stringify(session))

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()

    // Whitelist allowed fields
    const allowedFields = [
      'enableSync',
      'clearStatusOnEnd',
      'respectManualStatus',
      'muteDnd',
      'regularEventsEnabled',
      'regularEventsEmoji',
      'focusTimeEnabled',
      'focusTimeEmoji',
      'outOfOfficeEnabled',
      'outOfOfficeEmoji',
      'workStartTime',
      'workEndTime',
      'workingDays',
    ]

    const updateData: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field]
      }
    }

    const settings = await prisma.settings.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        ...updateData,
      },
      update: updateData,
    })

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Settings PUT error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
