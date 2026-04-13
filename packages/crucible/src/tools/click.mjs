import { z } from 'zod';

export const name = 'click';

export const config = {
  description:
    'Click an element matching a CSS selector on the current page. ' +
    'Useful for expanding collapsed sections, toggling UI state, or interacting with the page before screenshotting.',
  inputSchema: {
    selector: z
      .string()
      .describe('CSS selector of the element to click.'),
    timeout: z
      .number()
      .int()
      .positive()
      .max(30_000)
      .optional()
      .describe('Max time in ms to wait for the element. Defaults to 5000.'),
  },
};

export function createHandler(session) {
  return async (args) => {
    await session.driver.click(args.selector, {
      timeout: args.timeout,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, selector: args.selector }, null, 2),
        },
      ],
    };
  };
}
