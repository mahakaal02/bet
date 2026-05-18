#!/usr/bin/env bash
# Build all 5 Kalki service images for linux/amd64 and push to Docker Hub
# under saurav7055/kalki-<service>. Tags every image with `latest` and the
# current YYYYMMDD-HHMM. Override DOCKER_USER / TAG / PLATFORM via env.

set -euo pipefail

DOCKER_USER="${DOCKER_USER:-saurav7055}"
PLATFORM="${PLATFORM:-linux/amd64}"
TAG="${TAG:-$(date +%Y%m%d-%H%M)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SERVICES=(backend bet auctions aviator admin)

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
  echo
  echo "=============================================="
  echo ">>> building ${image}:${TAG} from ${ctx}"
  echo "=============================================="
  docker buildx build \
    --platform "${PLATFORM}" \
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
