import {defineConfig, devices} from '@playwright/test';

const executablePath = process.env.CHROME_BIN?.trim();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {timeout: 8_000},
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath
      ? {
          launchOptions: {
            executablePath,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
          },
        }
      : {}),
  },
  outputDir: 'test-results/playwright',
});
