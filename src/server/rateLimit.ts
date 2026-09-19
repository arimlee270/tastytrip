import type { NextFunction, Request, Response } from 'express';
import { env } from './env';

/**
 * 아주 단순한 요청 제한 (계획서 19장 'API 비용 증가' 대응).
 *
 * 메뉴 분석은 한 번 부를 때마다 Gemini 요금이 나간다. 로그인 없이 쓸 수 있는
 * 기능이라, 제한이 없으면 누구든 반복 호출해서 요금을 태울 수 있다.
 *
 * 메모리에만 기록하므로 서버를 여러 대로 늘리면 대당으로 세어진다.
 * 지금 규모에서는 충분하고, 나중에 필요하면 Redis 같은 공용 저장소로 옮긴다.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

/** 오래된 기록을 치워 메모리가 계속 늘지 않게 한다. */
const sweep = (now: number): void => {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

const clientKey = (req: Request): string => {
  // 로그인한 사용자는 계정 기준으로, 아니면 IP 기준으로 센다.
  const userId = (req as any).userId;
  if (userId) return `u:${userId}`;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return `ip:${forwarded || req.ip || 'unknown'}`;
};

/**
 * 분당 허용 횟수를 넘으면 429 를 돌려준다.
 * @param limit 분당 허용 횟수. 생략하면 RATE_LIMIT_PER_MINUTE 설정을 따른다.
 */
export const rateLimit = (limit?: number) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const max = limit ?? env.rateLimitPerMinute;
    if (max <= 0) {
      next();
      return;
    }

    const now = Date.now();
    sweep(now);

    const key = `${req.baseUrl}${req.path}|${clientKey(req)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      next();
      return;
    }

    if (bucket.count >= max) {
      const waitSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(waitSec));
      res.status(429).json({
        error: `요청이 너무 잦습니다. ${waitSec}초 후에 다시 시도해 주세요.`,
      });
      return;
    }

    bucket.count += 1;
    next();
  };
};

/**
 * 관리자 전용 엔드포인트 보호.
 *
 * 공개 데이터 동기화는 한 번 부를 때마다 식약처와 USDA 를 수백 번 호출한다.
 * ADMIN_TOKEN 을 설정하지 않으면 운영 환경에서는 아예 막고,
 * 개발 환경에서만 통과시킨다.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!env.adminToken) {
    if (env.nodeEnv !== 'production') {
      next();
      return;
    }
    res.status(503).json({ error: '관리자 기능이 설정되어 있지 않습니다.' });
    return;
  }

  const header = String(req.headers.authorization || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-admin-token'] || '');
  if (provided !== env.adminToken) {
    res.status(401).json({ error: '관리자 권한이 필요합니다.' });
    return;
  }
  next();
};
