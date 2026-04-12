import { z } from 'zod';
import { diffPngs } from '../diff/pixelmatch.mjs';

export const name = 'compare_screenshots';

export const config = {
  description: 'Diff a screenshot against a stored baseline using pixelmatch. If `pngBase64` is omitted, the most recent screenshot from this session is used. Returns match score, pixel counts, and a verdict (pass/fail/needs_review). Verdict is "pass" if matchScore >= 1 - matchTolerance, otherwise "needs_review" if no baseline exists, otherwise "fail".',
  inputSchema: {
    project: z.string().describe('Project segment (e.g. "foundry").'),
    spec: z.string().describe('Spec segment (e.g. "annotations-reply-flow").'),
    pngBase64: z.string().optional().describe('Optional base64 PNG to compare. Defaults to the last screenshot captured in this session.'),
    threshold: z.number().min(0).max(1).optional().describe('Pixelmatch per-pixel YIQ threshold. Defaults to 0.1.'),
    matchTolerance: z.number().min(0).max(1).optional().describe('How much pixel mismatch to tolerate for a pass verdict. Defaults to 0.001 (0.1%).'),
  },
};

export function createHandler(session) {
  return async (args) => {
    const { project, spec, pngBase64, threshold, matchTolerance = 0.001 } = args;

    const actual = pngBase64
      ? Buffer.from(pngBase64, 'base64')
      : (session.lastScreenshot && session.lastScreenshot.png);

    if (!actual) {
      throw new Error('No screenshot to compare: pass pngBase64 or call screenshot_page first.');
    }

    const baseline = await session.baselines.get(project, spec);
    if (!baseline) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                verdict: 'needs_review',
                reason: 'no_baseline',
                project,
                spec,
                hint: 'Call approve_baseline to seed this spec with the current screenshot.',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const diff = await diffPngs(actual, baseline.png, { threshold });
    const passThreshold = 1 - matchTolerance;
    const verdict = diff.matchScore >= passThreshold ? 'pass' : 'fail';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              verdict,
              project,
              spec,
              matchScore: diff.matchScore,
              diffPixels: diff.diffPixels,
              totalPixels: diff.totalPixels,
              width: diff.width,
              height: diff.height,
              threshold: diff.threshold,
              matchTolerance,
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}
