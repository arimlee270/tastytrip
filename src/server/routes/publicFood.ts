import { Router } from 'express';
import { db, nowIso } from '../db';
import { flags } from '../env';
import { getStandardFood, resolveStandardFood, rowToStandardFood } from '../services/normalize';
import { buildReferenceBundle } from '../services/nutrition';
import { persistNutrition, searchLotMaterials, searchNutrition, searchTraceQr } from '../services/mfds';
import { persistUsda, searchUsda } from '../services/usda';
import { SEED_FOODS, seedStandardFoods } from '../seed/standardFoods';

/** 계획서 13.5 공개 데이터 API */
export const publicFoodRouter = Router();

/** 표준 음식 검색 + 공개 데이터 근거 조회 */
publicFoodRouter.get('/search', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: '검색어를 입력해주세요.' });
      return;
    }

    const standardFood = await resolveStandardFood([query]);
    const { bundle } = await buildReferenceBundle({ original: query, translated: query, standardEn: query });

    res.json({
      standard_food: standardFood,
      reference: bundle,
      sources: {
        mfds: flags.hasMfds,
        usda: flags.hasUsda,
      },
    });
  } catch (error: any) {
    console.error('[public-food/search]', error);
    res.status(500).json({ error: error.message || '공개 데이터 조회에 실패했습니다.' });
  }
});

/** 표준 음식의 영양 참고 자료 */
publicFoodRouter.get('/:standardFoodId/nutrition', async (req, res) => {
  const food = await getStandardFood(req.params.standardFoodId);
  if (!food) {
    res.status(404).json({ error: '표준 음식을 찾을 수 없습니다.' });
    return;
  }
  const references = await db.all('SELECT * FROM nutrition_references WHERE standard_food_id = ? ORDER BY collected_at DESC', [food.standard_food_id]);
  res.json({ standard_food: food, references });
});

/** 표준 음식 목록 */
publicFoodRouter.get('/', async (req, res) => {
  const country = typeof req.query.country === 'string' ? req.query.country : null;
  const rows = country
    ? await db.all('SELECT * FROM standard_foods WHERE country = ? ORDER BY standard_name_en', [country])
    : await db.all('SELECT * FROM standard_foods ORDER BY standard_name_en LIMIT 200');
  res.json({ foods: rows.map(rowToStandardFood) });
});

/* --------------------------- 관리자 --------------------------- */

export const adminPublicDataRouter = Router();

/**
 * 공개 데이터 동기화 (계획서 7.5 / 13.5).
 * 표준 음식 시드를 적재하고, 각 음식의 영양 정보를 식약처/USDA 에서 갱신한다.
 */
adminPublicDataRouter.post('/sync', async (req, res) => {
  try {
    await seedStandardFoods();

    const limit = Number(req.body?.limit) || SEED_FOODS.length;
    const targets = SEED_FOODS.slice(0, limit);
    const results: { id: string; mfds: number; usda: number }[] = [];

    for (const food of targets) {
      const [mfds, usda] = await Promise.all([searchNutrition(food.ko), searchUsda(food.en)]);
      if (mfds.length > 0) await persistNutrition(food.id, mfds);
      if (usda.length > 0) await persistUsda(food.id, usda);
      results.push({ id: food.id, mfds: mfds.length, usda: usda.length });
    }

    res.json({ synced_at: nowIso(), results, sources: { mfds: flags.hasMfds, usda: flags.hasUsda } });
  } catch (error: any) {
    console.error('[admin/public-data/sync]', error);
    res.status(500).json({ error: error.message || '동기화에 실패했습니다.' });
  }
});

adminPublicDataRouter.get('/sync-status', async (_req, res) => {
  const counts: any = await db.get(`SELECT
         (SELECT COUNT(*) FROM standard_foods) AS standard_foods,
         (SELECT COUNT(*) FROM food_aliases) AS aliases,
         (SELECT COUNT(*) FROM nutrition_references) AS nutrition_references,
         (SELECT COUNT(*) FROM public_data_cache) AS cached_responses,
         (SELECT MAX(fetched_at) FROM public_data_cache) AS last_fetched_at`);

  const bySource = await db.all('SELECT source_name, COUNT(*) AS n FROM nutrition_references GROUP BY source_name');

  res.json({ counts, by_source: bySource, sources: { mfds: flags.hasMfds, usda: flags.hasUsda } });
});

/** 트레QR / LOT 원재료 직접 조회 (디버깅 및 제품 단위 분석용, 계획서 6.3 / 6.5) */
adminPublicDataRouter.get('/product', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: '제품명을 입력해주세요.' });
    return;
  }
  const [trace, lot] = await Promise.all([searchTraceQr(name), searchLotMaterials(name)]);
  res.json({ trace, lot });
});
