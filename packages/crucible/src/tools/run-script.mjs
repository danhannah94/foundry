import { z } from 'zod';

export const name = 'run_script';

export const config = {
  description:
    'Run a JavaScript expression in the current page context. ' +
    'Useful for setting localStorage, reading DOM state, or preparing the page before screenshotting. ' +
    'Returns the serialized result of the expression.',
  inputSchema: {
    expression: z
      .string()
      .describe('JavaScript expression to evaluate in the page context.'),
  },
};

export function createHandler(session) {
  return async (args) => {
    const result = await session.driver.evaluate(args.expression);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, result }, null, 2),
        },
      ],
    };
  };
}
