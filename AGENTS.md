# Working in personal-agent

## Layout and dependencies

- `agent/` is the Mastra/TypeScript backend (Node >=22.13), with its own `package.json` and `pnpm-lock.yaml`. Run its pnpm and script commands from `agent/`, not the repository root.
- `web/` is the separate Next.js frontend, with its own manifest and lockfile. Run its pnpm commands from `web/`; `@/*` imports are relative to that directory.
- There is no root Node package. Do not share or move dependencies, manifests, or lockfiles between the two apps. Ask before dependency changes and update the affected manifest and its matching lockfile together.
- The separate `personal-agent-durable` worktree is out of scope for changes in this checkout; do not edit it.
- Local development is `pnpm dev` in the relevant app directory, and production builds are `pnpm build` there. `agent/start.sh` loads backend secrets and runs the built Mastra output; `web/start.sh` serves an existing Next.js production build. Starting a configured server also enables its exposed routes and daily newsletter heartbeat, so it is not an offline test.

## Offline tests

From `agent/`, run the unit tests with:

```sh
pnpm exec tsx --test 'src/**/*.test.ts'
```

The README's `pnpm test` is stale: `agent/package.json` currently has no `test` script. Keep the direct `node:test`/`tsx` invocation above unless a real script is added later.

The ZIP unit test invokes the external `zip` executable to create its fixture; it is a system prerequisite, not an npm dependency. If it is missing, report that prerequisite rather than installing it without approval. These tests do not require model, calendar, email, or WhatsApp calls. Use synthetic fixtures and keep them offline.

## Local outputs, credentials, and private data

- Generated state and build output include `node_modules/`, `.mastra/`, `.next/`, `dist/`, `out/`, `.neon/`, `data/`, `next-env.d.ts`, and `*.tsbuildinfo`. Do not hand-edit generated output or commit local state.
- Keep `.env` and other environment-specific `.env*` files, `credentials.json`, and `token.json` out of commits, logs, test output, and documentation. Only reviewed placeholder examples belong in `.env.example`. `NEXT_PUBLIC_*` values are browser-public and must never contain secrets.
- Real chat exports, screenshots, newsletter content tied to a family, calendar details, email addresses, phone numbers, and school/family identifiers are private. Use synthetic data in tests and examples; do not print or upload real data during debugging.
- Review any deployment archive before sending it. Gitignore rules do not automatically exclude files from `tar`, and the README's archive example is not a complete secret/private-data exclusion policy. Transfer required secrets only through an explicitly approved deployment flow.

## Safety and approval boundaries

- Preserve the family-code middleware on dashboard operations, sync, and chat. `APP_TOKEN` unset deliberately fails open for demos; never use that configuration for production or describe it as secure setup.
- Email and WhatsApp are deny-by-default: empty or unset `ALLOWED_SENDERS` or `WHATSAPP_ALLOWED_FROM` admits nobody. Preserve that behavior and the coverage in `src/mastra/auth.test.ts`; each inbound channel needs its own allowlist check.
- Require explicit user confirmation before operations that insert or delete calendar events, send email or WhatsApp messages, create messaging inboxes/webhooks, run newsletter synchronization, or deploy/update a Sprite service. This includes indirectly triggering those effects through `/ingest`, chat tools, `/sync`, scripts, webhooks, or a running server.
- `scripts/clear-school-calendar.ts` is a destructive demo reset that deletes every event on the configured School calendar in a loop. Require specific confirmation for that script and verify the target is the intended dedicated, non-primary calendar; its `primary` guard is not sufficient protection.
- Live model extraction, school lookup/newsletter sync, Google OAuth/calendar scripts, AgentMail/Meta setup, and Sprite upload/service commands are not offline checks. Never put real credential values in commands, AGENTS.md, README files, tickets, or test fixtures.
