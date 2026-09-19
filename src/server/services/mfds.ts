import { db, isStale, newId, nowIso } from '../db';
import { env, flags } from '../env';

/**
 * 계획서 6.2 / 6.3 / 6.5 — 식품의약품안전처 공공데이터 연동.
 *   1) 식품영양성분DB정보   : 칼로리·영양성분 기준값
 *   2) 트레QR 정보 서비스   : 원재료·알레르기·조리법 (공식 표시 정보)
 *   3) 제품 LOT 원재료 정보 : 포장 제품 단위 원재료
 *
 * 공공데이터포털 API 는 활용신청 건별로 엔드포인트가 달라질 수 있으므로
 * URL 은 .env 로 덮어쓸 수 있게 했고, 응답 파싱은 필드명이 바뀌어도
 * 동작하도록 후보 키를 순회하는 방식으로 방어적으로 구현했다.
 */

const pick = (obj: any, keys: string[]): any => {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return null;
};

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------ 캐시 ------------------------------ */

const readCache = async <T>(key: string, ttlDays: number): Promise<T | null> => {
  const row: any = await db.get('SELECT payload, fetched_at FROM public_data_cache WHERE cache_key = ?', [key]);
  if (!row || isStale(row.fetched_at, ttlDays)) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
};

const writeCache = async (key: string, sourceName: string, payload: unknown): Promise<void> => {
  await db.run(
    `INSERT INTO public_data_cache (cache_key, source_name, payload, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    [key, sourceName, JSON.stringify(payload), nowIso()]
  );
};

/**
 * 공공데이터는 응답이 느리거나 아예 안 오는 일이 잦다.
 * 메뉴 분석은 이 결과가 없어도 진행할 수 있으므로, 오래 기다리지 않고 포기한다.
 * (서버 전역 타임아웃이 10분이라 이걸 두지 않으면 분석이 통째로 멈춘다.)
 */
const LOOKUP_TIMEOUT_MS = 4000;

const fetchJson = async (url: string): Promise<any> => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`공공데이터 API ${response.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    // 일부 엔드포인트는 오류 시 XML 을 반환한다.
    throw new Error(`공공데이터 API 응답을 해석할 수 없습니다: ${text.slice(0, 200)}`);
  }
};

/** 공공데이터포털 응답에서 item 배열을 꺼낸다. (스키마가 서비스마다 조금씩 다름) */
const extractItems = (data: any): any[] => {
  const candidates = [
    data?.body?.items,
    data?.response?.body?.items,
    data?.response?.body?.items?.item,
    data?.body?.items?.item,
    data?.items,
    data?.I2790?.row, // 구버전 식품영양성분 API
    data?.C002?.row,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === 'object') return [c];
  }
  return [];
};

/* -------------------- 1) 식품영양성분 DB 정보 -------------------- */

export interface MfdsNutrition {
  source: 'MFDS_FOOD_NUTRITION';
  food_name: string;
  food_code: string | null;
  /** 영양성분 값의 기준량 (보통 100g) */
  reference_amount: string | null;
  reference_amount_g: number | null;
  /** 실제 1회 제공 중량 (Z10500, 예: 비빔밥 450g). 칼로리 환산에 사용한다. */
  serving_weight_g: number | null;
  /** 음식 / 가공식품 등 분류 */
  food_group: string | null;
  category: string | null;
  energy_kcal: number | null;
  carbohydrate_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  sodium_mg: number | null;
  maker: string | null;
  source_date: string | null;
}

/**
 * 실제 응답 필드 기준 매핑 (2026-08 확인).
 *   SERVING_SIZE = 영양성분 기준량("100g"), Z10500 = 1회 제공 중량("450.000g")
 *   AMT_NUM1 에너지(kcal) / 3 단백질 / 4 지방 / 6 탄수화물 / 13 나트륨(mg)
 * 서비스 버전이 바뀌어도 동작하도록 이전 필드명도 후보로 남겨둔다.
 */
const mapNutritionItem = (item: any): MfdsNutrition => {
  const refRaw = pick(item, ['SERVING_SIZE', 'NUT_CONT_SRTR_QUA', 'FOOD_SIZE', 'SERVING_WT']);
  return {
    source: 'MFDS_FOOD_NUTRITION',
    food_name: String(pick(item, ['FOOD_NM_KR', 'DESC_KOR', 'FOOD_NAME', 'PRDLST_NM']) ?? ''),
    food_code: pick(item, ['FOOD_CD', 'FOOD_CODE', 'NUM']),
    reference_amount: refRaw ? String(refRaw) : null,
    reference_amount_g: num(refRaw),
    serving_weight_g: num(pick(item, ['Z10500', 'SERVING_WT', 'FOOD_SIZE'])),
    food_group: pick(item, ['DB_GRP_NM']),
    category: pick(item, ['FOOD_CAT1_NM', 'FOOD_REF_NM']),
    energy_kcal: num(pick(item, ['AMT_NUM1', 'NUTR_CONT1', 'ENERC', 'ENERGY'])),
    protein_g: num(pick(item, ['AMT_NUM3', 'NUTR_CONT3', 'PROT', 'PROTEIN'])),
    fat_g: num(pick(item, ['AMT_NUM4', 'NUTR_CONT4', 'FATCE', 'FAT'])),
    carbohydrate_g: num(pick(item, ['AMT_NUM6', 'NUTR_CONT2', 'CHOCDF', 'CARBOHYDRATE'])),
    sodium_mg: num(pick(item, ['AMT_NUM13', 'NUTR_CONT6', 'NA', 'SODIUM'])),
    maker: pick(item, ['MAKER_NM', 'BSSH_NM', 'MFR_NM', 'SUB_REF_NAME']),
    source_date: pick(item, ['UPDATE_DATE', 'RESEARCH_YMD', 'CRT_YMD', 'DATA_STD_DT']),
  };
};

/**
 * "팟타이" 로 검색하면 "팟타이 소스" 같은 조미료도 함께 나온다.
 * 이런 항목은 요리 자체가 아니라 칼로리 범위를 왜곡하므로 제외한다.
 */
const CONDIMENT_HINTS = ['소스', '양념', '드레싱', '시즈닝', '페이스트', '분말', '스프', '육수', '조미'];

/** 공백·괄호를 무시하고 이름이 같은지 비교한다. */
const sameName = (a: string, b: string): boolean =>
  a.replace(/[\s()[\]_]/g, '').toLowerCase() === b.replace(/[\s()[\]_]/g, '').toLowerCase();

const isCondiment = (x: MfdsNutrition, query: string): boolean => {
  const name = x.food_name.replace(/\s/g, '');
  const q = query.trim().replace(/\s/g, '');
  if (name === q) return false; // 이름이 정확히 같으면 요리 자체로 본다
  return (
    CONDIMENT_HINTS.some((hint) => name.includes(hint)) ||
    (x.category ?? '').includes('조미')
  );
};

/**
 * 부분 일치로 수백 건이 나오므로, 실제로 쓸 만한 결과를 앞으로 끌어올린다.
 *  - 검색어와 이름이 정확히 같은 것
 *  - 가공식품보다 '음식' 분류 (식당 메뉴에 해당)
 *  - 열량 값이 있는 것
 */
const rankNutrition = (items: MfdsNutrition[], query: string): MfdsNutrition[] => {
  const q = query.trim().toLowerCase();
  const score = (x: MfdsNutrition): number => {
    let s = 0;
    const name = x.food_name.toLowerCase();
    if (name === q) s += 100;
    else if (name.startsWith(q)) s += 50;
    if (x.food_group === '음식') s += 20;
    if (x.energy_kcal != null) s += 10;
    if (hasRealServingWeight(x)) s += 5;
    // 이름이 짧을수록 수식어가 적은 대표 음식일 가능성이 높다.
    s -= Math.min(10, name.length / 5);
    return s;
  };
  return [...items].sort((a, b) => score(b) - score(a));
};

/**
 * 1회 제공 중량이 기준량(보통 100g)과 같으면 실제 제공량 정보가 없다는 뜻이므로 신뢰하지 않는다.
 */
export const hasRealServingWeight = (x: MfdsNutrition): boolean =>
  x.serving_weight_g != null &&
  x.serving_weight_g > 0 &&
  x.serving_weight_g !== x.reference_amount_g;

/** 식품명으로 영양성분을 조회한다. 키가 없으면 빈 배열. */
export const searchNutrition = async (foodName: string, limit = 5): Promise<MfdsNutrition[]> => {
  if (!flags.hasMfds || !foodName.trim()) return [];

  const cacheKey = `mfds:nutrition:${foodName.trim().toLowerCase()}`;
  const cached = await readCache<MfdsNutrition[]>(cacheKey, env.publicDataTtlDays);
  if (cached) return cached;

  // 부분 일치 결과가 많으므로 넉넉히 받아 정렬한 뒤 상위만 사용한다.
  const fetchCount = Math.max(limit * 6, 30);
  const url =
    `${env.mfdsNutritionUrl}?serviceKey=${encodeURIComponent(env.mfdsServiceKey)}` +
    `&pageNo=1&numOfRows=${fetchCount}&type=json&FOOD_NM_KR=${encodeURIComponent(foodName.trim())}`;

  try {
    const data = await fetchJson(url);
    const all = extractItems(data)
      .map(mapNutritionItem)
      .filter((x) => x.food_name && x.energy_kcal != null && !isCondiment(x, foodName));

    // 부분 일치는 "똠얌꿍맛 새우칩"(538kcal) 처럼 전혀 다른 제품을 물어온다.
    // 이름이 정확히 같은 것만 쓰고, 없으면 아무것도 반환하지 않는다.
    // (틀린 공공데이터를 쓰느니 일반 레시피 참고값으로 남기는 편이 안전하다.)
    const exact = all.filter((x) => sameName(x.food_name, foodName));
    const items = rankNutrition(exact, foodName).slice(0, limit);
    if (items.length === 0) {
      console.log(`[mfds] '${foodName}' 은 식약처 DB 에 정확히 일치하는 항목이 없어 사용하지 않습니다.`);
    }
    await writeCache(cacheKey, 'MFDS_FOOD_NUTRITION', items);
    return items;
  } catch (e) {
    console.warn('[mfds] 영양성분 조회 실패:', (e as Error).message);
    return [];
  }
};

/* ---------------------- 2) 트레QR 정보 서비스 ---------------------- */

export interface MfdsTraceQr {
  source: 'MFDS_TRACE_QR';
  product_name: string;
  maker: string | null;
  raw_materials: string[];
  allergens: string[];
  cooking_method: string | null;
  caution: string | null;
}

const splitList = (v: any): string[] =>
  typeof v === 'string'
    ? v
        .split(/[,、,/·|]/)
        .map((s) => s.replace(/\([^)]*\)/g, '').trim())
        .filter((s) => s.length > 0 && s.length < 40)
    : [];

const mapTraceItem = (item: any): MfdsTraceQr => ({
  source: 'MFDS_TRACE_QR',
  product_name: String(pick(item, ['PRDLST_NM', 'PRDT_NM', 'PRODUCT_NM']) ?? ''),
  maker: pick(item, ['BSSH_NM', 'MAKER_NM', 'MANUFACTURE']),
  raw_materials: splitList(pick(item, ['RAWMTRL_NM', 'RAWMTRL', 'MTRL_NM', 'INGREDIENT'])),
  allergens: splitList(pick(item, ['ALLERGY', 'ALLERGY_MATERIAL', 'ALRG_MTRL'])),
  cooking_method: pick(item, ['COOK_MTH', 'COOKING_METHOD', 'MTHD']),
  caution: pick(item, ['CAUTION', 'ATTENTION_MATTER', 'NOTE']),
});

/** 제품/브랜드명으로 공식 원재료·알레르기 표시 정보를 조회한다. */
/**
 * 푸드QR(트레QR)은 아직 활용신청이 승인되지 않아 엔드포인트가 열려 있지 않다.
 * 부를 때마다 NO_OPENAPI_SERVICE_ERROR 만 돌아오면서 분석 시간만 잡아먹으므로,
 * 승인 전까지는 아예 부르지 않는다. 승인되면 이 값을 true 로 바꾸면 된다.
 */
const TRACE_QR_ENABLED = false;

export const searchTraceQr = async (productName: string, limit = 3): Promise<MfdsTraceQr[]> => {
  if (!TRACE_QR_ENABLED) return [];
  if (!flags.hasMfds || !productName.trim()) return [];

  const cacheKey = `mfds:traceqr:${productName.trim().toLowerCase()}`;
  const cached = await readCache<MfdsTraceQr[]>(cacheKey, env.publicDataTtlDays);
  if (cached) return cached;

  const url =
    `${env.mfdsTraceQrUrl}?serviceKey=${encodeURIComponent(env.mfdsServiceKey)}` +
    `&pageNo=1&numOfRows=${limit}&type=json&prdlstNm=${encodeURIComponent(productName.trim())}`;

  try {
    const data = await fetchJson(url);
    const items = extractItems(data).slice(0, limit).map(mapTraceItem).filter((x) => x.product_name);
    await writeCache(cacheKey, 'MFDS_TRACE_QR', items);
    return items;
  } catch (e) {
    console.warn('[mfds] 트레QR 조회 실패:', (e as Error).message);
    return [];
  }
};

/* ------------------- 3) 제품 LOT 원재료 정보 조회 ------------------- */

export interface MfdsLotMaterial {
  source: 'MFDS_LOT_RAWMTRL';
  product_name: string;
  raw_materials: string[];
  lot_no: string | null;
}

export const searchLotMaterials = async (productName: string, limit = 3): Promise<MfdsLotMaterial[]> => {
  if (!flags.hasMfds || !productName.trim()) return [];

  const cacheKey = `mfds:lot:${productName.trim().toLowerCase()}`;
  const cached = await readCache<MfdsLotMaterial[]>(cacheKey, env.publicDataTtlDays);
  if (cached) return cached;

  const url =
    `${env.mfdsLotUrl}?serviceKey=${encodeURIComponent(env.mfdsServiceKey)}` +
    `&pageNo=1&numOfRows=${limit}&type=json&prdlstNm=${encodeURIComponent(productName.trim())}`;

  try {
    const data = await fetchJson(url);
    const items: MfdsLotMaterial[] = extractItems(data)
      .slice(0, limit)
      .map((item: any) => ({
        source: 'MFDS_LOT_RAWMTRL' as const,
        product_name: String(pick(item, ['PRDLST_NM', 'PRDT_NM']) ?? ''),
        raw_materials: splitList(pick(item, ['RAWMTRL_NM', 'RAWMTRL', 'MTRL_NM'])),
        lot_no: pick(item, ['LOT_NO', 'LOTNO']),
      }))
      .filter((x) => x.product_name);
    await writeCache(cacheKey, 'MFDS_LOT_RAWMTRL', items);
    return items;
  } catch (e) {
    console.warn('[mfds] LOT 원재료 조회 실패:', (e as Error).message);
    return [];
  }
};

/* --------------------- nutrition_references 적재 --------------------- */

/** 조회한 영양성분을 표준 음식에 연결해 저장한다. (계획서 7.1) */
export const persistNutrition = async (standardFoodId: string, records: MfdsNutrition[]): Promise<void> => {
  const sql = (
    `INSERT INTO nutrition_references (nutrition_reference_id, standard_food_id, source_name, source_item_id,
       reference_amount_g, energy_kcal, carbohydrate_g, protein_g, fat_g, sodium_mg, raw_payload, source_updated_at, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(standard_food_id, source_name, source_item_id) DO UPDATE SET
       reference_amount_g = excluded.reference_amount_g,
       energy_kcal = excluded.energy_kcal,
       carbohydrate_g = excluded.carbohydrate_g,
       protein_g = excluded.protein_g,
       fat_g = excluded.fat_g,
       sodium_mg = excluded.sodium_mg,
       raw_payload = excluded.raw_payload,
       source_updated_at = excluded.source_updated_at,
       collected_at = excluded.collected_at`
  );

  await db.batch(
    records.map((r) => ({
      sql,
      params: [
        newId('ntr'),
        standardFoodId,
        r.source,
        r.food_code || r.food_name,
        r.reference_amount_g,
        r.energy_kcal,
        r.carbohydrate_g,
        r.protein_g,
        r.fat_g,
        r.sodium_mg,
        JSON.stringify(r),
        r.source_date,
        nowIso(),
      ],
    }))
  );
};
