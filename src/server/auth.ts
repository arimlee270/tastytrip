import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env';
import { db } from './db';

/**
 * 외부 인증 SDK 없이 이메일/비밀번호 + JWT(HS256) 로 구현.
 * 계획서 3.1 의 Firebase/Supabase 로 교체하더라도 이 파일의 인터페이스
 * (requireAuth / optionalAuth / req.userId) 만 맞추면 나머지 코드는 그대로 쓸 수 있다.
 */

/* ---------------------------- 비밀번호 ---------------------------- */

const SCRYPT_KEYLEN = 64;

export const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [scheme, salt, expected] = (stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/* ------------------------------ JWT ------------------------------ */

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const b64urlDecode = (input: string): Buffer =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (data: string): string =>
  b64url(crypto.createHmac('sha256', env.jwtSecret).update(data).digest());

export const createToken = (userId: string): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + env.jwtExpiresInDays * 24 * 60 * 60;
  const payload = b64url(JSON.stringify({ sub: userId, exp }));
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
};

export const verifyToken = (token: string): string | null => {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = sign(body);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
    if (!payload?.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return String(payload.sub);
  } catch {
    return null;
  }
};

/* --------------------------- 미들웨어 ---------------------------- */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
};

/** 로그인하지 않았어도 통과시키되, 토큰이 있으면 req.userId 를 채운다. (게스트 모드 지원) */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = extractToken(req);
  if (token) {
    const userId = verifyToken(token);
    if (userId) req.userId = userId;
  }
  next();
};

/** 로그인 필수 라우트용. */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = extractToken(req);
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: '로그인이 필요합니다. / Authentication required.' });
    return;
  }
  const exists = await db.get('SELECT 1 FROM users WHERE user_id = ?', [userId]);
  if (!exists) {
    res.status(401).json({ error: '유효하지 않은 계정입니다. / Invalid account.' });
    return;
  }
  req.userId = userId;
  next();
};
