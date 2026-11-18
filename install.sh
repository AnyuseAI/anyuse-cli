#!/usr/bin/env bash
# 下载已发布的独立 CLI；不安装 Node/Bun，不修改 shell 配置。
set -euo pipefail
fail() { printf 'anyuse: %s\n' "$*" >&2; exit 1; }
main() {
  local version="${ANYUSE_VERSION:-latest}" repo="${ANYUSE_REPOSITORY:-AnyuseAI/anyuse-cli}"
  local install_dir="${ANYUSE_INSTALL_DIR:-$HOME/.local/bin}"
  [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Invalid repository'
  [[ "$version" == latest || "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail 'Invalid version (omit the v prefix)'
  local os arch target asset base tmp expected actual staging installed
  case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) fail 'Use install.ps1 on Windows; this system is unsupported';; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) fail 'Unsupported CPU architecture';; esac
  target="$os-$arch"
  if [[ "$os" == linux ]]; then
    local loader
    for loader in /lib/ld-musl-*.so.1; do
      if [[ -e "$loader" ]]; then target="$target-musl"; break; fi
    done
    if [[ "$target" != *-musl ]] && command -v ldd >/dev/null && ldd --version 2>&1 | grep -qi musl; then target="$target-musl"; fi
  fi
  asset="anyuse-$target"
  base="https://github.com/$repo/releases"
  if [[ "$version" == latest ]]; then base="$base/latest/download"; else base="$base/download/v$version"; fi
  command -v curl >/dev/null || fail 'curl is required'
  if command -v sha256sum >/dev/null; then
    local hash_tool=sha256sum
  elif command -v shasum >/dev/null; then
    local hash_tool=shasum
  else fail 'sha256sum or shasum is required'; fi
  tmp=$(mktemp -d)
  staging=''
  trap 'rm -rf -- "$tmp"; if [[ -n "$staging" ]]; then rm -f -- "$staging"; fi' EXIT
  printf 'Downloading %s (%s)...\n' "$asset" "$version"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 "$base/$asset" -o "$tmp/$asset"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 60 "$base/$asset.sha256" -o "$tmp/checksum"
  expected=$(awk -v name="$asset" '$2 == name {print $1}' "$tmp/checksum")
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail 'Invalid checksum file'
  if [[ "$hash_tool" == sha256sum ]]; then actual=$(sha256sum "$tmp/$asset"); else actual=$(shasum -a 256 "$tmp/$asset"); fi
  [[ "${actual%% *}" == "$expected" ]] || fail 'Checksum mismatch; existing installation unchanged'
  chmod 755 "$tmp/$asset"
  installed=$("$tmp/$asset" --version)
  [[ "$version" == latest || "$installed" == "$version" ]] || fail 'Executable version mismatch'
  mkdir -p -- "$install_dir"
  staging=$(mktemp "$install_dir/.anyuse.XXXXXX")
  cp "$tmp/$asset" "$staging"
  chmod 755 "$staging"
  mv -f -- "$staging" "$install_dir/anyuse"
  staging=''
  printf 'Installed Anyuse %s to %s/anyuse\n' "$installed" "$install_dir"
  printf 'Add this directory to PATH if needed: %s\n' "$install_dir"
  # 清理在函数返回之前完成，避免 EXIT trap 引用已经离开作用域的局部变量。
  rm -rf -- "$tmp"
  trap - EXIT
}
main "$@"
