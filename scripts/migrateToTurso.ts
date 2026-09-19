import { createClient } from '@libsql/client';
import { env, flags } from '../src/server/env';

/**
 * 로컬 파일 DB 의 내용을 Turso 로 옮긴다.
 *
 *   npx tsx scripts/migrateToTurso.ts
 *
 * - 스키마는 서버가 기동할 때 만들어지므로 여기서는 데이터만 복사한다.
 * - 여러 번 실행해도 같은 결과가 되도록 INSERT OR REPLACE 를 쓴다.
 * - 기존 Turso 데이터를 지우지 않는다. 로컬에 있는 행만 덮어쓴다.
 */

/** 복사할 테이블. 참조 순서를 지켜야 외래키 제약에 걸리지 않는다. */
const TABLES = [
  'users',
  'user_profiles',
  'companions',
  'restaurants',
  'saved_restaurants',
  'standard_foods',
  'food_aliases',
  'standard_food_analysis',
  'restaurant_menus',
  'menu_analysis',
  'nutrition_references',
  'public_data_cache',
  'source_evidence',
  'reports',
  'search_logs',
];

const main = async () => {
  if (!flags.hasTurso) {
    console.error('TURSO_DATABASE_URL 이 설정되어 있지 않습니다. .env.local 을 확인하세요.');
    process.exit(1);
  }

  const local = createClient({ url: `file:${env.dbPath}` });
  const remote = createClient({ url: env.tursoUrl, authToken: env.tursoAuthToken });

  console.log(`로컬 : ${env.dbPath}`);
  console.log(`원격 : ${env.tursoUrl}\n`);

  let totalRows = 0;

  for (const table of TABLES) {
    // 로컬에 없는 테이블은 건너뛴다.
    const exists = await local.execute({
      sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
      args: [table],
    });
    if (exists.rows.length === 0) {
      console.log(`  ${table.padEnd(24)} 로컬에 없음 — 건너뜀`);
      continue;
    }

    const result = await local.execute(`SELECT * FROM ${table}`);
    if (result.rows.length === 0) {
      console.log(`  ${table.padEnd(24)} 0건`);
      continue;
    }

    const columns = result.columns;
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    // 한 번에 너무 많이 보내면 요청이 커지므로 나눠서 전송한다.
    const CHUNK = 200;
    for (let i = 0; i < result.rows.length; i += CHUNK) {
      const chunk = result.rows.slice(i, i + CHUNK);
      await remote.batch(
        chunk.map((row) => ({
          sql,
          args: columns.map((c) => (row as any)[c] ?? null),
        })),
        'write'
      );
    }

    totalRows += result.rows.length;
    console.log(`  ${table.padEnd(24)} ${result.rows.length}건 복사`);
  }

  console.log(`\n총 ${totalRows}건을 Turso 로 옮겼습니다.`);

  // 옮긴 결과 확인
  console.log('\n=== Turso 확인 ===');
  for (const table of ['standard_foods', 'food_aliases', 'nutrition_references', 'restaurants', 'restaurant_menus']) {
    const r = await remote.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    console.log(`  ${table.padEnd(24)} ${(r.rows[0] as any).n}건`);
  }
};

main().catch((e) => {
  console.error('이전 실패:', e.message);
  process.exit(1);
});
