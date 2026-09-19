import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const str = (key: string, fallback = ''): string => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
};

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: Number(str('PORT', '3000')),

  /** Gemini (기존 기능) */
  geminiApiKey: str('GEMINI_API_KEY'),
  geminiModel: str('GEMINI_MODEL', 'gemini-3.5-flash'),
  geminiFallbackModel: str('GEMINI_FALLBACK_MODEL', 'gemini-3.1-flash-lite'),

  /** 인증 */
  jwtSecret: str('JWT_SECRET', 'tastytrip-dev-secret-change-me'),
  jwtExpiresInDays: Number(str('JWT_EXPIRES_IN_DAYS', '30')),
  /** 구글 로그인 (Google Identity Services 웹 클라이언트 ID) */
  googleOAuthClientId: str('GOOGLE_OAUTH_CLIENT_ID'),

  /** DB — 로컬 개발용 파일 경로 */
  dbPath: path.resolve(process.cwd(), str('DB_PATH', 'data/tastytrip.db')),
  /**
   * Turso (호스팅 SQLite). 배포 환경에서는 반드시 설정해야 한다.
   * Cloud Run 은 컨테이너 재시작 시 로컬 파일이 사라지기 때문이다.
   */
  tursoUrl: str('TURSO_DATABASE_URL'),
  tursoAuthToken: str('TURSO_AUTH_TOKEN'),

  /**
   * 지도 서버 키 (Google Places API).
   * 유료 호출에 쓰이므로 브라우저로 절대 내보내지 않는다.
   */
  googleMapsApiKey: str('GOOGLE_MAPS_API_KEY'),
  /**
   * 브라우저 지도 렌더링용 키 (Maps JavaScript API).
   * 접속자 누구나 볼 수 있는 값이므로, Cloud Console 에서 HTTP 리퍼러 제한을
   * 걸어 둔 별도의 키를 써야 한다. 서버 키와 같은 값을 쓰면 안 된다.
   */
  googleMapsBrowserKey: str('GOOGLE_MAPS_BROWSER_KEY'),

  /** 공공데이터포털 (식약처) */
  mfdsServiceKey: str('MFDS_SERVICE_KEY'),
  // 실제 응답이 확인된 엔드포인트 (식품영양성분DB정보, 총 31만여 건)
  mfdsNutritionUrl: str(
    'MFDS_NUTRITION_URL',
    'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02'
  ),
  mfdsTraceQrUrl: str(
    'MFDS_TRACEQR_URL',
    'https://apis.data.go.kr/1471000/FoodTrckQrInfoService/getFoodTrckQrInfo'
  ),
  mfdsLotUrl: str(
    'MFDS_LOT_URL',
    'https://apis.data.go.kr/1471000/IsPrdlstRawmtrlInfoService/getIsPrdlstRawmtrlInfo'
  ),

  /** 이미지 검색 (Pexels). 서버에서만 호출하므로 VITE_ 접두사를 붙이지 않는다. */
  pexelsApiKey: str('PEXELS_API_KEY', str('VITE_PEXELS_API_KEY')),

  /**
   * 관리자용 엔드포인트 접근 토큰.
   * 설정하지 않으면 운영 환경에서 해당 엔드포인트를 아예 막는다.
   */
  adminToken: str('ADMIN_TOKEN'),

  /** 요청 제한 — 분당 허용 횟수 (계획서 19장 API 비용 증가 대응) */
  rateLimitPerMinute: Number(str('RATE_LIMIT_PER_MINUTE', '20')),

  /** USDA FoodData Central */
  usdaApiKey: str('USDA_API_KEY'),
  usdaBaseUrl: str('USDA_BASE_URL', 'https://api.nal.usda.gov/fdc/v1'),

  /** 공개 데이터 캐시 TTL (일) — 계획서 7.5 */
  publicDataTtlDays: Number(str('PUBLIC_DATA_TTL_DAYS', '30')),
  /** 메뉴 분석 재호출 기준 (일) — 계획서 12.2 */
  menuStaleDays: Number(str('MENU_STALE_DAYS', '90')),
  /** 신뢰도가 이 값 미만이면 재분석 대상 — 계획서 12.2 */
  minConfidence: Number(str('MIN_CONFIDENCE', '0.4')),
};

/**
 * 브라우저로 내려보낼 지도 키를 고른다.
 *
 * 서버 키를 여기에 쓰면 접속자 전원에게 유료 API 키를 나눠주는 셈이 된다.
 * 그래서 운영 환경에서는 전용 브라우저 키가 없으면 아무것도 내보내지 않고,
 * 지도 대신 목록 보기로 폴백시킨다. 개발 중에는 키를 두 개 만들지 않아도
 * 확인할 수 있도록 서버 키를 빌려 쓰되, 기동할 때 경고를 남긴다.
 */
const resolveBrowserMapsKey = (): string => {
  const isProduction = env.nodeEnv === 'production';
  // 설정을 잘못해 서버 키를 브라우저 키 자리에 넣어 두었더라도,
  // 운영 환경에서는 내보내지 않는다. 지도가 안 보이는 편이 낫다.
  const sameAsServerKey =
    !!env.googleMapsBrowserKey && env.googleMapsBrowserKey === env.googleMapsApiKey;
  if (isProduction && sameAsServerKey) return '';
  if (env.googleMapsBrowserKey) return env.googleMapsBrowserKey;
  if (isProduction) return '';
  return env.googleMapsApiKey;
};

/** 기동 시 위험한 설정을 한 번 알린다. */
export const warnUnsafeConfig = (): void => {
  const isProduction = env.nodeEnv === 'production';
  if (!env.googleMapsBrowserKey && env.googleMapsApiKey) {
    console.warn(
      isProduction
        ? '[보안] GOOGLE_MAPS_BROWSER_KEY 가 없어 지도를 목록 보기로 대체합니다. ' +
            '리퍼러 제한을 건 브라우저 전용 키를 만들어 설정하세요.'
        : '[보안] 개발 모드라 서버 지도 키를 브라우저에 빌려주고 있습니다. ' +
            '배포 전에 GOOGLE_MAPS_BROWSER_KEY 를 따로 만드세요.'
    );
  }
  if (env.googleMapsBrowserKey && env.googleMapsBrowserKey === env.googleMapsApiKey) {
    console.warn('[보안] 브라우저 키와 서버 키가 같은 값입니다. 서로 다른 키를 쓰세요.');
  }
  if (isProduction && !env.adminToken) {
    console.warn('[보안] ADMIN_TOKEN 이 없어 관리자 엔드포인트를 모두 차단합니다.');
  }
  if (isProduction && env.jwtSecret === 'tastytrip-dev-secret-change-me') {
    console.warn('[보안] JWT_SECRET 이 기본값입니다. 로그인 토큰을 위조당할 수 있습니다.');
  }
  if (isProduction && !flags.hasTurso) {
    console.warn('[주의] TURSO_DATABASE_URL 이 없습니다. 재시작하면 데이터가 사라집니다.');
  }
};

export const flags = {
  hasGemini: !!env.geminiApiKey,
  hasGoogleMaps: !!env.googleMapsApiKey,
  hasMapsBrowserKey: !!resolveBrowserMapsKey(),
  hasMfds: !!env.mfdsServiceKey,
  hasUsda: !!env.usdaApiKey,
  hasGoogleLogin: !!env.googleOAuthClientId,
  hasTurso: !!env.tursoUrl,
};

/** 프런트로 내려보내도 안전한 설정값. */
export const publicConfig = () => ({
  // 서버 키로 폴백하지 않는다. 이 값은 접속자 누구나 볼 수 있다.
  mapsBrowserKey: resolveBrowserMapsKey(),
  hasMaps: flags.hasGoogleMaps,
  hasMfds: flags.hasMfds,
  hasUsda: flags.hasUsda,
  // 클라이언트 ID 는 공개되어도 되는 값이다 (비밀번호에 해당하는 client secret 은 쓰지 않는다).
  googleClientId: env.googleOAuthClientId,
});
