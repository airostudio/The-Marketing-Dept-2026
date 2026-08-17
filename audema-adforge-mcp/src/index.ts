#!/usr/bin/env node
/**
 * Audema AdForge MCP — entrypoint.
 *
 * Creates high-converting static ad concepts and production-ready ad images
 * for Audema Marketing clients: brand profiles → ad briefs → customer
 * analysis → ad angles → scored concepts → copy → layout → PNG/JPG export,
 * plus campaign result tracking and A/B test recommendations.
 *
 * Runs over stdio — this is what Claude Desktop / Cursor / any local MCP
 * client launches as a subprocess and talks to via stdin/stdout.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';

// ── Crash resilience ─────────────────────────────────────────────────────────
// Every tool handler already catches its own errors and returns an isError
// result (see src/tools/*.ts) rather than throwing — these are a last-resort
// safety net for anything that still escapes that, e.g. a bug in a handler,
// a stray unawaited promise, or an SDK-internal error. Always log to stderr,
// NEVER stdout — stdout is the MCP JSON-RPC transport itself, and writing
// anything else to it corrupts the protocol stream for the connected client.
//
// unhandledRejection: log loudly and keep running. Most of these are a single
// isolated async bug, not process corruption — killing every open tool call
// and the client's whole MCP connection over one rejected promise elsewhere
// is a worse outcome than logging it and staying up.
//
// uncaughtException: Node's own guidance is that a synchronous exception
// escaping all the way to the top can leave process state undefined — so
// unlike unhandledRejection, this logs and then exits deliberately (not a
// silent crash) rather than trying to keep serving on a process Node itself
// says may be unsafe to trust.
process.on('unhandledRejection', (reason) => {
  console.error('[audema-adforge-mcp] Unhandled promise rejection (server continuing):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[audema-adforge-mcp] Uncaught exception — exiting so the MCP client can restart a clean process:', err);
  process.exit(1);
});

const server = new McpServer({
  name: 'audema-adforge-mcp',
  version: '1.0.0',
});

registerAllTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Audema AdForge MCP server running on stdio.');
}

main().catch((err) => {
  console.error('Fatal error starting Audema AdForge MCP:', err);
  process.exit(1);
});
