#!/usr/bin/env bash
# Downloads the Dweetabase archive (every dweet) for the screensaver to use.
#
#   ./get-database.sh                  save it in ./dwitter (the copy in this repository)
#   ./get-database.sh <folder>         save it in another folder, for example an installed screensaver:
#   ./get-database.sh ~/.steam/root/config/uioverrides/screensavers/dwitter
#
# Run it again whenever you want a newer copy. The previous one is kept as dweets.js.bak.
# Needs curl. To download by hand instead, open https://dweetabase.3d2k.com/dweets.js in a browser,
# save the page as dweets.js and put it in the screensaver folder.
set -euo pipefail

URL="${DWEETS_URL:-https://dweetabase.3d2k.com/dweets.js}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$HERE/dwitter}"
MIN_BYTES=1000000

if [ ! -d "$TARGET" ]; then
    echo "Folder not found: $TARGET" >&2
    echo "Pass the screensaver folder as the first argument, or run ./install.sh first." >&2
    exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
    echo "This needs curl, which was not found." >&2
    exit 1
fi

TMP="$(mktemp "$TARGET/dweets.js.tmp.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

echo "Downloading $URL"
curl --fail --location --retry 3 --connect-timeout 15 --progress-bar -o "$TMP" "$URL"

# Make sure a failed or partial download never replaces a working database.
SIZE="$(wc -c < "$TMP" | tr -d ' ')"
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
    echo "The download is only $SIZE bytes, which is too small to be the database. Keeping what you had." >&2
    exit 1
fi
if ! head -c 20 "$TMP" | grep -q '^let dweets = \['; then
    echo "The download does not start with 'let dweets = [', so it is not the database. Keeping what you had." >&2
    exit 1
fi
if ! tail -c 16 "$TMP" | grep -q '\];'; then
    echo "The download does not end with '];', so it is incomplete. Keeping what you had." >&2
    exit 1
fi

if [ -f "$TARGET/dweets.js" ]; then
    cp "$TARGET/dweets.js" "$TARGET/dweets.js.bak"
fi
chmod 644 "$TMP"
mv "$TMP" "$TARGET/dweets.js"
trap - EXIT

COUNT="$(grep -c '^{"id":' "$TARGET/dweets.js" || true)"
echo "Saved $TARGET/dweets.js ($SIZE bytes, $COUNT dweets)."
