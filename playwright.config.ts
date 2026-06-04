/// <reference types="node" />
// Loads variables from `.env` into process.env (TEST_BASE_URL, TEST_EMAIL, etc.).
import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authStoragePath = path.join(__dirname, 'playwright/.auth/user.json');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 1,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000/',

    /* Visual artifacts: a scrubbable trace (DOM snapshots per step), a final
     * screenshot, and a video recording for every test. These power the rich,
     * embedded report in the portfolio's "Live QA Lab". Tune down (e.g.
     * 'retain-on-failure') if storage / run time becomes a concern. */
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },

  /* Configure projects for major browsers */
  projects: [
    //setup projects
    {
      name: 'auth-setup',
      testMatch: '**/auth.setup.ts'
    },
    //teardown projects,
    {
      name: 'cards-auth-cleanup',
      testMatch: '**/cardsCleanup.setup.ts'
    },
    //auth tests
    {
      name: 'auth-tests',
      testDir: './tests/auth',
      dependencies: ['auth-setup'],
      teardown: 'cards-auth-cleanup',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStoragePath,
      }
    },
    {
      name: 'chromium',
      testDir: './tests',
      testIgnore: '**/auth/**',
      use: { ...devices['Desktop Chrome'] },
    },
    /*
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },*/

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
