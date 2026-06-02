#!/usr/bin/env bash
# 一次性推送完整项目到私有仓 SongMingLI-CS/ScholarKernel
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${REMOTE:-https://github.com/SongMingLI-CS/ScholarKernel.git}"
BRANCH="${BRANCH:-main}"

if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
  echo ">>> 请先完成 GitHub 登录（浏览器授权）："
  gh auth login -h github.com -p https -w -s repo
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh auth setup-git
  git remote set-url origin "$REMOTE"
else
  echo "未检测到 gh 登录。可改用 SSH："
  echo "  git remote set-url origin git@github.com:SongMingLI-CS/ScholarKernel.git"
  echo "  并确保 ~/.ssh 公钥已添加到 GitHub → Settings → SSH keys"
  git remote set-url origin "${REMOTE}"
fi

echo ">>> 推送 ${BRANCH} → origin (${REMOTE})"
git push -u origin "$BRANCH"
echo ">>> 完成：$(git log -1 --oneline)"
