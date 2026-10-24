#!/usr/bin/env bun
/**
 * The Atlas task MCP server over stdio, for one local session with direct
 * database access. Agents on the tailnet use atlas-server instead.
 *
 *   DATABASE_URL=postgres://... bun src/bin/atlas-mcp.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { connect, databaseUrl } from "../db.ts";
import { registerTaskTools } from "../tools.ts";

const { db, close } = connect(databaseUrl());
const server = new McpServer({ name: "atlas", version: "0.1.0" });
registerTaskTools(server, {
  db,
  now: () => new Date(),
  timeZone: process.env.ATLAS_TIME_ZONE ?? "Europe/London",
});
await server.connect(new StdioServerTransport());
process.stdin.on("close", () => void close());
