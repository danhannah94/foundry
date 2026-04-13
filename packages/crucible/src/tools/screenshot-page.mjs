import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const name = 'screenshot_page';

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'crucible', 'screenshots');

export const config = {
  description: 'Capture a PNG screenshot of the current page. Requires a prior navigate call. Saves the screenshot to a temp file and returns the file path plus metadata — read the PNG file to visually inspect. The most recent screenshot is also cached in-session so compare_screenshots can reference it without re-sending bytes.',
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
    const capturedAt = new Date().toISOString();
    session.lastScreenshot = { png, viewport, url, capturedAt };

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const filename = `screenshot-${Date.now()}.png`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    await fs.writeFile(filePath, png);

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
              filePath,
              capturedAt,
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}
