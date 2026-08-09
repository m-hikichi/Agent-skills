#!/bin/sh
set -eu

plugin_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
image_name='json-video-studio:0.1.0'
compose_file="$plugin_root/compose.voicevox.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker CLI was not found. Install Docker Desktop or Docker Engine first.' >&2
  exit 3
fi

docker info >/dev/null
docker compose version >/dev/null

if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$plugin_root" --strict
fi

if [ "${SKIP_BUILD:-0}" != 1 ]; then
  echo "Building $image_name ..."
  docker build --tag "$image_name" "$plugin_root"
fi

if [ "${SKIP_VOICEVOX:-0}" != 1 ]; then
  echo 'Starting the pinned VOICEVOX Engine ...'
  docker compose --file "$compose_file" up --detach

  echo 'Waiting for the VOICEVOX Engine API and speaker models ...'
  voicevox_ready=0
  attempt=1
  while [ "$attempt" -le 60 ]; do
    if docker run --rm --network json-video-studio --entrypoint node "$image_name" -e \
      "Promise.all([fetch('http://voicevox:50021/version',{signal:AbortSignal.timeout(3000)}),fetch('http://voicevox:50021/speakers',{signal:AbortSignal.timeout(5000)})]).then(async ([version,speakers])=>{const list=await speakers.json();if(!version.ok||!speakers.ok||!Array.isArray(list)||list.length===0)process.exit(1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      voicevox_ready=1
      break
    fi
    if [ "$attempt" -lt 60 ]; then sleep 2; fi
    attempt=$((attempt + 1))
  done
  if [ "$voicevox_ready" != 1 ]; then
    echo 'VOICEVOX Engine did not become ready after 60 probes. Check: docker compose --file compose.voicevox.yml logs voicevox' >&2
    exit 3
  fi
fi

setup_data="$plugin_root/.json-video-work/setup-doctor"
mkdir -p "$setup_data"

echo 'Running the deterministic runtime doctor ...'
docker run --rm --init \
  --network json-video-studio \
  -e JSON_VIDEO_WORKSPACE_ROOT=/workspace \
  -e JSON_VIDEO_DATA_ROOT=/data \
  -e JSON_VIDEO_SCHEMA_PATH=/app/schemas/video-project.schema.json \
  -e JSON_VIDEO_UI_HOST=0.0.0.0 \
  -e JSON_VIDEO_ALLOW_CONTAINER_BIND=1 \
  -e JSON_VIDEO_UI_PORT=43120 \
  -e VOICEVOX_URL=http://voicevox:50021 \
  -v "${plugin_root}:/workspace" \
  -v "${setup_data}:/data" \
  "$image_name" doctor

echo 'Validating the bundled minimal project ...'
docker run --rm --init \
  -e JSON_VIDEO_WORKSPACE_ROOT=/app/examples \
  -e JSON_VIDEO_SCHEMA_PATH=/app/schemas/video-project.schema.json \
  "$image_name" validate minimal.video-project.json

personal_root="$HOME/.claude/skills"
personal_path="$personal_root/json-video-studio"
personal_install_ready=0
if [ "${SKIP_PERSONAL_INSTALL:-0}" = 1 ]; then
  echo 'Skipped personal plugin installation.'
elif [ "$plugin_root" = "$personal_path" ]; then
  echo "Personal plugin is already running from $personal_path"
  personal_install_ready=1
elif [ -e "$personal_path" ]; then
  echo "Personal plugin already exists at $personal_path; it was not overwritten." >&2
else
  mkdir -p "$personal_root"
  staging="$personal_root/.json-video-studio.install-$$"
  mkdir "$staging"
  trap 'rm -rf -- "$staging"' EXIT HUP INT TERM
  tar -C "$plugin_root" \
    --exclude='./.git' \
    --exclude='./.json-video-work' \
    --exclude='./dist' \
    --exclude='./runtime/node_modules' \
    --exclude='./runtime/dist' \
    --exclude='./runtime/coverage' \
    --exclude='./runtime/.vite' \
    --exclude='./runtime/test-results' \
    --exclude='./runtime/playwright-report' \
    -cf - . | tar -C "$staging" -xf -
  mv "$staging" "$personal_path"
  trap - EXIT HUP INT TERM
  echo "Installed the personal Claude Code plugin at $personal_path"
  personal_install_ready=1
fi

echo
echo 'Setup completed.'
echo 'Runtime doctor and minimal project validation passed without AI assistance.'
if [ "$personal_install_ready" = 1 ]; then
  echo 'Start a new Claude Code session with: claude'
  printf "The personal plugin at %s will auto-load as json-video-studio@skills-dir.\n" "$personal_path"
else
  printf "Start the current source with: claude --plugin-dir '%s'\n" "$plugin_root"
fi
echo 'The local editor will be available at http://127.0.0.1:43120 after the MCP server starts.'
echo 'Before organizational use or offering a service, re-check the current Remotion terms: https://www.remotion.dev/docs/license/pricing'
echo 'Review THIRD_PARTY_NOTICES.md and the selected VOICEVOX character terms before publishing a video.'
