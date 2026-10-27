/** Value types for the direct connectors. */

/** The connectors VS Code can answer itself, by their setting names. */
export type ConnectorName = "github" | "microsoft365" | "monday";

/** Which credential a request needs. */
export type Credential = "github" | "microsoft" | "monday";

/** One HTTP request standing in for one connector tool call. */
export interface ConnectorRequest {
  body?: string;
  credential: Credential;
  headers: Record<string, string>;
  method: "GET" | "POST";
  /** Turns the API's JSON into the result the connector would have given. */
  result: (json: unknown) => unknown;
  url: string;
}
