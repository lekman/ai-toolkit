/** Value types for the qualification domain. */

/**
 * Which qualification a report records.
 *
 * `IQ` and `OQ` are the installation and operational qualifications. `MAINT`
 * is the scheduled maintenance run, which compacts the store and then repeats
 * the read-only checks. It produces the same report in the same place, so it
 * belongs in this union rather than in a second one beside it.
 */
export type ReportKind = "IQ" | "MAINT" | "OQ";
