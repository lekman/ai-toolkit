/** A launchd agent definition: label plus rendered plist XML. */
export interface AgentPlist {
  /** Reverse-DNS launchd label. */
  label: string;
  /** Rendered property-list XML. */
  xml: string;
}

const header = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">`;

const args = (values: string[]): string =>
  values.map((value) => `    <string>${value}</string>`).join("\n");

/**
 * Builds launchd plists for the watcher and the daily reconcile scan.
 * Pure — strings in, XML out; writing and loading is the system layer's job.
 */
export class Launchd {
  /** Daily full-reconcile scan at 07:00, plus a run at load. */
  static scanAgent(
    nodePath: string,
    cliPath: string,
    logDir: string,
  ): AgentPlist {
    const label = "com.lekman.rag.scan";
    return {
      label,
      xml: `${header}
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args([nodePath, cliPath, "scan"])}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/scan.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/scan.log</string>
</dict>
</plist>
`,
    };
  }

  /** Long-lived watcher, restarted by launchd if it dies. */
  static watchAgent(
    nodePath: string,
    cliPath: string,
    logDir: string,
  ): AgentPlist {
    const label = "com.lekman.rag.watch";
    return {
      label,
      xml: `${header}
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args([nodePath, cliPath, "watch"])}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/watch.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/watch.log</string>
</dict>
</plist>
`,
    };
  }
}
