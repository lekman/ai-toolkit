/**
 * Tailscale's CGNAT range, 100.64.0.0/10.
 *
 * Tailscale assigns every node an address in this range. Matching on it is how
 * the server recognises its own tailnet address without shelling out to the
 * `tailscale` CLI, which may not be on PATH under launchd.
 */
const TAILNET_FIRST_OCTET = 100;
const TAILNET_SECOND_MIN = 64;
const TAILNET_SECOND_MAX = 127;

/** Addresses that expose a server beyond the one interface it was given. */
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "[::]", "*"]);

/** Thrown instead of listening when the requested bind would over-expose. */
export class UnsafeBindError extends Error {
  constructor(host: string) {
    super(
      `refusing to bind to ${host || "(empty)"}: this server must bind to one ` +
        `specific interface. A wildcard bind would expose the index on every ` +
        `interface including the LAN, which the design forbids.`,
    );
    this.name = "UnsafeBindError";
  }
}

/**
 * Reject a bind address that would listen on more than one interface.
 *
 * The whole security posture of the always-on server is "tailnet only, never
 * public", and a wildcard bind is the single mistake that silently converts it
 * into a LAN service while every functional test still passes. Refusing to
 * start is the correct failure: an unreachable server is a visible problem, an
 * over-exposed one is not.
 */
export function assertSafeBindHost(host: string): void {
  if (WILDCARD_HOSTS.has(host.trim())) throw new UnsafeBindError(host);
}

/** True when an IPv4 address falls inside 100.64.0.0/10. */
export function isTailnetAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === TAILNET_FIRST_OCTET &&
    second >= TAILNET_SECOND_MIN &&
    second <= TAILNET_SECOND_MAX
  );
}
