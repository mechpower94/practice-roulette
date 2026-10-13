#!/usr/bin/env bash
# 사용법 (docker compose 에서):
#   up       : 클라우드 배포 + 로컬 미리보기, 컨테이너 종료/만료 시 자동 정리 (기본값)
#   local    : 클라우드 없이 로컬 미리보기만 (http://localhost:3000)
#   teardown : 클라우드 리소스 정리만 실행
set -Eeuo pipefail
cmd=${1:-up}
case "$cmd" in
  up)       exec bash /workspace/docker/up.sh ;;
  local)
    echo "로컬 미리보기: http://localhost:3000  (컨테이너를 종료하면 함께 꺼집니다)"
    exec serve -L --no-clipboard -l tcp://0.0.0.0:3000 /workspace/web ;;
  teardown) exec bash /workspace/docker/teardown.sh ;;
  *)        exec "$@" ;;
esac
