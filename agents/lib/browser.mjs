import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { devices } = require('playwright');
// The package exports no cli.js subpath, so it is found next to its package.json.
const MCP_CLI = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');

/** Browser context for a persona: device, language, theme, time zone. */
export function contextOptions(persona) {
  const device = devices[persona.device];
  if (!device) throw new Error(`${persona.id}: unknown Playwright device "${persona.device}"`);
  const options = { ...device, locale: persona.locale, colorScheme: persona.colorScheme ?? 'light' };
  if (persona.timezone) options.timezoneId = persona.timezone;
  if (persona.viewport) {
    const [width, height] = persona.viewport.split('x').map(Number);
    options.viewport = { width, height };
  }
  // The engine is set by the launcher; a device entry for Safari must not switch it.
  delete options.defaultBrowserType;
  return options;
}

/**
 * Writes the Playwright MCP config and the Claude MCP config for one run.
 * Screenshots with an explicit name land in the run folder, the rest in out/.
 * The secrets file stays outside the run folder, which the page serves.
 */
export function writeMcpConfig(runDir, persona, { secretsFile = null } = {}) {
  const pwConfig = {
    browser: {
      browserName: 'chromium',
      isolated: true,
      launchOptions: { headless: true },
      contextOptions: contextOptions(persona),
    },
    outputDir: path.join(runDir, 'out'),
    saveSession: true,
  };
  const pwConfigPath = path.join(runDir, 'playwright-mcp.json');
  writeFileSync(pwConfigPath, JSON.stringify(pwConfig, null, 2));

  const claudeConfig = {
    mcpServers: {
      browser: {
        command: process.execPath,
        args: [MCP_CLI, '--config', pwConfigPath, '--caps', 'devtools,network', ...(secretsFile ? ['--secrets', secretsFile] : [])],
      },
    },
  };
  const claudeConfigPath = path.join(runDir, 'mcp.json');
  writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
  return claudeConfigPath;
}
