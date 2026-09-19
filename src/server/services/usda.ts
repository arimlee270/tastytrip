import { db, isStale, newId, nowIso } from '../db';
import { env, flags } from '../env';

/**
 * 계획서 6.6 — USDA FoodData Central.
 * 해외 음식/영문 음식명의 100g 기준 영양 참고값을 조회한다.
 * 사용 원칙(6.6): 특정 식당 메뉴의 확정 칼로리로 쓰지 않고, 유사 음식의 기준값으로만 사용한다.
 */

export interface UsdaNutrition {
  source: 'USDA';
  fdc_id: string;
  description: string;
  data_type: string | null;
  /** 100g 기준 */
  energy_kcal: number | null;
  carbohydrate_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  sodium_mg: number | null;
  published_date: string | null;
}

const readCache = async <T>(key: string, ttlDays: number): Promise<T | null> => {
  const row: any = await db.get('SELECT payload, fetched_at FROM public_data_cache WHERE cache_key = ?', [key]);
  if (!row || isStale(row.fetched_at, ttlDays)) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
};

const writeCache = async (key: string, payload: unknown): Promise<void> => {
  await db.run(
    `INSERT INTO public_data_cache (cache_key, source_name, payload, fetched_at)
     VALUES (?, 'USDA', ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    [key, JSON.stringify(payload), nowIso()]
  );
};

const nutrientValue = (food: any, names: string[], unit?: string): number | null => {
  const list: any[] = food.foodNutrients || [];
  for (const n of list) {
    const name: string = (n.nutrientName || n.nutrient?.name || '').toLowerCase();
    const u: string = (n.unitName || n.nutrient?.unitName || '').toLowerCase();
    if (names.some((target) => name.includes(target.toLowerCase()))) {
      if (unit && u !== unit.toLowerCase()) continue;
      const value = n.value ?? n.amount;
      if (typeof value === 'number') return value;
    }
  }
  return null;
};

const mapFood = (food: any): UsdaNutrition => ({
  source: 'USDA',
  fdc_id: String(food.fdcId),
  description: food.description || '',
  data_type: food.dataType || null,
  energy_kcal: nutrientValue(food, ['energy'], 'kcal'),
  carbohydrate_g: nutrientValue(food, ['carbohydrate, by difference', 'carbohydrate'], 'g'),
  protein_g: nutrientValue(food, ['protein'], 'g'),
  fat_g: nutrientValue(food, ['total lipid', 'fat'], 'g'),
  sodium_mg: nutrientValue(food, ['sodium'], 'mg'),
  published_date: food.publishedDate || null,
});

/** 비교용 정규화: 공백·기호·대소문자·수식어 제거 */
const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/,.*$/, '') // "Pad thai, restaurant" -> "pad thai"
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * "Pad Thai" 로 검색하면 시판 제품(Branded)이나 전혀 다른 식품도 함께 나온다.
 * 식약처와 같은 원칙으로, 이름이 사실상 일치하는 것만 사용한다.
 */
const isCloseMatch = (description: string, query: string): boolean => {
  const a = normalizeName(description);
  const b = normalizeName(query);
  if (!a || !b) return false;
  // 검색어를 그대로 포함하되, 수식어가 과하게 붙지 않은 경우만 인정한다.
  return a === b || (a.includes(b) && a.length <= b.length * 1.6);
};

/** 표준 식품(Foundation/SR Legacy/Survey)을 시판 제품(Branded)보다 우선한다. */
const dataTypeRank = (dataType: string | null): number => {
  switch (dataType) {
    case 'Foundation':
      return 3;
    case 'SR Legacy':
      return 2;
    case 'Survey (FNDDS)':
      return 2;
    default:
      return 0; // Branded 등
  }
};

/** 영문 음식명으로 100g 기준 영양 정보를 검색한다. */
export const searchUsda = async (query: string, limit = 3): Promise<UsdaNutrition[]> => {
  if (!flags.hasUsda || !query.trim()) return [];

  const cacheKey = `usda:search:${query.trim().toLowerCase()}`;
  const cached = await readCache<UsdaNutrition[]>(cacheKey, env.publicDataTtlDays);
  if (cached) return cached;

  // 걸러낼 것을 감안해 넉넉히 받는다.
  const url =
    `${env.usdaBaseUrl}/foods/search?api_key=${encodeURIComponent(env.usdaApiKey)}` +
    `&query=${encodeURIComponent(query.trim())}&pageSize=${Math.max(limit * 8, 25)}` +
    `&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)`;

  try {
    // 공공데이터가 늦어도 분석은 진행해야 하므로 오래 기다리지 않는다.
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      throw new Error(`USDA ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const data = await response.json();

    const foods: UsdaNutrition[] = (data.foods || [])
      .map(mapFood)
      .filter((f: UsdaNutrition) => f.energy_kcal != null && isCloseMatch(f.description, query))
      .sort(
        (a: UsdaNutrition, b: UsdaNutrition) => dataTypeRank(b.data_type) - dataTypeRank(a.data_type)
      )
      .slice(0, limit);

    if (foods.length === 0) {
      console.log(`[usda] '${query}' 은 정확히 일치하는 항목이 없어 사용하지 않습니다.`);
    }
    await writeCache(cacheKey, foods);
    return foods;
  } catch (e) {
    console.warn('[usda] 검색 실패:', (e as Error).message);
    return [];
  }
};

/** 조회 결과를 표준 음식에 연결해 저장한다. */
export const persistUsda = async (standardFoodId: string, records: UsdaNutrition[]): Promise<void> => {
  const sql = (
    `INSERT INTO nutrition_references (nutrition_reference_id, standard_food_id, source_name, source_item_id,
       reference_amount_g, energy_kcal, carbohydrate_g, protein_g, fat_g, sodium_mg, raw_payload, source_updated_at, collected_at)
     VALUES (?, ?, 'USDA', ?, 100, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(standard_food_id, source_name, source_item_id) DO UPDATE SET
       energy_kcal = excluded.energy_kcal,
       carbohydrate_g = excluded.carbohydrate_g,
       protein_g = excluded.protein_g,
       fat_g = excluded.fat_g,
       sodium_mg = excluded.sodium_mg,
       raw_payload = excluded.raw_payload,
       collected_at = excluded.collected_at`
  );

  await db.batch(
    records.map((r) => ({
      sql,
      params: [
        newId('ntr'),
        standardFoodId,
        r.fdc_id,
        r.energy_kcal,
        r.carbohydrate_g,
        r.protein_g,
        r.fat_g,
        r.sodium_mg,
        JSON.stringify(r),
        r.published_date,
        nowIso(),
      ],
    }))
  );
};
