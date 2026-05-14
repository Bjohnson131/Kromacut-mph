import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    workers: 1,
    timeout: 20 * 60 * 1000,
    expect: {
        timeout: 30 * 1000,
    },
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:5173',
        acceptDownloads: true,
        actionTimeout: 30 * 1000,
        navigationTimeout: 60 * 1000,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'off',
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 1000 },
                launchOptions: {
                    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
                },
            },
        },
    ],
});
