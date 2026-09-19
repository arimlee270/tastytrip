import { db } from '../src/server/db';
import { pickDisplayName } from '../src/server/services/displayName';

/**
 * 이미 저장된 식당 이름 가운데 여러 언어가 섞인 것을 표시 언어에 맞게 정리한다.
 *
 *   npx tsx scripts/cleanRestaurantNames.ts          # 무엇이 바뀌는지만 보여준다
 *   npx tsx scripts/cleanRestaurantNames.ts --write   # 실제로 반영한다
 *
 * 한 가지 문자 체계로만 된 이름은 건드리지 않으므로 여러 번 실행해도 안전하다.
 */
const main = async () => {
  const write = process.argv.includes('--write');
  const rows = await db.all<any>('SELECT restaurant_id, name, language_code FROM restaurants');

  const changes: { id: string; from: string; to: string; lang: string }[] = [];
  for (const row of rows) {
    const next = pickDisplayName(row.name, row.language_code);
    if (next && next !== row.name) {
      changes.push({ id: row.restaurant_id, from: row.name, to: next, lang: row.language_code || '-' });
    }
  }

  console.log(`전체 ${rows.length}건 가운데 ${changes.length}건이 대상입니다.\n`);
  for (const c of changes) console.log(`  [${c.lang}] ${c.from}\n         => ${c.to}`);

  if (!write) {
    console.log('\n확인용 실행입니다. 반영하려면 --write 를 붙여 주세요.');
    return;
  }
  for (const c of changes) {
    await db.run('UPDATE restaurants SET name = ? WHERE restaurant_id = ?', [c.to, c.id]);
  }
  console.log(`\n${changes.length}건을 반영했습니다.`);
};

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
