#!/usr/bin/env bash
# Resolve the Kanade build version from the nearest reachable New API release
# tag and print it as KEY=value lines suitable for appending to
# "$GITHUB_OUTPUT":
#
#   version=<Kanade-prefixed git describe>     VERSION file, ldflags, file names
#   oci_tag=<version with '+' replaced by '-'> Docker tags forbid '+'
#
# Usage: resolve-kanade-version.sh [expected-sha]
# When an expected SHA is given (or GITHUB_SHA is set), the checked-out HEAD
# must match it, so a run can never stamp a version from a different commit.
#
# The base follows the project's release convention (`git describe --tags
# --match 'v[0-9]*'`): an exact release checkout yields "Kanade-v1.0.0-rc.51",
# a branch checkout yields "Kanade-v1.0.0-rc.51-<count>-g<sha12>".
#
# Requires a full clone with tags (actions/checkout fetch-depth: 0). Fails
# loudly when no v-prefixed release tag is reachable instead of inventing a
# fallback version.
set -euo pipefail

expected_sha="${1:-${GITHUB_SHA:-}}"
head_sha="$(git rev-parse HEAD)"
if [[ -n "${expected_sha}" && "${head_sha}" != "${expected_sha}" ]]; then
  echo "::error::Checked out ${head_sha}, but this run was dispatched for ${expected_sha}" >&2
  exit 1
fi

if ! describe="$(git describe --tags --match 'v[0-9]*' --abbrev=12 2>/dev/null)"; then
  echo "::error::No reachable New API release tag (v[0-9]*) at ${head_sha}; fetch full history and tags (fetch-depth: 0)" >&2
  exit 1
fi

# Git ref syntax allows characters that are unsafe in shell expansion, file
# names, and Docker tags (quotes, semicolons, dollar signs, ...), so only
# accept the characters New API release tags actually use.
if [[ ! "${describe}" =~ ^v[0-9][A-Za-z0-9._+-]*$ ]]; then
  echo "::error::Resolved version base '${describe}' is not a supported v-prefixed release tag" >&2
  exit 1
fi

version="Kanade-${describe}"
oci_tag="${version//+/-}"

# Docker tags are limited to 128 characters.
if (( ${#oci_tag} > 128 )); then
  echo "::error::Resolved OCI tag '${oci_tag}' exceeds the 128 character Docker tag limit" >&2
  exit 1
fi

printf 'version=%s\n' "${version}"
printf 'oci_tag=%s\n' "${oci_tag}"
