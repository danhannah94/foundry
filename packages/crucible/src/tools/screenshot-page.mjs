import { z } from 'zod';

export const name = 'screenshot_page';

export const config = {
  description: 'Capture a PNG screenshot of the current page. Requires a prior navigate call. Returns a base64-encoded PNG plus metadata. The most recent screenshot is also cached in-session so compare_screenshots can reference it without re-sending bytes.',
  inputSchema: {
    fullPage: z
      .boolean()
      .optional()
      .describe('If true (default), capture the full scrollable page; otherwise just the viewport.'),
  },
};

export function createHandler(session) {
  return async (args) => {
    const { png, viewport, url } = await session.driver.screenshotPage({
      fullPage: args.fullPage ?? true,
    });
    session.lastScreenshot = { png, viewport, url, capturedAt: new Date().toISOString() };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              url,
              viewport,
              bytes: png.length,
              pngBase64: png.toString('base64'),
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}
