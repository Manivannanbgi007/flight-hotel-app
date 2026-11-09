#!/usr/bin/env bash
# Lints and renders every Helm chart with every environment's values, then validates the output with kubeconform.
# CI runs it in the "k8s-manifests" job (.github/workflows/ci.yml); run it locally the same way before you push.
#
# Layout (docs/CI_CD.md, "GitOps layout"):
#   deploy/charts/microservice    rendered once per deploy/environments/<env>/services/<service>.yaml (release = <service>)
#   deploy/charts/data-platform   rendered when deploy/environments/<env>/data-platform.yaml exists (local/dev only)
#   deploy/charts/shared          rendered when deploy/environments/<env>/shared.yaml exists
# Value files are applied in the order Argo CD must use too: <env>/values.yaml (global.*) first, then the chart's file.
#
# Output: $RENDER_DIR/<chart>/<env>/<release>.yaml (the "iac-scan" job scans these files with Trivy).
#
# Needs: helm 4, kubeconform. Usage (repository root, Linux/macOS/Git Bash):  bash scripts/ci/validate-k8s.sh
set -euo pipefail
shopt -s nullglob

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

DEPLOY_DIR="${DEPLOY_DIR:-deploy}"
RENDER_DIR="${RENDER_DIR:-${TMPDIR:-/tmp}/flighthotel-rendered}"
K8S_VERSION="${K8S_VERSION:-1.36.0}"
NAMESPACE="${NAMESPACE:-flighthotel}"
# helm template has no cluster to ask, so charts that test .Capabilities.APIVersions for a CRD need it listed here
# (Argo CD passes the real cluster's API versions). Both forms: "group/version" and "group/version/Kind".
HELM_API_VERSIONS="${HELM_API_VERSIONS:-argoproj.io/v1alpha1 argoproj.io/v1alpha1/Rollout argoproj.io/v1alpha1/AnalysisTemplate gateway.networking.k8s.io/v1 gateway.networking.k8s.io/v1/HTTPRoute}"
# Kubernetes schemas come from kubeconform's default location; CRD schemas (Argo Rollouts, Gateway API, ...) from the
# datreeio CRDs-catalog. (Single quotes: the "}}" of the Go template would end a ${VAR:-default} expansion early.)
default_crd_schema_location='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
CRD_SCHEMA_LOCATION="${CRD_SCHEMA_LOCATION:-${default_crd_schema_location}}"
# Comma-separated kinds kubeconform should skip (only for kinds that have no published schema anywhere).
KUBECONFORM_SKIP="${KUBECONFORM_SKIP:-}"
KUBECONFORM_CACHE="${KUBECONFORM_CACHE:-${TMPDIR:-/tmp}/kubeconform-cache}"

charts_dir="${DEPLOY_DIR}/charts"
envs_dir="${DEPLOY_DIR}/environments"

for tool in helm kubeconform; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "::error title=validate-k8s::${tool} is not installed (see docs/CI_CD.md, 'Run the checks locally')"
    exit 1
  fi
done
for dir in "${charts_dir}/microservice" "${envs_dir}"; do
  if [[ ! -d "${dir}" ]]; then
    echo "::error title=validate-k8s::${dir} does not exist (expected layout: docs/CI_CD.md, 'GitOps layout')"
    exit 1
  fi
done

api_args=()
for api in ${HELM_API_VERSIONS}; do
  api_args+=(--api-versions "${api}")
done

rm -rf "${RENDER_DIR}"
mkdir -p "${RENDER_DIR}" "${KUBECONFORM_CACHE}"

errors=0
rendered=0

# ---------- 1. Chart dependencies (only for charts that declare some) ----------
for chart in "${charts_dir}"/*/; do
  chart="${chart%/}"
  [[ -f "${chart}/Chart.yaml" ]] || continue
  grep -qE '^dependencies:' "${chart}/Chart.yaml" || continue
  echo "::group::helm dependency build ${chart}"
  # http(s) chart repositories must be known to helm; oci:// and file:// dependencies need nothing.
  repo_urls="$(grep -E '^[[:space:]]*repository:' "${chart}/Chart.yaml" | grep -oE 'https?://[^"'"'"'[:space:]]+' | sort -u || true)"
  n=0
  for repo_url in ${repo_urls}; do
    n=$((n + 1))
    helm repo add "$(basename "${chart}")-dep-${n}" "${repo_url}" --force-update
  done
  if ! helm dependency build "${chart}"; then
    echo "::error title=helm dependency build::${chart}"
    errors=$((errors + 1))
  fi
  echo "::endgroup::"
done

# ---------- 2. helm lint + helm template per environment and release ----------
# render <chart> <release> <env> <values files...>
render() {
  local chart="$1" release="$2" env="$3"
  shift 3
  local values=() file
  for file in "$@"; do
    values+=(--values "${file}")
  done
  local out="${RENDER_DIR}/${chart}/${env}/${release}.yaml"
  mkdir -p "$(dirname "${out}")"

  echo "::group::${env} / ${chart} / ${release}"
  if ! helm lint --strict --quiet "${charts_dir}/${chart}" --kube-version "${K8S_VERSION}" "${values[@]}"; then
    echo "::error title=helm lint::${env}/${chart}/${release} (values: $*)"
    errors=$((errors + 1))
  fi
  if helm template "${release}" "${charts_dir}/${chart}" \
      --namespace "${NAMESPACE}" --kube-version "${K8S_VERSION}" "${api_args[@]}" "${values[@]}" >"${out}"; then
    rendered=$((rendered + 1))
    echo "rendered ${out}"
  else
    echo "::error title=helm template::${env}/${chart}/${release} (values: $*)"
    errors=$((errors + 1))
  fi
  echo "::endgroup::"
}

envs=("${envs_dir}"/*/)
if ((${#envs[@]} == 0)); then
  echo "::error title=validate-k8s::no environments under ${envs_dir}"
  exit 1
fi

for env_dir in "${envs[@]}"; do
  env_dir="${env_dir%/}"
  env="$(basename "${env_dir}")"
  global_values="${env_dir}/values.yaml"
  if [[ ! -f "${global_values}" ]]; then
    echo "::error title=validate-k8s::${global_values} is missing (it holds global.image.registry and global.image.tag)"
    errors=$((errors + 1))
    continue
  fi

  services=("${env_dir}/services/"*.yaml)
  if ((${#services[@]} == 0)); then
    echo "::warning title=validate-k8s::${env}: no ${env_dir}/services/*.yaml, so no microservice release is rendered"
  fi
  for service_values in "${services[@]}"; do
    render microservice "$(basename "${service_values}" .yaml)" "${env}" "${global_values}" "${service_values}"
  done

  for chart in data-platform shared; do
    chart_values="${env_dir}/${chart}.yaml"
    if [[ -f "${chart_values}" ]]; then
      render "${chart}" "${chart}" "${env}" "${global_values}" "${chart_values}"
    else
      echo "${env}: no ${chart_values}, ${chart} not rendered for this environment"
    fi
  done
done

if ((rendered == 0)); then
  echo "::error title=validate-k8s::nothing was rendered"
  exit 1
fi

# ---------- 3. Schema validation ----------
echo "::group::kubeconform (Kubernetes ${K8S_VERSION}, strict)"
kubeconform_args=(
  -strict
  -summary
  -output text
  -kubernetes-version "${K8S_VERSION}"
  -schema-location default
  -schema-location "${CRD_SCHEMA_LOCATION}"
  -cache "${KUBECONFORM_CACHE}"
)
if [[ -n "${KUBECONFORM_SKIP}" ]]; then
  kubeconform_args+=(-skip "${KUBECONFORM_SKIP}")
fi
if ! kubeconform "${kubeconform_args[@]}" "${RENDER_DIR}"; then
  echo "::error title=kubeconform::invalid manifests (see the log above)"
  errors=$((errors + 1))
fi
echo "::endgroup::"

echo "Rendered ${rendered} release(s) into ${RENDER_DIR}. Resources by kind:"
find "${RENDER_DIR}" -name '*.yaml' -exec grep -hE '^kind:' {} + | sort | uniq -c | sort -rn || true

if ((errors > 0)); then
  echo "::error title=validate-k8s::${errors} problem(s) found"
  exit 1
fi
echo "All charts lint, render and validate."
