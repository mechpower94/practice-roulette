#!/usr/bin/env bash
# Supabase(DB) → GitHub(push) → Vercel(배포) 를 자동으로 진행하고,
# 컨테이너가 종료되거나 SERVICE_TTL_MINUTES 가 지나면 클라우드 서비스를 닫습니다.
set -Eeuo pipefail
source /workspace/docker/lib.sh

TTL_MIN=${SERVICE_TTL_MINUTES:-60}
REGION=${SUPABASE_REGION:-ap-northeast-2}
WEB=/workspace/web
SERVE_PID=""

for v in GITHUB_TOKEN VERCEL_TOKEN SUPABASE_ACCESS_TOKEN; do
  [ -n "${!v:-}" ] || die "$v 가 .env 에 없습니다. README.md 의 '토큰 준비' 를 참고하세요."
done

# ---------------------------------------------------------------- 종료 처리
TORN=0
cleanup() {
  local code=$?
  [ "$TORN" = 1 ] && return
  TORN=1
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  rm -f /workspace/.service-url
  log "🧹 클라우드 서비스 정리 시작 (Vercel 프로젝트 삭제 · Supabase 일시정지)"
  bash /workspace/docker/teardown.sh || warn "정리 일부 실패 → 'docker compose run --rm app teardown' 으로 다시 실행하세요"
  exit "$code"
}
trap cleanup EXIT
trap 'log "종료 신호를 받았습니다"; exit 0' TERM INT

# ---------------------------------------------------------------- Supabase
sb_sql() {
  api POST "$SB_API/v1/projects/$SB_REF/database/query" "$SUPABASE_ACCESS_TOKEN" "$(jq -n --arg q "$1" '{query:$q}')"
}

supabase_up() {
  local T=$SUPABASE_ACCESS_TOKEN org="" status o
  log "🗄️  Supabase 준비"
  api GET "$SB_API/v1/organizations" "$T"
  ok || die "Supabase 토큰 확인 실패 (HTTP $HTTP_STATUS): $(errmsg)"
  for o in $(jq -r '.[].id' <<<"$API_BODY"); do
    [ -n "${SUPABASE_ORG:-}" ] && [ "$o" != "$SUPABASE_ORG" ] && continue
    api GET "$SB_API/v1/organizations/$o" "$T"
    if ok && [ "$(jq -r '.plan // empty' <<<"$API_BODY")" = "free" ]; then org=$o; break; fi
  done
  [ -n "$org" ] || die "Free 플랜 Supabase organization 을 찾지 못했습니다 → 과금 방지를 위해 중단합니다"
  log "   organization: $org (Free 플랜 확인)"

  api GET "$SB_API/v1/projects" "$T"
  ok || die "Supabase 프로젝트 목록 조회 실패: $(errmsg)"
  SB_REF=$(jq -r --arg n "$NAME" --arg o "$org" \
    '[.[] | select(.name == $n and (.organization_id == $o or .organization_slug == $o))][0].id // empty' <<<"$API_BODY")

  if [ -z "$SB_REF" ]; then
    log "   새 프로젝트 생성: $NAME ($REGION)"
    local pass
    pass=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
    api POST "$SB_API/v1/projects" "$T" "$(jq -n --arg n "$NAME" --arg o "$org" --arg p "$pass" --arg r "$REGION" \
      '{name:$n, organization_id:$o, db_pass:$p, region:$r}')"
    ok || die "Supabase 프로젝트 생성 실패: $(errmsg)  (무료 플랜은 활성 프로젝트 2개까지)"
    SB_REF=$(jq -r .id <<<"$API_BODY")
    state_set SUPABASE_DB_PASS "$pass"
  fi
  state_set SUPABASE_REF "$SB_REF"

  local restored=0 deadline=$(($(date +%s) + 1200))
  while :; do
    api GET "$SB_API/v1/projects/$SB_REF" "$T"
    status=$(jq -r '.status // "UNKNOWN"' <<<"$API_BODY" 2>/dev/null || echo UNKNOWN)
    [ "$status" = ACTIVE_HEALTHY ] && break
    if [[ "$status" =~ ^(INACTIVE|PAUSED)$ ]] && [ "$restored" = 0 ]; then
      log "   일시정지된 프로젝트를 다시 켭니다 (restore, 수 분 소요)"
      api POST "$SB_API/v1/projects/$SB_REF/restore" "$T" '{}'
      ok || die "Supabase 재개 실패: $(errmsg)"
      restored=1
    fi
    [ "$(date +%s)" -lt "$deadline" ] || die "Supabase 준비 시간 초과 (status=$status)"
    log "   Supabase 상태: $status … 대기 중"
    sleep 10
  done
  log "   프로젝트 준비 완료: $SB_REF"

  local sql i
  sql=$(cat /workspace/supabase/schema.sql)
  for i in $(seq 1 18); do
    sb_sql "$sql"
    ok && break
    [ "$i" = 18 ] && die "스키마 적용 실패: $(errmsg)"
    sleep 10
  done
  log "   테이블·보안 규칙(RLS) 적용 완료"

  api GET "$SB_API/v1/projects/$SB_REF/api-keys" "$T"
  ok || die "API 키 조회 실패: $(errmsg)"
  SB_KEY=$(jq -r '([.[] | select(.name == "anon" and (.api_key | type) == "string")][0].api_key)
                // ([.[] | select(.type == "publishable" and (.api_key | type) == "string")][0].api_key)
                // empty' <<<"$API_BODY")
  [ -n "$SB_KEY" ] || die "공개용(anon/publishable) 키를 찾지 못했습니다"
  SB_URL="https://$SB_REF.supabase.co"

  local code
  for i in $(seq 1 24); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB_URL/rest/v1/rpc/top_menus" \
      -H "apikey: $SB_KEY" -H "Content-Type: application/json" -d '{"p_team":"전체"}' || true)
    [ "$code" = 200 ] && break
    [ "$i" = 24 ] && die "Supabase REST API 응답 확인 실패 (HTTP $code)"
    sleep 5
  done
  log "   공개 API 동작 확인 완료"
}

# ---------------------------------------------------------------- GitHub
github_up() {
  log "🐙 GitHub 저장소 준비"
  api GET "$GH_API/user" "$GITHUB_TOKEN"
  ok || die "GitHub 토큰 확인 실패 (HTTP $HTTP_STATUS): $(errmsg)"
  GH_LOGIN=$(jq -r .login <<<"$API_BODY")
  GH_UID=$(jq -r .id <<<"$API_BODY")
  if [ -n "${GITHUB_OWNER:-}" ] && [ "$GH_LOGIN" != "$GITHUB_OWNER" ]; then
    die "토큰 계정($GH_LOGIN)이 GITHUB_OWNER($GITHUB_OWNER)와 다릅니다"
  fi
  api GET "$GH_API/repos/$GH_LOGIN/$NAME" "$GITHUB_TOKEN"
  if [ "$HTTP_STATUS" = 404 ]; then
    log "   새 공개 저장소 생성: $GH_LOGIN/$NAME"
    api POST "$GH_API/user/repos" "$GITHUB_TOKEN" "$(jq -n --arg n "$NAME" \
      '{name:$n, private:false, has_wiki:false, description:"오늘 뭐 먹지? 점심 룰렛 — Docker + Vercel + Supabase 0원 실습"}')"
  fi
  ok || die "GitHub 저장소 준비 실패: $(errmsg)"
  GH_REPO_ID=$(jq -r .id <<<"$API_BODY")
}

git_push() {
  cd /workspace
  git config --global --add safe.directory /workspace
  [ -d .git ] || git init -q -b main
  git config user.name "$GH_LOGIN"
  git config user.email "$GH_UID+$GH_LOGIN@users.noreply.github.com"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$GH_LOGIN/$NAME.git"
  git add -A
  git diff --cached --quiet || git commit -q -m "$1"
  git push -q "https://x-access-token:$GITHUB_TOKEN@github.com/$GH_LOGIN/$NAME.git" HEAD:main 2>&1 \
    | sed "s/$GITHUB_TOKEN/***/g"
  log "   push 완료: https://github.com/$GH_LOGIN/$NAME"
}

# ---------------------------------------------------------------- Vercel
vercel_up() {
  local T=$VERCEL_TOKEN q
  q=$(vc_q)
  log "▲ Vercel 프로젝트 준비"
  api GET "$VC_API/v2/user" "$T"
  ok || die "Vercel 토큰 확인 실패 (HTTP $HTTP_STATUS): $(errmsg)"

  api GET "$VC_API/v9/projects/$NAME?$q" "$T"
  if ok; then
    VC_MODE=$([ "$(jq -r '.link.type // empty' <<<"$API_BODY")" = github ] && echo git || echo cli)
  else
    api POST "$VC_API/v11/projects?$q" "$T" "$(jq -n --arg n "$NAME" --arg r "$GH_LOGIN/$NAME" \
      '{name:$n, framework:null, rootDirectory:"web", gitRepository:{type:"github", repo:$r}}')"
    if ok; then
      VC_MODE=git
    else
      warn "Vercel ↔ GitHub 자동 연동 실패: $(errmsg)"
      warn "→ Vercel CLI 직접 업로드 방식으로 배포합니다 (Vercel GitHub App 권한에 저장소를 추가하면 다음부터 자동 배포)"
      api POST "$VC_API/v11/projects?$q" "$T" "$(jq -n --arg n "$NAME" '{name:$n, framework:null}')"
      ok || die "Vercel 프로젝트 생성 실패: $(errmsg)"
      VC_MODE=cli
    fi
  fi
  VC_PROJECT_ID=$(jq -r .id <<<"$API_BODY")
  VC_ACCOUNT=$(jq -r .accountId <<<"$API_BODY")
  state_set VERCEL_PROJECT_ID "$VC_PROJECT_ID"
  log "   프로젝트: $VC_PROJECT_ID (배포 방식: $([ "$VC_MODE" = git ] && echo 'GitHub push 자동 배포' || echo 'CLI 업로드'))"

  # 링크만 있으면 누구나 접속하도록 Vercel 로그인 보호 해제
  api PATCH "$VC_API/v9/projects/$VC_PROJECT_ID?$q" "$T" '{"ssoProtection":null}'
  ok || warn "배포 보호 해제 실패: $(errmsg)"
}

vercel_deploy() {
  local T=$VERCEL_TOKEN q dep="" st="" i
  q=$(vc_q)
  if [ "$VC_MODE" = git ]; then
    log "   push 로 시작된 배포를 찾는 중…"
    for i in $(seq 1 12); do
      api GET "$VC_API/v6/deployments?projectId=$VC_PROJECT_ID&since=$PUSH_MS&limit=1&$q" "$T"
      dep=$(jq -r '.deployments[0].uid // empty' <<<"$API_BODY")
      [ -n "$dep" ] && break
      sleep 5
    done
    if [ -z "$dep" ]; then
      log "   자동 배포가 보이지 않아 직접 요청합니다"
      api POST "$VC_API/v13/deployments?$q" "$T" "$(jq -n --arg n "$NAME" --arg p "$VC_PROJECT_ID" --arg id "$GH_REPO_ID" \
        '{name:$n, project:$p, target:"production", gitSource:{type:"github", repoId:($id|tonumber), ref:"main"}}')"
      ok || die "배포 요청 실패: $(errmsg)"
      dep=$(jq -r .id <<<"$API_BODY")
    fi
  else
    mkdir -p "$WEB/.vercel"
    jq -n --arg p "$VC_PROJECT_ID" --arg o "$VC_ACCOUNT" '{projectId:$p, orgId:$o}' >"$WEB/.vercel/project.json"
    local url
    url=$(cd "$WEB" && vercel deploy --prod --yes --token "$T" 2>/dev/null | tail -1)
    [[ "$url" == https://* ]] || die "vercel deploy 실패"
    api GET "$VC_API/v13/deployments/${url#https://}?$q" "$T"
    dep=$(jq -r .id <<<"$API_BODY")
  fi

  for i in $(seq 1 72); do
    api GET "$VC_API/v13/deployments/$dep?$q" "$T"
    st=$(jq -r '.readyState // .status // "UNKNOWN"' <<<"$API_BODY")
    case "$st" in
      READY) break ;;
      ERROR | CANCELED) die "Vercel 배포 실패 ($st)" ;;
    esac
    log "   Vercel 배포 상태: $st"
    sleep 5
  done
  [ "$st" = READY ] || die "Vercel 배포 대기 시간 초과"

  SERVICE_URL=""
  for i in $(seq 1 12); do
    api GET "$VC_API/v13/deployments/$dep?$q" "$T"
    SERVICE_URL=$(jq -r '[.alias[]? | select(endswith(".vercel.app"))] | sort_by(length) | .[0] // empty' <<<"$API_BODY")
    [ -n "$SERVICE_URL" ] && break
    sleep 5
  done
  [ -n "$SERVICE_URL" ] || SERVICE_URL=$(jq -r .url <<<"$API_BODY")
  SERVICE_URL="https://$SERVICE_URL"
}

# ---------------------------------------------------------------- main
log "🚀 '오늘 뭐 먹지?' 배포 시작 — 서비스 유지 시간 ${TTL_MIN}분"
serve -L --no-clipboard -l tcp://0.0.0.0:3000 "$WEB" >/dev/null 2>&1 &
SERVE_PID=$!

supabase_up

EXPIRES_EPOCH=$(($(date +%s) + (TTL_MIN + 2) * 60))
EXPIRES_ISO=$(date -u -d "@$EXPIRES_EPOCH" +%Y-%m-%dT%H:%M:%SZ)
EXPIRES_KST=$(date -d "@$EXPIRES_EPOCH" '+%Y-%m-%d %H:%M')
sb_sql "insert into public.app_config (id, expires_at) values (1, '$EXPIRES_ISO')
        on conflict (id) do update set expires_at = excluded.expires_at;"
ok || die "마감 시각 저장 실패: $(errmsg)"

cat >"$WEB/config.js" <<EOF
// 배포할 때 docker/up.sh 가 자동으로 덮어씁니다.
// supabaseKey 는 공개용(publishable/anon) 키라서 커밋해도 안전합니다. (RLS로 읽기·투표만 허용)
window.APP_CONFIG = {
  supabaseUrl: "$SB_URL",
  supabaseKey: "$SB_KEY",
  expiresAt: "$EXPIRES_ISO"
};
EOF

github_up
vercel_up
PUSH_MS=$((($(date +%s) - 5) * 1000))
git_push "deploy: 서비스 공개 (자동 종료 $EXPIRES_KST KST)"
vercel_deploy

code=$(curl -s -o /dev/null -w '%{http_code}' "$SERVICE_URL" || true)
[ "$code" = 200 ] || warn "서비스 주소 응답 코드: $code"
echo "$SERVICE_URL" >/workspace/.service-url

cat <<EOF

  ┌──────────────────────────────────────────────────────────────
  │ ✅ 서비스 공개 완료!
  │   🌐 서비스 주소 : $SERVICE_URL
  │   💻 로컬 미리보기: http://localhost:3000
  │   🐙 GitHub      : https://github.com/$GH_LOGIN/$NAME
  │   ⏰ 자동 종료    : $EXPIRES_KST (KST)
  │   🛑 지금 끄려면  : docker compose down
  └──────────────────────────────────────────────────────────────

EOF

while [ "$(date +%s)" -lt "$EXPIRES_EPOCH" ]; do
  sleep 10 &
  wait $!
done
log "⏰ 서비스 시간이 끝났습니다"
exit 0
