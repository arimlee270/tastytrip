/**
 * 시연 전에 메뉴 분석을 미리 받아 두는 스크립트.
 *
 * 처음 보는 메뉴는 AI 에게 물어봐야 하고, 메뉴 12개면 그 한 번에 30초 안팎
 * 걸린다. 발표 시간이 1~2분이면 그 30초를 화면 앞에서 쓸 수가 없다.
 *
 * 한 번 분석한 메뉴는 공통 음식 캐시(dish_analysis)에 남아, 다음부터는 AI 를
 * 부르지 않고 DB 에서 바로 꺼내 온다. 그래서 시연에 쓸 메뉴 이름을 미리 여기로
 * 한 번 통과시켜 두면, 발표장에서는 사진에서 이름을 읽는 시간만 든다.
 *
 * 쓰는 법 (메뉴 이름을 쉼표로):
 *   npx tsx --env-file=.env.local scripts/warmCache.ts "寿司盛り合わせ, ラーメン, 天ぷら定食"
 *
 * 여행 국가와 표시 언어를 바꿀 때:
 *   WARM_COUNTRY=일본 WARM_LANG=ko npx tsx --env-file=.env.local scripts/warmCache.ts "..."
 *
 * 주의: 캐시에는 '사실 정보'(설명·재료·칼로리)만 담긴다. 알레르기·식단 판정은
 * 조회하는 사람의 프로필로 그때그때 다시 계산하므로, 여기서 어떤 프로필을
 * 쓰더라도 시연 때 보이는 안전 판정은 시연자의 프로필 기준으로 나온다.
 */
import { runFreeAnalysis } from '../src/server/services/menuPipeline';
import type { Member, PartyFilter } from '../src/types';

const names = (process.argv[2] || '')
  .split(/[,、\n]/)
  .map((s) => s.trim())
  .filter(Boolean);

if (names.length === 0) {
  console.error('분석할 메뉴 이름을 쉼표로 구분해 넘겨주세요.');
  console.error('예: npx tsx --env-file=.env.local scripts/warmCache.ts "ラーメン, 天ぷら定食"');
  process.exit(1);
}

/*
 * 아무 제한도 없는 프로필로 돌린다. 캐시에 남는 것은 사실 정보뿐이므로
 * 프로필이 결과에 섞이지 않고, 쓸데없이 경고를 만들 이유도 없다.
 */
const members: Member[] = [{ id: 'warm', name: '준비', allergies: [], diets: [], notes: '' }];

const filter: PartyFilter = {
  allergies: [],
  dietary_tags: [],
  avoid_ingredients: [],
  notes: [],
  memberCount: 1,
  members,
};

const main = async () => {
  console.log(`메뉴 ${names.length}개를 미리 분석합니다: ${names.join(', ')}`);

  /*
   * 한 번에 다 넣지 않고 6개씩 나눠 돌린다. 파이프라인도 6개씩 나눠 묻지만,
   * 여기서 나눠 두면 중간에 실패해도 앞의 묶음은 이미 저장돼 남는다.
   */
  const CHUNK = 6;
  let done = 0;
  const t0 = Date.now();

  for (let i = 0; i < names.length; i += CHUNK) {
    const part = names.slice(i, i + CHUNK);
    const t = Date.now();
    try {
      const res = await runFreeAnalysis({
        menuText: part.join(', '),
        travelCountry: process.env.WARM_COUNTRY || '일본',
        homeCountry: '한국',
        party: members,
        filter,
        targetLanguage: process.env.WARM_LANG || 'ko',
      });
      done += res.dishes.length;
      const how = res.meta?.gemini_called ? 'AI 분석' : '이미 저장돼 있음';
      console.log(
        `  ${part.join(', ')} → ${res.dishes.length}개 (${how}, ${((Date.now() - t) / 1000).toFixed(1)}초)`
      );
    } catch (e) {
      console.error(`  ${part.join(', ')} → 실패: ${(e as Error).message}`);
    }
  }

  console.log(`\n${done}개 준비 완료 (${((Date.now() - t0) / 1000).toFixed(1)}초).`);
  console.log('이제 같은 메뉴는 AI 를 부르지 않고 DB 에서 바로 나옵니다.');
  console.log('확인하려면 같은 명령을 한 번 더 돌려 보세요. "이미 저장돼 있음" 으로 나와야 맞습니다.');
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
