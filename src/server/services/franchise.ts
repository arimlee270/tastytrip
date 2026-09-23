import { db } from '../db';
import type { Restaurant } from '../../types';

/**
 * 같은 프랜차이즈의 다른 지점에서 등록된 메뉴를 찾아 준다.
 *
 * 프랜차이즈는 지점이 많고 메뉴가 대부분 같다. 한 곳에서 누군가 메뉴판을
 * 등록하면 나머지 지점 방문자도 그 정보를 참고할 수 있다.
 *
 * 다만 자동으로 그 지점의 메뉴로 등록하지는 않는다. 지점마다 안 파는 메뉴가
 * 있고, 없는 메뉴를 있는 것처럼 보여주면 손님이 그것을 주문한다.
 * 그래서 '다른 지점에서 확인된 메뉴' 로만 보여주고, 현장에서 확인한 사람이
 * 버튼을 눌러야 이 지점의 메뉴가 된다.
 */

/**
 * 가게 이름에서 브랜드를 뽑는다. 프랜차이즈가 아니면 null.
 *
 * 첫 낱말만 보면 'The Lookout' 과 'The Deck' 이 같은 브랜드로 묶이고,
 * '통집' 과 '통나무집' 도 엮인다. 그래서 지점 표기(~점)가 실제로 붙어 있는
 * 이름만 프랜차이즈로 보고, 그 앞부분 전체를 브랜드로 삼는다.
 *
 *   'BBQ치킨 광주교대점'      → 'BBQ치킨'
 *   '롯데리아 군산나운점'      → '롯데리아'
 *   '고궁 비빔밥 종로점'       → '고궁 비빔밥'   ('고궁 전주본점' 과 섞이지 않는다)
 *   'The Lookout'            → null           (지점 표기가 없다)
 */
export const brandOf = (name: string): string | null => {
  if (!name) return null;
  const trimmed = name.trim();

  const ok = (brand: string): string | null => {
    const b = brand.trim();
    // 한 글자 브랜드는 우연히 맞을 여지가 커서 제외한다.
    return b.length >= 2 ? b : null;
  };

  /*
   * 지점 표기는 두 가지 모양으로 온다.
   *   'BBQ치킨 광주상무점'      괄호 없이
   *   'BBQ치킨 (광주상무점)'    괄호 안에
   * 괄호 안이 '~점' 으로 끝나면 그게 지점명이므로 앞부분이 브랜드다.
   */
  const paren = trimmed.match(/^(.+?)\s*[(（]([^)）]*)[)）]\s*$/);
  if (paren && /점$/.test(paren[2].trim())) return ok(paren[1]);

  // 'BBQ치킨 광주문흥점 (BSK)' 처럼 지점명 뒤에 붙은 설명은 떼어낸다.
  const cleaned = paren ? paren[1].trim() : trimmed;

  // 마지막 낱말이 '~점' 으로 끝나야 지점으로 본다 (종로점, 전주덕진DT점, 본점 ...).
  const match = cleaned.match(/^(.+?)\s+\S*점$/);
  return match ? ok(match[1]) : null;
};

export interface SuggestedMenu {
  /** 다른 지점에 등록된 메뉴 이름 (원문) */
  original_name: string;
  translated_name: string | null;
  image_url: string | null;
  /** 이 메뉴가 확인된 지점 이름 */
  from_branch: string;
  /** 같은 메뉴를 등록한 지점 수. 많을수록 그 브랜드의 공통 메뉴일 가능성이 높다. */
  branch_count: number;
}

/**
 * 이 식당과 같은 브랜드인 다른 지점들의 메뉴를 모은다.
 * 이미 이 지점에 등록된 메뉴는 뺀다.
 */
export const suggestMenusFromBranches = async (
  restaurant: Restaurant,
  limit = 12
): Promise<{ brand: string | null; menus: SuggestedMenu[] }> => {
  const brand = brandOf(restaurant.name);
  if (!brand) return { brand: null, menus: [] };

  // 같은 브랜드의 다른 지점을 찾는다. 브랜드로 시작하고 지점 표기가 붙은 이름만.
  const siblings = (await db.all(
    `SELECT restaurant_id, name FROM restaurants
       WHERE restaurant_id != ? AND name LIKE ?`,
    [restaurant.restaurant_id, `${brand} %`]
  )) as { restaurant_id: string; name: string }[];

  const sameBrand = siblings.filter((s) => brandOf(s.name) === brand);
  if (sameBrand.length === 0) return { brand, menus: [] };

  // 이 지점에 이미 등록된 메뉴는 제안하지 않는다.
  const own = (await db.all(
    "SELECT original_name FROM restaurant_menus WHERE restaurant_id = ? AND status = 'active'",
    [restaurant.restaurant_id]
  )) as { original_name: string }[];
  const ownNames = new Set(own.map((o) => o.original_name.trim().toLowerCase()));

  const ids = sameBrand.map((s) => s.restaurant_id);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = (await db.all(
    `SELECT m.original_name, m.translated_name, m.image_url, r.name AS branch
       FROM restaurant_menus m
       JOIN restaurants r ON r.restaurant_id = m.restaurant_id
      WHERE m.restaurant_id IN (${placeholders}) AND m.status = 'active'`,
    ids
  )) as { original_name: string; translated_name: string | null; image_url: string | null; branch: string }[];

  // 같은 메뉴가 여러 지점에 있으면 한 번만 보여주되, 몇 곳에서 확인됐는지 센다.
  const grouped = new Map<string, SuggestedMenu>();
  for (const row of rows) {
    const key = row.original_name.trim().toLowerCase();
    if (!key || ownNames.has(key)) continue;

    const found = grouped.get(key);
    if (found) {
      found.branch_count += 1;
      // 번역명이나 사진이 비어 있으면 있는 쪽으로 채운다.
      found.translated_name = found.translated_name || row.translated_name;
      found.image_url = found.image_url || row.image_url;
      continue;
    }
    grouped.set(key, {
      original_name: row.original_name,
      translated_name: row.translated_name,
      image_url: row.image_url,
      from_branch: row.branch,
      branch_count: 1,
    });
  }

  const menus = [...grouped.values()]
    // 여러 지점에서 확인된 메뉴를 먼저 보여준다.
    .sort((a, b) => b.branch_count - a.branch_count)
    .slice(0, limit);

  return { brand, menus };
};
