import { db } from '../src/server/db';
import { photoProxyUrl } from '../src/server/services/places';

/**
 * 이미 저장된 사진 주소에서 API 키를 걷어낸다.
 *
 *   npx tsx scripts/cleanPhotoUrls.ts          # 바뀔 내용만 보여준다
 *   npx tsx scripts/cleanPhotoUrls.ts --write   # 실제로 반영한다
 *
 * 예전에는 구글 사진 주소를 키까지 붙인 채로 저장했다. 그 주소가 브라우저로
 * 내려가면 키가 노출되므로, 우리 서버를 거치는 주소로 바꾼다.
 */
const PHOTO_NAME = /\/v1\/(places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+)\/media/;

const main = async () => {
  const write = process.argv.includes('--write');
  const rows = await db.all<any>(
    `SELECT restaurant_id, name, photo_url FROM restaurants WHERE photo_url IS NOT NULL`
  );

  const changes: { id: string; name: string; to: string }[] = [];
  let alreadySafe = 0;

  for (const row of rows) {
    if (!row.photo_url.includes('key=')) {
      alreadySafe += 1;
      continue;
    }
    const match = PHOTO_NAME.exec(row.photo_url);
    if (!match) {
      console.warn(`  ! 형식을 알 수 없어 건너뜀: ${row.name}`);
      continue;
    }
    changes.push({ id: row.restaurant_id, name: row.name, to: photoProxyUrl(match[1]) });
  }

  console.log(`사진이 있는 식당 ${rows.length}건 중 키가 박힌 것 ${changes.length}건 (이미 안전 ${alreadySafe}건)\n`);
  for (const c of changes.slice(0, 5)) console.log(`  ${c.name}\n    => ${c.to}`);
  if (changes.length > 5) console.log(`  ... 외 ${changes.length - 5}건`);

  if (!write) {
    console.log('\n확인용 실행입니다. 반영하려면 --write 를 붙여 주세요.');
    return;
  }
  for (const c of changes) {
    await db.run('UPDATE restaurants SET photo_url = ? WHERE restaurant_id = ?', [c.to, c.id]);
  }
  console.log(`\n${changes.length}건을 반영했습니다.`);
};

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
