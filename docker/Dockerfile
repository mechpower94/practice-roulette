# 개발·배포 도구는 모두 이 이미지 안에만 설치됩니다. (호스트 PC에는 아무것도 설치하지 않음)
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g vercel@48 serve@14 \
 && npm cache clean --force

ENV TZ=Asia/Seoul
WORKDIR /workspace
ENTRYPOINT ["bash", "/workspace/docker/entrypoint.sh"]
CMD ["up"]
