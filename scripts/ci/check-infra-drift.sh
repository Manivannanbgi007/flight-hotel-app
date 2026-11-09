#!/usr/bin/env bash
# Fails when the copies of the infra scripts inside the data-platform Helm chart differ from the originals in infra/.
#
# Docker Compose mounts infra/ directly; the Kubernetes data-platform chart cannot read files outside its own folder, so
# it ships copies under deploy/charts/data-platform/files/ with the same relative layout:
#   infra/mysql/        -> deploy/charts/data-platform/files/mysql/        (init/01-databases-and-users.sh, conf.d/flighthotel.cnf)
#   infra/kafka/        -> deploy/charts/data-platform/files/kafka/        (create-topics.sh)
#   infra/kafka-connect/-> deploy/charts/data-platform/files/kafka-connect/ (register-connectors.sh, connectors/*.json)
# Every file must exist on both sides with identical content (extra or missing files count as drift).
#
# Usage (repository root, Linux/macOS/Git Bash):  bash scripts/ci/check-infra-drift.sh
# Fix a reported drift by copying infra/ over the chart files, e.g.:
#   rm -rf deploy/charts/data-platform/files/kafka-connect && cp -r infra/kafka-connect deploy/charts/data-platform/files/
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

src_root="infra"
dst_root="deploy/charts/data-platform/files"
subtrees=(mysql kafka kafka-connect)

status=0
for dir in "${subtrees[@]}"; do
  src="${src_root}/${dir}"
  dst="${dst_root}/${dir}"
  if [[ ! -d "${src}" ]]; then
    echo "::error title=infra drift::${src} does not exist (update scripts/ci/check-infra-drift.sh if it moved)"
    status=1
    continue
  fi
  if [[ ! -d "${dst}" ]]; then
    echo "::error title=infra drift::${dst} is missing: copy ${src} into ${dst_root}/"
    status=1
    continue
  fi
  # --strip-trailing-cr: a Windows working copy may have CRLF; git stores LF (.gitattributes), so CI compares LF to LF.
  if diff --recursive --unified --strip-trailing-cr "${src}" "${dst}"; then
    echo "OK    ${dst} matches ${src}"
  else
    echo "::error title=infra drift::${dst} differs from ${src} (diff above). Copy ${src} to ${dst} again."
    status=1
  fi
done

exit "${status}"
