#!/usr/bin/env bash
# Build all 5 Kalki service images for linux/amd64 and push to Docker Hub
# under saurav7055/kalki-<service>. Tags every image with `latest` and the
# current YYYYMMDD-HHMM. Override DOCKER_USER / TAG / PLATFORM via env.
#
# Public URLs (NEXT_PUBLIC_* / VITE_*) must be inlined at build time — Next.js
# and Vite both bake them into the client bundle when `npm run build` runs.
# Defaults below target the production kalki.cloud.podstack.ai cluster; set
# the corresponding env vars to retarget the build at a different cluster.
#
# Pass service names as positional args to narrow the build, e.g.:
#   ./scripts/build-and-push.sh aviator bet
# (defaults to all five when invoked without args.)

set -euo pipefail

DOCKER_USER="${DOCKER_USER:-saurav7055}"
PLATFORM="${PLATFORM:-linux/amd64}"
TAG="${TAG:-$(date +%Y%m%d-%H%M)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Per-cluster public URLs (override via env to retarget) ─────────────────
BACKEND_URL="${BACKEND_URL:-https://kalki-backend.cloud.podstack.ai}"
AUCTIONS_URL="${AUCTIONS_URL:-https://kalki-auctions.cloud.podstack.ai}"
AVIATOR_URL="${AVIATOR_URL:-https://kalki-aviator.cloud.podstack.ai}"
EXCHANGE_URL="${EXCHANGE_URL:-https://kalki-bet.cloud.podstack.ai}"
GOOGLE_ENABLED="${GOOGLE_ENABLED:-false}"

if [ "$#" -eq 0 ]; then
  SERVICES=(backend bet auctions aviator admin)
else
  SERVICES=("$@")
fi

echo ">>> Ensuring buildx builder exists"
if ! docker buildx inspect kalki-builder >/dev/null 2>&1 ; then
  docker buildx create --name kalki-builder --use
else
  docker buildx use kalki-builder
fi
docker buildx inspect --bootstrap >/dev/null

for svc in "${SERVICES[@]}" ; do
  image="docker.io/${DOCKER_USER}/kalki-${svc}"
  ctx="${ROOT}/${svc}"

  # Each service has its own --build-arg list. Backend has no public URLs to
  # bake in (server-side renders, reads env at runtime). The four UI apps
  # each pull only the subset they actually reference in client code.
  case "$svc" in
    backend)
      BUILD_ARGS=()
      ;;
    bet)
      BUILD_ARGS=(
        "--build-arg=NEXT_PUBLIC_AUCTIONS_URL=${AUCTIONS_URL}"
        "--build-arg=NEXT_PUBLIC_AVIATOR_URL=${AVIATOR_URL}"
        "--build-arg=NEXT_PUBLIC_GOOGLE_ENABLED=${GOOGLE_ENABLED}"
      )
      ;;
    auctions)
      BUILD_ARGS=(
        "--build-arg=NEXT_PUBLIC_AUCTIONS_URL=${AUCTIONS_URL}"
        "--build-arg=NEXT_PUBLIC_AVIATOR_URL=${AVIATOR_URL}"
        "--build-arg=NEXT_PUBLIC_BACKEND_URL=${BACKEND_URL}"
        "--build-arg=NEXT_PUBLIC_EXCHANGE_URL=${EXCHANGE_URL}"
      )
      ;;
    aviator)
      BUILD_ARGS=(
        "--build-arg=NEXT_PUBLIC_API_URL=${BACKEND_URL}"
        "--build-arg=NEXT_PUBLIC_AUCTIONS_URL=${AUCTIONS_URL}"
        "--build-arg=NEXT_PUBLIC_EXCHANGE_URL=${EXCHANGE_URL}"
      )
      ;;
    admin)
      BUILD_ARGS=(
        "--build-arg=VITE_API_BASE_URL=${BACKEND_URL}"
        "--build-arg=VITE_BET_BASE_URL=${EXCHANGE_URL}"
      )
      ;;
    *)
      echo "!!! unknown service: ${svc}" >&2
      exit 1
      ;;
  esac

  echo
  echo "=============================================="
  echo ">>> building ${image}:${TAG} from ${ctx}"
  if [ "${#BUILD_ARGS[@]}" -gt 0 ]; then
    for arg in ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}; do
      echo "    ${arg}"
    done
  fi
  echo "=============================================="
  docker buildx build \
    --platform "${PLATFORM}" \
    ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
    -t "${image}:${TAG}" \
    -t "${image}:latest" \
    --push \
    "${ctx}"
done

echo
echo ">>> Done. Images pushed:"
for svc in "${SERVICES[@]}" ; do
  echo "    docker.io/${DOCKER_USER}/kalki-${svc}:${TAG}"
  echo "    docker.io/${DOCKER_USER}/kalki-${svc}:latest"
done
