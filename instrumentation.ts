export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSyncWorker } = await import('@/lib/sync-worker')
    startSyncWorker()
  }
}
