import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { store } from '../lib/store.js';
import { generateSummary } from './summary.js';

let task = null;

/** Rebuilds every connected company's summary on a cron so the dashboard is warm. */
export function startScheduler() {
  if (!config.scheduler.enabled) {
    logger.info('Auto-refresh disabled (set AUTO_REFRESH_ENABLED=true to turn it on)');
    return null;
  }
  if (!cron.validate(config.scheduler.cron)) {
    logger.error(`Invalid AUTO_REFRESH_CRON: ${config.scheduler.cron}`);
    return null;
  }

  task = cron.schedule(config.scheduler.cron, refreshAll, { scheduled: true });
  logger.info(`Auto-refresh scheduled: ${config.scheduler.cron}`);
  return task;
}

export async function refreshAll() {
  const realmIds = await store.keys('tokens');
  logger.info(`Auto-refresh starting for ${realmIds.length} connection(s)`);

  const results = [];
  // Sequential on purpose: each company already saturates the rate limiter.
  for (const realmId of realmIds) {
    try {
      const summary = await generateSummary(realmId);
      results.push({ realmId, ok: true, durationMs: summary.durationMs });
    } catch (err) {
      logger.error(`Auto-refresh failed for ${realmId}: ${err.message}`);
      results.push({ realmId, ok: false, error: err.message });
    }
  }
  return results;
}

export function stopScheduler() {
  task?.stop();
  task = null;
}

export const schedulerStatus = () => ({
  enabled: config.scheduler.enabled,
  cron: config.scheduler.cron,
  running: Boolean(task),
});
