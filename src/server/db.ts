import fs from 'fs';
import path from 'path';
import { createClient, type Client, type InValue } from '@libsql/client';
import { env, flags } from './env';

/**
 * 계획서 11장 데이터베이스 설계.
 *
 * 배포 환경(Cloud Run)은 컨테이너가 재시작되면 로컬 파일이 사라지므로,
 * 운영에서는 Turso(호스팅 SQLite)를 쓰고 개발에서는 같은 클라이언트로 로컬 파일을 쓴다.
 * SQL 방언이 동일해 코드는 한 벌만 유지된다.
 *
 * libSQL 클라이언트는 비동기이므로 모든 조회는 await 가 필요하다.
 */

const createDbClient = (): Client => {
  if (flags.hasTurso) {
    console.log('[db] Turso(원격 DB)에 연결합니다.');
    return createClient({ url: env.tursoUrl, authToken: env.tursoAuthToken });
  }
  // 로컬 개발: 파일 기반. Turso 자격증명이 없어도 그대로 동작한다.
  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  console.log(`[db] 로컬 파일 DB 를 사용합니다: ${env.dbPath}`);
  return createClient({ url: `file:${env.dbPath}` });
};

const client = createDbClient();

/** undefined 는 libSQL 이 받지 못하므로 null 로 바꾼다. */
const toArgs = (params: unknown[] = []): InValue[] =>
  params.map((p) => (p === undefined ? null : (p as InValue)));

/**
 * 얇은 질의 헬퍼.
 * better-sqlite3 의 prepare().get()/all()/run() 을 대체한다.
 */
export const db = {
  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await client.execute({ sql, args: toArgs(params) });
    return result.rows[0] as T | undefined;
  },

  async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await client.execute({ sql, args: toArgs(params) });
    return result.rows as unknown as T[];
  },

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = await client.execute({ sql, args: toArgs(params) });
    return { changes: Number(result.rowsAffected ?? 0) };
  },

  /** 여러 문장을 한 번에 실행 (스키마 생성용) */
  async exec(sql: string): Promise<void> {
    await client.executeMultiple(sql);
  },

  /** 하나라도 실패하면 전부 되돌린다. */
  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (statements.length === 0) return;
    await client.batch(
      statements.map((s) => ({ sql: s.sql, args: toArgs(s.params) })),
      'write'
    );
  },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  nationality TEXT,
  language TEXT,
  destination_country TEXT,
  profile_image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_profiles (
  profile_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  allergies TEXT NOT NULL DEFAULT '[]',
  dietary_tags TEXT NOT NULL DEFAULT '[]',
  avoid_ingredients TEXT NOT NULL DEFAULT '[]',
  preference_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companions (
  companion_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  allergies TEXT NOT NULL DEFAULT '[]',
  dietary_tags TEXT NOT NULL DEFAULT '[]',
  avoid_ingredients TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companions_user ON companions(user_id);

CREATE TABLE IF NOT EXISTS restaurants (
  restaurant_id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  latitude REAL,
  longitude REAL,
  country TEXT,
  region TEXT,
  category TEXT,
  rating REAL,
  review_count INTEGER,
  photo_url TEXT,
  business_status TEXT,
  last_synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_restaurants_geo ON restaurants(latitude, longitude);

CREATE TABLE IF NOT EXISTS saved_restaurants (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS standard_foods (
  standard_food_id TEXT PRIMARY KEY,
  standard_name_en TEXT NOT NULL,
  name_ko TEXT,
  local_names TEXT NOT NULL DEFAULT '[]',
  aliases TEXT NOT NULL DEFAULT '[]',
  country TEXT,
  category TEXT,
  typical_description TEXT,
  typical_ingredients TEXT NOT NULL DEFAULT '[]',
  typical_allergens TEXT NOT NULL DEFAULT '[]',
  dietary_tags TEXT NOT NULL DEFAULT '[]',
  serving_weight_min_g INTEGER,
  serving_weight_max_g INTEGER,
  updated_at TEXT NOT NULL
);

/* 메뉴명 -> 표준 음식 매핑용 별칭 테이블 (계획서 7.2) */
CREATE TABLE IF NOT EXISTS food_aliases (
  alias_key TEXT PRIMARY KEY,
  standard_food_id TEXT NOT NULL REFERENCES standard_foods(standard_food_id) ON DELETE CASCADE,
  raw_alias TEXT NOT NULL,
  lang TEXT
);

CREATE TABLE IF NOT EXISTS restaurant_menus (
  menu_id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
  standard_food_id TEXT,
  original_name TEXT NOT NULL,
  translated_name TEXT,
  price REAL,
  currency TEXT,
  image_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  last_verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menus_restaurant ON restaurant_menus(restaurant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menus_unique ON restaurant_menus(restaurant_id, original_name, version);

CREATE TABLE IF NOT EXISTS menu_analysis (
  analysis_id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL REFERENCES restaurant_menus(menu_id) ON DELETE CASCADE,
  lang TEXT NOT NULL DEFAULT 'ko',
  description TEXT,
  taste_description TEXT,
  ingredients TEXT NOT NULL DEFAULT '[]',
  allergen_tags TEXT NOT NULL DEFAULT '[]',
  dietary_tags TEXT NOT NULL DEFAULT '[]',
  avoid_risk_tags TEXT NOT NULL DEFAULT '[]',
  calorie_min INTEGER,
  calorie_max INTEGER,
  calorie_basis TEXT,
  source_type TEXT,
  source_summary TEXT NOT NULL DEFAULT '[]',
  confidence_score REAL,
  payload TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_menu ON menu_analysis(menu_id, lang);

CREATE TABLE IF NOT EXISTS nutrition_references (
  nutrition_reference_id TEXT PRIMARY KEY,
  standard_food_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_item_id TEXT,
  reference_amount_g REAL,
  energy_kcal REAL,
  carbohydrate_g REAL,
  protein_g REAL,
  fat_g REAL,
  sodium_mg REAL,
  raw_payload TEXT,
  source_updated_at TEXT,
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nutrition_food ON nutrition_references(standard_food_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_unique
  ON nutrition_references(standard_food_id, source_name, source_item_id);

/*
 * 공통 음식 분석 캐시 (계획서 12.1 3단계).
 * 식당과 무관하게 "이 음식은 어떤 요리인가"를 저장해 두고 재사용한다.
 * 사용자별 판정(안전/주의)은 저장하지 않고 조회 시점에 다시 계산한다.
 */
CREATE TABLE IF NOT EXISTS standard_food_analysis (
  standard_food_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  payload TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (standard_food_id, lang)
);

/*
 * 로그인 사용자의 마지막 분석 결과.
 *
 * 분석 결과 카드는 그동안 브라우저에만 남아서, 다른 기기나 다른 브라우저로
 * 열면 사라졌다. 로그인한 사용자는 이어서 볼 수 있도록 서버에 한 벌 남긴다.
 * 안전/주의 판정은 여기 저장하지 않고 꺼내 볼 때마다 다시 계산한다
 * (프로필이 바뀌면 경고도 달라져야 하므로).
 */
CREATE TABLE IF NOT EXISTS user_last_analysis (
  user_id TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  payload TEXT NOT NULL,
  saved_at TEXT NOT NULL
);

/*
 * 메뉴별 분석 캐시 (계획서 12.1 3단계).
 *
 * standard_food_analysis 는 표준 음식 하나에 칸이 하나뿐이라, 같은 분류로 묶이는
 * 다른 메뉴들이 서로를 덮어썼다. 메뉴 이름을 열쇠에 더해 칸을 나눈 것이 이 표다.
 */
CREATE TABLE IF NOT EXISTS dish_analysis (
  standard_food_id TEXT NOT NULL,
  dish_key TEXT NOT NULL,
  lang TEXT NOT NULL,
  payload TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (standard_food_id, dish_key, lang)
);
CREATE INDEX IF NOT EXISTS idx_dish_analysis_food ON dish_analysis(standard_food_id, lang);

/* 공개 데이터 원본 응답 캐시 (계획서 7.1) */
CREATE TABLE IF NOT EXISTS public_data_cache (
  cache_key TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_evidence (
  evidence_id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_record_id TEXT,
  extracted_value TEXT,
  confidence REAL,
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_menu ON source_evidence(menu_id);

CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL,
  user_id TEXT,
  report_type TEXT NOT NULL,
  report_text TEXT NOT NULL,
  evidence_url TEXT,
  visit_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_menu ON reports(menu_id, status);

CREATE TABLE IF NOT EXISTS search_logs (
  log_id TEXT PRIMARY KEY,
  user_id TEXT,
  restaurant_id TEXT,
  menu_id TEXT,
  query_text TEXT,
  result_source TEXT,
  gemini_called INTEGER NOT NULL DEFAULT 0,
  searched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_logs_time ON search_logs(searched_at);
`;

/* ------------------------------------------------------------------ */
/* 스키마 생성 및 마이그레이션                                          */
/* ------------------------------------------------------------------ */

/**
 * 이미 만들어진 DB 에 컬럼을 안전하게 추가한다.
 * (SQLite 는 ADD COLUMN IF NOT EXISTS 를 지원하지 않으므로 직접 확인한다.)
 */
const addColumnIfMissing = async (table: string, column: string, definition: string): Promise<void> => {
  const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] migrated: ${table}.${column} 추가`);
};

let initialized: Promise<void> | null = null;

/** 서버 기동 시 한 번 호출한다. 여러 번 불러도 안전하다. */
export const initDb = async (): Promise<void> => {
  if (initialized) return initialized;

  initialized = (async () => {
    await db.exec(SCHEMA);

    // 소셜 로그인 지원 (구글 로그인)
    await addColumnIfMissing('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'email'");
    await addColumnIfMissing('users', 'google_sub', 'TEXT');
    await db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL'
    );

    // 지도 데이터를 어떤 표시 언어로 받아왔는지 기록 (언어가 바뀌면 다시 조회)
    await addColumnIfMissing('restaurants', 'language_code', 'TEXT');

    // 사용자가 현장에서 확인한 알레르기 정보
    await addColumnIfMissing('reports', 'reported_allergens', "TEXT NOT NULL DEFAULT '[]'");
    await addColumnIfMissing('reports', 'absent_allergens', "TEXT NOT NULL DEFAULT '[]'");
  })();

  return initialized;
};

/* ------------------------------------------------------------------ */
/* 헬퍼                                                                */
/* ------------------------------------------------------------------ */

export const nowIso = (): string => new Date().toISOString();

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const toJson = (value: unknown): string => JSON.stringify(value ?? []);

/** ISO 날짜가 days 일보다 오래되었는지 */
export const isStale = (iso: string | null | undefined, days: number): boolean => {
  if (!iso) return true;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > days * 24 * 60 * 60 * 1000;
};

export const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
};

/** 검색 로그 기록 (계획서 11.11 / 12.3) — 실패해도 요청을 막지 않는다. */
export const logSearch = (row: {
  user_id?: string | null;
  restaurant_id?: string | null;
  menu_id?: string | null;
  query_text?: string | null;
  result_source: string;
  gemini_called: boolean;
}): void => {
  db.run(
    `INSERT INTO search_logs (log_id, user_id, restaurant_id, menu_id, query_text, result_source, gemini_called, searched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('log'),
      row.user_id ?? null,
      row.restaurant_id ?? null,
      row.menu_id ?? null,
      row.query_text ?? null,
      row.result_source,
      row.gemini_called ? 1 : 0,
      nowIso(),
    ]
  ).catch((e) => console.warn('[db] failed to write search log', e));
};
