# Sample Design Doc

> A deterministic fixture for the foundry test environment.

This document exists purely to give the foundry API something to anchor test annotations on. The content is intentionally minimal — what matters is that the sections below exist so the seed script can create deterministic comments against known heading paths.

## Overview

This section sets the stage. It's short on purpose. A real design doc would include a one-line pitch, the problem statement, the proposed approach, and a rough scope. This one does not — it's a fixture, not a real doc.

The test env's seed script attaches a top-level comment to this section. If you're manually QAing the review panel, you should see a single comment here with the text *"This section sets the stage. Consider adding a one-line pitch at the top for scannability."*

## Architecture

The architecture of this fixture is deliberately trivial:

- **One layer**: this document
- **No dependencies**: it doesn't reference anything
- **No implementation**: just words

This section is the **root of a reply thread** in the seeded state. It has:

1. A top-level comment asking about layer boundaries
2. An AI reply that lists three layers (frontend, API, MCP)
3. A human reply-to-reply asking where auth fits

The reply-to-reply is the important one — it exercises the flattened-descendant rendering path in `AnnotationThread.tsx` that was fixed in PR #124. If you expand the thread and see three nested-looking comments under the top-level, the render path is working.

## Open Questions

- What color should the example button be?
- How many fields does the example form need?
- Does the example section need a subsection?

These are intentionally trivial. **One of them has a resolved comment attached in the seeded state** — exercising the collapsed-resolved rendering. Click to expand to see the comment text.
