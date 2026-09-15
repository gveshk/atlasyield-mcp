import { z } from 'zod';
import type { AtlasClient } from '../atlas-client.js';
import { ok, failFrom, type ToolResult } from '../result.js';

export const listOpenAlertsInput = {
  chainId: z.number().int().positive().optional().describe('Restrict to one chain id'),
  minSeverity: z.number().int().min(1).optional().describe('Only alerts at or above this severity (1 = lowest)'),
};

export const listOpenAlertsDescription =
  'Open blowup-monitor alerts from the published daily snapshot: score-band exits, fast ' +
  'composite breaks, yield collapse, TVL flight, exploit flags, delistings. Each event carries ' +
  'score before/after and pillar deltas. Published once a day; the date field says when. Read-only.';

export async function listOpenAlerts(
  client: AtlasClient,
  args: { chainId?: number; minSeverity?: number },
): Promise<ToolResult> {
  try {
    const snap = await client.getAlerts();
    const events = snap.events
      .filter((e) => args.chainId === undefined || e.chainId === args.chainId)
      .filter((e) => args.minSeverity === undefined || e.severity >= args.minSeverity);
    return ok({
      date: snap.date,
      publishedAt: snap.publishedAt,
      monitorVersion: snap.monitorVersion,
      windowDays: snap.windowDays,
      count: events.length,
      events,
      source: 'https://atlasyield.club/monitor',
    });
  } catch (err) {
    return failFrom(err);
  }
}
