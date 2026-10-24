import { networkInterfaces } from "node:os";

/** Addresses that would listen on more than one interface. */
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "[::]", "*"]);

/** Thrown instead of listening when the bind would expose the server beyond one interface. */
export class UnsafeBindError extends Error {
  constructor(host: string) {
    super(
      `refusing to bind to ${host || "(empty)"}: bind to one interface, ` +
        `in production this machine's Tailscale address`,
    );
    this.name = "UnsafeBindError";
  }
}

/** Refuse a wildcard bind, which would put the server on the LAN. */
export function assertSafeBindHost(host: string): void {
  if (WILDCARD_HOSTS.has(host.trim())) throw new UnsafeBindError(host);
}

/** True when an IPv4 address is in Tailscale's range, 100.64.0.0/10. */
export function isTailnetAddress(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4) return false;
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return false;
  }
  return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

/** This machine's Tailscale IPv4 address, or null when Tailscale is not up. */
export function findTailnetAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isTailnetAddress(entry.address)) return entry.address;
    }
  }
  return null;
}
