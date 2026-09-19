import crypto from 'crypto';
import { env, flags } from '../env';

/**
 * 구글 로그인(Google Identity Services)에서 브라우저가 받은 ID 토큰을 서버에서 검증한다.
 *
 * 검증 방식: 구글 공개키(JWKS)로 서명을 직접 확인한다.
 * - 네트워크 왕복이 캐시로 줄어들고, 토큰이 외부로 다시 나가지 않는다.
 * - client secret 은 사용하지 않는다(브라우저 ID 토큰 흐름).
 */

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface Jwk {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1시간

const fetchJwks = async (forceRefresh = false): Promise<Jwk[]> => {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error(`구글 공개키를 가져오지 못했습니다. (${response.status})`);
  const data = (await response.json()) as { keys: Jwk[] };
  jwksCache = { keys: data.keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
};

const b64urlToBuffer = (input: string): Buffer =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const decodeSegment = (segment: string): any => JSON.parse(b64urlToBuffer(segment).toString('utf8'));

/** JWK(모듈러스/지수)를 검증에 쓸 수 있는 공개키 객체로 변환 */
const jwkToPublicKey = (jwk: Jwk): crypto.KeyObject =>
  crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e } as any, format: 'jwk' });

/**
 * ID 토큰을 검증하고 사용자 정보를 돌려준다.
 * 서명 / 발급자 / 대상(aud) / 만료 시각을 모두 확인한다.
 */
export const verifyGoogleIdToken = async (credential: string): Promise<GoogleIdentity> => {
  if (!flags.hasGoogleLogin) {
    throw new Error('구글 로그인이 설정되지 않았습니다. GOOGLE_OAUTH_CLIENT_ID 를 확인해주세요.');
  }

  const parts = (credential || '').split('.');
  if (parts.length !== 3) throw new Error('구글 토큰 형식이 올바르지 않습니다.');

  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);

  if (header.alg !== 'RS256') throw new Error('지원하지 않는 서명 알고리즘입니다.');

  // 1) 서명 검증 (키가 교체된 직후일 수 있으므로 실패 시 한 번 갱신해 재시도)
  const verifyWith = async (forceRefresh: boolean): Promise<boolean> => {
    const keys = await fetchJwks(forceRefresh);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      jwkToPublicKey(jwk),
      b64urlToBuffer(parts[2])
    );
  };

  const verified = (await verifyWith(false)) || (await verifyWith(true));
  if (!verified) throw new Error('구글 토큰 서명 검증에 실패했습니다.');

  // 2) 클레임 검증
  if (!VALID_ISSUERS.includes(payload.iss)) {
    throw new Error('구글 토큰 발급자가 올바르지 않습니다.');
  }
  if (payload.aud !== env.googleOAuthClientId) {
    throw new Error('이 앱을 대상으로 발급된 토큰이 아닙니다.');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw new Error('만료된 구글 토큰입니다. 다시 로그인해주세요.');
  }
  if (!payload.email) {
    throw new Error('구글 계정에서 이메일을 가져오지 못했습니다.');
  }

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    // 구글은 boolean 또는 문자열 'true' 로 내려줄 수 있다.
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name,
    picture: payload.picture,
  };
};
