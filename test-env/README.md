# test-env — Dockerized Foundry for Local QA

A reproducible, parallel-safe Docker test environment for foundry. Boots a fresh foundry instance with deterministic seed data in about a minute (after the first build), on any port, isolated from your real dev state and from other running test instances.

Built for:

- **Manual QA** — click around a known-good foundry instance without polluting your real dev data
- **Sub-agent QA pipelines** — give a QA agent (future: Crucible) a clean, deterministic target to screenshot and diff against
- **Parallel testing** — run multiple sub-agents on different branches simultaneously without state collisions

## Quick start

```bash
# Boot a new instance — random id + random port
test-env/scripts/up.sh

# Boot with an explicit instance id and port (for scripting)
test-env/scripts/up.sh alpha 54321

# Tear it down (use the id that up.sh printed)
test-env/scripts/down.sh alpha

# Reset in place (down + up with the same id)
test-env/scripts/reset.sh alpha 54321
```

`up.sh` prints the URL and the exact `down.sh` command to tear it back down. Copy-paste friendly.

## What gets seeded

Every boot produces the same known state:

- **One sample doc** at `projects/sample/design.md` (copied from `test-env/seed/fixtures/content/`)
- **Five annotations** created via the real API:
  - Two top-level comments on different sections
  - A reply threaded under one of them
  - A reply-to-a-reply (exercises flattened-descendant rendering)
  - One resolved comment (exercises collapsed-resolved state)

Because the seed runs through the actual API endpoints, the seed script is also a living integration test for the `/api/annotations` routes.

## Parallel safety

Multiple instances can run concurrently without collisions. Each gets:

- Its own Docker containers, volumes, and network (namespaced via `COMPOSE_PROJECT_NAME=foundry-test-<id>`)
- Its own SQLite database (lives in the namespaced named volume)
- Its own host port (passed via the `PORT` env var)

Example:

```bash
# Terminal 1
test-env/scripts/up.sh alpha 54321

# Terminal 2 (simultaneously, different id + different port)
test-env/scripts/up.sh beta 54322
```

Both boot independently. Neither can see the other's annotations, docs, or DB. Teardown is per-instance — `down.sh alpha` leaves `beta` running.

## How it works

- **`compose.test.yml`** is a thin override of the production `docker-compose.yml`. It sets environment variables that disable the GitHub sync path, enable dev-mode auth, and add a healthcheck. The production `Dockerfile` is **not touched** — tests run the exact same image that ships to production.
- **Markdown fixtures** live in `seed/fixtures/content/` and are copied into the container's `/data/docs` via `docker cp` after the container passes its healthcheck. The API's file watcher picks them up.
- **Annotations + reviews** are created by `seed/fixture.mjs`, a plain Node script that calls the real API via `fetch()`. No TypeScript build step — it's ~80 lines of straight ESM.

## First build will be slow

The production `Dockerfile` is a multi-stage build with native module recompilation (`better-sqlite3`, `sqlite-vss`). Your first `up.sh` will take several minutes while Docker builds the image. **Subsequent runs hit the Docker layer cache and finish in ~30-60 seconds** — most of that is waiting for the API + Astro SSR to warm up.

If you're using this for sub-agent pipelines, pre-building the image once (`docker compose -f docker-compose.yml -f test-env/compose.test.yml build`) before the first agent run amortizes the cost.

## Customizing the seed

- **Add markdown fixtures**: drop files into `seed/fixtures/content/` at the path they should appear in the app. Example: `seed/fixtures/content/projects/myproject/design.md` becomes available at `projects/myproject/design.md` inside the test env.
- **Add annotations**: edit `seed/fixture.mjs`. It's plain ESM, uses `fetch()`, and each block is documented.

Because the seed script runs against the real API, any valid request is fair game — annotations, reviews, edits, resolves. The only constraint is that the API must be healthy (which the up script guarantees before calling the seed).

## Debugging

### Container won't become healthy

`up.sh` dumps the last 100 lines of container logs before exiting if the healthcheck doesn't pass within 90 seconds. Common causes:

- **Port already in use** — try again with a different port
- **Stale volume from a previous instance** — `down.sh <id>` first
- **First build still going** — the 90s timer starts *after* the build completes, so this shouldn't happen on second runs

### Watch logs on a running instance

```bash
COMPOSE_PROJECT_NAME=foundry-test-<id> \
  docker compose -f docker-compose.yml -f test-env/compose.test.yml logs -f
```

### Inspect the container directly

```bash
docker exec -it $(docker compose \
  -f docker-compose.yml -f test-env/compose.test.yml \
  --project-name foundry-test-<id> \
  ps -q foundry) sh
```

## Known limitations

- **macOS / Linux only** — the scripts are bash. Windows: run through WSL.
- **No CI integration yet** — this is for local dev and local sub-agents. CI wiring is a separate concern.
- **Initial build is slow** — see above.
- **Seed is static** — one fixture set for now. If you need alternate states, fork `fixture.mjs` into `fixture-<name>.mjs` and pass the filename to the up script (future enhancement).
- **Anvil (semantic search) is disabled** — set via `FOUNDRY_DISABLE_ANVIL=1` in the compose override. The ONNX embedding model Anvil loads crashes under QEMU amd64 emulation on arm64 hosts, and search isn't needed for visual QA of the review panel. Health, docs, annotations, and reviews all work without it. If you need to exercise search specifically, this test env isn't the right tool — use the real dev server (`npm run dev`) against your local DB instead.
- **Platform pinned to `linux/amd64`** — the production `Dockerfile` hard-codes a `sqlite-vss-linux-x64` path that doesn't exist on arm64 builds. Until that's fixed upstream, the test env runs through QEMU on Apple Silicon. Slower but correct. Tracked as a follow-up.
