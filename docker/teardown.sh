#!/usr/bin/env bash
# 클라우드 서비스 닫기: Vercel 프로젝트 삭제(링크 비활성화) + Supabase 투표 마감·일시정지
# GitHub 저장소(코드)는 무료이므로 그대로 둡니다.
set -uo pipefail
source /workspace/docker/lib.sh

q=$(vc_q)

if [ -n "${VERCEL_TOKEN:-}" ]; then
  vid=$(state_get VERCEL_PROJECT_ID)
  if [ -z "$vid" ]; then
    api GET "$VC_API/v9/projects/$NAME?$q" "$VERCEL_TOKEN"
    ok && vid=$(jq -r .id <<<"$API_BODY")
  fi
  if [ -n "$vid" ]; then
    api DELETE "$VC_API/v9/projects/$vid?$q" "$VERCEL_TOKEN"
    if ok || [ "$HTTP_STATUS" = 404 ]; then
      log "✔ Vercel 프로젝트 삭제 완료 → 서비스 링크가 더 이상 열리지 않습니다"
      state_del VERCEL_PROJECT_ID
    else
      warn "Vercel 프로젝트 삭제 실패 (HTTP $HTTP_STATUS): $(errmsg)"
    fi
  else
    log "Vercel: 정리할 프로젝트 없음"
  fi
fi

ref=$(state_get SUPABASE_REF)
if [ -n "$ref" ] && [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  api POST "$SB_API/v1/projects/$ref/database/query" "$SUPABASE_ACCESS_TOKEN" \
    '{"query":"update public.app_config set expires_at = now() where id = 1;"}'
  ok && log "✔ Supabase 투표 마감 처리"
  api POST "$SB_API/v1/projects/$ref/pause" "$SUPABASE_ACCESS_TOKEN" '{}'
  if ok; then
    log "✔ Supabase 프로젝트 일시정지 (데이터는 보존, 다음 실행 때 자동 재개)"
  else
    warn "Supabase 일시정지 실패 (HTTP $HTTP_STATUS): $(errmsg) — 무료 플랜이라 과금은 없습니다"
  fi
fi

rm -rf /workspace/web/.vercel /workspace/.service-url
log "정리 완료"
