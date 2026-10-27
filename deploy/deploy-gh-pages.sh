#!/usr/bin/env bash
# Build for https://app.gridviewuasservices.com/ (custom domain) and publish dist/ to the gh-pages branch.
# Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the env or in .env (the anon key is public).
set -euo pipefail
cd "$(dirname "$0")/.."
export BASE_PATH="${BASE_PATH:-/}"
export VITE_WEBSITE_URL="${VITE_WEBSITE_URL:-https://gridviewuasservices.com}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-app.gridviewuasservices.com}"
npm run build
cp dist/index.html dist/404.html && mkdir -p dist/demo && cp dist/index.html dist/demo/index.html && touch dist/.nojekyll
[ -n "$CUSTOM_DOMAIN" ] && echo "$CUSTOM_DOMAIN" > dist/CNAME
cd dist && rm -rf .git && git init -q -b gh-pages && git add -A \
  && git -c user.name="GridView deploy" -c user.email="matt@gridviewuasservices.com" commit -qm "Deploy $(date -u +%FT%TZ)" \
  && git push -f "$(git -C .. remote get-url origin)" gh-pages && rm -rf .git
