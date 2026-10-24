/** The launchd label for the poller. */
export const LABEL = "com.lekman.gh-events";

const xmlEscape = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Renders the poller's launch agent: run `poll` every `interval` seconds and
 * at load. launchd starts no second copy while one is still running, so slow
 * polls never overlap. Pure; the CLI writes and loads it.
 */
export function plist(options: {
  bun: string;
  cli: string;
  interval: number;
  log: string;
  path: string;
}): string {
  const s = (value: string): string => `<string>${xmlEscape(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${s(LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${s(options.bun)}
    ${s(options.cli)}
    <string>poll</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    ${s(options.path)}
  </dict>
  <key>StartInterval</key>
  <integer>${options.interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  ${s(options.log)}
  <key>StandardErrorPath</key>
  ${s(options.log)}
</dict>
</plist>
`;
}
