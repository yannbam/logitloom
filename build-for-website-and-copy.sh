# build the site to dist/ for vgel.me/logitloom

DEPLOY_PATH=/home/vogel/prog/blog-vgel/static/logitloom
FIND='</body>'
REPLACE='    <script data-goatcounter="https://stats.vgel.me/count" async src="//stats.vgel.me/count.js"></script>
</body>'

bun build --outdir=dist index.html

mv dist/index.html dist/index.original.html
rg \
    --passthru \
    --fixed-strings "$FIND" \
    --replace "$REPLACE" \
    dist/index.original.html \
    > dist/index.html

if [ -z "$DEPLOY_PATH" ]; then
    echo "DEPLOY_PATH not set!"
    exit 1
fi

# trailing slash on dist/ important! copy contents instead of folder
rsync -av --delete dist/ "$DEPLOY_PATH"

echo "Copied, remember to run make build && make deploy in the blog-vgel directory."
