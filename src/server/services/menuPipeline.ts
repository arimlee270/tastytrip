import { db, daysSince, isStale, logSearch, newId, nowIso, parseJson, toJson } from '../db';
import { env } from '../env';
import type {
  AnalyzeMenuResponse,
  CalorieEstimate,
  Dish,
  Member,
  PartyFilter,
  ReferenceBundle,
} from '../../types';
import { analyzeMenu, readFoodPhoto, type PhotoReading } from './gemini';
import { buildReferenceBundle, computeCalories, validateCalories } from './nutrition';
import { createStandardFoodFromDish, registerAliases, resolveStandardFood } from './normalize';
import {
  allergenLabel,
  computeDietary,
  crossCheck,
  dietLabel,
  dietaryWarnings,
  memberWarningText,
  perMemberWarnings,
  removeClearedAllergens,
  statusFromHits,
} from './party';
import { collectUserReports, confidenceWithReports } from './userReports';
import { dishCacheKey, loadFoodAnalysis, saveFoodAnalysis } from './foodCache';

/**
 * 계획서 12.1 조회 우선순위를 구현한다.
 *   1. 식당별 검증 메뉴 DB
 *   2. 식당별 AI 분석 캐시
 *   3. 공통 음식 DB
 *   4. 공개 데이터(실시간 또는 캐시)
 *   5. Gemini 신규 분석
 */

/**
 * 사진에서 메뉴도 음식도 알아보지 못했을 때 사용자에게 보여줄 안내.
 * 억지로 분석하면 AI 가 그 나라의 그럴듯한 음식을 지어내므로 여기서 멈춘다.
 */
const PHOTO_UNREADABLE_MESSAGE =
  '사진에서 메뉴나 음식을 알아보지 못했습니다. 메뉴판 글씨나 음식이 화면에 크고 또렷하게 들어오도록 다시 찍어 주세요.';

/* ------------------------------------------------------------------ */
/* 저장된 분석 -> Dish 복원                                             */
/* ------------------------------------------------------------------ */

interface MenuRow {
  menu_id: string;
  restaurant_id: string;
  standard_food_id: string | null;
  original_name: string;
  translated_name: string | null;
  image_url: string | null;
  version: number;
  last_verified_at: string | null;
}

const loadAnalysis = async (menuId: string, lang: string): Promise<any | null> =>
  (await db.get(
    'SELECT * FROM menu_analysis WHERE menu_id = ? AND lang = ? ORDER BY generated_at DESC LIMIT 1',
    [menuId, lang]
  )) || null;

/** 저장된 분석 결과를 현재 사용자 조건으로 다시 판정해 Dish 로 만든다. */
export const analysisToDish = async (menu: MenuRow, analysis: any, filter: PartyFilter): Promise<Dish> => {
  const payload = parseJson<any>(analysis.payload, {});
  const ingredients = parseJson<string[]>(analysis.ingredients, []);
  const allergenTags = parseJson<string[]>(analysis.allergen_tags, []);
  // 표시용 재료는 표시 언어로만 저장되므로, 판정에는 영문 원어를 포함한 매칭용 목록을 쓴다.
  const matchIngredients: string[] = Array.isArray(payload.match_ingredients)
    ? payload.match_ingredients
    : ingredients;
  const matchAllergens: string[] = Array.isArray(payload.match_allergens)
    ? payload.match_allergens
    : allergenTags;

  // 현장에서 확인한 사용자 제보를 합친다. (계획서 8장 — 사용자 정보로 갱신)
  const reports = await collectUserReports(menu.menu_id);
  // '없다'고 확인된 항목은 알레르기 목록뿐 아니라 재료 목록에서도 빼야 판정이 바뀐다.
  // (재료에 'peanut' 이 남아 있으면 계속 걸리기 때문)
  const verifiedAllergens = removeClearedAllergens(
    [...new Set([...matchAllergens, ...reports.confirmedAllergens])],
    reports.clearedAllergens
  );
  const verifiedIngredients = removeClearedAllergens(matchIngredients, reports.clearedAllergens);

  // 사용자별 조건은 저장하지 않고 조회 시점에 재계산한다. (프로필이 바뀌어도 정확히 반영)
  const hits = crossCheck([...verifiedIngredients, ...verifiedAllergens], filter);
  const dietary = mergeDietary(computeDietary(verifiedIngredients), payload.dietary);
  const dietNotes = dietaryWarnings(filter, dietary);
  // 사용자가 선택한 식단 조건이 '불확실'이면 확인이 필요하므로 최소 노랑으로 올린다.
  const status =
    dietNotes.length > 0 && statusFromHits(hits, payload.status) === 'green'
      ? 'yellow'
      : statusFromHits(hits, payload.status);

  // 동반인이 있으면 누가 못 먹는지 이름으로 알려준다. (계획서 3.3)
  const memberWarnings = perMemberWarnings([...verifiedIngredients, ...verifiedAllergens], filter);

  const warningParts: string[] = [];
  if (memberWarnings.length > 0) warningParts.push(memberWarningText(memberWarnings));
  else {
    if (hits.allergenHits.length > 0)
      warningParts.push(`알레르기 주의 성분: ${hits.allergenHits.map(allergenLabel).join(', ')}`);
    if (hits.dietHits.length > 0)
      warningParts.push(`식단 제한 충돌: ${hits.dietHits.map(dietLabel).join(', ')}`);
    if (hits.avoidHits.length > 0) warningParts.push(`기피 재료 포함 가능: ${hits.avoidHits.join(', ')}`);
  }
  dietNotes.forEach((n) => warningParts.push(n));
  if (reports.confirmedAllergens.length > 0) {
    warningParts.push(`방문자 확인: ${reports.confirmedAllergens.map(allergenLabel).join(', ')} 포함`);
  }

  return {
    name: menu.translated_name || payload.name || menu.original_name,
    original: menu.original_name,
    imageUrl: menu.image_url || payload.imageUrl || '',
    primary_query: payload.primary_query || '',
    secondary_query: payload.secondary_query || '',
    fallback_query: payload.fallback_query || '',
    desc: analysis.description || payload.desc || '',
    taste: analysis.taste_description || payload.taste || '',
    status,
    badge: payload.badge || '',
    // 경고는 반드시 '지금 조회하는 사용자'의 조건으로만 만든다.
    // 저장된 payload.warning 을 폴백으로 쓰면 이전 사용자(예: 할랄 선택자)의
    // 경고가 조건이 다른 다음 사용자에게 그대로 노출된다.
    warning: warningParts.join(' / '),
    pair: payload.pair || '',
    order: payload.order || '',
    phrase: payload.phrase || '',
    etiquette: payload.etiquette || '',
    reviews: Array.isArray(payload.reviews) ? payload.reviews : [],

    menu_id: menu.menu_id,
    restaurant_id: menu.restaurant_id,
    standard_food_id: menu.standard_food_id ?? undefined,
    standard_food_name: payload.standard_food_name,
    typical_ingredients: ingredients,
    allergen_risk: payload.allergen_risk
      ? {
          ...payload.allergen_risk,
          items: removeClearedAllergens(
            [...new Set([...(payload.allergen_risk.items ?? []), ...reports.confirmedAllergens])],
            reports.clearedAllergens
          ),
          level: reports.confirmedAllergens.length > 0 ? 'high' : payload.allergen_risk.level,
        }
      : payload.allergen_risk,
    // 판정 규칙이 개선되면 저장된 메뉴에도 바로 반영되도록 조회 시점에 다시 계산한다.
    dietary,
    estimated_calories:
      analysis.calorie_min != null && analysis.calorie_max != null
        ? {
            min: analysis.calorie_min,
            max: analysis.calorie_max,
            unit: 'kcal',
            basis: analysis.calorie_basis || '',
            confidence: analysis.confidence_score ?? 0.5,
          }
        : payload.estimated_calories,
    // 현장 확인 정보가 있으면 출처와 신뢰도가 올라간다. (계획서 9.4)
    source_type: reports.confirmedAllergens.length > 0 ? 'user_reported' : analysis.source_type,
    source_summary: [
      ...parseJson<string[]>(analysis.source_summary, []),
      ...(reports.reportCount > 0 ? [`방문자 제보 ${reports.reportCount}건`] : []),
    ],
    confidence_score: confidenceWithReports(analysis.confidence_score ?? 0.5, reports),
    user_notes: reports.notes,
    last_verified_at: menu.last_verified_at,
    verification_message: payload.verification_message,
    member_warnings: memberWarnings,
    from_cache: true,
  };
};

/* ------------------------------------------------------------------ */
/* 재분석 필요 여부 (계획서 12.2)                                        */
/* ------------------------------------------------------------------ */

export const needsReanalysis = async (menuId: string, lang: string): Promise<boolean> => {
  const analysis = await loadAnalysis(menuId, lang);
  if (!analysis) return true;
  if (isStale(analysis.generated_at, env.menuStaleDays)) return true;
  if ((analysis.confidence_score ?? 0) < env.minConfidence) return true;
  if (!analysis.description || analysis.calorie_min == null) return true;

  const pendingReports = (await db.get(
    "SELECT COUNT(*) AS n FROM reports WHERE menu_id = ? AND status = 'pending'",
    [menuId]
  )) as any;
  if ((pendingReports?.n ?? 0) >= 3) return true;

  return false;
};

/* ------------------------------------------------------------------ */
/* 저장                                                                */
/* ------------------------------------------------------------------ */

const upsertMenu = async (
  restaurantId: string,
  dish: Dish,
  standardFoodId: string | null
): Promise<MenuRow> => {
  const existing: any = await db.get(
    `SELECT * FROM restaurant_menus WHERE restaurant_id = ? AND original_name = ? AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [restaurantId, dish.original]
  );

  if (existing) {
    await db.run(
      `UPDATE restaurant_menus SET translated_name = ?, standard_food_id = COALESCE(?, standard_food_id),
         image_url = COALESCE(?, image_url), last_verified_at = ?
       WHERE menu_id = ?`,
      [dish.name, standardFoodId, dish.imageUrl || null, nowIso(), existing.menu_id]
    );
    return (await db.get('SELECT * FROM restaurant_menus WHERE menu_id = ?', [existing.menu_id])) as MenuRow;
  }

  const menuId = newId('men');
  await db.run(
    `INSERT INTO restaurant_menus (menu_id, restaurant_id, standard_food_id, original_name, translated_name,
       price, currency, image_url, version, status, last_verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 1, 'active', ?, ?)`,
    [menuId, restaurantId, standardFoodId, dish.original, dish.name, dish.imageUrl || null, nowIso(), nowIso()]
  );

  return (await db.get('SELECT * FROM restaurant_menus WHERE menu_id = ?', [menuId])) as MenuRow;
};

const saveAnalysis = async (menuId: string, lang: string, dish: Dish): Promise<void> => {
  await db.run(
    `INSERT INTO menu_analysis (analysis_id, menu_id, lang, description, taste_description, ingredients,
       allergen_tags, dietary_tags, avoid_risk_tags, calorie_min, calorie_max, calorie_basis,
       source_type, source_summary, confidence_score, payload, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
    newId('anl'),
    menuId,
    lang,
    dish.desc,
    dish.taste,
    toJson(dish.typical_ingredients ?? []),
    toJson(dish.allergen_risk?.items ?? []),
    toJson(
      [
        dish.dietary?.vegan === 'suitable' ? 'vegan' : null,
        dish.dietary?.halal === 'suitable' ? 'halal' : null,
      ].filter(Boolean)
    ),
    toJson([]),
    dish.estimated_calories?.min ?? null,
    dish.estimated_calories?.max ?? null,
    dish.estimated_calories?.basis ?? null,
    dish.source_type ?? 'ai_estimate',
    toJson(dish.source_summary ?? []),
    dish.confidence_score ?? dish.estimated_calories?.confidence ?? 0.5,
    JSON.stringify(dish),
    nowIso(),
    ]
  );

  // 오래된 분석은 최신 3건만 남긴다.
  await db.run(
    `DELETE FROM menu_analysis WHERE menu_id = ? AND lang = ? AND analysis_id NOT IN (
       SELECT analysis_id FROM menu_analysis WHERE menu_id = ? AND lang = ? ORDER BY generated_at DESC LIMIT 3
     )`,
    [menuId, lang, menuId, lang]
  );
};

const saveEvidence = async (menuId: string, bundle: ReferenceBundle, sourceType: string): Promise<void> => {
  const sql = `INSERT INTO source_evidence (evidence_id, menu_id, source_type, source_name, source_record_id, extracted_value, confidence, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  await db.batch([
    ...bundle.nutrition_records.map((r) => ({
      sql,
      params: [newId('evd'), menuId, sourceType, r.source, null, `${r.energy_kcal ?? '-'} kcal / ${r.basis}`, 0.8, nowIso()],
    })),
    ...(bundle.official_notes ?? []).map((note) => ({
      sql,
      params: [newId('evd'), menuId, 'official', 'MFDS_TRACE_QR', null, note, 0.95, nowIso()],
    })),
  ]);
};

/* ------------------------------------------------------------------ */
/* 후처리: 근거 결합 + 교차 검증 (계획서 8.4)                            */
/* ------------------------------------------------------------------ */

const DISCLAIMER =
  '실제 재료와 조리 과정은 식당마다 다를 수 있으므로 심각한 알레르기가 있는 경우 반드시 직원에게 확인하세요.';

/** AI 가 스스로 덧붙인 출처 문구 대신, 서버가 실제로 조회한 근거만 표시할 때 쓰는 라벨. */
const AI_SOURCE_LABEL = 'AI 추론';

type DietFit = 'suitable' | 'not_suitable' | 'uncertain';

/**
 * 재료 기반 판정과 AI 판정을 합친다.
 * 안전 방향(가능 -> 불확실 -> 불가)으로만 움직이고, 반대로 완화하지는 않는다.
 */
const mergeDietary = (
  computed: { vegan: DietFit; halal: DietFit },
  ai?: { vegan?: DietFit; halal?: DietFit }
): { vegan: DietFit; halal: DietFit } => {
  const rank: Record<DietFit, number> = { suitable: 0, uncertain: 1, not_suitable: 2 };
  const stricter = (a: DietFit, b?: DietFit): DietFit =>
    b && rank[b] > rank[a] ? b : a;

  return {
    vegan: stricter(computed.vegan, ai?.vegan),
    halal: stricter(computed.halal, ai?.halal),
  };
};

export const enrichDish = async (
  raw: any,
  filter: PartyFilter,
  travelCountry?: string
): Promise<Dish> => {
  const { bundle, standardFood } = await buildReferenceBundle({
    original: raw.original,
    translated: raw.name,
    standardEn: raw.standard_food_name,
    country: travelCountry,
  });

  // 재료는 두 벌로 나눠서 쓴다.
  //  - matchIngredients: 공개 데이터(영문) + AI 결과를 합친 것. 알레르기/식단 교차 검증용.
  //  - displayIngredients: 사용자 표시용. AI 가 표시 언어로 써준 목록을 우선해 언어가 섞이지 않게 한다.
  const aiIngredients = ((raw.typical_ingredients as string[]) ?? []).filter(Boolean);
  const matchIngredients = [...new Set([...(bundle.typical_ingredients ?? []), ...aiIngredients])];
  const displayIngredients = aiIngredients.length > 0 ? aiIngredients : (bundle.typical_ingredients ?? []);

  // 알레르기도 재료와 같은 방식으로 표시용/매칭용을 나눈다. (계획서 6.3 우선순위)
  const aiAllergens = ((raw.allergen_risk?.items as string[]) ?? []).filter(Boolean);
  const matchAllergens = [...new Set([...(bundle.allergen_candidates ?? []), ...aiAllergens])];
  const displayAllergens = aiAllergens.length > 0 ? aiAllergens : (bundle.allergen_candidates ?? []);

  const hits = crossCheck([...matchIngredients, ...matchAllergens], filter);
  const dietary = mergeDietary(computeDietary(matchIngredients), raw.dietary);
  const dietNotes = dietaryWarnings(filter, dietary);
  // 사용자가 선택한 식단 조건이 '불확실'이면 확인이 필요하므로 최소 노랑으로 올린다.
  const baseStatus = statusFromHits(hits, raw.status);
  const status = dietNotes.length > 0 && baseStatus === 'green' ? 'yellow' : baseStatus;

  const calorie = computeCalories(bundle, raw.estimated_calories as Partial<CalorieEstimate>);
  const validation = validateCalories(calorie.estimate);

  // 동반인이 있으면 누가 못 먹는지 이름으로 알려준다. (계획서 3.3)
  const memberWarnings = perMemberWarnings([...matchIngredients, ...matchAllergens], filter);

  const warningParts: string[] = [];
  if (memberWarnings.length > 0) warningParts.push(memberWarningText(memberWarnings));
  else {
    if (hits.allergenHits.length > 0)
      warningParts.push(`알레르기 주의 성분: ${hits.allergenHits.map(allergenLabel).join(', ')}`);
    if (hits.dietHits.length > 0)
      warningParts.push(`식단 제한 충돌: ${hits.dietHits.map(dietLabel).join(', ')}`);
    if (hits.avoidHits.length > 0) warningParts.push(`기피 재료 포함 가능: ${hits.avoidHits.join(', ')}`);
  }
  dietNotes.forEach((n) => warningParts.push(n));

  const officialEvidence = (bundle.official_notes ?? []).length > 0;

  return {
    ...raw,
    status,
    warning: warningParts.length > 0 ? `${warningParts.join(' / ')}${raw.warning ? ` · ${raw.warning}` : ''}` : raw.warning,
    standard_food_id: standardFood?.standard_food_id,
    typical_ingredients: displayIngredients,
    /** 사용자 조건 재판정에 쓰는 매칭용 목록(표시하지 않음) */
    match_ingredients: matchIngredients,
    match_allergens: matchAllergens,
    allergen_risk: {
      level: hits.allergenHits.length > 0 ? 'high' : displayAllergens.length > 0 ? 'medium' : 'low',
      items: displayAllergens,
      message: raw.allergen_risk?.message || DISCLAIMER,
    },
    // 비건·할랄은 AI 응답을 그대로 쓰지 않고 재료로 다시 판정한다.
    // AI 가 '불가'라고 본 것을 '가능'으로 뒤집지는 않는다(안전 방향으로만 보수적으로).
    dietary,
    estimated_calories: validation.valid ? calorie.estimate : undefined,
    source_type: officialEvidence ? 'official_nutrition' : calorie.sourceType,
    // 출처는 서버가 실제로 조회한 근거만 표시한다.
    // AI 가 "○○ 데이터베이스" 처럼 스스로 써넣는 출처는 검증할 수 없으므로 사용하지 않고,
    // AI 가 관여했다는 사실만 남긴다.
    source_summary: [...new Set([...(calorie.sourceSummary ?? []), AI_SOURCE_LABEL])],
    confidence_score: officialEvidence
      ? Math.min(0.95, calorie.estimate.confidence + 0.1)
      : calorie.estimate.confidence,
    verification_message: raw.verification_message || DISCLAIMER,
    member_warnings: memberWarnings,
    from_cache: false,
    __bundle: bundle,
  } as Dish & { __bundle: ReferenceBundle };
};

/* ------------------------------------------------------------------ */
/* 1) 자유 분석 (카메라 / 텍스트) — 기존 기능                            */
/* ------------------------------------------------------------------ */

export interface RunAnalysisInput {
  image?: string | null;
  menuText?: string | null;
  homeCountry?: string;
  travelCountry?: string;
  party: Member[];
  filter: PartyFilter;
  targetLanguage: string;
  userId?: string;
  restaurantId?: string;
}

/**
 * 캐시에 저장해 둔 음식 분석을 현재 사용자 조건으로 다시 판정해 Dish 로 만든다.
 * 설명·재료 같은 사실 정보는 그대로 쓰고, 안전 판정만 새로 계산한다.
 */
/**
 * 저장해 둔 분석에 '지금 이 사용자'의 조건을 다시 적용한다.
 *
 * 안전/주의 판정과 경고 문구는 절대 저장된 것을 그대로 쓰지 않는다.
 * 프로필을 바꿨는데 예전 조건으로 만든 경고가 그대로 보이면,
 * 할랄을 해제한 사람에게 할랄 경고가 남는 식의 잘못된 안내가 된다.
 * 재료 목록만 저장해 두고 판정은 꺼내 볼 때마다 새로 한다.
 */
export const reevaluateDish = (cached: Partial<Dish>, filter: PartyFilter): Dish => {
  const matchIngredients = cached.match_ingredients ?? cached.typical_ingredients ?? [];
  const matchAllergens = cached.match_allergens ?? cached.allergen_risk?.items ?? [];

  const hits = crossCheck([...matchIngredients, ...matchAllergens], filter);
  const dietary = mergeDietary(computeDietary(matchIngredients), cached.dietary);
  const dietNotes = dietaryWarnings(filter, dietary);
  const baseStatus = statusFromHits(hits);
  const status = dietNotes.length > 0 && baseStatus === 'green' ? 'yellow' : baseStatus;
  const memberWarnings = perMemberWarnings([...matchIngredients, ...matchAllergens], filter);

  const warningParts: string[] = [];
  if (memberWarnings.length > 0) warningParts.push(memberWarningText(memberWarnings));
  else {
    if (hits.allergenHits.length > 0)
      warningParts.push(`알레르기 주의 성분: ${hits.allergenHits.map(allergenLabel).join(', ')}`);
    if (hits.dietHits.length > 0)
      warningParts.push(`식단 제한 충돌: ${hits.dietHits.map(dietLabel).join(', ')}`);
    if (hits.avoidHits.length > 0) warningParts.push(`기피 재료 포함 가능: ${hits.avoidHits.join(', ')}`);
  }
  dietNotes.forEach((n) => warningParts.push(n));

  return {
    ...(cached as Dish),
    status,
    warning: warningParts.join(' / '),
    dietary,
    member_warnings: memberWarnings,
    reviews: cached.reviews ?? [],
    from_cache: true,
  };
};

const cachedDishFor = async (
  standardFoodId: string,
  dishKey: string,
  lang: string,
  filter: PartyFilter
): Promise<Dish | null> => {
  const cached = await loadFoodAnalysis(standardFoodId, dishKey, lang);
  if (!cached) return null;
  return { ...reevaluateDish(cached, filter), standard_food_id: standardFoodId };
};

export const runFreeAnalysis = async (input: RunAnalysisInput): Promise<AnalyzeMenuResponse> => {
  const lang = input.targetLanguage || 'ko';

  // ── 1) 텍스트로 검색한 경우: 이미 분석해 둔 음식은 AI 를 부르지 않는다. (계획서 12.1)
  const typedNames =
    input.menuText && input.menuText.trim()
      ? input.menuText
          .split(/[,、,\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];

  const cachedDishes: Dish[] = [];
  const unknownNames: string[] = [];

  /*
   * 사진으로 들어온 경우에도 저장된 분석을 쓸 수 있게 한다.
   *
   * 사진은 열어보기 전까지 무엇이 적혀 있는지 알 수 없으므로, 먼저 이름만
   * 읽어 온다(재료·칼로리를 묻지 않아 응답이 짧고 빠르다). 그렇게 얻은 이름으로
   * 캐시를 뒤지면, 이미 분석해 둔 메뉴는 무거운 분석을 다시 돌리지 않아도 된다.
   * 전부 저장돼 있으면 두 번째 호출은 아예 생략된다.
   */
  /*
   * 사진이 들어왔으면 답은 오직 그 사진 안에 있다.
   *
   * 예전에는 사진 읽기에 실패하면 사용자가 앞서 입력해 둔 검색어로 되돌아갔다.
   * 그래서 일본 메뉴판을 찍었는데 예전에 검색했던 '팟타이'가 결과로 나왔다.
   * 메뉴판에 없는 음식을 보여주는 것은 알레르기 앱에서 그냥 틀린 정보다.
   * 읽기에 실패하면 빈 목록으로 두고, 아래에서 사진 전체를 분석하게 한다.
   */
  let namesToCheck: string[] = [];
  if (input.image) {
    let reading: PhotoReading = { kind: 'none', names: [] };
    try {
      reading = await readFoodPhoto(input.image);
    } catch (e) {
      console.warn('[analyze] 사진 확인 실패:', (e as Error).message);
    }

    /*
     * 메뉴판도 음식도 알아보지 못하면 여기서 멈춘다.
     * 억지로 분석을 돌리면 AI 가 그 나라의 그럴듯한 음식을 지어내 채운다.
     * 사용자에게는 다시 찍어 달라고 하는 편이 정직하고 안전하다.
     */
    if (reading.names.length === 0) {
      throw new Error(PHOTO_UNREADABLE_MESSAGE);
    }

    namesToCheck = reading.names;
    const what = reading.kind === 'menu' ? '메뉴판' : '음식 사진';
    console.log(`[analyze] ${what}에서 ${namesToCheck.length}개 확인: ${namesToCheck.slice(0, 5).join(', ')}`);
  } else {
    namesToCheck = typedNames;
  }

  if (namesToCheck.length > 0) {
    /*
     * 원칙: 메뉴판에 적힌 한 줄이 카드 하나다.
     *
     * 서로 다른 메뉴가 같은 표준 음식으로 묶이는 일이 흔하다.
     * '刺身盛り合わせ'(모둠회)와 'かんぱち刺'(잿방어 회)는 둘 다 사시미로 묶이지만
     * 손님에게는 다른 메뉴다. 표준 음식이 같다고 하나를 지우면 메뉴가 사라진다.
     *
     * 그래서 같은 표준 음식이 또 나오면 지우는 대신 AI 에게 따로 분석시킨다.
     * 저장된 분석은 먼저 온 메뉴가 쓰고, 뒤에 온 메뉴는 자기 내용을 받는다.
     */
    const seenNames = new Set<string>();
    const uniqueNames: string[] = [];
    for (const name of namesToCheck) {
      // 같은 줄을 두 번 읽은 경우만 건너뛴다.
      const key = name.trim().toLowerCase();
      if (!key || seenNames.has(key)) continue;
      seenNames.add(key);
      uniqueNames.push(name);
    }

    /*
     * 메뉴마다 순서대로 조회하면 메뉴 12개일 때 원격 DB 왕복이 24번 줄줄이 이어진다.
     * 서로 기다릴 이유가 없으므로 한꺼번에 물어보고 함께 받는다.
     * 결과를 담는 순서는 메뉴판에 적힌 순서를 그대로 지킨다.
     */
    const looked = await Promise.all(
      uniqueNames.map(async (name) => {
        const food = await resolveStandardFood([name]);
        // 저장 칸이 메뉴 이름까지 열쇠로 쓰므로, 같은 분류의 다른 메뉴와 섞이지 않는다.
        const dish = food
          ? await cachedDishFor(food.standard_food_id, dishCacheKey(name), lang, input.filter)
          : null;
        return { name, dish };
      })
    );

    for (const { name, dish } of looked) {
      if (dish) cachedDishes.push(dish);
      else unknownNames.push(name);
    }

    if (cachedDishes.length > 0) {
      console.log(`[analyze] 저장된 분석 ${cachedDishes.length}개 사용, 새로 분석할 메뉴 ${unknownNames.length}개`);
    }

    // 전부 캐시에 있으면 Gemini 를 아예 호출하지 않는다.
    if (unknownNames.length === 0 && cachedDishes.length > 0) {
      logSearch({
        user_id: input.userId ?? null,
        restaurant_id: input.restaurantId ?? null,
        query_text: input.menuText ?? null,
        result_source: 'db',
        gemini_called: false,
      });
      return { dishes: cachedDishes, meta: { gemini_called: false, result_source: 'db' } };
    }
  }

  /*
   * ── 2) 모르는 메뉴만 AI 에 묻는다.
   *
   * 사진이 있을 때는 예전에 입력해 둔 검색어를 절대 섞지 않는다.
   * 섞으면 메뉴판에 없는 음식이 결과에 끼어든다.
   */
  const askNames = unknownNames.length > 0 ? unknownNames.join(', ') : input.image ? undefined : input.menuText;

  // 공개 데이터 근거를 프롬프트에 넣는다. (계획서 8.1)
  /*
   * 근거 자료를 메뉴마다 하나씩 순서대로 모으면, 메뉴가 8개일 때 외부 조회가
   * 8번 줄줄이 이어져 그만큼 시간이 곱해진다. 서로 기다릴 이유가 없으므로
   * 한꺼번에 보내고 함께 받는다.
   */
  const referenceData: Record<string, ReferenceBundle> = {};
  const bundles = await Promise.all(
    unknownNames.map(async (name) => {
      const { bundle } = await buildReferenceBundle({
        original: name,
        translated: name,
        country: input.travelCountry,
      });
      return { name, bundle };
    })
  );
  for (const { name, bundle } of bundles) {
    if (bundle.typical_ingredients.length > 0 || bundle.nutrition_records.length > 0) {
      referenceData[name] = bundle;
    }
  }

  /*
   * 사진은 분석 단계에 넘기지 않는다.
   *
   * 앞서 읽어 둔 이름만으로 분석한다. 사진을 통째로 넘기면 AI 가 흐리거나
   * 비어 있는 부분을 그 나라의 그럴듯한 음식으로 채워 넣는다. 실제로 글자가
   * 하나도 없는 사진에 '여행 국가: 일본' 을 주자 돈카츠·타코야키 같은 메뉴를
   * 지어냈다. 메뉴판에 없는 음식을 보여주면 손님이 그걸 시킬 수 있다.
   *
   * 읽기 단계에서 나온 이름만 넘기면 지어낼 재료 자체가 없어진다.
   * 대신 읽기가 놓친 메뉴는 결과에서도 빠지는데, 없는 메뉴를 보여주는 것보다
   * 낫다고 판단했다.
   */
  const needsImage = false;

  /*
   * 메뉴를 한 번에 다 묻지 않고 나눠서 동시에 묻는다.
   *
   * 한 번의 호출로 메뉴 12개를 분석하니 80초가 걸렸다. 메뉴마다 설명·맛·곁들임·
   * 주문법·예절을 다 받아 적어야 하므로, 메뉴가 늘면 받아쓸 글자 수가 그만큼
   * 늘고 시간도 같이 늘어난다. 6개씩 둘로 나눠 동시에 물으면 53초가 됐다.
   *
   * 더 잘게 쪼개면 더 빠르지만, 동시 호출이 많아지면 구글이 과부하(503)로
   * 되돌려보낸다. 실제로 4개씩 세 갈래로 나눴을 때 재시도를 다 쓰고 실패했다.
   * 그래서 한 번에 두 갈래까지만 보낸다.
   */
  const CHUNK_SIZE = 6;
  const MAX_PARALLEL = 2;

  const askChunks: string[][] = [];
  if (unknownNames.length > 0) {
    for (let i = 0; i < unknownNames.length; i += CHUNK_SIZE) {
      askChunks.push(unknownNames.slice(i, i + CHUNK_SIZE));
    }
  }

  const askOnce = (menuText: string | undefined, names?: string[]) =>
    analyzeMenu({
      image: needsImage ? input.image : null,
      menuText,
      homeCountry: input.homeCountry,
      travelCountry: input.travelCountry,
      party: input.party,
      targetLanguage: lang,
      /* 이 묶음에 든 메뉴의 근거만 보낸다. 안 물어본 메뉴의 자료까지 넣으면
       * 프롬프트만 길어지고, 모델이 그 메뉴도 답에 끼워 넣는다. */
      referenceData: names
        ? Object.fromEntries(names.filter((n) => referenceData[n]).map((n) => [n, referenceData[n]]))
        : referenceData,
    });

  let result: { dishes: any[] };
  if (askChunks.length === 0) {
    // 사진도 없고 아는 메뉴도 없는 '현지 추천' 경로.
    result = await askOnce(askNames ?? undefined);
  } else {
    const collected: any[] = [];
    for (let i = 0; i < askChunks.length; i += MAX_PARALLEL) {
      const wave = askChunks.slice(i, i + MAX_PARALLEL);
      const parts = await Promise.all(wave.map((names) => askOnce(names.join(', '), names)));
      for (const part of parts) collected.push(...(part.dishes || []));
    }
    result = { dishes: collected };
  }

  const dishes: Dish[] = [...cachedDishes];
  /*
   * AI 가 같은 메뉴를 두 번 돌려주는 경우만 걸러낸다.
   *
   * 기준은 메뉴판에 적힌 원문 이름이다. 표준 음식으로 거르면 안 된다 —
   * 모둠회와 잿방어 회처럼 같은 분류로 묶이는 다른 메뉴가 지워지기 때문이다.
   */
  const keyOf = (d: { original?: string | null; name?: string | null }) =>
    (d.original || d.name || '').trim().toLowerCase();

  const saves: Promise<unknown>[] = [];

  const taken = new Set<string>();
  for (const d of cachedDishes) {
    const k = keyOf(d);
    if (k) taken.add(k);
  }

  // enrichDish 도 메뉴마다 외부 조회를 하므로 한꺼번에 처리한다.
  const enrichedList = await Promise.all(
    (result.dishes || []).map((raw: any) => enrichDish(raw, input.filter, input.travelCountry))
  );

  for (const enriched of enrichedList) {
    delete (enriched as any).__bundle;

    const key = keyOf(enriched);
    if (key && taken.has(key)) continue;
    if (key) taken.add(key);

    // ── 3) 다음 사용자를 위해 공통 음식 캐시에 저장한다.
    const standardFoodId =
      enriched.standard_food_id ??
      (await createStandardFoodFromDish({
        standard_food_name: enriched.standard_food_name,
        name: enriched.name,
        original: enriched.original,
        country: input.travelCountry,
        typical_ingredients: enriched.typical_ingredients,
        typical_allergens: enriched.allergen_risk?.items,
        description: enriched.desc,
      })).standard_food_id;

    enriched.standard_food_id = standardFoodId;

    /*
     * 저장은 사용자가 결과를 보는 데 필요하지 않다. 메뉴마다 순서대로 쓰면
     * 원격 DB 왕복이 메뉴 수의 두 배만큼 줄줄이 이어져, 다 끝날 때까지 응답이
     * 늦어진다. 그래서 할 일만 모아 두고 아래에서 한꺼번에 처리한다.
     */
    saves.push(
      /*
       * 다음에 같은 메뉴를 만났을 때 이 표준 음식을 다시 찾을 수 있도록 이름을 등록한다.
       * 이게 빠져 있으면 분석 결과를 저장해 두고도 이름으로 찾지 못해,
       * 매번 AI 를 다시 부르게 된다.
       */
      registerAliases(standardFoodId, [enriched.original, enriched.name, enriched.standard_food_name])
        // 저장 열쇠는 메뉴판에 적힌 이름. 같은 분류의 다른 메뉴와 칸을 나눠 쓴다.
        .then(() =>
          saveFoodAnalysis(standardFoodId, dishCacheKey(enriched.original || enriched.name), lang, enriched)
        )
    );

    dishes.push(enriched);
  }

  /*
   * 저장이 하나 실패해도 이미 만들어진 결과는 보여준다. 다만 저장이 안 됐다는
   * 사실은 남긴다 — 다음 사용자가 캐시를 못 맞히는 원인이 되기 때문이다.
   */
  const saveResults = await Promise.allSettled(saves);
  const failed = saveResults.filter((r) => r.status === 'rejected').length;
  if (failed > 0) console.warn(`[analyze] 분석 ${failed}개를 저장하지 못했습니다.`);

  logSearch({
    user_id: input.userId ?? null,
    restaurant_id: input.restaurantId ?? null,
    query_text: input.menuText ?? (input.image ? '[image]' : '[recommendation]'),
    result_source: cachedDishes.length > 0 ? 'mixed' : 'gemini',
    gemini_called: true,
  });

  return {
    dishes,
    meta: {
      gemini_called: true,
      result_source: cachedDishes.length > 0 ? 'mixed' : 'gemini',
    },
  };
};

/* ------------------------------------------------------------------ */
/* 2) 식당별 메뉴 조회 (계획서 5.1)                                      */
/* ------------------------------------------------------------------ */

export const getRestaurantDishes = async (
  restaurantId: string,
  lang: string,
  filter: PartyFilter
): Promise<{ dishes: Dish[]; stale: boolean }> => {
  const menus = (await db.all(
    "SELECT * FROM restaurant_menus WHERE restaurant_id = ? AND status = 'active' ORDER BY created_at",
    [restaurantId]
  )) as MenuRow[];

  const dishes: Dish[] = [];
  let stale = false;

  for (const menu of menus) {
    const analysis = (await loadAnalysis(menu.menu_id, lang)) || (await loadAnalysis(menu.menu_id, 'ko'));
    if (!analysis) {
      stale = true;
      continue;
    }
    if (await needsReanalysis(menu.menu_id, lang)) stale = true;
    dishes.push(await analysisToDish(menu, analysis, filter));
  }

  return { dishes, stale };
};

/* ------------------------------------------------------------------ */
/* 3) 식당 메뉴 분석 & 저장 (계획서 5.2 / 5.3)                           */
/* ------------------------------------------------------------------ */

export interface RestaurantAnalysisInput extends RunAnalysisInput {
  restaurantId: string;
  restaurantName: string;
}

export const runRestaurantAnalysis = async (
  input: RestaurantAnalysisInput
): Promise<AnalyzeMenuResponse> => {
  const lang = input.targetLanguage || 'ko';

  // 1. 이미 저장된 메뉴가 있으면 먼저 확보한다.
  const known = (await db.all(
    "SELECT original_name FROM restaurant_menus WHERE restaurant_id = ? AND status = 'active'",
    [input.restaurantId]
  )) as { original_name: string }[];

  /*
   * 사진은 먼저 이름만 읽고, 그 이름으로 분석한다.
   *
   * 사진을 분석 단계에 통째로 넘기면 AI 가 못 읽은 부분을 그 나라의 그럴듯한
   * 음식으로 채운다. 실제로 글자 없는 사진에 '여행 국가: 일본' 을 주자
   * 돈카츠·타코야키를 지어냈다. 메뉴판에 없는 음식을 식당 메뉴로 등록하면
   * 다음 방문자에게도 그대로 퍼진다.
   */
  let menuNames = input.menuText;
  if (input.image) {
    const reading = await readFoodPhoto(input.image).catch(
      () => ({ kind: 'none', names: [] }) as PhotoReading
    );
    if (reading.names.length === 0) throw new Error(PHOTO_UNREADABLE_MESSAGE);

    const what = reading.kind === 'menu' ? '메뉴판' : '음식 사진';
    console.log(`[analyze] 식당 ${what}에서 ${reading.names.length}개 확인: ${reading.names.slice(0, 5).join(', ')}`);
    menuNames = reading.names.join(', ');
  }

  const result = await analyzeMenu({
    // 이름을 읽어 두었으므로 사진은 넘기지 않는다.
    image: null,
    menuText: menuNames,
    homeCountry: input.homeCountry,
    travelCountry: input.travelCountry,
    party: input.party,
    targetLanguage: lang,
    restaurantName: input.restaurantName,
    knownMenuNames: known.map((k) => k.original_name),
  });

  const dishes: Dish[] = [];
  /*
   * 같은 메뉴가 두 번 나오지 않게 한다.
   * 기준은 메뉴판에 적힌 원문 이름이다. 표준 음식으로 거르면 모둠회와
   * 잿방어 회처럼 같은 분류로 묶이는 다른 메뉴가 지워진다.
   */
  const takenKeys = new Set<string>();

  for (const raw of result.dishes || []) {
    const key = String(raw?.original || raw?.name || '').trim().toLowerCase();
    if (key && takenKeys.has(key)) continue;
    if (key) takenKeys.add(key);

    const enriched = (await enrichDish(raw, input.filter, input.travelCountry)) as Dish & {
      __bundle: ReferenceBundle;
    };
    const bundle = enriched.__bundle;
    delete (enriched as any).__bundle;

    // 표준 음식이 없으면 새로 만들어 DB 를 확장한다. (계획서 7.1)
    let standardFoodId = enriched.standard_food_id ?? null;
    if (!standardFoodId) {
      const created = await createStandardFoodFromDish({
        standard_food_name: enriched.standard_food_name,
        name: enriched.name,
        original: enriched.original,
        country: input.travelCountry,
        typical_ingredients: enriched.typical_ingredients,
        typical_allergens: enriched.allergen_risk?.items,
        description: enriched.desc,
      });
      standardFoodId = created.standard_food_id;
    } else {
      await registerAliases(standardFoodId, [enriched.original, enriched.name, enriched.standard_food_name]);
    }

    const menu = await upsertMenu(input.restaurantId, enriched, standardFoodId);
    enriched.menu_id = menu.menu_id;
    enriched.restaurant_id = input.restaurantId;
    enriched.standard_food_id = standardFoodId;
    enriched.last_verified_at = menu.last_verified_at;

    await saveAnalysis(menu.menu_id, lang, enriched);
    await saveEvidence(menu.menu_id, bundle, enriched.source_type ?? 'ai_estimate');

    dishes.push(enriched);
  }

  logSearch({
    user_id: input.userId ?? null,
    restaurant_id: input.restaurantId,
    query_text: input.menuText ?? '[image]',
    result_source: 'gemini',
    gemini_called: true,
  });

  return { dishes, meta: { gemini_called: true, result_source: 'gemini', restaurant_id: input.restaurantId } };
};

/**
 * 이미 분석된 결과를 식당 메뉴로 저장한다. (계획서 5.2 / 5.3)
 * AI 를 다시 부르지 않고, 사용자가 본 그 결과를 그대로 식당에 붙인다.
 */
export const registerDishesToRestaurant = async (
  restaurantId: string,
  lang: string,
  dishes: Dish[],
  userId?: string
): Promise<string[]> => {
  const savedMenuIds: string[] = [];

  for (const dish of dishes) {
    if (!dish.original && !dish.name) continue;

    // 표준 음식이 없으면 새로 만들어 다음 검색에서도 매칭되게 한다. (계획서 7.1)
    let standardFoodId = dish.standard_food_id ?? null;
    if (!standardFoodId) {
      standardFoodId = (
        await createStandardFoodFromDish({
          standard_food_name: dish.standard_food_name,
          name: dish.name,
          original: dish.original,
          typical_ingredients: dish.typical_ingredients,
          typical_allergens: dish.allergen_risk?.items,
          description: dish.desc,
        })
      ).standard_food_id;
    } else {
      await registerAliases(standardFoodId, [dish.original, dish.name, dish.standard_food_name]);
    }

    const menu = await upsertMenu(restaurantId, dish, standardFoodId);
    await saveAnalysis(menu.menu_id, lang, { ...dish, menu_id: menu.menu_id, restaurant_id: restaurantId });
    savedMenuIds.push(menu.menu_id);
  }

  logSearch({
    user_id: userId ?? null,
    restaurant_id: restaurantId,
    query_text: `[메뉴 등록 ${savedMenuIds.length}건]`,
    result_source: 'user_registered',
    gemini_called: false,
  });

  return savedMenuIds;
};

/** 식당 메뉴 데이터 신선도 요약 (카드/추천에서 사용) */
export const menuFreshness = async (
  restaurantId: string
): Promise<{ count: number; lastVerifiedDays: number | null }> => {
  const row: any = await db.get(
    `SELECT COUNT(*) AS n, MAX(last_verified_at) AS latest
     FROM restaurant_menus WHERE restaurant_id = ? AND status = 'active'`,
    [restaurantId]
  );
  return { count: Number(row?.n ?? 0), lastVerifiedDays: daysSince(row?.latest) };
};
