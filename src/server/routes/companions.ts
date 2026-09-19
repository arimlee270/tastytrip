import { Router } from 'express';
import { db, newId, nowIso, parseJson, toJson } from '../db';
import { requireAuth } from '../auth';

/** 계획서 13.2 동반인 API */
export const companionsRouter = Router();

companionsRouter.use(requireAuth);

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

const toPublic = (c: any) => ({
  companion_id: c.companion_id,
  user_id: c.user_id,
  nickname: c.nickname,
  allergies: parseJson<string[]>(c.allergies, []),
  dietary_tags: parseJson<string[]>(c.dietary_tags, []),
  avoid_ingredients: parseJson<string[]>(c.avoid_ingredients, []),
});

companionsRouter.get('/', async (req, res) => {
  const rows = await db.all('SELECT * FROM companions WHERE user_id = ? ORDER BY sort_order, created_at', [req.userId!]);
  res.json({ companions: rows.map(toPublic) });
});

companionsRouter.post('/', async (req, res) => {
  const { nickname, allergies, dietary_tags, avoid_ingredients } = req.body || {};
  if (typeof nickname !== 'string' || !nickname.trim()) {
    res.status(400).json({ error: '동반인 닉네임을 입력해주세요.' });
    return;
  }

  const count = (await db.get('SELECT COUNT(*) AS n FROM companions WHERE user_id = ?', [req.userId!]) as any).n;
  const id = newId('cmp');
  await db.run(`INSERT INTO companions (companion_id, user_id, nickname, allergies, dietary_tags, avoid_ingredients, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id,
    req.userId!,
    nickname.trim(),
    toJson(arr(allergies)),
    toJson(arr(dietary_tags)),
    toJson(arr(avoid_ingredients)),
    count,
    nowIso()]);

  res.status(201).json({ companion: toPublic(await db.get('SELECT * FROM companions WHERE companion_id = ?', [id])) });
});

companionsRouter.patch('/:id', async (req, res) => {
  const current: any = await db.get('SELECT * FROM companions WHERE companion_id = ? AND user_id = ?', [req.params.id, req.userId!]);
  if (!current) {
    res.status(404).json({ error: '동반인을 찾을 수 없습니다.' });
    return;
  }

  const { nickname, allergies, dietary_tags, avoid_ingredients } = req.body || {};
  await db.run(`UPDATE companions SET nickname = ?, allergies = ?, dietary_tags = ?, avoid_ingredients = ?
     WHERE companion_id = ?`, [typeof nickname === 'string' && nickname.trim() ? nickname.trim() : current.nickname,
    toJson(allergies === undefined ? parseJson<string[]>(current.allergies, []) : arr(allergies)),
    toJson(dietary_tags === undefined ? parseJson<string[]>(current.dietary_tags, []) : arr(dietary_tags)),
    toJson(
      avoid_ingredients === undefined ? parseJson<string[]>(current.avoid_ingredients, []) : arr(avoid_ingredients)
    ),
    req.params.id]);

  res.json({
    companion: toPublic(await db.get('SELECT * FROM companions WHERE companion_id = ?', [req.params.id])),
  });
});

companionsRouter.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM companions WHERE companion_id = ? AND user_id = ?', [req.params.id, req.userId!]);
  if (info.changes === 0) {
    res.status(404).json({ error: '동반인을 찾을 수 없습니다.' });
    return;
  }
  res.json({ ok: true });
});

/**
 * 클라이언트의 여행 구성원(Member[]) 목록을 계정에 통째로 저장한다.
 * index 0 = 본인(user_profiles), 나머지 = 동반인(companions).
 * 기존 localStorage 데이터 마이그레이션에도 사용된다. (계획서 Phase 2)
 */
companionsRouter.put('/sync-party', async (req, res) => {
  const party = Array.isArray(req.body?.party) ? req.body.party : null;
  if (!party || party.length === 0) {
    res.status(400).json({ error: '여행 구성원 목록이 비어 있습니다.' });
    return;
  }

  const ts = nowIso();
  {
    const [self, ...others] = party;

    await db.run(`UPDATE user_profiles SET allergies = ?, dietary_tags = ?, avoid_ingredients = ?, preference_text = ?, updated_at = ?
       WHERE user_id = ?`, [toJson(arr(self?.allergies)),
      toJson(arr(self?.diets ?? self?.dietary_tags)),
      toJson(arr(self?.avoid_ingredients)),
      typeof self?.notes === 'string' ? self.notes : '',
      ts,
      req.userId!]);

    await db.run('DELETE FROM companions WHERE user_id = ?', [req.userId!]);
    for (const [idx, m] of others.entries()) {
      // 기존 UI 의 자유 입력(notes)은 기피 재료 목록에 함께 보관한다.
      const avoid = arr(m?.avoid_ingredients);
      if (typeof m?.notes === 'string' && m.notes.trim()) avoid.push(m.notes.trim());

      await db.run(`INSERT INTO companions (companion_id, user_id, nickname, allergies, dietary_tags, avoid_ingredients, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [newId('cmp'),
        req.userId!,
        (typeof m?.name === 'string' && m.name.trim()) || `여행자 ${idx + 2}`,
        toJson(arr(m?.allergies)),
        toJson(arr(m?.diets ?? m?.dietary_tags)),
        toJson(avoid),
        idx,
        ts]);
    }
  }

  const rows = await db.all('SELECT * FROM companions WHERE user_id = ? ORDER BY sort_order, created_at', [req.userId!]);
  res.json({ ok: true, companions: rows.map(toPublic) });
});
