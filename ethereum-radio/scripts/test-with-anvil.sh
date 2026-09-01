#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

docker compose -f ../docker-compose.test.yml up -d --wait
trap "docker compose -f ../docker-compose.test.yml down" EXIT

pnpm --filter template-ethereum-contracts run deploy localhost --skip-prompts
pnpm run test:only
