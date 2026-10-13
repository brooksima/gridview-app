#!/usr/bin/env bash
# Build for https://brooksima.github.io/gridview-app/ and publish dist/ to the gh-pages branch.
# Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the env or in .env (the anon key is public).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE_PATH=/gridview-app/ npm run build
cp dist/index.html dist/404.html && touch dist/.nojekyll
cd dist && rm -rf .git && git init -q -b gh-pages && git add -A \
  && git -c user.name="GridView deploy" -c user.email="matt@gridviewuasservices.com" commit -qm "Deploy $(date -u +%FT%TZ)" \
  && git push -f "$(git -C .. remote get-url origin)" gh-pages && rm -rf .git
