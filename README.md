# 🍽️ 오늘 뭐 먹지? — 점심 룰렛

버튼 한 번으로 점심 메뉴를 정하고, 팀원들과 투표해서 **오늘의 인기 메뉴 TOP 5**를 함께 보는 웹 서비스입니다.
개발·배포 도구는 **모두 Docker 컨테이너 안에서만** 동작하므로 내 PC 설정을 바꾸지 않습니다.
컨테이너가 꺼지면 클라우드 서비스도 함께 닫힙니다.

## 기능

| 기능 | 설명 |
| --- | --- |
| 🎡 룰렛 | 효과음, 꽃가루(confetti), 진동 / 다시 돌릴 때마다 바뀌는 멘트 |
| 🥣 기분 필터 | 아무거나 · 국물 · 매운 · 가볍게 · 든든하게 |
| 🌧️ 날씨 보너스 | Open-Meteo(무료) 날씨를 반영: 비·눈·추운 날은 국물, 더운 날은 가벼운 메뉴 확률 2배 (⭐ 표시) |
| 🗳️ 투표 | '이걸로 결정!' → Supabase에 저장. 브라우저당 하루에 한 표 |
| 🏆 TOP 5 | 오늘(한국 시간) 집계. 화면이 보일 때만 30초마다 갱신 |
| 👥 팀 투표방 | `?team=마케팅` 처럼 주소에 팀 이름을 붙이면 팀별로 따로 집계 |
| 🍱 메뉴 편집 | 메뉴 추가·삭제 (내 브라우저에 저장) |
| 📣 공유 | QR 코드, 링크 복사, 모바일 공유하기 |
| ⏳ 자동 종료 | 남은 시간을 표시하고, 시간이 지나면 화면과 DB 투표를 모두 닫음 |

## 구조

```
내 PC (Docker 컨테이너)
 ├─ Supabase 프로젝트 생성/재개 + 테이블·RLS 적용   (Management API)
 ├─ GitHub 저장소 생성 + push                        (REST API + git)
 ├─ Vercel 프로젝트 생성(GitHub 연동) + 배포 확인    (REST API)
 └─ 대기 → 종료 신호 또는 60분 경과 시
      ├─ Vercel 프로젝트 삭제  → 링크 접속 불가
      └─ Supabase 투표 마감 + 일시정지
```

- `web/` : 정적 웹페이지 (빌드 도구 없음, 서버 코드 없음)
- `supabase/schema.sql` : 투표 테이블, 보안 규칙(RLS), TOP 5 집계 함수
- `docker/` : 개발·배포 컨테이너와 자동화 스크립트

## 토큰 준비 (처음 한 번)

`.env.example` 을 `.env` 로 복사하고 세 개의 토큰을 채웁니다. `.env` 는 Git에 올라가지 않습니다.

1. **GitHub**: <https://github.com/settings/tokens/new?scopes=repo&description=practice-roulette> → Expiration 7 days → Generate
2. **Vercel**: <https://vercel.com/account/settings/tokens> → Create Token (Scope: 개인 Hobby 계정, Expiration 1~7 days)
3. **Supabase**: <https://supabase.com/dashboard/account/tokens> → Generate new token

## 실행

```bash
docker compose up --build      # 배포 시작 → 로그에 서비스 주소가 표시됨
docker compose down            # 서비스 닫기 (Vercel 삭제 + Supabase 일시정지)
```

- 서비스 시간은 기본 60분입니다. `.env` 의 `SERVICE_TTL_MINUTES` 로 바꿀 수 있습니다.
- 클라우드 없이 화면만 보려면: `docker compose run --rm --service-ports app local` → <http://localhost:3000>
- 정리가 중간에 실패했다면: `docker compose run --rm app teardown`

## 0원 유지 장치

- Supabase organization 이 **Free 플랜이 아니면 배포를 중단**합니다.
- Vercel은 정적 파일만 배포합니다(서버리스 함수 없음). Hobby 플랜은 한도를 넘으면 과금되지 않고 일시 중단됩니다.
- TOP 5는 DB에서 집계해 5줄만 받아오고, 화면이 보일 때만 갱신해서 전송량을 줄였습니다.
- DB 트리거로 10초에 60표가 넘게 몰리면 거절합니다(도배 방지).
- 마감 시각이 지나면 DB 보안 규칙이 투표를 거절합니다. 컨테이너가 비정상 종료되더라도 투표는 닫힙니다.
- 공개 키(anon/publishable)만 웹페이지에 들어갑니다. service_role 키는 쓰지 않습니다.
