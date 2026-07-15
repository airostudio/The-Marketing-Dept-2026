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
