import { z } from 'zod';

export const name = 'list_baselines';

export const config = {
  description: 'List all stored baselines. If a project is specified, lists specs for that project with metadata. If no project is specified, lists all projects and their specs. Used by the regression QA agent to discover its test suite.',
  inputSchema: {
    project: z.string().optional().describe('Optional project filter (e.g. "foundry"). If omitted, lists all projects.'),
  },
};

export function createHandler(session) {
  return async (args) => {
    const { project } = args;

    if (project) {
      const specs = await session.baselines.list(project);
      const entries = [];
      for (const spec of specs) {
        const { pngPath, metaPath } = session.baselines.pathFor(project, spec);
        try {
          const baseline = await session.baselines.get(project, spec);
          entries.push({
            spec,
            pngPath,
            metaPath,
            meta: baseline.meta,
          });
        } catch {
          entries.push({ spec, pngPath, metaPath, meta: null });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                project,
                count: entries.length,
                baselines: entries,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const projects = await session.baselines.list();
    const result = [];
    for (const { project: proj, specs } of projects) {
      result.push({ project: proj, specs, count: specs.length });
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              count: result.length,
              projects: result,
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}
