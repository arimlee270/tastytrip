import { Router } from 'express';
import { db, logSearch, nowIso } from '../db';
import { optionalAuth, requireAuth } from '../auth';
import {
  PlacesUnavailableError,
  getRestaurantById,
  haversineMeters,
  searchNearby,
  searchText,
  syncPlace,
} from '../services/places';
import { getRestaurantDishes, menuFreshness } from '../services/menuPipeline';
import { resolveParty } from '../services/party';
import { recommendRestaurants } from '../services/recommend';
import { suggestMenusFromBranches } from '../services/franchise';

/** 계획서 13.3 식당 API */
export const restaurantsRouter = Router();

restaurantsRouter.use(optionalAuth);

/**
 * 지도 검색을 못 했을 때의 응답.
 * 화면이 사정에 맞는 안내를 띄울 수 있도록 reason 을 함께 내려준다.
 * 예전처럼 데모 식당으로 대신하지 않는다 — 없는 가게를 진짜처럼 보여주면 안 된다.
 */
const sendPlacesUnavailable = (res: any, error: PlacesUnavailableError): void => {
  res.status(503).json({
    error:
      error.kind === 'quota'
        ? '오늘 지도 검색 한도를 모두 사용했습니다.'
        : '지도 검색을 일시적으로 사용할 수 없습니다.',
    reason: error.kind,
    restaurants: [],
  });
};

const numParam = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** 지도 결과를 사용자 표시 언어로 받기 위한 언어 코드 */
const langParam = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[a-z]{2}$/.test(v) ? v : undefined;

/** 주변 음식점 검색 */
restaurantsRouter.get('/nearby', async (req, res) => {
  try {
    const lat = numParam(req.query.lat);
    const lng = numParam(req.query.lng);
    if (lat === undefined || lng === undefined) {
      res.status(400).json({ error: '위치(lat, lng)가 필요합니다.' });
      return;
    }

    const restaurants = await searchNearby({
      lat,
      lng,
      radius: numParam(req.query.radius) ?? 1500,
      keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
      limit: numParam(req.query.limit) ?? 20,
      languageCode: langParam(req.query.lang),
      force: req.query.refresh === '1',
    });

    const withMenuCounts = await Promise.all(
      restaurants.map(async (r) => ({ ...r, menu_count: (await menuFreshness(r.restaurant_id)).count }))
    );
    // 키가 있어도 호출이 실패하면 데모 데이터로 대체되므로 결과를 보고 판단한다.
    const isDemo = restaurants.length > 0 && restaurants.every((r) => r.source === 'demo');

    logSearch({
      user_id: req.userId ?? null,
      query_text: `nearby(${lat},${lng})`,
      result_source: isDemo ? 'demo' : 'google_places',
      gemini_called: false,
    });

    res.json({ restaurants: withMenuCounts, demo: isDemo });
  } catch (error: any) {
    if (error instanceof PlacesUnavailableError) {
      sendPlacesUnavailable(res, error);
      return;
    }
    console.error('[restaurants/nearby]', error);
    res.status(500).json({ error: error.message || '주변 식당을 불러오지 못했습니다.' });
  }
});

/**
 * 같은 프랜차이즈 다른 지점에서 등록된 메뉴 (참고용).
 *
 * 이 지점의 메뉴로 바로 넣지 않는다. 지점마다 안 파는 메뉴가 있어서,
 * 없는 메뉴를 있는 것처럼 보여주면 손님이 그것을 주문하게 된다.
 * 현장에서 확인한 사람이 따로 등록해야 이 지점의 메뉴가 된다.
 */
restaurantsRouter.get('/:restaurantId/branch-menus', async (req, res) => {
  const restaurant = await getRestaurantById(req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
    return;
  }
  res.json(await suggestMenusFromBranches(restaurant));
});

/**
 * 입력하는 동안 보여줄 가게 이름 후보 (자동완성).
 *
 * 이미 모아 둔 식당에서만 찾는다. 글자를 칠 때마다 구글을 부르면 하루
 * 호출 한도가 몇 분 만에 바닥난다. 우리 DB 조회는 비용이 들지 않아
 * 마음껏 부를 수 있다.
 */
restaurantsRouter.get('/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 1) {
    res.json({ suggestions: [] });
    return;
  }

  const lat = numParam(req.query.lat);
  const lng = numParam(req.query.lng);

  const rows = (await db.all(
    `SELECT restaurant_id, name, address, latitude, longitude, category
       FROM restaurants WHERE name LIKE ? LIMIT 40`,
    [`%${q}%`]
  )) as any[];

  const scored = rows.map((r) => {
    const lower = String(r.name).toLowerCase();
    const needle = q.toLowerCase();
    return {
      restaurant_id: r.restaurant_id,
      name: r.name,
      address: r.address,
      category: r.category,
      distance_m:
        lat != null && lng != null && r.latitude != null && r.longitude != null
          ? haversineMeters({ lat, lng }, { lat: r.latitude, lng: r.longitude })
          : undefined,
      // 이름이 검색어로 시작하는 가게를 먼저 보여준다.
      startsWith: lower.startsWith(needle),
    };
  });

  scored.sort((a, b) => {
    if (a.startsWith !== b.startsWith) return a.startsWith ? -1 : 1;
    return (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER);
  });

  res.json({ suggestions: scored.slice(0, 8).map(({ startsWith, ...rest }) => rest) });
});

/** 식당명 / 음식 종류 / 지역 검색 */
restaurantsRouter.get('/search', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: '검색어를 입력해주세요.' });
      return;
    }

    const restaurants = await searchText({
      query,
      lat: numParam(req.query.lat),
      lng: numParam(req.query.lng),
      limit: numParam(req.query.limit) ?? 20,
      languageCode: langParam(req.query.lang),
    });

    const withMenuCounts = await Promise.all(
      restaurants.map(async (r) => ({ ...r, menu_count: (await menuFreshness(r.restaurant_id)).count }))
    );
    const isDemo = restaurants.length > 0 && restaurants.every((r) => r.source === 'demo');

    logSearch({
      user_id: req.userId ?? null,
      query_text: query,
      result_source: isDemo ? 'demo' : 'google_places',
      gemini_called: false,
    });

    res.json({ restaurants: withMenuCounts, demo: isDemo });
  } catch (error: any) {
    if (error instanceof PlacesUnavailableError) {
      sendPlacesUnavailable(res, error);
      return;
    }
    console.error('[restaurants/search]', error);
    res.status(500).json({ error: error.message || '식당 검색에 실패했습니다.' });
  }
});

/** Place ID 로 내부 DB 와 동기화 */
restaurantsRouter.post('/sync-place', async (req, res) => {
  try {
    const placeId = req.body?.place_id;
    if (typeof placeId !== 'string' || !placeId) {
      res.status(400).json({ error: 'place_id 가 필요합니다.' });
      return;
    }
    const restaurant = await syncPlace(placeId, req.body?.force === true, langParam(req.body?.lang));
    res.json({ restaurant });
  } catch (error: any) {
    console.error('[restaurants/sync-place]', error);
    res.status(500).json({ error: error.message || '장소 동기화에 실패했습니다.' });
  }
});

/** 저장한 식당 목록 (계획서 14.2) */
restaurantsRouter.get('/saved', requireAuth, async (req, res) => {
  const rows = await db.all(`SELECT r.* FROM saved_restaurants s
       JOIN restaurants r ON r.restaurant_id = s.restaurant_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC`, [req.userId!]);
  res.json({ restaurants: rows });
});

/** 식당 상세 (계획서 4.3) */
restaurantsRouter.get('/:restaurantId', async (req, res) => {
  const restaurant = await getRestaurantById(req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
    return;
  }

  const origin =
    numParam(req.query.lat) !== undefined && numParam(req.query.lng) !== undefined
      ? { lat: numParam(req.query.lat)!, lng: numParam(req.query.lng)! }
      : undefined;

  const distance_m =
    origin && restaurant.latitude != null && restaurant.longitude != null
      ? haversineMeters(origin, { lat: restaurant.latitude, lng: restaurant.longitude })
      : undefined;

  const freshness = await menuFreshness(restaurant.restaurant_id);
  const saved = req.userId
    ? !!await db.get('SELECT 1 FROM saved_restaurants WHERE user_id = ? AND restaurant_id = ?', [req.userId, restaurant.restaurant_id])
    : false;

  res.json({
    restaurant: { ...restaurant, distance_m, menu_count: freshness.count },
    last_verified_days: freshness.lastVerifiedDays,
    saved,
  });
});

/** 식당별 메뉴 조회 — 저장된 데이터가 있으면 Gemini 호출 없이 반환 (계획서 5.1) */
restaurantsRouter.get('/:restaurantId/menus', async (req, res) => {
  const restaurant = await getRestaurantById(req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
    return;
  }

  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';
  // 비로그인 사용자는 화면의 여행 구성원 목록을 쿼리로 전달한다.
  let partyBody: any = {};
  if (typeof req.query.party === 'string') {
    try {
      partyBody = { party: JSON.parse(req.query.party) };
    } catch {
      partyBody = {};
    }
  }
  const { filter } = await resolveParty(partyBody, req.userId);
  const { dishes, stale } = await getRestaurantDishes(restaurant.restaurant_id, lang, filter);

  logSearch({
    user_id: req.userId ?? null,
    restaurant_id: restaurant.restaurant_id,
    query_text: '[restaurant menus]',
    result_source: 'db',
    gemini_called: false,
  });

  res.json({
    dishes,
    meta: { gemini_called: false, result_source: 'db', restaurant_id: restaurant.restaurant_id, stale },
  });
});

/** 맞춤 추천 대상 식당 목록 (지도 화면 하단 추천 패널) */
restaurantsRouter.get('/:restaurantId/recommendation', async (req, res) => {
  const restaurant = await getRestaurantById(req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
    return;
  }
  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';
  const { filter } = await resolveParty({}, req.userId);
  const [recommendation] = await recommendRestaurants([restaurant], { filter, lang });
  res.json({ recommendation: recommendation ?? null });
});

/** 식당 저장 / 해제 */
restaurantsRouter.post('/:restaurantId/save', requireAuth, async (req, res) => {
  const restaurant = await getRestaurantById(req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
    return;
  }
  await db.run(`INSERT INTO saved_restaurants (user_id, restaurant_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, restaurant_id) DO NOTHING`, [req.userId!, restaurant.restaurant_id, nowIso()]);
  res.json({ saved: true });
});

restaurantsRouter.delete('/:restaurantId/save', requireAuth, async (req, res) => {
  await db.run('DELETE FROM saved_restaurants WHERE user_id = ? AND restaurant_id = ?', [req.userId!,
    req.params.restaurantId]);
  res.json({ saved: false });
});
