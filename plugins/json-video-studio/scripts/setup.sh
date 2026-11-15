#!/bin/sh
# Builds the image, starts VOICEVOX, runs the doctor, and installs the personal plugin.
# Set SKIP_PERSONAL_INSTALL=1 to use the repository directly with `claude --plugin-dir`.
set -eu

plugin_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
image=json-video-studio
doctor() { docker run --rm --init --network json-video-studio "$image" doctor; }

docker compose version >/dev/null

echo "Building $image ..."
docker build --tag "$image" --file "$plugin_root/mcp-server/Dockerfile" "$plugin_root"

echo 'Starting the VOICEVOX Engine ...'
docker compose --file "$plugin_root/mcp-server/compose.yml" up --detach

echo 'Waiting for the runtime doctor to pass ...'
attempt=1
until doctor >/dev/null 2>&1 || [ "$attempt" -ge 60 ]; do
  attempt=$((attempt + 1))
  sleep 2
done
doctor

echo 'Validating the bundled minimal project ...'
docker run --rm --init -e JSON_VIDEO_WORKSPACE_ROOT=/app/examples "$image" validate minimal.video-project.json

personal_path="$HOME/.claude/skills/json-video-studio"
if [ "${SKIP_PERSONAL_INSTALL:-0}" = 1 ] || [ "$plugin_root" = "$personal_path" ]; then
  :
elif [ -e "$personal_path" ]; then
  echo "Personal plugin already exists at $personal_path; it was not overwritten." >&2
else
  mkdir -p "$personal_path"
  tar -C "$plugin_root" --exclude=.git --exclude=node_modules --exclude=dist --exclude=.json-video-work -cf - . \
    | tar -C "$personal_path" -xf -
  echo "Installed the personal plugin at $personal_path"
fi

echo
echo 'Setup completed.'
if [ "${SKIP_PERSONAL_INSTALL:-0}" != 1 ] && [ -e "$personal_path" ]; then
  echo 'Start a new Claude Code session with: claude'
else
  echo "Start a new Claude Code session with: claude --plugin-dir '$plugin_root'"
fi
echo 'Check the Remotion license (https://www.remotion.dev/docs/license) and the VOICEVOX character terms before publishing.'
