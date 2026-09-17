# @atlasyield/mcp

Read-only MCP server for the AtlasYield judgment layer. Six tools, no key, no custody,
no execution: an agent asks for judgment and is told when a route is unsafe.

| Tool | Answers |
|---|---|
| `get_vault_score` | Latest 16-factor Atlas Score for one vault (composite, label, 4 pillars, live APY/TVL). |
| `get_coverage` | What is scored right now: vault count, TVL, score spread, by protocol and chain. |
| `check_route_survival` | Can a deposit be exited at size, measured today? `blocking:true` means refuse. |
| `list_open_alerts` | Open blowup-monitor alerts from the published daily snapshot. |
| `explain_vault_score` | Why: all 16 factors by pillar (sub-score, weight, raw input, label) and the three weakest. |
| `compare_vaults` | 2-8 vaults side by side, ranked by composite; unscored ones stay visible as `found:false`. |

Data comes from the public API `https://api.atlasyield.club/v1` and the published score
history `https://github.com/gveshk/atlasyield-score-history`. Scored every 4 hours, snapshot
published daily. Research and information, not investment advice.

## Install

Claude Code:

```bash
claude mcp add atlasyield -- npx -y @atlasyield/mcp
```

Claude Desktop / Cursor / any stdio client (`mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "atlasyield": { "command": "npx", "args": ["-y", "@atlasyield/mcp"] }
  }
}
```

From a checkout: `npm run build -w apps/mcp` then use `"command": "node", "args": ["<repo>/apps/mcp/dist/index.js"]`.

## Try it

> Is Morpho WETH on Base (0x09832347586e238841f49149c84d121bc2191c53) safe to enter at $10k?

The agent calls `get_vault_score`, then `check_route_survival`. A `NO_ROUTE` verdict comes
back as `blocking: true` and a plain-English refusal.

Without an MCP client: `npm run build && node scripts/smoke.mjs check_route_survival '{"chainId":8453,"address":"0x..."}'`
speaks raw JSON-RPC to the binary over stdio.

## Environment

- `ATLAS_API_BASE` — override the API base (default `https://api.atlasyield.club/v1`)
- `ATLAS_SNAPSHOT_BASE` — override the score-history raw base

## What this is not

No deposit, sign, or send tool exists here and none will be added. Execution, if offered, is a
separate API with its own guards (`recipient-safety`, `assertRouteValue`) — never an MCP tool.

Docs: https://docs.atlasyield.club/api-reference/mcp · Licence: MIT · Data licence:
https://atlasyield.club/data-license
