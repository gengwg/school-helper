#!/bin/bash
# Service entrypoint on the sprite: load secrets, then run the built Mastra server.
cd "$(dirname "$0")"
set -a; . ./.env; set +a
exec node .mastra/output/index.mjs
