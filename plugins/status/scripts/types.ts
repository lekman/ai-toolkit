/** Types for the service status check. No logic. */

/** How a service stands, worst last except unknown. */
export type Level = "degraded" | "maintenance" | "ok" | "outage" | "unknown";

/** One open incident or notice behind a level other than ok. */
export interface Incident {
  /** Provider status word, such as "investigating" or "Service degradation". */
  status?: string;
  /** What the provider says is wrong, one line. */
  title: string;
  /** When the provider last updated it, ISO time. */
  updated?: string;
  /** A page with the details. */
  url?: string;
}

/** What one service check found. */
export interface ServiceResult {
  /** Why the level could not be read: the feed failed or a name was not found. */
  error?: string;
  /** Open incidents and notices, newest information first. */
  incidents: Incident[];
  /** The provider kind that was read. */
  kind: ServiceKind;
  /** The service's level. */
  level: Level;
  /** The service's name from the configuration. */
  name: string;
  /** False when the request got no answer at all: a network error or a timeout. */
  reached: boolean;
  /** The page a person opens to read more. */
  source: string;
  /** One line for the report. */
  summary: string;
}

/** The provider kinds the check can read. */
export type ServiceKind =
  "aws" | "google-workspace" | "http" | "microsoft" | "statuspage";

/** An Atlassian Statuspage site, such as https://www.githubstatus.com. */
export interface StatuspageService {
  /** Only these components decide the level. Without it, the page's overall indicator does. */
  components?: string[];
  kind: "statuspage";
  name: string;
  /** The page's base URL. The check reads `<url>/api/v2/summary.json`. */
  url: string;
}

/** A feed on status.cloud.microsoft. */
export interface MicrosoftService {
  /** For a feed that lists services, only these service names decide the level. */
  components?: string[];
  /** The feed: `mac` (Microsoft 365 for business), `m365Consumer`, `azure` or `ppac`. */
  feed: string;
  kind: "microsoft";
  name: string;
}

/** The Google Workspace status dashboard. */
export interface GoogleWorkspaceService {
  kind: "google-workspace";
  name: string;
  /** Only incidents that affect these products count, such as "Gmail". Without it, every product does. */
  products?: string[];
}

/** The AWS Health Dashboard's public current events. */
export interface AwsService {
  kind: "aws";
  name: string;
  /** Only events in these regions count, such as "eu-west-1". Without it, every region does. */
  regions?: string[];
  /** Only events for these service codes count, such as "ec2" or "s3". Without it, every service does. */
  services?: string[];
}

/** A plain HTTP probe of an endpoint you run. */
export interface HttpService {
  /** The status codes that mean up. Default: 200 to 399. */
  expect?: number[];
  kind: "http";
  name: string;
  /** The URL to request with GET. */
  url: string;
}

/** One configured service. */
export type Service =
  | AwsService
  | GoogleWorkspaceService
  | HttpService
  | MicrosoftService
  | StatuspageService;

/**
 * A connection of your own with no public status feed, such as a home
 * broadband line or a mobile network. Listed when this machine looks offline.
 */
export interface Connection {
  /** The provider, such as a broadband company. */
  name: string;
  /** Where the provider's own status checker is. */
  page?: string;
  /** A phone line that reports outages. */
  phone?: string;
  /** What the connection is for, such as "broadband" or "mobile". */
  role?: string;
}

/** The configuration file's shape. */
export interface StatusConfig {
  /** Your own connections, shown when nothing at all can be reached. */
  connections?: Connection[];
  /** The services to check, in report order. */
  services: Service[];
}

/** A fetched response: status code and raw body. */
export interface FetchedResponse {
  /** The body bytes, decoded by the parser that needs them. */
  body: Uint8Array;
  /** The HTTP status code. */
  status: number;
}
