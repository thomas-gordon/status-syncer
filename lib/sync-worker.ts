import cron from 'node-cron'
import { runSync } from '@/lib/sync'

let started = false

export function startSyncWorker(): void {
  if (started) {
    return
  }
  started = true

  console.log('[sync-worker] Starting background sync worker (every 60s)')

  // Run immediately on startup
  runSync().catch((err) => console.error('[sync-worker] Initial sync error:', err))

  // Schedule every 60 seconds
  cron.schedule('* * * * *', async () => {
    try {
      await runSync()
    } catch (error) {
      console.error('[sync-worker] Sync error:', error)
    }
  })
}
