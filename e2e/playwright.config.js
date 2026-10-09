import { defineConfig } from '@playwright/test';

const PORT = 5099;
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  outputDir: '../test-results',
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL || 'chrome', // the installed Chrome; set PW_CHANNEL=chromium to use Playwright's build
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run build && node server/src/index.js',
    cwd: '..',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { PORT: String(PORT), PUFFS_EPHEMERAL_DB: '1', CLAUDE: 'off' },
  },
});
