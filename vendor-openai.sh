# bun (a/o 1.2.13 canary) has issues importing openai in the browser due to
# circular imports in the package. until that's fixed, we vendor it as a .js
# file in the repo.
# this script takes the currently installed openai package, and vendors it

echo "(vendor-openai.sh) vendoring openai to vendored/openai.js..."
bunx esbuild node_modules/openai/index.js \
  --log-level=warning \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2020 \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=vendored/openai.js
