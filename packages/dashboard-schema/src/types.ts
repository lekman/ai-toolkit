/**
 * Types matching schema/dashboard-item.schema.json. A superset of the Atlas
 * BacklogItem: every Atlas field keeps its name, so an Atlas item copies
 * across unchanged.
 */

export type Classification =
  "public" | "internal" | "client-confidential" | "restricted";

export type State = "todo" | "doing" | "review" | "done" | "dropped";

/** Atlas's priority words, used for both the stored fallback and the computed result. */
export type Priority = "high" | "normal" | "low";

export type BusinessValue =
  "negative" | "none" | "low" | "medium" | "high" | "veryHigh";

export type Effort = "XS" | "S" | "M" | "L" | "XL";

/** An ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** An ISO date-time with zone, for example `2026-10-24T11:18:00Z`. */
export type IsoDateTime = string;

export interface Tracker {
  system: "jira" | "monday" | "github" | "other";
  key: string;
  url: string;
}

export interface BlockedOn {
  since: IsoDate;
  waitingFor: string;
  reason?: string;
}

export interface HistoryEntry {
  kind: "added" | "moved" | "state" | "edited" | "claimed" | "released";
  on: IsoDate;
  at?: IsoDateTime;
  by?: string;
  from?: string;
  to?: string;
}

export interface LogEntry {
  at: IsoDateTime;
  status: State | "blocked";
  note: string;
  by?: string;
}

export interface DashboardItem {
  id: string;
  classification: Classification;
  boundary: string;
  clientId: string;
  requirementId?: string;
  workstreamId?: string;
  title: string;
  summary?: string;
  state: State;
  priority: Priority;
  tracker?: Tracker;
  effort?: Effort;
  businessValue?: BusinessValue;
  due?: IsoDate;
  scheduledFor?: IsoDate;
  rank?: string;
  blocked?: boolean;
  blockedOn?: BlockedOn;
  doneOn?: IsoDate;
  kind?: "work" | "admin";
  detailsId?: string;
  history?: HistoryEntry[];
  log?: LogEntry[];
  claim?: { by: string; at: IsoDateTime };
  tags?: string[];
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** How close the due date is. `now`: overdue or within 2 working days. */
export type Urgency = "now" | "soon" | "none";

/**
 * Covey's matrix from First Things First. Important means business value
 * medium or above; urgent means urgency now or soon. `unsized` until both
 * businessValue and effort are set.
 */
export type Quadrant =
  "Q1-do-now" | "Q2-schedule" | "Q3-minimise" | "Q4-drop" | "unsized";

export interface Assessment {
  priority: Priority;
  urgency: Urgency;
  quadrant: Quadrant;
  /** True when priority came from the inputs; false when it is the stored fallback. */
  computed: boolean;
  /** One line a person can read, for example "medium value, XS effort: high". */
  reason: string;
}
