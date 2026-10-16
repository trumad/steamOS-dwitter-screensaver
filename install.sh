#!/usr/bin/env bash
# Copies the screensaver into Steam's custom screensaver folder.
#
#   ./install.sh                          install on this computer
#   ./install.sh deck@steamdeck.local     install on a Steam Deck over SSH (needs ssh and rsync)
#   STEAM_ROOT=/path/to/Steam ./install.sh   use a Steam folder that is somewhere else
#
# Your own config.js and custom-dweets.js are never overwritten. If the new versions differ from yours, they
# are saved next to them as config.js.new and custom-dweets.js.new.
# Windows: copy the dwitter folder by hand, see the README.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/dwitter"
NAME="dwitter"
REMOTE="${1:-}"
RELATIVE_DEST=".steam/root/config/uioverrides/screensavers/$NAME"
# Files that earlier versions installed and later ones no longer use; they are removed when you update.
LEFTOVERS="dbloader.html dbloader.js"

if [ ! -f "$SRC/index.html" ]; then
    echo "Could not find the screensaver folder at $SRC" >&2
    exit 1
fi

if [ -n "$REMOTE" ]; then
    command -v rsync >/dev/null 2>&1 || { echo "Installing over SSH needs rsync." >&2; exit 1; }
    ssh "$REMOTE" "mkdir -p \"\$HOME/$RELATIVE_DEST\""
    rsync -a --exclude config.js --exclude custom-dweets.js "$SRC/" "$REMOTE:$RELATIVE_DEST/"
    rsync -a --ignore-existing --include config.js --include custom-dweets.js --exclude '*' "$SRC/" "$REMOTE:$RELATIVE_DEST/"
    ssh "$REMOTE" "cd \"\$HOME/$RELATIVE_DEST\" && rm -f $LEFTOVERS"
    echo "Installed on $REMOTE in ~/$RELATIVE_DEST"
    if [ ! -f "$SRC/dweets.js" ]; then
        echo "The database is not included. On the Deck, run: ./get-database.sh ~/$RELATIVE_DEST"
        echo "(or download https://dweetabase.3d2k.com/dweets.js and save it in that folder)."
    fi
    echo "Then choose it in Steam: Settings > Customization > Screensaver (restart Steam if it is not listed, or if an update seems to make no difference)."
    exit 0
fi

STEAM=""
for candidate in "${STEAM_ROOT:-}" "$HOME/.steam/root" "$HOME/.local/share/Steam" \
    "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam" "$HOME/Library/Application Support/Steam"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
        STEAM="$candidate"
        break
    fi
done
if [ -z "$STEAM" ]; then
    echo "Could not find your Steam folder. Run it as: STEAM_ROOT=/path/to/Steam ./install.sh" >&2
    exit 1
fi

DEST="$STEAM/config/uioverrides/screensavers/$NAME"
mkdir -p "$DEST"
for item in "$SRC"/*; do
    base="$(basename "$item")"
    case "$base" in
        config.js | custom-dweets.js)
            if [ ! -e "$DEST/$base" ]; then
                cp "$item" "$DEST/$base"
            elif ! cmp -s "$item" "$DEST/$base"; then
                cp "$item" "$DEST/$base.new"
                echo "Kept your $base (the new default is saved as $base.new)."
            fi
            ;;
        *)
            cp -R "$item" "$DEST/$base"
            ;;
    esac
done
(cd "$DEST" && rm -f $LEFTOVERS)
echo "Installed in $DEST"

if [ ! -f "$DEST/dweets.js" ]; then
    echo
    echo "The database is not there yet. Download it with:"
    echo "    $HERE/get-database.sh \"$DEST\""
    echo "(or download https://dweetabase.3d2k.com/dweets.js and save it in that folder)."
fi
echo
echo "Now choose it in Steam: Settings > Customization > Screensaver (restart Steam if it is not listed, or if an update seems to make no difference)."
