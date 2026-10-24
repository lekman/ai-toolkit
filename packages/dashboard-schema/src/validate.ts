/**
 * Validation against schema/dashboard-item.schema.json, for writers that take
 * items from outside the process, such as the MCP server.
 */

import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

import type { DashboardItem } from "./types.ts";

import schema from "../schema/dashboard-item.schema.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const check = ajv.compile<DashboardItem>(schema);

/** Thrown with every schema error when an item is not valid. */
export class InvalidItem extends Error {
  constructor(readonly errors: string[]) {
    super(`item is not valid: ${errors.join("; ")}`);
  }
}

/** Throw InvalidItem unless the value is a valid dashboard item. */
export function validateItem(value: unknown): asserts value is DashboardItem {
  if (check(value)) return;
  throw new InvalidItem(
    (check.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "is not valid"}`,
    ),
  );
}
