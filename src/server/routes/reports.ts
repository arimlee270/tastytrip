import { Router } from 'express';
import { db, newId, nowIso, toJson } from '../db';
import { optionalAuth } from '../auth';
import type { ReportType } from '../../types';

/** 계획서 13.7 신고 및 검증 API (Phase 8) */
export const reportsRouter = Router();

reportsRouter.use(optionalAuth);

const VALID_TYPES: ReportType[] = ['ingredient', 'allergen', 'calorie', 'price', 'other'];

/** 메뉴 오류 신고 등록 */
reportsRouter.post('/menus/:menuId/reports', async (req, res) => {
  const menu = await db.get('SELECT menu_id FROM restaurant_menus WHERE menu_id = ?', [req.params.menuId]);
  if (!menu) {
    res.status(404).json({ error: '메뉴를 찾을 수 없습니다.' });
    return;
  }

  const { report_type, report_text, evidence_url, visit_date, reported_allergens, absent_allergens } =
    req.body || {};
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  if (!VALID_TYPES.includes(report_type)) {
    res.status(400).json({ error: '신고 유형이 올바르지 않습니다.' });
    return;
  }
  if (typeof report_text !== 'string' || report_text.trim().length < 2) {
    res.status(400).json({ error: '신고 내용을 입력해주세요.' });
    return;
  }

  const reportId = newId('rep');
  await db.run(`INSERT INTO reports (report_id, menu_id, user_id, report_type, report_text, evidence_url, visit_date,
       status, created_at, reported_allergens, absent_allergens)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, [reportId,
    req.params.menuId,
    req.userId ?? null,
    report_type,
    report_text.trim(),
    typeof evidence_url === 'string' ? evidence_url : null,
    typeof visit_date === 'string' ? visit_date : null,
    nowIso(),
    toJson(arr(reported_allergens)),
    toJson(arr(absent_allergens))]);

  res.status(201).json({ report: await db.get('SELECT * FROM reports WHERE report_id = ?', [reportId]) });
});

/** 메뉴별 신고 목록 */
reportsRouter.get('/menus/:menuId/reports', async (req, res) => {
  const reports = await db.all('SELECT * FROM reports WHERE menu_id = ? ORDER BY created_at DESC', [req.params.menuId]);
  res.json({ reports });
});

/**
 * 신고 검증 처리.
 * 채택하면 해당 메뉴의 신뢰도를 낮추고 '사용자 정보' 근거를 추가한다. (계획서 9.4 / 19장)
 */
reportsRouter.post('/reports/:reportId/verify', async (req, res) => {
  const report: any = await db.get('SELECT * FROM reports WHERE report_id = ?', [req.params.reportId]);
  if (!report) {
    res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
    return;
  }

  const status = req.body?.status === 'accepted' ? 'accepted' : 'rejected';
  await db.run('UPDATE reports SET status = ? WHERE report_id = ?', [status, req.params.reportId]);

  if (status === 'accepted') {
    await db.run(`INSERT INTO source_evidence (evidence_id, menu_id, source_type, source_name, source_record_id, extracted_value, confidence, collected_at)
       VALUES (?, ?, 'user_reported', 'USER_REPORT', ?, ?, 0.6, ?)`, [newId('evd'), report.menu_id, report.report_id, report.report_text, nowIso()]);

    // 신고 내용 자체는 collectUserReports 가 조회 시점에 합쳐 반영하므로
    // 여기서 분석 결과를 덮어쓰지 않는다. 마지막 확인일만 갱신한다.
    await db.run('UPDATE restaurant_menus SET last_verified_at = ? WHERE menu_id = ?', [nowIso(), report.menu_id]);
  }

  res.json({ report: await db.get('SELECT * FROM reports WHERE report_id = ?', [req.params.reportId]) });
});
