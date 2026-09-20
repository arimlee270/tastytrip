import type {
  AnalyzeMenuResponse,
  Companion,
  Dish,
  Member,
  MenuRecommendation,
  Restaurant,
  RestaurantRecommendation,
  User,
  UserProfile,
} from '../types';

/** 백엔드 API 클라이언트. 토큰은 localStorage 에 보관한다. */

const TOKEN_KEY = 'tastytrip_token';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
};

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err: any = new Error(data?.error || `요청에 실패했습니다. (${response.status})`);
    // 서버가 실패 사유를 알려주면 화면이 그에 맞는 안내를 띄울 수 있도록 함께 넘긴다.
    if (data?.reason) err.reason = data.reason;
    err.status = response.status;
    throw err;
  }
  return data as T;
};

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length > 0 ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};

/* ------------------------------ 설정 ------------------------------ */

export interface PublicConfig {
  mapsBrowserKey: string;
  hasMaps: boolean;
  hasMfds: boolean;
  hasUsda: boolean;
  googleClientId: string;
}

export const fetchConfig = () => request<PublicConfig>('/api/config');

/* ------------------------------ 인증 ------------------------------ */

export interface AuthResponse {
  token: string;
  user: User;
  profile: UserProfile | null;
}

export const signup = (body: {
  email: string;
  password: string;
  nickname?: string;
  nationality?: string;
  language?: string;
  destination_country?: string;
}) => request<AuthResponse>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) });

export const login = (body: { email: string; password: string }) =>
  request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });

/** 구글 로그인 — GIS 가 발급한 ID 토큰을 서버에서 검증한다. */
export const loginWithGoogle = (credential: string) =>
  request<AuthResponse>('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });

export const fetchMe = () =>
  request<{ user: User; profile: UserProfile | null; companions: Companion[] }>('/api/users/me');

export const updateProfile = (body: Record<string, unknown>) =>
  request<{ user: User; profile: UserProfile }>('/api/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/** 화면의 여행 구성원 목록을 계정에 통째로 저장 (기존 localStorage 데이터 마이그레이션 포함) */
export const syncParty = (party: Member[]) =>
  request<{ ok: boolean; companions: Companion[] }>('/api/companions/sync-party', {
    method: 'PUT',
    body: JSON.stringify({ party }),
  });

/* ------------------------------ 식당 ------------------------------ */

/** lang 을 함께 보내면 가게 이름·주소·업종이 해당 언어로 내려온다. */
export const fetchNearby = (params: {
  lat: number;
  lng: number;
  radius?: number;
  keyword?: string;
  lang?: string;
}) => request<{ restaurants: Restaurant[]; demo: boolean }>(`/api/restaurants/nearby${qs(params)}`);

export const searchRestaurants = (params: { q: string; lat?: number; lng?: number; lang?: string }) =>
  request<{ restaurants: Restaurant[]; demo: boolean }>(`/api/restaurants/search${qs(params)}`);

export const fetchRestaurant = (
  restaurantId: string,
  params: { lat?: number; lng?: number; lang?: string } = {}
) =>
  request<{ restaurant: Restaurant; last_verified_days: number | null; saved: boolean }>(
    `/api/restaurants/${restaurantId}${qs(params)}`
  );

export const fetchRestaurantMenus = (restaurantId: string, params: { lang: string; party?: Member[] }) =>
  request<AnalyzeMenuResponse & { meta: { stale: boolean } }>(
    `/api/restaurants/${restaurantId}/menus${qs({
      lang: params.lang,
      party: params.party ? JSON.stringify(params.party) : undefined,
    })}`
  );

/** Place ID 기준으로 상세 정보를 현재 표시 언어로 다시 받아온다. */
export const syncPlace = (placeId: string, lang?: string) =>
  request<{ restaurant: Restaurant }>('/api/restaurants/sync-place', {
    method: 'POST',
    body: JSON.stringify({ place_id: placeId, lang }),
  });

export const saveRestaurant = (restaurantId: string) =>
  request<{ saved: boolean }>(`/api/restaurants/${restaurantId}/save`, { method: 'POST' });

export const unsaveRestaurant = (restaurantId: string) =>
  request<{ saved: boolean }>(`/api/restaurants/${restaurantId}/save`, { method: 'DELETE' });

export const fetchSavedRestaurants = () =>
  request<{ restaurants: Restaurant[] }>('/api/restaurants/saved');

/* ------------------------------ 분석 ------------------------------ */

export interface AnalyzeBody {
  image?: string | null;
  menuText?: string;
  homeCountry?: string;
  travelCountry?: string;
  party: Member[];
  targetLanguage: string;
}

export const analyzeMenu = (body: AnalyzeBody) =>
  request<AnalyzeMenuResponse>('/api/analyze-menu', { method: 'POST', body: JSON.stringify(body) });

export const analyzeRestaurantMenu = (restaurantId: string, body: AnalyzeBody) =>
  request<AnalyzeMenuResponse>(`/api/restaurants/${restaurantId}/menus/analyze`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** 분석 결과를 식당 메뉴로 등록 (계획서 5.2) */
export const registerMenusToRestaurant = (restaurantId: string, dishes: Dish[], targetLanguage: string) =>
  request<{ registered: number; restaurant: { restaurant_id: string; name: string } }>(
    `/api/restaurants/${restaurantId}/menus/register`,
    { method: 'POST', body: JSON.stringify({ dishes, targetLanguage }) }
  );

export const fetchMenu = (menuId: string, lang: string) =>
  request<{ dish: Dish; evidence: unknown[] }>(`/api/menus/${menuId}${qs({ lang })}`);

/**
 * 로그인 사용자가 마지막으로 분석한 결과.
 * 안전/주의 판정은 서버가 현재 프로필로 다시 계산해서 내려준다.
 */
export const fetchLastAnalysis = () =>
  request<{ dishes: Dish[]; saved_at?: string }>('/api/last-analysis');

/* ------------------------------ 추천 ------------------------------ */

export const fetchRestaurantRecommendations = (params: {
  lat?: number;
  lng?: number;
  radius?: number;
  lang: string;
  party?: Member[];
}) =>
  request<{ recommendations: RestaurantRecommendation[] }>(
    `/api/recommendations/restaurants${qs({
      lat: params.lat,
      lng: params.lng,
      radius: params.radius,
      lang: params.lang,
      party: params.party ? JSON.stringify(params.party) : undefined,
    })}`
  );

export const fetchMenuRecommendations = (params: {
  lat?: number;
  lng?: number;
  radius?: number;
  lang: string;
  party?: Member[];
}) =>
  request<{ menus: MenuRecommendation[] }>(
    `/api/recommendations/menus${qs({
      lat: params.lat,
      lng: params.lng,
      radius: params.radius,
      lang: params.lang,
      party: params.party ? JSON.stringify(params.party) : undefined,
    })}`
  );

/* ------------------------------ 신고 ------------------------------ */

export const submitReport = (
  menuId: string,
  body: {
    report_type: string;
    report_text: string;
    evidence_url?: string;
    visit_date?: string;
    /** 현장에서 들어 있다고 확인한 알레르기 */
    reported_allergens?: string[];
    /** 현장에서 없다고 확인한 알레르기 */
    absent_allergens?: string[];
  }
) => request<{ report: unknown }>(`/api/menus/${menuId}/reports`, { method: 'POST', body: JSON.stringify(body) });

/* ------------------------------ 공개 데이터 ------------------------------ */

export const searchPublicFood = (q: string) => request<any>(`/api/public-food/search${qs({ q })}`);
