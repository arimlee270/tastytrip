import { db, newId, nowIso, parseJson, toJson } from '../db';
import type { StandardFood } from '../../types';

/**
 * 계획서 7.2 — 같은 음식이 여러 이름으로 표기되므로 별칭 테이블로 표준 음식 ID 를 찾는다.
 *   팟타이 / Pad Thai / ผัดไทย / Phad Thai -> TH_PAD_THAI
 */

/** 검색 키 정규화: 공백·기호 제거 + 소문자화 */
export const aliasKey = (raw: string): string =>
  (raw || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.·・,()[\]{}'"]/g, '')
    .trim();

export const rowToStandardFood = (row: any): StandardFood => ({
  standard_food_id: row.standard_food_id,
  standard_name_en: row.standard_name_en,
  name_ko: row.name_ko,
  local_names: parseJson<string[]>(row.local_names, []),
  aliases: parseJson<string[]>(row.aliases, []),
  country: row.country,
  category: row.category,
  typical_description: row.typical_description,
  typical_ingredients: parseJson<string[]>(row.typical_ingredients, []),
  typical_allergens: parseJson<string[]>(row.typical_allergens, []),
  dietary_tags: parseJson<string[]>(row.dietary_tags, []),
});

export const getStandardFood = async (id: string): Promise<StandardFood | null> => {
  const row = await db.get('SELECT * FROM standard_foods WHERE standard_food_id = ?', [id]);
  return row ? rowToStandardFood(row) : null;
};

export const getServingWeight = async (id: string): Promise<{ min: number; max: number }> => {
  const row: any = await db.get(
    'SELECT serving_weight_min_g, serving_weight_max_g FROM standard_foods WHERE standard_food_id = ?',
    [id]
  );
  return {
    min: row?.serving_weight_min_g ?? 300,
    max: row?.serving_weight_max_g ?? 450,
  };
};

/** 별칭 정확 매칭 */
const findByAlias = async (name: string): Promise<StandardFood | null> => {
  const key = aliasKey(name);
  if (!key) return null;
  const hit: any = await db.get('SELECT standard_food_id FROM food_aliases WHERE alias_key = ?', [key]);
  return hit ? getStandardFood(hit.standard_food_id) : null;
};

/** 부분 일치(포함 관계) 매칭 — "새우 팟타이" 처럼 수식어가 붙은 경우 */
const findByPartial = async (name: string): Promise<StandardFood | null> => {
  const key = aliasKey(name);
  if (key.length < 3) return null;
  const rows: any[] = await db.all('SELECT alias_key, standard_food_id FROM food_aliases');
  // 가장 긴 별칭이 먼저 매칭되도록 정렬 (더 구체적인 이름 우선)
  const sorted = rows.sort((a, b) => b.alias_key.length - a.alias_key.length);
  const hit = sorted.find((r) => r.alias_key.length >= 3 && (key.includes(r.alias_key) || r.alias_key.includes(key)));
  return hit ? getStandardFood(hit.standard_food_id) : null;
};

/**
 * 메뉴명(원어/번역/표준명 후보)으로 표준 음식을 찾는다.
 * 정확 매칭 -> 부분 매칭 순으로 시도하고, 찾지 못하면 null 을 반환한다.
 */
export const resolveStandardFood = async (
  candidates: (string | undefined | null)[]
): Promise<StandardFood | null> => {
  const names = candidates.filter((c): c is string => !!c && !!c.trim());
  for (const name of names) {
    const exact = await findByAlias(name);
    if (exact) return exact;
  }
  for (const name of names) {
    const partial = await findByPartial(name);
    if (partial) return partial;
  }
  return null;
};

/** 표준 음식 등록/갱신 + 별칭 색인 */
export const upsertStandardFood = async (food: {
  standard_food_id: string;
  standard_name_en: string;
  name_ko?: string | null;
  local_names?: string[];
  aliases?: string[];
  country?: string | null;
  category?: string | null;
  typical_description?: string | null;
  typical_ingredients?: string[];
  typical_allergens?: string[];
  dietary_tags?: string[];
  serving_weight_min_g?: number | null;
  serving_weight_max_g?: number | null;
}): Promise<StandardFood> => {
  const ts = nowIso();
  await db.run(
    `INSERT INTO standard_foods (standard_food_id, standard_name_en, name_ko, local_names, aliases, country, category,
       typical_description, typical_ingredients, typical_allergens, dietary_tags,
       serving_weight_min_g, serving_weight_max_g, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(standard_food_id) DO UPDATE SET
       standard_name_en = excluded.standard_name_en,
       name_ko = COALESCE(excluded.name_ko, standard_foods.name_ko),
       local_names = excluded.local_names,
       aliases = excluded.aliases,
       country = COALESCE(excluded.country, standard_foods.country),
       category = COALESCE(excluded.category, standard_foods.category),
       typical_description = COALESCE(excluded.typical_description, standard_foods.typical_description),
       typical_ingredients = excluded.typical_ingredients,
       typical_allergens = excluded.typical_allergens,
       dietary_tags = excluded.dietary_tags,
       serving_weight_min_g = COALESCE(excluded.serving_weight_min_g, standard_foods.serving_weight_min_g),
       serving_weight_max_g = COALESCE(excluded.serving_weight_max_g, standard_foods.serving_weight_max_g),
       updated_at = excluded.updated_at`,
    [
    food.standard_food_id,
    food.standard_name_en,
    food.name_ko ?? null,
    toJson(food.local_names ?? []),
    toJson(food.aliases ?? []),
    food.country ?? null,
    food.category ?? null,
    food.typical_description ?? null,
    toJson(food.typical_ingredients ?? []),
    toJson(food.typical_allergens ?? []),
    toJson(food.dietary_tags ?? []),
    food.serving_weight_min_g ?? null,
    food.serving_weight_max_g ?? null,
    ts,
    ]
  );

  await registerAliases(food.standard_food_id, [
    food.standard_name_en,
    food.name_ko ?? '',
    ...(food.local_names ?? []),
    ...(food.aliases ?? []),
  ]);

  return (await getStandardFood(food.standard_food_id))!;
};

export const registerAliases = async (
  standardFoodId: string,
  aliases: (string | undefined | null)[]
): Promise<void> => {
  const sql = `INSERT INTO food_aliases (alias_key, standard_food_id, raw_alias, lang)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(alias_key) DO UPDATE SET standard_food_id = excluded.standard_food_id`;

  const statements = aliases
    .filter((a): a is string => !!a && !!a.trim())
    .map((alias) => ({ alias, key: aliasKey(alias) }))
    .filter((x) => x.key.length >= 2)
    .map((x) => ({ sql, params: [x.key, standardFoodId, x.alias.trim()] }));

  await db.batch(statements);
};

/**
 * AI 가 새로 인식한 메뉴를 표준 음식으로 등록한다. (계획서 7.1 내부 DB 적재)
 * 표준 영문명을 기반으로 ID 를 만들되 충돌 시 임의 접미사를 붙인다.
 */
export const createStandardFoodFromDish = async (dish: {
  standard_food_name?: string;
  name: string;
  original: string;
  country?: string;
  typical_ingredients?: string[];
  typical_allergens?: string[];
  dietary_tags?: string[];
  description?: string;
}): Promise<StandardFood> => {
  const base = (dish.standard_food_name || dish.original || dish.name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  const countryPrefix = (dish.country || 'XX').slice(0, 2).toUpperCase();
  let id = `${countryPrefix}_${base || 'FOOD'}`;
  if (await db.get('SELECT 1 FROM standard_foods WHERE standard_food_id = ?', [id])) {
    id = `${id}_${newId('v').slice(-4)}`;
  }

  return upsertStandardFood({
    standard_food_id: id,
    standard_name_en: dish.standard_food_name || dish.name,
    name_ko: dish.name,
    local_names: [dish.original].filter(Boolean),
    aliases: [dish.name, dish.original, dish.standard_food_name].filter((x): x is string => !!x),
    country: dish.country ?? null,
    category: null,
    typical_description: dish.description ?? null,
    typical_ingredients: dish.typical_ingredients ?? [],
    typical_allergens: dish.typical_allergens ?? [],
    dietary_tags: dish.dietary_tags ?? [],
  });
};
