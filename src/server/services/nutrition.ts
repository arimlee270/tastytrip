import { db } from '../db';
import type { CalorieEstimate, ReferenceBundle, SourceType, StandardFood } from '../../types';
import { getServingWeight, resolveStandardFood } from './normalize';
import {
  hasRealServingWeight,
  persistNutrition,
  searchNutrition,
  searchTraceQr,
  type MfdsNutrition,
} from './mfds';
import { persistUsda, searchUsda } from './usda';

/**
 * 계획서 8.1 / 9.2 / 9.3 — 공개 데이터를 근거로 칼로리 범위와 참고 자료를 구성한다.
 * 조회 순서는 계획서 12.1 을 따른다: 내부 DB -> 공개 데이터 캐시 -> 외부 API.
 */

interface NutritionRow {
  source_name: string;
  reference_amount_g: number | null;
  energy_kcal: number | null;
  source_item_id: string | null;
}

const loadStoredNutrition = async (standardFoodId: string): Promise<NutritionRow[]> =>
  (await db.all(
    `SELECT source_name, reference_amount_g, energy_kcal, source_item_id
     FROM nutrition_references WHERE standard_food_id = ? AND energy_kcal IS NOT NULL`,
    [standardFoodId]
  )) as NutritionRow[];

/**
 * 근거 데이터 묶음 생성. 외부 API 는 내부에 자료가 없을 때만 호출한다.
 * @param names 메뉴명 후보 (원어, 번역명, 표준 영문명)
 */
export const buildReferenceBundle = async (
  names: { original?: string; translated?: string; standardEn?: string; country?: string },
  options: { allowExternal?: boolean } = {}
): Promise<{ bundle: ReferenceBundle; standardFood: StandardFood | null }> => {
  const allowExternal = options.allowExternal !== false;
  const standardFood = await resolveStandardFood([names.standardEn, names.translated, names.original]);

  const typicalIngredients = new Set<string>(standardFood?.typical_ingredients ?? []);
  const allergenCandidates = new Set<string>(standardFood?.typical_allergens ?? []);
  const officialNotes: string[] = [];

  let stored: NutritionRow[] = standardFood ? await loadStoredNutrition(standardFood.standard_food_id) : [];

  // 내장 시드(SEED)는 실제 조회 자료가 아니므로, 공개 데이터를 아직 못 받은 것으로 취급한다.
  // (외부 응답은 public_data_cache 에 TTL 로 캐시되므로 매번 API 를 호출하지는 않는다.)
  const hasExternalData = stored.some((r) => r.source_name !== 'SEED');

  // 공개 데이터 조회 (계획서 12.1 4단계)
  if (allowExternal && !hasExternalData) {
    const koreanName = names.translated || names.original || '';
    // USDA 는 영문 DB 라 한글로 조회하면 결과가 나오지 않는다.
    // 호출자가 준 이름이 영문이 아니면 표준 음식의 영문명으로 바꿔서 조회한다.
    const isAscii = (s: string) => !!s && /^[\x20-\x7E]+$/.test(s);
    const englishName = isAscii(names.standardEn ?? '')
      ? (names.standardEn as string)
      : standardFood?.standard_name_en ?? '';
    const isEnglish = isAscii(englishName);

    const [mfds, usda, trace] = await Promise.all([
      koreanName ? searchNutrition(koreanName) : Promise.resolve([] as MfdsNutrition[]),
      englishName && isEnglish ? searchUsda(englishName) : Promise.resolve([]),
      koreanName ? searchTraceQr(koreanName) : Promise.resolve([]),
    ]);

    trace.forEach((t) => {
      t.raw_materials.forEach((m) => typicalIngredients.add(m));
      t.allergens.forEach((a) => allergenCandidates.add(a));
      if (t.allergens.length > 0) {
        officialNotes.push(`트레QR 공식 표시 알레르기 정보: ${t.allergens.join(', ')} (제품: ${t.product_name})`);
      }
    });

    if (standardFood) {
      if (mfds.length > 0) {
        await persistNutrition(standardFood.standard_food_id, mfds);

        // 공식 1회 제공 중량(Z10500)으로 시드 추정치를 대체한다.
        // 다만 이름이 정확히 일치하는 '음식' 분류의 값만 신뢰한다.
        // (기준량과 같은 100g 은 "정보 없음"의 기본값이라 hasRealServingWeight 로 걸러진다.)
        const queryName = (names.translated || names.original || '').trim().replace(/\s/g, '');
        const trusted = mfds.find(
          (m) =>
            hasRealServingWeight(m) &&
            m.food_group === '음식' &&
            m.food_name.replace(/\s/g, '') === queryName
        );
        if (trusted?.serving_weight_g) {
          await db.run(
            'UPDATE standard_foods SET serving_weight_min_g = ?, serving_weight_max_g = ? WHERE standard_food_id = ?',
            [
              Math.round(trusted.serving_weight_g * 0.9),
              Math.round(trusted.serving_weight_g * 1.1),
              standardFood.standard_food_id,
            ]
          );
        }
      }
      if (usda.length > 0) await persistUsda(standardFood.standard_food_id, usda);
      stored = await loadStoredNutrition(standardFood.standard_food_id);
    } else {
      // 표준 음식이 아직 없더라도 이번 분석에는 참고값을 쓸 수 있게 임시로 담는다.
      stored = [
        ...mfds.map((m) => ({
          source_name: m.source,
          reference_amount_g: m.reference_amount_g,
          energy_kcal: m.energy_kcal,
          source_item_id: m.food_code,
        })),
        ...usda.map((u) => ({
          source_name: u.source,
          reference_amount_g: 100,
          energy_kcal: u.energy_kcal,
          source_item_id: u.fdc_id,
        })),
      ].filter((r) => r.energy_kcal != null);
    }
  }

  const serving = standardFood
    ? await getServingWeight(standardFood.standard_food_id)
    : { min: 300, max: 450 };

  return {
    standardFood,
    bundle: {
      standard_food_id: standardFood?.standard_food_id,
      typical_ingredients: [...typicalIngredients],
      allergen_candidates: [...allergenCandidates],
      nutrition_records: stored.map((r) => ({
        source: r.source_name,
        basis: r.reference_amount_g ? `${r.reference_amount_g}g` : '1회 제공량',
        energy_kcal: r.energy_kcal,
      })),
      estimated_serving_weight_g: serving,
      official_notes: officialNotes,
    },
  };
};

/* ------------------------------------------------------------------ */
/* 칼로리 계산 (계획서 9.3)                                             */
/* ------------------------------------------------------------------ */

export interface CalorieResult {
  estimate: CalorieEstimate;
  sourceType: SourceType;
  sourceSummary: string[];
}

const round10 = (n: number) => Math.round(n / 10) * 10;

/**
 * 같은 음식이라도 종류에 따라 100g 열량이 크게 다르다(비빔밥 112~204kcal).
 * 계획서 7.4 에 따라 평균으로 뭉개지 않고 중앙값을 대표값으로 삼는다.
 * 최솟값×최소중량 ~ 최댓값×최대중량 으로 계산하면 편차가 곱해져 범위가 비현실적으로 넓어진다.
 */
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** 내장 시드 값(SEED)만으로 계산했는지 판별한다. 외부 공개 데이터를 쓴 것처럼 표시하지 않기 위함. */
const isSeedOnly = (sources: string[]): boolean =>
  sources.length > 0 && sources.every((s) => s === 'SEED');

/** 실제로 사용한 근거에 맞는 출처 유형과 표시 문구를 만든다. */
const describeSource = (
  sources: string[]
): { sourceType: SourceType; summary: string[]; label: string } => {
  const unique = [...new Set(sources)];
  if (isSeedOnly(unique)) {
    return {
      sourceType: 'reference_recipe',
      summary: ['일반 레시피 기준 참고값'],
      label: '일반 레시피 기준',
    };
  }
  return {
    sourceType: 'public_data',
    summary: ['공개 영양 데이터', ...unique.filter((s) => s !== 'SEED')],
    label: `공개 데이터 활용 (${unique.filter((s) => s !== 'SEED').join(', ')})`,
  };
};

/**
 * 우선순위:
 *  1. 공식 1회 제공량 데이터
 *  2. 100g 데이터 × 추정 제공 중량
 *  3. 여러 공개 데이터의 범위
 *  4. AI 추정값
 */
export const computeCalories = (
  bundle: ReferenceBundle,
  aiEstimate?: Partial<CalorieEstimate> | null
): CalorieResult => {
  const records = bundle.nutrition_records.filter((r) => typeof r.energy_kcal === 'number');
  const serving = bundle.estimated_serving_weight_g;

  // 1) 공식 1회 제공량 데이터 (기준량이 100g 이 아닌 실제 제공량으로 명시된 경우)
  const servingRecords = records.filter(
    (r) => r.basis === '1회 제공량' || (/^\d+(\.\d+)?g$/.test(r.basis) && parseFloat(r.basis) !== 100)
  );
  if (servingRecords.length > 0) {
    const values = servingRecords.map((r) => r.energy_kcal as number);
    const min = round10(Math.min(...values) * 0.9);
    const max = round10(Math.max(...values) * 1.1);
    return {
      estimate: {
        min,
        max,
        unit: 'kcal',
        basis: `공식 1회 제공량 기준 (${servingRecords.map((r) => r.source).join(', ')})`,
        confidence: 0.9,
      },
      sourceType: 'official_nutrition',
      sourceSummary: ['공식 영양성분 데이터', ...new Set(servingRecords.map((r) => r.source))],
    };
  }

  // 2) 100g 기준 데이터 × 추정 제공 중량
  const per100 = records.filter((r) => r.basis === '100g');
  if (per100.length > 0) {
    const values = per100.map((r) => r.energy_kcal as number);
    // 대표 열량은 중앙값으로 정하고, 범위는 1인분 중량의 폭으로만 만든다.
    const representative = median(values);
    const described = describeSource(per100.map((r) => r.source));
    return {
      estimate: {
        min: round10((representative * serving.min) / 100),
        max: round10((representative * serving.max) / 100),
        unit: 'kcal',
        basis: `일반적인 1인분 ${serving.min}~${serving.max}g 기준 추정 (100g 기준 ${described.label})`,
        // 외부 공개 데이터로 확인된 값이 아니면 신뢰도를 낮게 잡는다.
        confidence: described.sourceType === 'public_data' ? 0.7 : 0.55,
      },
      sourceType: described.sourceType,
      sourceSummary: described.summary,
    };
  }

  // 3) 기준량이 불명확한 공개 데이터가 여러 건 있는 경우 — 범위로만 제시 (계획서 7.4)
  if (records.length > 0) {
    const values = records.map((r) => r.energy_kcal as number);
    const described = describeSource(records.map((r) => r.source));
    return {
      estimate: {
        min: round10(Math.min(...values) * 0.8),
        max: round10(Math.max(...values) * 1.2),
        unit: 'kcal',
        basis: `${described.label} 범위 기반 추정 (기준량 상이)`,
        confidence: described.sourceType === 'public_data' ? 0.5 : 0.4,
      },
      sourceType: described.sourceType,
      sourceSummary: described.summary,
    };
  }

  // 4) AI 추정
  if (aiEstimate && typeof aiEstimate.min === 'number' && typeof aiEstimate.max === 'number') {
    const min = Math.min(aiEstimate.min, aiEstimate.max);
    const max = Math.max(aiEstimate.min, aiEstimate.max);
    return {
      estimate: {
        min: round10(min),
        max: round10(max),
        unit: 'kcal',
        basis: aiEstimate.basis || '일반적인 1인분 기준 AI 추정',
        confidence: Math.min(aiEstimate.confidence ?? 0.45, 0.6),
      },
      sourceType: 'ai_estimate',
      sourceSummary: ['AI 추정'],
    };
  }

  return {
    estimate: {
      min: 0,
      max: 0,
      unit: 'kcal',
      basis: '정보 부족',
      confidence: 0,
    },
    sourceType: 'ai_estimate',
    sourceSummary: ['정보 부족'],
  };
};

/**
 * 계획서 8.4 — 서버측 출력 검증.
 * 실패한 필드는 '정보 부족'으로 처리하고 문제 목록을 함께 돌려준다.
 */
export const validateCalories = (estimate: CalorieEstimate): { valid: boolean; issues: string[] } => {
  const issues: string[] = [];
  if (estimate.min > estimate.max) issues.push('칼로리 최솟값이 최댓값보다 큽니다.');
  if (estimate.max > 3000) issues.push('칼로리 값이 비정상적으로 큽니다.');
  if (estimate.min < 0) issues.push('칼로리 값이 음수입니다.');
  return { valid: issues.length === 0, issues };
};
