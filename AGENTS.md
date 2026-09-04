<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project instructions

This repository is the source of truth for Route Policy Hub（分流清单）.

- Keep the user-facing policy model platform-neutral. Windows/macOS process-name differences belong in matchers, not separate user-visible lists.
- Preserve the read-only rule endpoints at `/rules/direct.yaml` and `/rules/proxy.yaml`.
- Persist mutable policy data only under `DATA_DIR`; never commit a real `data/policies.json`.
- Never commit subscription URLs, proxy nodes, passwords, tokens, cookies, or real `.env` files.
- Keep the management surface private to LAN or Tailscale unless the user explicitly approves public exposure and authentication is designed first.
- Before changing live Q4 NAS or Cloudflare infrastructure, read `/Users/pygmalion/Documents/Codex/Projects/003-nas-cloudflare-stack/README.md`, `docs/inventory.md`, `docs/architecture.md`, and `docs/deployment-runbook.md`.
- Use the official Clash Verge Rev application; integrate through Mihomo rule providers rather than maintaining a custom Clash fork.
- Run `pnpm lint` and `pnpm build` after source changes. Validate both rule endpoints and password-protected writes for deployment-sensitive changes.
