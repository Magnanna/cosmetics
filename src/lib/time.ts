/** Kenfri's business day is the Nairobi calendar day, not UTC. */
export function nairobiDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(d);
}
