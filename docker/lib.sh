#!/usr/bin/env bash
# 공통 함수: 로그, REST API 호출, 상태 파일

NAME=${PROJECT_NAME:-practice-roulette}
STATE_FILE=/state/state.env
GH_API=https://api.github.com
VC_API=https://api.vercel.com
SB_API=https://api.supabase.com

log()  { printf '\033[1;36m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[%s] ⚠ %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
die()  { printf '\033[1;31m[%s] ✖ %s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# api METHOD URL TOKEN [JSON] → $HTTP_STATUS, $API_BODY
api() {
  local method=$1 url=$2 token=$3 data=${4:-} out
  out=$(mktemp)
  local args=(-sS -X "$method" -o "$out" -w '%{http_code}'
    -H "Authorization: Bearer $token" -H "Content-Type: application/json"
    -H "Accept: application/json" -H "User-Agent: practice-roulette-deployer")
  [ -n "$data" ] && args+=(--data "$data")
  HTTP_STATUS=$(curl "${args[@]}" "$url" 2>/dev/null) || HTTP_STATUS=000
  API_BODY=$(cat "$out")
  rm -f "$out"
}
ok() { [[ "$HTTP_STATUS" =~ ^2 ]]; }
errmsg() { jq -r '.error.message // .message // .error // .' <<<"$API_BODY" 2>/dev/null | head -c 400; }

state_get() { [ -f "$STATE_FILE" ] && sed -n "s/^$1=//p" "$STATE_FILE" | tail -1; }
state_set() {
  mkdir -p "$(dirname "$STATE_FILE")"; touch "$STATE_FILE"
  sed -i "/^$1=/d" "$STATE_FILE"
  echo "$1=$2" >>"$STATE_FILE"
}
state_del() { [ -f "$STATE_FILE" ] && sed -i "/^$1=/d" "$STATE_FILE"; return 0; }

vc_q() { [ -n "${VERCEL_TEAM_ID:-}" ] && echo "teamId=$VERCEL_TEAM_ID" || echo ""; }
