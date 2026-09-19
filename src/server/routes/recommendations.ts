import { Router } from 'express';
import { db } from '../db';
import { optionalAuth } from '../auth';
import { resolveParty } from '../services/party';
import { haversineMeters, searchNearby } from '../services/places';
import { recommendMenus, recommendRestaurants } from '../services/recommend';
import type { Restaurant } from '../../types';

/** 계획서 13.6 추천 API */
export const recommendationsRouter = Router();

recommendationsRouter.use(optionalAuth);

const numParam = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * 최근에 동기화된 내부 식당 중 반경 안에 있는 것을 찾는다.
 * 위·경도 범위로 1차 필터링한 뒤 실제 거리로 걸러낸다.
 */
const nearbyFromDb = async (lat: number, lng: number, radius: number): Promise<Restaurant[]> => {
  const latDelta = radius / 111_000; // 위도 1도 ≈ 111km
  const lngDelta = radius / (111_000 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

  const rows = await db.all(`SELECT * FROM restaurants
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         AND last_synced_at >= datetime('now', '-1 day')
       LIMIT 60`, [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]) as any[];

  return rows
    .map((row) => ({
      ...row,
      distance_m: haversineMeters({ lat, lng }, { lat: row.latitude, lng: row.longitude }),
      source: 'db' as const,
    }))
    .filter((r) => r.distance_m <= radius);
};

/** 위치 기준 후보 식당을 모은다. 내부 DB 우선, 부족할 때만 지도 API. */
const collectCandidates = async (
  lat: number | undefined,
  lng: number | undefined,
  radius: number,
  languageCode?: string
): Promise<Restaurant[]> => {
  const candidates = new Map<string, Restaurant>();

  if (lat !== undefined && lng !== undefined) {
    // 지도 화면이 방금 주변 검색을 했다면 그 결과가 이미 DB 에 저장되어 있다.
    // 같은 지점을 다시 조회해 지도 API 할당량을 두 번 쓰지 않도록, 먼저 DB 에서 찾는다.
    const cached = await nearbyFromDb(lat, lng, radius);
    cached.forEach((r) => candidates.set(r.restaurant_id, r));

    if (cached.length < 5) {
      try {
        const nearby = await searchNearby({ lat, lng, radius, limit: 20, languageCode });
        nearby.forEach((r) => candidates.set(r.restaurant_id, r));
      } catch (e) {
        console.warn('[recommendations] 주변 검색 실패, 내부 DB 만 사용:', (e as Error).message);
      }
    }
  }

  // 메뉴 데이터가 있는 내부 식당은 항상 후보에 포함한다.
  const stored = await db.all(`SELECT r.* FROM restaurants r
       WHERE EXISTS (SELECT 1 FROM restaurant_menus m WHERE m.restaurant_id = r.restaurant_id AND m.status = 'active')
       LIMIT 100`) as any[];

  stored.forEach((row) => {
    if (candidates.has(row.restaurant_id)) return;
    const distance_m =
      lat !== undefined && lng !== undefined && row.latitude != null && row.longitude != null
        ? haversineMeters({ lat, lng }, { lat: row.latitude, lng: row.longitude })
        : undefined;
    if (distance_m !== undefined && distance_m > radius * 3) return;
    candidates.set(row.restaurant_id, { ...row, distance_m, source: 'db' });
  });

  return [...candidates.values()];
};

/** 맞춤 식당 추천 */
recommendationsRouter.get('/restaurants', async (req, res) => {
  try {
    const lat = numParam(req.query.lat);
    const lng = numParam(req.query.lng);
    const radius = numParam(req.query.radius) ?? 1500;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';

    let partyBody: any = {};
    if (typeof req.query.party === 'string') {
      try {
        partyBody = { party: JSON.parse(req.query.party) };
      } catch {
        partyBody = {};
      }
    }
    const { filter } = await resolveParty(partyBody, req.userId);

    const candidates = await collectCandidates(lat, lng, radius, lang);
    const recommendations = await recommendRestaurants(candidates, {
      filter,
      lang,
      origin: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
      maxDistanceM: radius,
    });

    res.json({ recommendations: recommendations.slice(0, numParam(req.query.limit) ?? 10) });
  } catch (error: any) {
    console.error('[recommendations/restaurants]', error);
    res.status(500).json({ error: error.message || '추천을 계산하지 못했습니다.' });
  }
});

/** 맞춤 메뉴 추천 */
recommendationsRouter.get('/menus', async (req, res) => {
  try {
    const lat = numParam(req.query.lat);
    const lng = numParam(req.query.lng);
    const radius = numParam(req.query.radius) ?? 1500;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';

    let partyBody: any = {};
    if (typeof req.query.party === 'string') {
      try {
        partyBody = { party: JSON.parse(req.query.party) };
      } catch {
        partyBody = {};
      }
    }
    const { filter } = await resolveParty(partyBody, req.userId);

    const candidates = await collectCandidates(lat, lng, radius, lang);
    const menus = await recommendMenus(
      candidates,
      { filter, lang, origin: lat !== undefined && lng !== undefined ? { lat, lng } : undefined, maxDistanceM: radius },
      numParam(req.query.limit) ?? 10
    );

    res.json({ menus });
  } catch (error: any) {
    console.error('[recommendations/menus]', error);
    res.status(500).json({ error: error.message || '추천을 계산하지 못했습니다.' });
  }
});
