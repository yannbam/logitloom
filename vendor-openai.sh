# Node.js version of the original vendoring script
# This script takes the currently installed openai package, and vendors it as a .js file

echo "(vendor-openai.sh) vendoring openai to vendored/openai.js..."
npx esbuild node_modules/openai/index.js \
  --log-level=warning \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2020 \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=vendored/openai.js
