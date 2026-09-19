import { db, isStale, nowIso, parseJson } from '../db';
import { env } from '../env';
import type { Dish } from '../../types';

/**
 * 계획서 12.1 3단계 — 공통 음식 분석 캐시.
 *
 * 같은 음식을 다른 사용자가 조회할 때마다 Gemini 를 다시 부르지 않도록,
 * 음식 자체에 대한 설명(재료·맛·주문법 등)을 표준 음식 단위로 저장한다.
 *
 * 저장하지 않는 것: 안전/주의 판정, 경고 문구, 구성원별 경고.
 * 이것들은 사용자 프로필에 따라 달라지므로 조회할 때마다 다시 계산한다.
 */

/** 사용자와 무관한 부분만 골라 저장한다. */
const CACHEABLE_FIELDS = [
  'name',
  'original',
  'standard_food_name',
  'imageUrl',
  'primary_query',
  'secondary_query',
  'fallback_query',
  'desc',
  'taste',
  'pair',
  'order',
  'phrase',
  'etiquette',
  'typical_ingredients',
  'match_ingredients',
  'match_allergens',
  'allergen_risk',
  'dietary',
  'estimated_calories',
  'source_type',
  'source_summary',
  'confidence_score',
  'verification_message',
  'reviews',
] as const;

/**
 * 메뉴판에 적힌 이름을 저장 칸의 열쇠로 바꾼다.
 *
 * 표준 음식만으로는 칸이 부족하다. '刺身盛り合わせ'(모둠회)와 'かんぱち刺'(잿방어 회)는
 * 둘 다 사시미로 묶이지만 재료도 양도 다른 메뉴다. 표준 음식 하나에 한 칸만 두면
 * 나중에 저장한 쪽이 앞의 것을 덮어써서, 손님이 다른 음식의 재료를 자기 메뉴의
 * 재료로 읽게 된다. 그래서 메뉴 이름까지 열쇠에 넣어 칸을 따로 쓴다.
 */
export const dishCacheKey = (name?: string | null): string =>
  (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const saveFoodAnalysis = async (
  standardFoodId: string,
  dishKey: string,
  lang: string,
  dish: Dish
): Promise<void> => {
  const payload: Record<string, unknown> = {};
  CACHEABLE_FIELDS.forEach((key) => {
    const value = (dish as any)[key];
    if (value !== undefined) payload[key] = value;
  });

  await db.run(
    `INSERT INTO dish_analysis (standard_food_id, dish_key, lang, payload, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(standard_food_id, dish_key, lang) DO UPDATE SET
       payload = excluded.payload,
       generated_at = excluded.generated_at`,
    [standardFoodId, dishKey, lang, JSON.stringify(payload), nowIso()]
  );
};

/**
 * 캐시된 분석을 불러온다. 너무 오래된 것은 쓰지 않는다. (계획서 12.2)
 *
 * 메뉴 이름이 정확히 맞는 칸만 쓴다. 비슷한 음식의 분석을 대신 내주면
 * 알레르기 정보가 틀리기 때문이다.
 */
export const loadFoodAnalysis = async (
  standardFoodId: string,
  dishKey: string,
  lang: string
): Promise<Partial<Dish> | null> => {
  const row: any = await db.get(
    `SELECT payload, generated_at FROM dish_analysis
       WHERE standard_food_id = ? AND dish_key = ? AND lang = ?`,
    [standardFoodId, dishKey, lang]
  );
  if (!row) return null;
  if (isStale(row.generated_at, env.menuStaleDays)) return null;
  return parseJson<Partial<Dish>>(row.payload, {}) as Partial<Dish>;
};

export const cachedFoodCount = async (): Promise<number> =>
  ((await db.get<any>('SELECT COUNT(*) AS n FROM dish_analysis'))?.n ?? 0);
