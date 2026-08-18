import { networkInterfaces } from "node:os";

import { isTailnetAddress } from "./tailnet";

/**
 * This machine's Tailscale IPv4 address, or null when it has none.
 *
 * Returning null rather than falling back to another interface is deliberate.
 * The caller must refuse to start: binding "somewhere else" because the tailnet
 * is not up would put the index on the LAN, and a server that quietly binds the
 * wrong interface is the failure this design exists to prevent.
 */
export function findTailnetAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isTailnetAddress(entry.address)) return entry.address;
    }
  }
  return null;
}
