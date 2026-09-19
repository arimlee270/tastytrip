import { db, parseJson } from '../db';
import type { Member, MemberWarning, PartyFilter } from '../../types';

/**
 * 계획서 3.3 — 본인과 선택한 동반인의 조건을 합쳐 상한 조건을 계산한다.
 * (한 명이라도 못 먹으면 파티 전체 기준으로 제외)
 */
export const mergeParty = (members: Member[]): PartyFilter => {
  const allergies = new Set<string>();
  const dietary = new Set<string>();
  const avoid = new Set<string>();
  const notes: string[] = [];

  members.forEach((m) => {
    (m.allergies || []).forEach((a) => allergies.add(a));
    (m.diets || []).forEach((d) => dietary.add(d));
    (m as any).avoid_ingredients?.forEach?.((x: string) => avoid.add(x));
    if (m.notes && m.notes.trim()) {
      notes.push(`${m.name}: ${m.notes.trim()}`);
      // 자유 입력도 기피 재료 후보로 취급한다.
      m.notes
        .split(/[,、,·/]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => avoid.add(s));
    }
  });

  return {
    allergies: [...allergies],
    dietary_tags: [...dietary],
    avoid_ingredients: [...avoid],
    notes,
    memberCount: members.length,
    members,
  };
};

/** 로그인 사용자의 저장된 프로필 + 동반인으로 파티 조건을 만든다. */
export const partyFromAccount = async (
  userId: string
): Promise<{ members: Member[]; filter: PartyFilter }> => {
  const user: any = await db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
  const profile: any = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
  const companions: any[] = await db.all(
    'SELECT * FROM companions WHERE user_id = ? ORDER BY sort_order, created_at',
    [userId]
  );

  const members: Member[] = [
    {
      id: 'self',
      name: user?.nickname || '나',
      allergies: parseJson<string[]>(profile?.allergies, []),
      diets: parseJson<string[]>(profile?.dietary_tags, []),
      notes: profile?.preference_text || '',
    },
    ...companions.map((c) => ({
      id: c.companion_id,
      name: c.nickname,
      allergies: parseJson<string[]>(c.allergies, []),
      diets: parseJson<string[]>(c.dietary_tags, []),
      notes: parseJson<string[]>(c.avoid_ingredients, []).join(', '),
    })),
  ];

  return { members, filter: mergeParty(members) };
};

/**
 * 요청 바디의 party(비로그인 게스트) 또는 로그인 계정 정보로 파티를 결정한다.
 * body.party 가 있으면 그것을 우선한다(사용자가 화면에서 바로 수정한 값이므로).
 */
export const resolveParty = async (
  body: any,
  userId?: string
): Promise<{ members: Member[]; filter: PartyFilter }> => {
  if (Array.isArray(body?.party) && body.party.length > 0) {
    const members = body.party as Member[];
    return { members, filter: mergeParty(members) };
  }
  if (userId) return partyFromAccount(userId);
  return { members: [], filter: mergeParty([]) };
};

/* ------------------------------------------------------------------ */
/* 알레르기/식단 키 ↔ 재료 매핑                                          */
/* ------------------------------------------------------------------ */

/**
 * UI 의 알레르기 키가 실제 재료명으로 어떻게 나타나는지. 교차 검증에 사용.
 * 메뉴판은 현지어로 쓰여 있고 AI 응답은 표시 언어로 오므로,
 * 여행 대상국 언어(영/한/일/중/태/베)를 함께 넣는다.
 */
export const ALLERGEN_KEYWORDS: Record<string, string[]> = {
  crustacean: [
    'shrimp', 'prawn', 'crab', 'lobster', 'crustacean', 'krill',
    '새우', '게', '랍스터', '갑각류', '꽃게', '대하', '건새우',
    'えび', '海老', 'カニ', '蟹', '虾', '蝦', 'กุ้ง', 'ปู', 'tôm', 'cua',
  ],
  nuts: [
    'almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'tree nut', 'macadamia', 'pecan',
    '아몬드', '캐슈', '호두', '피스타치오', '헤이즐넛', '견과', '잣',
    'アーモンド', 'ナッツ', '杏仁', '坚果', 'ถั่ว', 'hạt điều', 'hạnh nhân',
  ],
  dairy: [
    'milk', 'cheese', 'butter', 'cream', 'yogurt', 'dairy', 'ghee', 'condensed milk', 'evaporated milk',
    '우유', '치즈', '버터', '크림', '요거트', '유제품', '연유', '생크림',
    'ミルク', '牛乳', 'チーズ', 'バター', '牛奶', '奶酪', 'นม', 'เนย', 'sữa', 'phô mai',
  ],
  gluten: [
    'wheat', 'flour', 'bread', 'noodle', 'pasta', 'gluten', 'soy sauce', 'barley', 'panko', 'breadcrumb',
    '밀', '밀가루', '빵', '면', '글루텐', '보리', '빵가루', '국수', '만두피',
    '小麦', 'パン', '麺', '面', '面粉', 'แป้งสาลี', 'บะหมี่', 'bột mì', 'bánh mì',
  ],
  peanut: ['peanut', 'groundnut', 'peanut butter', '땅콩', '피넛', 'ピーナッツ', '落花生', '花生', 'ถั่วลิสง', 'đậu phộng', 'lạc'],
  peach: ['peach', '복숭아', '桃', 'ลูกพีช', 'đào'],
  soy: [
    'soy', 'soybean', 'tofu', 'miso', 'soy sauce', 'edamame', 'tempeh',
    '대두', '두부', '간장', '된장', '콩', '두유',
    '大豆', '豆腐', '味噌', '醤油', '酱油', 'เต้าหู้', 'ซีอิ๊ว', 'đậu nành', 'đậu hũ',
  ],
  egg: [
    'egg', 'mayonnaise', 'omelet', 'omelette', 'meringue', 'custard',
    '달걀', '계란', '마요네즈', '오믈렛', '난백', '난황',
    '卵', 'たまご', 'マヨネーズ', '鸡蛋', '蛋', 'ไข่', 'trứng',
  ],
  fish: [
    'fish', 'anchovy', 'fish sauce', 'tuna', 'salmon', 'bonito', 'dashi', 'katsuobushi',
    '생선', '멸치', '피시소스', '참치', '연어', '가쓰오', '다시', '액젓',
    '魚', '鰹', 'だし', '鱼', 'ปลา', 'น้ำปลา', 'cá', 'nước mắm',
  ],
  shellfish: [
    'clam', 'mussel', 'oyster', 'scallop', 'shellfish', 'oyster sauce', 'squid', 'octopus',
    '조개', '홍합', '굴', '가리비', '굴소스', '오징어', '문어',
    '貝', '牡蠣', '蛤', '牡蛎', 'หอย', 'ngao', 'hàu',
  ],
};

/** 식단 태그별 금지 재료 */
export const DIET_FORBIDDEN: Record<string, string[]> = {
  vegan: [
    'meat', 'pork', 'beef', 'chicken', 'lamb', 'duck', 'fish', 'shrimp', 'seafood',
    'egg', 'milk', 'cheese', 'butter', 'cream', 'yogurt', 'ghee',
    'fish sauce', 'oyster sauce', 'shrimp paste', 'honey', 'lard', 'gelatin', 'bonito', 'dashi', 'anchovy',
    '고기', '돼지', '소고기', '닭', '오리', '양고기', '생선', '새우', '해산물',
    '달걀', '계란', '우유', '치즈', '버터', '크림', '피시소스', '액젓', '굴소스', '꿀', '젤라틴', '라드',
    '肉', '豚', '牛', '鶏', '魚', '卵', '牛乳', 'バター', 'だし',
    '猪肉', '牛肉', '鸡肉', '鱼', '鸡蛋', '牛奶', '黄油',
    'หมู', 'เนื้อ', 'ไก่', 'ปลา', 'กุ้ง', 'ไข่', 'นม', 'น้ำปลา',
    'thịt', 'gà', 'cá', 'tôm', 'trứng', 'sữa', 'nước mắm',
  ],
  halal: [
    'pork', 'lard', 'bacon', 'ham', 'sausage', 'gelatin', 'blood',
    'alcohol', 'wine', 'beer', 'sake', 'mirin', 'rum', 'vodka', 'whiskey', 'liquor', 'cooking wine',
    '돼지', '베이컨', '햄', '삼겹', '순대', '젤라틴', '라드',
    '술', '와인', '맥주', '사케', '미림', '청주', '소주', '맛술',
    '豚', '豚肉', 'ベーコン', '酒', 'みりん', '料理酒',
    '猪肉', '培根', '火腿', '料酒', '黄酒',
    'หมู', 'เบคอน', 'เหล้า', 'ไวน์', 'เบียร์',
    'thịt lợn', 'thịt heo', 'rượu', 'bia',
  ],
  nopork: [
    'pork', 'bacon', 'ham', 'lard', 'sausage', 'pork belly', 'guanciale', 'pancetta', 'chashu',
    '돼지', '베이컨', '햄', '삼겹', '목살', '순대', '차슈',
    '豚', 'ベーコン', 'チャーシュー', '猪肉', '培根', '火腿',
    'หมู', 'thịt lợn', 'thịt heo',
  ],
  nobeef: [
    'beef', 'steak', 'brisket', 'veal', 'oxtail', 'beef broth',
    '소고기', '쇠고기', '우육', '차돌', '사골', '한우',
    '牛肉', '牛', 'เนื้อวัว', 'thịt bò',
  ],
  lacto: [
    'meat', 'pork', 'beef', 'chicken', 'duck', 'lamb', 'fish', 'shrimp', 'seafood',
    'fish sauce', 'oyster sauce', 'bonito', 'dashi', 'anchovy', 'lard', 'gelatin',
    '고기', '돼지', '소고기', '닭', '오리', '생선', '새우', '해산물', '액젓', '피시소스', '굴소스',
    '肉', '豚', '牛', '鶏', '魚', '猪肉', '牛肉', '鸡肉', '鱼',
    'หมู', 'เนื้อ', 'ไก่', 'ปลา', 'กุ้ง', 'thịt', 'gà', 'cá', 'tôm',
  ],
};

/** 할랄 여부가 도축 방식에 달린 육류 — 돼지가 아니어도 인증 없이는 확정할 수 없다. */
const HALAL_UNCERTAIN_MEATS = [
  'beef', 'chicken', 'lamb', 'mutton', 'goat', 'duck', 'meat', 'broth', 'stock',
  '소고기', '쇠고기', '닭', '양고기', '오리', '고기', '육수', '사골',
  '牛肉', '鶏', '肉', '鸡肉', 'เนื้อ', 'ไก่', 'thịt', 'gà',
];

const norm = (s: string) => s.toLowerCase().trim();

/** 재료 목록에서 파티 조건에 걸리는 항목을 찾아낸다. (계획서 8.4 교차 검증) */
export const crossCheck = (
  ingredients: string[],
  filter: PartyFilter
): { allergenHits: string[]; dietHits: string[]; avoidHits: string[] } => {
  const flat = ingredients.map(norm);
  const contains = (needle: string) => flat.some((ing) => ing.includes(norm(needle)));

  const allergenHits = filter.allergies.filter((key) =>
    (ALLERGEN_KEYWORDS[key] || [key]).some(contains)
  );
  const dietHits = filter.dietary_tags.filter((tag) => (DIET_FORBIDDEN[tag] || []).some(contains));
  const avoidHits = filter.avoid_ingredients.filter((item) => item.length > 1 && contains(item));

  return { allergenHits, dietHits, avoidHits };
};

/**
 * 재료 목록으로 비건·할랄 적합성을 직접 판정한다. (AI 응답을 그대로 믿지 않는다)
 *
 * 할랄은 돼지고기·술이 없다고 바로 '가능'이 되지 않는다.
 * 다른 육류가 들어가면 도축 방식(자비하)을 확인할 수 없으므로 '불확실'로 둔다.
 */
export const computeDietary = (
  ingredients: string[]
): { vegan: 'suitable' | 'not_suitable' | 'uncertain'; halal: 'suitable' | 'not_suitable' | 'uncertain' } => {
  // 재료를 모르면 판정하지 않는다.
  if (ingredients.length === 0) return { vegan: 'uncertain', halal: 'uncertain' };

  const flat = ingredients.map(norm);
  const contains = (needle: string) => flat.some((ing) => ing.includes(norm(needle)));

  const veganBlocked = DIET_FORBIDDEN.vegan.some(contains);
  const halalBlocked = DIET_FORBIDDEN.halal.some(contains);
  const hasUncertainMeat = HALAL_UNCERTAIN_MEATS.some(contains);

  return {
    vegan: veganBlocked ? 'not_suitable' : 'suitable',
    halal: halalBlocked ? 'not_suitable' : hasUncertainMeat ? 'uncertain' : 'suitable',
  };
};

/**
 * 어떤 문자열이 특정 알레르기 항목(키)을 가리키는지 판단한다.
 * 재료명·알레르기 표시가 언어마다 다르게 오므로 키워드 사전으로 비교한다.
 *   matchesAllergenKey('땅콩', 'peanut') -> true
 *   matchesAllergenKey('peanut butter', 'peanut') -> true
 */
export const matchesAllergenKey = (text: string, key: string): boolean => {
  const needle = norm(text);
  if (!needle) return false;
  if (needle === norm(key)) return true;
  return (ALLERGEN_KEYWORDS[key] ?? [key]).some((word) => needle.includes(norm(word)));
};

/**
 * 여러 사용자가 "들어 있지 않다"고 확인한 알레르기에 해당하는 항목을 목록에서 제거한다.
 * 재료명과 알레르기 표기를 모두 다루므로 재료 목록에도 그대로 쓸 수 있다.
 */
export const removeClearedAllergens = (items: string[], clearedKeys: string[]): string[] => {
  if (clearedKeys.length === 0) return items;
  return items.filter((item) => !clearedKeys.some((key) => matchesAllergenKey(item, key)));
};

/**
 * 사용자가 실제로 선택한 식단 조건에 대해서만 확인 안내를 만든다.
 * (할랄을 체크하지 않은 사용자에게 할랄 정보를 띄우지 않는다)
 */
export const dietaryWarnings = (
  filter: PartyFilter,
  dietary: { vegan: string; halal: string }
): string[] => {
  const messages: string[] = [];

  if (filter.dietary_tags.includes('halal') && dietary.halal === 'uncertain') {
    messages.push('할랄 확인 필요: 돼지고기·술은 없지만 육류 도축 방식은 확인할 수 없습니다');
  }
  if (filter.dietary_tags.includes('vegan') && dietary.vegan === 'uncertain') {
    messages.push('비건 확인 필요: 재료 정보가 충분하지 않습니다');
  }
  return messages;
};

/* ------------------------------------------------------------------ */
/* 구성원별 판정 — 누가 못 먹는지 이름으로 알려준다 (계획서 3.3)          */
/* ------------------------------------------------------------------ */

/** 경고 문구에 쓸 표시용 라벨. 내부 키('peanut')를 그대로 보여주지 않기 위함. */
const ALLERGEN_LABELS: Record<string, string> = {
  crustacean: '갑각류', nuts: '견과류', dairy: '유제품', gluten: '밀가루',
  peanut: '땅콩', peach: '복숭아', soy: '대두', egg: '달걀',
  fish: '생선', shellfish: '조개류',
};

const DIET_LABELS: Record<string, string> = {
  vegan: '비건', halal: '할랄', nopork: '돼지고기 제외',
  nobeef: '소고기 제외', lacto: '락토 채식',
};

export const allergenLabel = (key: string): string => ALLERGEN_LABELS[key] ?? key;
export const dietLabel = (key: string): string => DIET_LABELS[key] ?? key;

/**
 * 구성원 한 명 한 명을 따로 검사해, 누가 이 메뉴를 못 먹는지 돌려준다.
 * 파티 전체를 합쳐서 보면 "누가" 걸리는지 알 수 없기 때문이다.
 */
export const perMemberWarnings = (ingredients: string[], filter: PartyFilter): MemberWarning[] =>
  filter.members
    .map((member): MemberWarning | null => {
      const hits = crossCheck(ingredients, mergeParty([member]));
      const blocking = [
        ...hits.allergenHits.map(allergenLabel),
        ...hits.dietHits.map(dietLabel),
      ];
      const caution = hits.avoidHits;

      if (blocking.length === 0 && caution.length === 0) return null;
      return {
        name: member.name,
        level: blocking.length > 0 ? 'red' : 'yellow',
        reasons: blocking.length > 0 ? blocking : caution,
      };
    })
    .filter((w): w is MemberWarning => w !== null);

/** 구성원 경고를 한 줄 문구로 만든다. 예: '지우' 주의 (땅콩) */
export const memberWarningText = (warnings: MemberWarning[]): string =>
  warnings.map((w) => `'${w.name}' 주의 (${w.reasons.join(', ')})`).join(' / ');

/** 교차 검증 결과로 신호등 상태를 계산한다. */
export const statusFromHits = (
  hits: { allergenHits: string[]; dietHits: string[]; avoidHits: string[] },
  aiStatus?: 'green' | 'yellow' | 'red'
): 'green' | 'yellow' | 'red' => {
  if (hits.allergenHits.length > 0 || hits.dietHits.length > 0) return 'red';
  if (hits.avoidHits.length > 0) return 'yellow';
  // 교차 검증에서 걸리는 게 없더라도 AI 가 위험하다고 본 경우는 그대로 존중한다.
  return aiStatus || 'green';
};
