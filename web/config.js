// 배포할 때 docker/up.sh 가 자동으로 덮어씁니다.
// supabaseKey 는 공개용(publishable/anon) 키라서 커밋해도 안전합니다. (RLS로 읽기·투표만 허용)
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  expiresAt: null
};
