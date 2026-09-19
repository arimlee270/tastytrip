import { Router } from 'express';
import { db, newId, nowIso, parseJson, toJson } from '../db';
import { createToken, hashPassword, requireAuth, verifyPassword } from '../auth';
import { verifyGoogleIdToken } from '../services/googleAuth';

/** 계획서 13.1 인증 API */
export const authRouter = Router();

const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const publicUser = (row: any) => ({
  user_id: row.user_id,
  email: row.email,
  nickname: row.nickname,
  nationality: row.nationality,
  language: row.language,
  destination_country: row.destination_country,
  profile_image_url: row.profile_image_url,
  created_at: row.created_at,
  updated_at: row.updated_at,
  last_login_at: row.last_login_at,
});

const publicProfile = (row: any) =>
  row
    ? {
        profile_id: row.profile_id,
        user_id: row.user_id,
        allergies: parseJson<string[]>(row.allergies, []),
        dietary_tags: parseJson<string[]>(row.dietary_tags, []),
        avoid_ingredients: parseJson<string[]>(row.avoid_ingredients, []),
        preference_text: row.preference_text || '',
      }
    : null;

authRouter.post('/signup', async (req, res) => {
  const { email, password, nickname, nationality, language, destination_country } = req.body || {};

  if (!isEmail(email)) {
    res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.get('SELECT 1 FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    res.status(409).json({ error: '이미 가입된 이메일입니다.' });
    return;
  }

  const userId = newId('usr');
  const ts = nowIso();

  // 계정과 프로필은 함께 만들어져야 하므로 한 트랜잭션으로 실행한다.
  await db.batch([
    {
      sql: `INSERT INTO users (user_id, email, password_hash, nickname, nationality, language, destination_country, created_at, updated_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        userId,
        normalizedEmail,
        hashPassword(password),
        (typeof nickname === 'string' && nickname.trim()) || normalizedEmail.split('@')[0],
        nationality ?? null,
        language ?? null,
        destination_country ?? null,
        ts,
        ts,
        ts,
      ],
    },
    {
      sql: `INSERT INTO user_profiles (profile_id, user_id, allergies, dietary_tags, avoid_ingredients, preference_text, updated_at)
            VALUES (?, ?, '[]', '[]', '[]', '', ?)`,
      params: [newId('prf'), userId, ts],
    },
  ]);

  const row = await db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
  res.status(201).json({ token: createToken(userId), user: publicUser(row), profile: publicProfile(
    await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [userId])
  ) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== 'string') {
    res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    return;
  }

  const row: any = await db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    return;
  }

  const ts = nowIso();
  await db.run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE user_id = ?', [ts, ts, row.user_id]);

  res.json({
    token: createToken(row.user_id),
    user: publicUser({ ...row, last_login_at: ts }),
    profile: publicProfile(await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [row.user_id])),
  });
});

/**
 * 구글 로그인.
 * 브라우저에서 Google Identity Services 가 발급한 ID 토큰(credential)을 받아 검증하고,
 * 계정이 없으면 새로 만든 뒤 우리 서비스의 JWT 를 돌려준다.
 */
authRouter.post('/google', async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || !credential) {
      res.status(400).json({ error: '구글 인증 정보가 없습니다.' });
      return;
    }

    const identity = await verifyGoogleIdToken(credential);
    if (!identity.emailVerified) {
      res.status(401).json({ error: '이메일이 확인되지 않은 구글 계정입니다.' });
      return;
    }

    const ts = nowIso();

    // 같은 구글 계정 -> 같은 이메일 순으로 기존 사용자를 찾는다.
    let row: any =
      (await db.get('SELECT * FROM users WHERE google_sub = ?', [identity.sub])) ??
      (await db.get('SELECT * FROM users WHERE email = ?', [identity.email]));

    if (row) {
      // 이메일로 가입했던 계정이면 구글 계정을 연결해준다.
      await db.run(`UPDATE users SET google_sub = ?, profile_image_url = COALESCE(?, profile_image_url),
           last_login_at = ?, updated_at = ? WHERE user_id = ?`, [identity.sub, identity.picture ?? null, ts, ts, row.user_id]);
    } else {
      const userId = newId('usr');
      await db.batch([
        {
          sql: `INSERT INTO users (user_id, email, password_hash, nickname, nationality, language, destination_country,
                  profile_image_url, created_at, updated_at, last_login_at, auth_provider, google_sub)
                VALUES (?, ?, '', ?, NULL, NULL, NULL, ?, ?, ?, ?, 'google', ?)`,
          params: [
            userId,
            identity.email,
            identity.name || identity.email.split('@')[0],
            identity.picture ?? null,
            ts,
            ts,
            ts,
            identity.sub,
          ],
        },
        {
          sql: `INSERT INTO user_profiles (profile_id, user_id, allergies, dietary_tags, avoid_ingredients, preference_text, updated_at)
                VALUES (?, ?, '[]', '[]', '[]', '', ?)`,
          params: [newId('prf'), userId, ts],
        },
      ]);
      row = await db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
    }

    const user = await db.get('SELECT * FROM users WHERE user_id = ?', [row.user_id]);
    res.json({
      token: createToken(row.user_id),
      user: publicUser(user),
      profile: publicProfile(await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [row.user_id])),
    });
  } catch (error: any) {
    console.error('[auth/google]', error);
    res.status(401).json({ error: error.message || '구글 로그인에 실패했습니다.' });
  }
});

/** JWT 는 서버 상태가 없으므로 클라이언트 토큰 삭제로 충분하다. 호환성을 위해 엔드포인트만 유지. */
authRouter.post('/logout', async (_req, res) => {
  res.json({ ok: true });
});

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE user_id = ?', [req.userId!]);
  const profile = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [req.userId!]);
  const companionRows = await db.all(
    'SELECT * FROM companions WHERE user_id = ? ORDER BY sort_order, created_at',
    [req.userId!]
  );
  const companions = companionRows.map((c: any) => ({
    companion_id: c.companion_id,
    user_id: c.user_id,
    nickname: c.nickname,
    allergies: parseJson<string[]>(c.allergies, []),
    dietary_tags: parseJson<string[]>(c.dietary_tags, []),
    avoid_ingredients: parseJson<string[]>(c.avoid_ingredients, []),
  }));

  res.json({ user: publicUser(user), profile: publicProfile(profile), companions });
});

/** 계획서 3.2 사용자 기본 정보 + 알레르기/식단 조건 저장 */
usersRouter.patch('/me/profile', requireAuth, async (req, res) => {
  const {
    nickname,
    nationality,
    language,
    destination_country,
    allergies,
    dietary_tags,
    avoid_ingredients,
    preference_text,
  } = req.body || {};

  const ts = nowIso();
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

  {
    const current: any = await db.get('SELECT * FROM users WHERE user_id = ?', [req.userId!]);
    await db.run(`UPDATE users SET nickname = ?, nationality = ?, language = ?, destination_country = ?, updated_at = ?
       WHERE user_id = ?`, [typeof nickname === 'string' && nickname.trim() ? nickname.trim() : current.nickname,
      nationality ?? current.nationality,
      language ?? current.language,
      destination_country ?? current.destination_country,
      ts,
      req.userId!]);

    const profileRow: any = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [req.userId!]);
    if (profileRow) {
      await db.run(`UPDATE user_profiles SET allergies = ?, dietary_tags = ?, avoid_ingredients = ?, preference_text = ?, updated_at = ?
         WHERE user_id = ?`, [toJson(allergies === undefined ? parseJson<string[]>(profileRow.allergies, []) : arr(allergies)),
        toJson(dietary_tags === undefined ? parseJson<string[]>(profileRow.dietary_tags, []) : arr(dietary_tags)),
        toJson(
          avoid_ingredients === undefined
            ? parseJson<string[]>(profileRow.avoid_ingredients, [])
            : arr(avoid_ingredients)
        ),
        typeof preference_text === 'string' ? preference_text : profileRow.preference_text,
        ts,
        req.userId!]);
    } else {
      await db.run(`INSERT INTO user_profiles (profile_id, user_id, allergies, dietary_tags, avoid_ingredients, preference_text, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [newId('prf'),
        req.userId!,
        toJson(arr(allergies)),
        toJson(arr(dietary_tags)),
        toJson(arr(avoid_ingredients)),
        typeof preference_text === 'string' ? preference_text : '',
        ts]);
    }
  }

  res.json({
    user: publicUser(await db.get('SELECT * FROM users WHERE user_id = ?', [req.userId!])),
    profile: publicProfile(await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [req.userId!])),
  });
});
