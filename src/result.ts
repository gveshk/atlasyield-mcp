/**
 * MCP CallToolResult shape, built two ways only: ok() with a JSON payload
 * the agent can parse, or fail() with isError so the agent sees the outage
 * or refusal as data instead of a transport crash.
 */
export const DISCLAIMER = 'Research and information, not investment advice.';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [k: string]: unknown;
}

export function ok(payload: Record<string, unknown>): ToolResult {
  const structured = { ...payload, disclaimer: DISCLAIMER };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Normalise any thrown value into a fail() result. */
export function failFrom(err: unknown): ToolResult {
  if (err instanceof Error) return fail(err.name === 'AtlasApiError' ? err.message : `atlasyield-mcp: ${err.message}`);
  return fail(`atlasyield-mcp: ${String(err)}`);
}

/** vaultIds are not uniformly protocol:chain:address — always take the LAST segment. */
export function addressOf(vaultId: string): string {
  return (vaultId.split(':').pop() ?? vaultId).toLowerCase();
}
