#!/bin/bash
# Service entrypoint on the sprite: serve the production Next.js build.
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
exec pnpm start -p 3000
