#!/bin/zsh
# Builds a standalone Release MyFolio.app (JS bundle + desktop widget embedded) into ./build.
#
# Xcode's own "Bundle React Native code" phase is skipped (SKIP_BUNDLING=1) and the JS bundle is built here,
# because that phase fails to detect the macOS platform when the project path contains non-ASCII characters.
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

# Apple team ID lives in signing.local.xcconfig (git-ignored); see signing.example.xcconfig.
TEAM=$(sed -n 's/^DEVELOPMENT_TEAM *= *//p' signing.local.xcconfig 2>/dev/null)
[ -n "$TEAM" ] || { echo "Set DEVELOPMENT_TEAM in signing.local.xcconfig (copy signing.example.xcconfig)"; exit 1; }

# A failed Xcode build must stop here, not fall through to the previous build's app.
set -o pipefail
xcodebuild -workspace macos/MyFolioRN.xcworkspace -scheme MyFolioRN-macOS -configuration Release \
  -derivedDataPath macos/build CODE_SIGNING_ALLOWED=NO SKIP_BUNDLING=1 DEVELOPMENT_TEAM="$TEAM" \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
set +o pipefail

SRC_APP="macos/build/Build/Products/Release/MyFolio.app"
[ -d "$SRC_APP" ] || { echo "Xcode build failed (see xcodebuild output)"; exit 1; }

mkdir -p build
rm -rf build/MyFolio.app
cp -R "$SRC_APP" build/MyFolio.app

node node_modules/react-native-macos/scripts/bundle.js bundle \
  --entry-file index.js --platform macos --dev false --minify true \
  --bundle-output build/MyFolio.app/Contents/Resources/main.jsbundle \
  --assets-dest build/MyFolio.app/Contents/Resources \
  --config-cmd "node $ROOT/node_modules/react-native-macos/cli.js config"

# Sign with the personal team only (stable identity → no repeated keychain prompts; required for the widget's App Group).
# Never a company team: the result is checked against TEAM below.
IDENTITY="${MYFOLIO_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  # Pick the installed certificate issued to TEAM, so no personal details live in this script.
  while IFS= read -r name; do
    if security find-certificate -c "$name" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | grep -Eq "OU ?= ?$TEAM"; then
      IDENTITY="$name"
      break
    fi
  done < <(security find-identity -v -p codesigning | sed -n 's/.*"\(.*\)"$/\1/p')
fi
[ -n "$IDENTITY" ] || { echo "No signing certificate for team $TEAM (set MYFOLIO_SIGN_IDENTITY)"; exit 1; }
APP=build/MyFolio.app
for fw in "$APP"/Contents/Frameworks/*; do
  codesign --force --sign "$IDENTITY" "$fw"
done
# codesign doesn't expand build settings, so fill in the team here.
ENT=$(mktemp -d)
trap 'rm -rf "$ENT"' EXIT
sed "s/\$(DEVELOPMENT_TEAM)/$TEAM/g" macos/MyFolioWidget/MyFolioWidget.entitlements > "$ENT/widget.entitlements"
sed "s/\$(DEVELOPMENT_TEAM)/$TEAM/g" macos/MyFolioRN-macOS/MyFolioRN.entitlements > "$ENT/app.entitlements"
codesign --force --sign "$IDENTITY" --entitlements "$ENT/widget.entitlements" "$APP/Contents/PlugIns/MyFolioWidget.appex"
codesign --force --sign "$IDENTITY" --entitlements "$ENT/app.entitlements" "$APP"
for target in "$APP" "$APP/Contents/PlugIns/MyFolioWidget.appex"; do
  codesign -dv "$target" 2>&1 | grep -q "TeamIdentifier=$TEAM" || { echo "Signed with the wrong team (expected $TEAM): $target"; exit 1; }
done
# A running widget process keeps the old code; stop it so WidgetKit relaunches the new build.
pkill -f "MyFolioWidget.appex/Contents/MacOS/MyFolioWidget" || true
echo "Built $APP (team $TEAM)"
