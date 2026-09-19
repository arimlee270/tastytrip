import { db, isStale, newId, nowIso } from '../db';
import { env, flags } from '../env';
import type { Restaurant } from '../../types';
import { DEMO_RESTAURANTS } from '../seed/demoRestaurants';
import { pickDisplayName } from './displayName';

/**
 * 계획서 4장 — 지도 기반 가게 검색.
 * Google Places API (New) v1 을 사용하고, Place ID 를 내부 식당 데이터의 기준 키로 삼는다.
 * 키가 없으면 내장 데모 식당 데이터로 폴백하여 UI 개발/시연이 가능하도록 한다.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.businessStatus',
  'places.currentOpeningHours.openNow',
  'places.photos',
].join(',');

const DETAIL_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'primaryTypeDisplayName',
  'types',
  'businessStatus',
  'currentOpeningHours.openNow',
  'photos',
  'addressComponents',
].join(',');

export const haversineMeters = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean };
  photos?: { name?: string }[];
  addressComponents?: { longText?: string; types?: string[] }[];
};

/**
 * 사진 주소를 우리 서버를 거치도록 만든다.
 *
 * 구글 사진 주소는 끝에 API 키를 붙여야 열린다. 그 주소를 그대로 브라우저에
 * 내려보내면 <img src="..."> 안에 서버 키가 그대로 노출된다. 그래서 키가 없는
 * 우리 주소만 내려보내고, 실제 구글 호출은 서버가 대신한다(routes/places.ts).
 */
const photoUrl = (place: RawPlace): string | null => {
  const name = place.photos?.[0]?.name;
  if (!name || !flags.hasGoogleMaps) return null;
  return photoProxyUrl(name);
};

/** 사진 리소스 이름(places/xxx/photos/yyy)을 우리 서버 주소로 바꾼다. */
export const photoProxyUrl = (photoName: string): string =>
  `/api/places/photo?name=${encodeURIComponent(photoName)}`;

/**
 * 구글에서 사진을 받아 온다. 키는 이 함수 안에서만 쓰이고 밖으로 나가지 않는다.
 * 구글이 실제 이미지 파일로 리다이렉트하므로 그 결과를 그대로 돌려준다.
 */
export const fetchPlacePhoto = async (
  photoName: string,
  maxWidthPx = 640
): Promise<{ body: ArrayBuffer; contentType: string } | null> => {
  if (!flags.hasGoogleMaps) return null;
  const url = `${PLACES_BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${env.googleMapsApiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') || 'image/jpeg',
  };
};

const countryOf = (place: RawPlace): string | null => {
  const c = place.addressComponents?.find((x) => x.types?.includes('country'));
  return c?.longText ?? null;
};

const regionOf = (place: RawPlace): string | null => {
  const c =
    place.addressComponents?.find((x) => x.types?.includes('locality')) ??
    place.addressComponents?.find((x) => x.types?.includes('administrative_area_level_1'));
  return c?.longText ?? null;
};

const mapPlace = (
  place: RawPlace,
  languageCode?: string
): Omit<Restaurant, 'restaurant_id'> & { open_now?: boolean } => ({
  place_id: place.id,
  // 한 이름에 여러 언어가 섞여 오는 경우가 있어 표시 언어에 맞는 부분만 남긴다.
  name: pickDisplayName(place.displayName?.text || '(이름 없음)', languageCode),
  address: place.formattedAddress ?? null,
  latitude: place.location?.latitude ?? null,
  longitude: place.location?.longitude ?? null,
  country: countryOf(place),
  region: regionOf(place),
  category: place.primaryTypeDisplayName?.text || place.types?.[0] || null,
  rating: place.rating ?? null,
  review_count: place.userRatingCount ?? null,
  photo_url: photoUrl(place),
  business_status: place.businessStatus ?? null,
  last_synced_at: nowIso(),
  language_code: languageCode ?? null,
  open_now: place.currentOpeningHours?.openNow,
  source: 'google',
});

const callPlaces = async (path: string, body: unknown, fieldMask: string): Promise<any> => {
  const response = await fetch(`${PLACES_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.googleMapsApiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Places API ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
};

/* ------------------------------------------------------------------ */
/* 내부 DB 동기화 (계획서 4.2)                                          */
/* ------------------------------------------------------------------ */

const rowToRestaurant = (row: any): Restaurant => ({
  restaurant_id: row.restaurant_id,
  place_id: row.place_id,
  name: row.name,
  address: row.address,
  latitude: row.latitude,
  longitude: row.longitude,
  country: row.country,
  region: row.region,
  category: row.category,
  rating: row.rating,
  review_count: row.review_count,
  photo_url: row.photo_url,
  business_status: row.business_status,
  last_synced_at: row.last_synced_at,
  language_code: row.language_code,
  source: 'db',
});

/** Place ID 를 기준 키로 내부 restaurants 테이블에 저장/갱신한다. */
export const upsertRestaurant = async (
  data: Partial<Restaurant> & { place_id: string; name: string }
): Promise<Restaurant> => {
  const existing: any = await db.get('SELECT * FROM restaurants WHERE place_id = ?', [data.place_id]);
  const id = existing?.restaurant_id ?? newId('rst');

  await db.run(
    `INSERT INTO restaurants (restaurant_id, place_id, name, address, latitude, longitude, country, region,
       category, rating, review_count, photo_url, business_status, last_synced_at, language_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(place_id) DO UPDATE SET
       name = excluded.name,
       address = COALESCE(excluded.address, restaurants.address),
       latitude = COALESCE(excluded.latitude, restaurants.latitude),
       longitude = COALESCE(excluded.longitude, restaurants.longitude),
       country = COALESCE(excluded.country, restaurants.country),
       region = COALESCE(excluded.region, restaurants.region),
       category = COALESCE(excluded.category, restaurants.category),
       rating = COALESCE(excluded.rating, restaurants.rating),
       review_count = COALESCE(excluded.review_count, restaurants.review_count),
       photo_url = COALESCE(excluded.photo_url, restaurants.photo_url),
       business_status = COALESCE(excluded.business_status, restaurants.business_status),
       last_synced_at = excluded.last_synced_at,
       language_code = COALESCE(excluded.language_code, restaurants.language_code)`,
    [
    id,
    data.place_id,
    data.name,
    data.address ?? null,
    data.latitude ?? null,
    data.longitude ?? null,
    data.country ?? null,
    data.region ?? null,
    data.category ?? null,
    data.rating ?? null,
    data.review_count ?? null,
    data.photo_url ?? null,
    data.business_status ?? null,
    nowIso(),
    data.language_code ?? null,
    ]
  );

  return rowToRestaurant(await db.get('SELECT * FROM restaurants WHERE place_id = ?', [data.place_id]));
};

export const getRestaurantById = async (restaurantId: string): Promise<Restaurant | null> => {
  const row = await db.get('SELECT * FROM restaurants WHERE restaurant_id = ?', [restaurantId]);
  return row ? rowToRestaurant(row) : null;
};

export const getRestaurantByPlaceId = async (placeId: string): Promise<Restaurant | null> => {
  const row = await db.get('SELECT * FROM restaurants WHERE place_id = ?', [placeId]);
  return row ? rowToRestaurant(row) : null;
};

/* ------------------------------------------------------------------ */
/* 검색                                                                */
/* ------------------------------------------------------------------ */

const demoAsRestaurants = (origin?: { lat: number; lng: number }) =>
  DEMO_RESTAURANTS.map((d) => ({
    ...d,
    restaurant_id: '',
    last_synced_at: nowIso(),
    source: 'demo' as const,
    distance_m:
      origin && d.latitude != null && d.longitude != null
        ? haversineMeters(origin, { lat: d.latitude, lng: d.longitude })
        : undefined,
  }));

/** 데모 식당을 내부 DB 에 반영한 뒤 목록으로 돌려준다. */
const demoFallback = async (
  origin: { lat: number; lng: number } | undefined,
  limit: number,
  filter?: (d: ReturnType<typeof demoAsRestaurants>[number]) => boolean
): Promise<Restaurant[]> => {
  const picked = demoAsRestaurants(origin)
    .filter((d) => (filter ? filter(d) : true))
    .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))
    .slice(0, limit);

  const saved: Restaurant[] = [];
  for (const d of picked) {
    saved.push({ ...(await upsertRestaurant(d)), distance_m: d.distance_m, source: 'demo' as const });
  }
  return saved;
};

/**
 * 지도 검색을 못 했을 때 쓰는 오류.
 *
 * 예전에는 호출이 실패하면 데모 식당 목록으로 대신했는데, 그러면 사용자가
 * 근처에 있지도 않은 가게를 진짜로 착각한다. 알레르기 정보를 다루는 앱에서
 * 이건 화면이 잠깐 비는 것보다 훨씬 나쁘다.
 * 그래서 이제는 실패를 숨기지 않고, 화면이 사정을 설명하도록 이 오류를 올린다.
 */
export class PlacesUnavailableError extends Error {
  /** 'quota' = 오늘 호출 한도 소진, 'failed' = 그 밖의 호출 실패 */
  readonly kind: 'quota' | 'failed';
  constructor(kind: 'quota' | 'failed', detail: string) {
    super(detail);
    this.name = 'PlacesUnavailableError';
    this.kind = kind;
  }
}

/** 할당량 소진인지 구분한다. 사용자에게 다른 안내를 해야 하기 때문이다. */
const isQuotaError = (error: unknown): boolean => {
  const msg = String((error as Error)?.message || error || '').toLowerCase();
  return msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted');
};

/** 호출 실패를 화면에 설명할 수 있는 오류로 바꾼다. */
const toUnavailable = (error: unknown, where: string): PlacesUnavailableError => {
  const detail = String((error as Error)?.message || error || '');
  console.warn(`[places] ${where} 실패:`, detail);
  return new PlacesUnavailableError(isQuotaError(error) ? 'quota' : 'failed', detail);
};

/** 호출 실패가 일시적인 것인지(=화면에서 안내할 수 있는 것인지) 가린다. */
const isRecoverablePlacesError = (error: unknown): boolean => {
  const msg = String((error as Error)?.message || error || '');
  return (
    msg.includes('Places API 4') || // 401/403/404 등 인증·권한 오류
    msg.includes('Places API 5') || // 서버 오류
    msg.includes('429') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('billing') ||
    msg.toLowerCase().includes('fetch failed')
  );
};

export interface NearbyOptions {
  lat: number;
  lng: number;
  radius?: number;
  keyword?: string;
  limit?: number;
  /** 결과 표시 언어 (ko, en, ja ...). 가게 이름·주소·업종이 이 언어로 내려온다. */
  languageCode?: string;
  /** 저장된 결과를 무시하고 구글에서 새로 받아온다 (사용자가 새로고침을 누른 경우). */
  force?: boolean;
}

/**
 * 최근에 받아 둔 같은 동네 식당을 내부 DB 에서 찾는다.
 *
 * 구글 주변검색은 하루 호출 수가 정해져 있는데, 지도 화면을 열 때마다 부르면
 * 같은 자리를 몇 번 보는 것만으로 하루치가 바닥난다. 한 번 받아 온 동네는
 * 하루 동안 저장된 것을 쓰고, 그 사이에는 구글을 부르지 않는다.
 */
const nearbyFromCache = async (
  lat: number,
  lng: number,
  radius: number,
  limit: number,
  languageCode?: string
): Promise<Restaurant[]> => {
  const latDelta = radius / 111_000; // 위도 1도 ≈ 111km
  const lngDelta = radius / (111_000 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

  const rows = (await db.all(
    `SELECT * FROM restaurants
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         AND last_synced_at >= datetime('now', '-1 day')
         AND (? IS NULL OR language_code = ?)
       LIMIT 80`,
    [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, languageCode ?? null, languageCode ?? null]
  )) as any[];

  return rows
    .map((row) => ({
      ...rowToRestaurant(row),
      distance_m: haversineMeters({ lat, lng }, { lat: row.latitude, lng: row.longitude }),
    }))
    .filter((r) => (r.distance_m ?? 0) <= radius)
    .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))
    .slice(0, limit);
};

/**
 * 저장된 결과를 그대로 쓸 만한지 판단하는 기준.
 * 너무 적게 잡히면 그 동네를 제대로 받아 온 적이 없다는 뜻이므로 구글에 다시 묻는다.
 */
const CACHE_MIN_RESULTS = 8;

/** 주변 음식점 검색. 결과는 내부 DB 에 저장하여 Place ID 를 기준 키로 유지한다. */
export const searchNearby = async (opts: NearbyOptions): Promise<Restaurant[]> => {
  const { lat, lng, radius = 1500, limit = 20 } = opts;

  if (!flags.hasGoogleMaps) return await demoFallback({ lat, lng }, limit);

  // 이름으로 찾는 검색이 아니라면, 하루 안에 받아 둔 같은 동네 결과를 먼저 쓴다.
  if (!opts.keyword && !opts.force) {
    const cached = await nearbyFromCache(lat, lng, radius, limit, opts.languageCode);
    if (cached.length >= CACHE_MIN_RESULTS) {
      console.log(`[places] 주변 검색: 저장된 ${cached.length}곳 사용 (구글 호출 안 함)`);
      return cached;
    }
  }

  const body = opts.keyword
    ? {
        textQuery: opts.keyword,
        includedType: 'restaurant',
        maxResultCount: limit,
        languageCode: opts.languageCode,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }
    : {
        includedTypes: ['restaurant'],
        maxResultCount: limit,
        languageCode: opts.languageCode,
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      };

  let places: RawPlace[];
  try {
    const data = await callPlaces(opts.keyword ? 'places:searchText' : 'places:searchNearby', body, FIELD_MASK);
    places = data.places || [];
  } catch (error) {
    if (!isRecoverablePlacesError(error)) throw error;
    // 키가 있는데 호출이 실패한 것이므로, 없는 가게를 지어내지 않고 사정을 알린다.
    throw toUnavailable(error, '주변 검색');
  }

  const results: Restaurant[] = [];
  for (const p of places) {
    const mapped = mapPlace(p, opts.languageCode);
    const saved = await upsertRestaurant(mapped);
    results.push({
      ...saved,
      distance_m:
        mapped.latitude != null && mapped.longitude != null
          ? haversineMeters({ lat, lng }, { lat: mapped.latitude, lng: mapped.longitude })
          : undefined,
      source: 'google' as const,
    });
  }
  return results;
};

export interface TextSearchOptions {
  query: string;
  lat?: number;
  lng?: number;
  limit?: number;
  languageCode?: string;
}

/** 식당명 / 음식 종류 / 지역명 검색 (계획서 4.1) */
export const searchText = async (opts: TextSearchOptions): Promise<Restaurant[]> => {
  const { query, lat, lng, limit = 20 } = opts;
  const origin = lat != null && lng != null ? { lat, lng } : undefined;

  const q = query.toLowerCase();
  const matchesQuery = (d: { name: string; category?: string | null; address?: string | null; region?: string | null }) =>
    d.name.toLowerCase().includes(q) ||
    (d.category || '').toLowerCase().includes(q) ||
    (d.address || '').toLowerCase().includes(q) ||
    (d.region || '').toLowerCase().includes(q);

  if (!flags.hasGoogleMaps) return await demoFallback(origin, limit, matchesQuery);

  const body: any = {
    textQuery: query,
    includedType: 'restaurant',
    maxResultCount: limit,
    languageCode: opts.languageCode,
  };
  if (origin) {
    body.locationBias = { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: 20000 } };
  }

  let places: RawPlace[];
  try {
    const data = await callPlaces('places:searchText', body, FIELD_MASK);
    places = data.places || [];
  } catch (error) {
    if (!isRecoverablePlacesError(error)) throw error;
    throw toUnavailable(error, '이름 검색');
  }

  const results: Restaurant[] = [];
  for (const p of places) {
    const mapped = mapPlace(p, opts.languageCode);
    const saved = await upsertRestaurant(mapped);
    results.push({
      ...saved,
      distance_m:
        origin && mapped.latitude != null && mapped.longitude != null
          ? haversineMeters(origin, { lat: mapped.latitude, lng: mapped.longitude })
          : undefined,
      source: 'google' as const,
    });
  }
  return results;
};

/**
 * Place ID 로 상세 정보를 동기화한다. (계획서 13.3 sync-place)
 * 이미 저장된 정보가 충분히 최신이면 API 를 호출하지 않는다. (계획서 7.5)
 */
export const syncPlace = async (
  placeId: string,
  force = false,
  languageCode?: string
): Promise<Restaurant> => {
  const cached = await getRestaurantByPlaceId(placeId);
  const languageMatches = !languageCode || cached?.language_code === languageCode;
  if (cached && !force && languageMatches && !isStale(cached.last_synced_at, env.publicDataTtlDays)) {
    return cached;
  }

  if (!flags.hasGoogleMaps) {
    const demo = DEMO_RESTAURANTS.find((d) => d.place_id === placeId);
    if (demo) return { ...(await upsertRestaurant(demo)), source: 'demo' };
    if (cached) return cached;
    throw new Error('지도 API 키가 없어 해당 장소 정보를 가져올 수 없습니다.');
  }

  const langQuery = languageCode ? `?languageCode=${encodeURIComponent(languageCode)}` : '';
  const response = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}${langQuery}`, {
    headers: {
      'X-Goog-Api-Key': env.googleMapsApiKey,
      'X-Goog-FieldMask': DETAIL_FIELD_MASK,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    if (cached) {
      console.warn(`[places] detail fetch failed (${response.status}), serving cached row`);
      return cached;
    }
    throw new Error(`Places API ${response.status}: ${text.slice(0, 300)}`);
  }

  const place: RawPlace = await response.json();
  return upsertRestaurant(mapPlace(place, languageCode));
};
