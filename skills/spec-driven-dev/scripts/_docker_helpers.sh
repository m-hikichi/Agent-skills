# Shared helpers for Docker operations across platforms (Windows/macOS/Linux).
# Usage: . "$(dirname "$0")/_docker_helpers.sh"

# Convert host path to Docker-compatible volume mount path.
# On Windows Git Bash / MSYS2, converts to mixed format (C:/Users/...).
# On non-Windows environments this is a no-op.
to_docker_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

# Run docker with MSYS path conversion disabled.
# This prevents Git Bash from mangling container paths like /workspace.
# Usage: docker_run [docker run args...]
docker_run() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" docker "$@"
}
