import { z } from 'zod';

export const name = 'approve_baseline';

export const config = {
  description: 'Write the current (or provided) screenshot as the baseline for a project/spec. In v0.1 this is the only path that creates baselines — later versions will add diff-review flows. Overwrites any existing baseline for the same project/spec.',
  inputSchema: {
    project: z.string().describe('Project segment (e.g. "foundry").'),
    spec: z.string().describe('Spec segment (e.g. "annotations-reply-flow").'),
    pngBase64: z.string().optional().describe('Optional base64 PNG. Defaults to the last screenshot captured in this session.'),
    note: z.string().optional().describe('Optional free-form note stored in the baseline meta.'),
  },
};

export function createHandler(session) {
  return async (args) => {
    const { project, spec, pngBase64, note } = args;

    const last = session.lastScreenshot;
    const png = pngBase64
      ? Buffer.from(pngBase64, 'base64')
      : (last && last.png);

    if (!png) {
      throw new Error('No screenshot to approve: pass pngBase64 or call screenshot_page first.');
    }

    const meta = {
      capturedAt: (last && last.capturedAt) || new Date().toISOString(),
      url: last && last.url,
      viewport: (last && last.viewport) || session.config.viewport,
      browser: session.config.browser,
      approvedBy: 'crucible-v0.1-stub',
      note: note || null,
    };

    const { pngPath, metaPath } = await session.baselines.put(project, spec, { png, meta });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              project,
              spec,
              pngPath,
              metaPath,
              bytes: png.length,
              meta,
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}
