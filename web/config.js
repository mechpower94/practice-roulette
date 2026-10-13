// 배포할 때 docker/up.sh 가 자동으로 덮어씁니다.
// supabaseKey 는 공개용(publishable/anon) 키라서 커밋해도 안전합니다. (RLS로 읽기·투표만 허용)
window.APP_CONFIG = {
  supabaseUrl: "https://oavlmergztgohhcjoesj.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdmxtZXJnenRnb2hoY2pvZXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTA5NjksImV4cCI6MjEwNzQ2Njk2OX0.jT_RT1My8sBIazd_k4GwgpyhT5WpbU4kF82PJ6xSGJc",
  expiresAt: "2026-10-13T14:56:30Z"
};
