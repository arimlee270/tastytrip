import { db, daysSince, parseJson } from '../db';
import type {
  Dish,
  MenuRecommendation,
  PartyFilter,
  RecommendationReason,
  Restaurant,
  RestaurantRecommendation,
} from '../../types';
import { crossCheck, statusFromHits } from './party';

/**
 * 계획서 10장 — 개인 맞춤 가게 추천.
 *   점수 = 안전 적합도 40% + 식단 적합도 20% + 거리 15% + 메뉴 다양성 10% + 데이터 신뢰도 10% + 인기/평점 5%
 * 안전 조건은 점수 이전에 필터로 먼저 적용한다(10.2).
 */

interface MenuEvalRow {
  menu_id: string;
  restaurant_id: string;
  original_name: string;
  translated_name: string | null;
  ingredients: string;
  allergen_tags: string;
  dietary_tags: string;
  calorie_min: number | null;
  calorie_max: number | null;
  calorie_basis: string | null;
  confidence_score: number | null;
  last_verified_at: string | null;
  payload: string;
}

const loadMenusForRestaurants = async (
  restaurantIds: string[],
  lang: string
): Promise<MenuEvalRow[]> => {
  if (restaurantIds.length === 0) return [];
  const placeholders = restaurantIds.map(() => '?').join(',');
  // 요청 언어의 분석을 우선하되, 없으면 가장 최근 분석을 쓴다.
  return (await db.all(
    `SELECT m.menu_id, m.restaurant_id, m.original_name, m.translated_name, m.last_verified_at,
            a.ingredients, a.allergen_tags, a.dietary_tags, a.calorie_min, a.calorie_max,
            a.calorie_basis, a.confidence_score, a.payload
     FROM restaurant_menus m
     JOIN menu_analysis a ON a.analysis_id = (
       SELECT x.analysis_id FROM menu_analysis x
       WHERE x.menu_id = m.menu_id
       ORDER BY (x.lang = ?) DESC, x.generated_at DESC
       LIMIT 1
     )
     WHERE m.restaurant_id IN (${placeholders}) AND m.status = 'active'`,
    [lang, ...restaurantIds]
  )) as MenuEvalRow[];
};

const evaluateMenu = (row: MenuEvalRow, filter: PartyFilter) => {
  const ingredients = parseJson<string[]>(row.ingredients, []);
  const allergens = parseJson<string[]>(row.allergen_tags, []);
  const dietary = parseJson<string[]>(row.dietary_tags, []);
  const payload = parseJson<any>(row.payload, {});

  const hits = crossCheck([...ingredients, ...allergens], filter);
  const status = statusFromHits(hits, payload.status);

  return { row, status, dietary, payload, hits };
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface RecommendOptions {
  filter: PartyFilter;
  lang: string;
  origin?: { lat: number; lng: number };
  maxDistanceM?: number;
}

/**
 * 직선거리를 도보 시간(분)으로 어림한다.
 *
 * distance_m 은 두 지점을 직선으로 이은 길이라, 실제로 걸어야 하는 거리보다
 * 짧다. 길이 꺾이고 건널목을 돌아가야 하므로 보통 1.3배 정도로 본다.
 * 성인 보행 속도는 분당 80m 로 잡는다.
 *
 * 실제 경로를 쓰려면 유료 경로 API 를 식당마다 불러야 하므로, 여기서는
 * 어림값을 쓰고 화면에서도 '약' 이라고 표시한다.
 */
const DETOUR_RATIO = 1.3;
const WALK_METERS_PER_MIN = 80;

const walkingMinutes = (straightLineMeters: number): number =>
  Math.max(1, Math.round((straightLineMeters * DETOUR_RATIO) / WALK_METERS_PER_MIN));

export const recommendRestaurants = async (
  restaurants: Restaurant[],
  opts: RecommendOptions
): Promise<RestaurantRecommendation[]> => {
  const ids = restaurants.map((r) => r.restaurant_id).filter(Boolean);
  const menus = await loadMenusForRestaurants(ids, opts.lang);

  const byRestaurant = new Map<string, ReturnType<typeof evaluateMenu>[]>();
  menus.forEach((m) => {
    const evaluated = evaluateMenu(m, opts.filter);
    const list = byRestaurant.get(m.restaurant_id) ?? [];
    list.push(evaluated);
    byRestaurant.set(m.restaurant_id, list);
  });

  const maxDistance = opts.maxDistanceM ?? 2000;

  const results: RestaurantRecommendation[] = restaurants.map((restaurant) => {
    const evaluated = byRestaurant.get(restaurant.restaurant_id) ?? [];
    const safe = evaluated.filter((e) => e.status === 'green');
    const check = evaluated.filter((e) => e.status === 'yellow');
    const vegan = evaluated.filter((e) => e.dietary.includes('vegan'));
    const reasons: RecommendationReason[] = [];

    // --- 10.2 필터: 위험 메뉴만 존재하면 추천에서 제외 ---
    const excluded = evaluated.length > 0 && safe.length === 0 && check.length === 0;

    // 1) 안전 적합도 40%
    const safetyScore = evaluated.length === 0 ? 0.35 : clamp01((safe.length + check.length * 0.5) / evaluated.length);

    // 2) 식단 적합도 20% — 파티에 식단 태그가 있을 때만 의미가 있으므로 없으면 중립값
    const dietTags = opts.filter.dietary_tags;
    const dietScore =
      dietTags.length === 0
        ? 0.6
        : evaluated.length === 0
          ? 0.3
          : clamp01(evaluated.filter((e) => dietTags.every((t) => e.dietary.includes(t))).length / evaluated.length);

    // 3) 거리 15%
    const distance = restaurant.distance_m;
    const distanceScore = distance == null ? 0.5 : clamp01(1 - distance / maxDistance);

    // 4) 메뉴 다양성 10%
    const varietyScore = clamp01(evaluated.length / 10);

    // 5) 데이터 신뢰도 10%
    const confidences = evaluated.map((e) => e.row.confidence_score ?? 0.4);
    const confidenceScore = confidences.length === 0 ? 0.2 : clamp01(confidences.reduce((a, b) => a + b, 0) / confidences.length);

    // 6) 인기 및 평점 5%
    const ratingScore = restaurant.rating == null ? 0.5 : clamp01((restaurant.rating - 3) / 2);

    const score =
      safetyScore * 0.4 +
      dietScore * 0.2 +
      distanceScore * 0.15 +
      varietyScore * 0.1 +
      confidenceScore * 0.1 +
      ratingScore * 0.05;

    // --- 10.4 추천 이유 ---
    if (safe.length > 0) reasons.push({ key: 'reasonSafeMenus', value: safe.length });
    if (vegan.length > 0) reasons.push({ key: 'reasonVeganMenus', value: vegan.length });
    if (distance != null) reasons.push({ key: 'reasonDistance', value: walkingMinutes(distance) });
    const freshest = evaluated
      .map((e) => daysSince(e.row.last_verified_at))
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b)[0];
    if (freshest != null) reasons.push({ key: 'reasonVerified', value: freshest });
    if (restaurant.rating != null && restaurant.rating >= 4) {
      reasons.push({ key: 'reasonRating', value: restaurant.rating });
    }

    return {
      restaurant: { ...restaurant, menu_count: evaluated.length },
      score: Math.round(score * 1000) / 1000,
      reasons,
      safe_menu_count: safe.length,
      vegan_menu_count: vegan.length,
      excluded,
    };
  });

  return results.filter((r) => !r.excluded).sort((a, b) => b.score - a.score);
};

export const recommendMenus = async (
  restaurants: Restaurant[],
  opts: RecommendOptions,
  limit = 10
): Promise<MenuRecommendation[]> => {
  const nameById = new Map(restaurants.map((r) => [r.restaurant_id, r.name]));
  const menus = await loadMenusForRestaurants([...nameById.keys()], opts.lang);

  return menus
    .map((row) => {
      const { status, dietary, payload } = evaluateMenu(row, opts.filter);
      const restaurant = restaurants.find((r) => r.restaurant_id === row.restaurant_id);
      const distance = restaurant?.distance_m;

      const statusScore = status === 'green' ? 1 : status === 'yellow' ? 0.4 : 0;
      const dietScore =
        opts.filter.dietary_tags.length === 0
          ? 0.6
          : opts.filter.dietary_tags.every((t) => dietary.includes(t))
            ? 1
            : 0.2;
      const distanceScore = distance == null ? 0.5 : clamp01(1 - distance / (opts.maxDistanceM ?? 2000));
      const confidenceScore = clamp01(row.confidence_score ?? 0.4);

      const score =
        statusScore * 0.5 + dietScore * 0.2 + distanceScore * 0.15 + confidenceScore * 0.15;

      const reasons: RecommendationReason[] = [];
      if (status === 'green') reasons.push({ key: 'reasonSafeMenus', value: 1 });
      if (dietary.includes('vegan')) reasons.push({ key: 'reasonVeganMenus', value: 1 });
      if (distance != null) reasons.push({ key: 'reasonDistance', value: walkingMinutes(distance) });

      return {
        menu_id: row.menu_id,
        restaurant_id: row.restaurant_id,
        restaurant_name: nameById.get(row.restaurant_id) || '',
        name: row.translated_name || row.original_name,
        original_name: row.original_name,
        status,
        estimated_calories:
          row.calorie_min != null && row.calorie_max != null
            ? {
                min: row.calorie_min,
                max: row.calorie_max,
                unit: 'kcal' as const,
                basis: row.calorie_basis || '',
                confidence: row.confidence_score ?? 0.5,
              }
            : (payload.estimated_calories as Dish['estimated_calories']),
        score: Math.round(score * 1000) / 1000,
        reasons,
      };
    })
    .filter((m) => m.status !== 'red')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
