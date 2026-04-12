import { z } from 'zod';

export const name = 'navigate';

export const config = {
  description: 'Navigate the headless browser to a URL. Launches the browser on first call. Returns the final URL and HTTP status.',
  inputSchema: {
    url: z.string().url().describe('Absolute URL to navigate to.'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
      .optional()
      .describe('Playwright wait condition. Defaults to "load".'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(120_000)
      .optional()
      .describe('Navigation timeout in milliseconds. Defaults to 30000.'),
  },
};

export function createHandler(session) {
  return async (args) => {
    const result = await session.driver.navigate(args.url, {
      waitUntil: args.waitUntil,
      timeoutMs: args.timeoutMs,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, ...result }, null, 2),
        },
      ],
    };
  };
}
