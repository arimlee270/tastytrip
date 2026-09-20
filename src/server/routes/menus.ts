import { Router } from 'express';
import { db, nowIso, parseJson, toJson } from '../db';
import { optionalAuth } from '../auth';
import { resolveParty } from '../services/party';
import { getRestaurantById } from '../services/places';
import {
  analysisToDish,
  getRestaurantDishes,
  reevaluateDish,
  registerDishesToRestaurant,
  runFreeAnalysis,
  runRestaurantAnalysis,
} from '../services/menuPipeline';
import { friendlyGeminiError } from '../services/gemini';
import type { Dish } from '../../types';

/** 계획서 13.4 메뉴 분석 API */
export const menusRouter = Router();

menusRouter.use(optionalAuth);

/**
 * 기존 카메라/텍스트 분석 엔드포인트.
 * 응답 형식({ dishes: [...] })을 유지하여 기존 프런트엔드와 호환된다.
 */
menusRouter.post('/analyze-menu', async (req, res) => {
  try {
    const { image, menuText, homeCountry, travelCountry, targetLanguage } = req.body || {};
    const { members, filter } = await resolveParty(req.body, req.userId);

    const result = await runFreeAnalysis({
      image,
      menuText,
      homeCountry,
      travelCountry,
      party: members,
      filter,
      targetLanguage: targetLanguage || 'ko',
      userId: req.userId,
    });

    // 로그인 사용자는 다른 기기에서도 이어 볼 수 있도록 결과를 남긴다.
    if (req.userId && result.dishes.length > 0) {
      await db.run(
        `INSERT INTO user_last_analysis (user_id, lang, payload, saved_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           lang = excluded.lang, payload = excluded.payload, saved_at = excluded.saved_at`,
        [req.userId, targetLanguage || 'ko', toJson(result.dishes), nowIso()]
      );
    }

    res.json(result);
  } catch (error: any) {
    console.error('Error in /api/analyze-menu:', error);
    res.status(500).json({ error: friendlyGeminiError(error) });
  }
});

/**
 * 마지막으로 분석한 결과를 돌려준다 (로그인 사용자만).
 *
 * 저장된 판정을 그대로 주지 않고 지금 프로필로 다시 계산한다.
 * 알레르기 설정을 바꿨는데 예전 조건의 경고가 남아 있으면 안 되기 때문이다.
 */
menusRouter.get('/last-analysis', async (req, res) => {
  if (!req.userId) {
    res.json({ dishes: [] });
    return;
  }
  const row: any = await db.get('SELECT * FROM user_last_analysis WHERE user_id = ?', [req.userId]);
  if (!row) {
    res.json({ dishes: [] });
    return;
  }

  const saved = parseJson<Dish[]>(row.payload, []);
  const { filter } = await resolveParty(req.query, req.userId);
  res.json({
    dishes: saved.map((d) => reevaluateDish(d, filter)),
    saved_at: row.saved_at,
  });
});

/**
 * 특정 식당의 메뉴판을 촬영해 분석하고 restaurant_menus 에 저장한다. (계획서 5.2)
 */
menusRouter.post('/restaurants/:restaurantId/menus/analyze', async (req, res) => {
  try {
    const restaurant = await getRestaurantById(req.params.restaurantId);
    if (!restaurant) {
      res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
      return;
    }

    const { image, menuText, homeCountry, travelCountry, targetLanguage } = req.body || {};
    const { members, filter } = await resolveParty(req.body, req.userId);

    const result = await runRestaurantAnalysis({
      image,
      menuText,
      homeCountry,
      travelCountry: travelCountry || restaurant.country || undefined,
      party: members,
      filter,
      targetLanguage: targetLanguage || 'ko',
      userId: req.userId,
      restaurantId: restaurant.restaurant_id,
      restaurantName: restaurant.name,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error in /api/restaurants/:id/menus/analyze:', error);
    res.status(500).json({ error: friendlyGeminiError(error) });
  }
});

/**
 * 이미 분석한 결과를 특정 식당의 메뉴로 등록한다. (계획서 5.2 / 5.3)
 * 사용자가 쌓아준 데이터라 다음 방문자는 AI 호출 없이 바로 조회할 수 있다.
 */
menusRouter.post('/restaurants/:restaurantId/menus/register', async (req, res) => {
  try {
    const restaurant = await getRestaurantById(req.params.restaurantId);
    if (!restaurant) {
      res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
      return;
    }

    const dishes = Array.isArray(req.body?.dishes) ? req.body.dishes : null;
    if (!dishes || dishes.length === 0) {
      res.status(400).json({ error: '등록할 메뉴가 없습니다.' });
      return;
    }

    const lang = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'ko';
    const saved = await registerDishesToRestaurant(restaurant.restaurant_id, lang, dishes, req.userId);

    res.json({
      registered: saved.length,
      restaurant: { restaurant_id: restaurant.restaurant_id, name: restaurant.name },
    });
  } catch (error: any) {
    console.error('Error in /api/restaurants/:id/menus/register:', error);
    res.status(500).json({ error: error.message || '메뉴 등록에 실패했습니다.' });
  }
});

/** 메뉴 1건 상세 */
menusRouter.get('/menus/:menuId', async (req, res) => {
  const menu: any = await db.get('SELECT * FROM restaurant_menus WHERE menu_id = ?', [req.params.menuId]);
  if (!menu) {
    res.status(404).json({ error: '메뉴를 찾을 수 없습니다.' });
    return;
  }

  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';
  const analysis: any =
    await db.get('SELECT * FROM menu_analysis WHERE menu_id = ? AND lang = ? ORDER BY generated_at DESC LIMIT 1', [menu.menu_id, lang]) ||
    await db.get('SELECT * FROM menu_analysis WHERE menu_id = ? ORDER BY generated_at DESC LIMIT 1', [menu.menu_id]);

  if (!analysis) {
    res.status(404).json({ error: '분석 정보가 아직 없습니다.' });
    return;
  }

  const { filter } = await resolveParty({}, req.userId);
  const evidence = await db.all('SELECT * FROM source_evidence WHERE menu_id = ? ORDER BY collected_at DESC LIMIT 20', [menu.menu_id]);

  res.json({
    dish: await analysisToDish(menu, analysis, filter),
    evidence,
    reports: await db.get("SELECT COUNT(*) AS n FROM reports WHERE menu_id = ? AND status = 'pending'", [menu.menu_id]),
  });
});

/**
 * 메뉴 재분석. (계획서 12.2 재호출 조건에 해당할 때 사용)
 * 저장된 원어 메뉴명을 텍스트로 다시 분석한다.
 */
menusRouter.post('/menus/:menuId/reanalyze', async (req, res) => {
  try {
    const menu: any = await db.get('SELECT * FROM restaurant_menus WHERE menu_id = ?', [req.params.menuId]);
    if (!menu) {
      res.status(404).json({ error: '메뉴를 찾을 수 없습니다.' });
      return;
    }
    const restaurant = await getRestaurantById(menu.restaurant_id);
    if (!restaurant) {
      res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
      return;
    }

    const { members, filter } = await resolveParty(req.body, req.userId);
    const result = await runRestaurantAnalysis({
      menuText: menu.original_name,
      homeCountry: req.body?.homeCountry,
      travelCountry: req.body?.travelCountry || restaurant.country || undefined,
      party: members,
      filter,
      targetLanguage: req.body?.targetLanguage || 'ko',
      userId: req.userId,
      restaurantId: restaurant.restaurant_id,
      restaurantName: restaurant.name,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error in /api/menus/:menuId/reanalyze:', error);
    res.status(500).json({ error: friendlyGeminiError(error) });
  }
});

/** 식당의 저장된 메뉴 목록 (계획서 5.1) — 결과 카드 형태로 반환 */
menusRouter.get('/restaurants/:restaurantId/dishes', async (req, res) => {
  const restaurant = await getRestaurantById(req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: '식당을 찾을 수 없습니다.' });
    return;
  }
  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';
  const { filter } = await resolveParty({}, req.userId);
  res.json(await getRestaurantDishes(restaurant.restaurant_id, lang, filter));
});

/** 분석 기록 (계획서 14.2 내 정보 화면) */
menusRouter.get('/history', async (req, res) => {
  if (!req.userId) {
    res.json({ history: [] });
    return;
  }
  const rows = await db.all(`SELECT l.searched_at, l.query_text, l.result_source, l.gemini_called, r.name AS restaurant_name, r.restaurant_id
       FROM search_logs l
       LEFT JOIN restaurants r ON r.restaurant_id = l.restaurant_id
       WHERE l.user_id = ? ORDER BY l.searched_at DESC LIMIT 50`, [req.userId]);
  res.json({ history: rows });
});

/** 검색 로그 기반 인기 메뉴 (계획서 12.3) */
menusRouter.get('/popular-foods', async (_req, res) => {
  const rows = await db.all(`SELECT query_text, COUNT(*) AS hits
       FROM search_logs
       WHERE searched_at >= datetime('now', '-30 days') AND query_text IS NOT NULL
       GROUP BY query_text ORDER BY hits DESC LIMIT 20`);
  res.json({ popular: rows });
});

export const parseTags = (raw: unknown): string[] => parseJson<string[]>(raw, []);
