import { db, newId, nowIso } from '../db';
import { upsertStandardFood } from '../services/normalize';
import { CHINESE_FOODS, JAPANESE_FOODS, KOREAN_FOODS, VIETNAMESE_FOODS } from './foodsAsia';
import { AMERICAN_FOODS, BANGLADESHI_FOODS } from './foodsUsBd';

/**
 * 계획서 7.2 — 표준 음식명/별칭 초기 데이터.
 * 공공데이터 API 키가 없어도 별칭 매칭과 칼로리 범위 추정이 동작하도록
 * 대표 음식에 대해 100g 기준 참고값(SEED)을 함께 적재한다.
 * SEED 값은 일반 조리법 기준의 보수적 참고치이며, 공개 데이터가 조회되면 그쪽이 우선한다.
 */

export interface SeedFood {
  id: string;
  en: string;
  ko: string;
  local: string[];
  aliases: string[];
  country: string;
  category: string;
  description: string;
  ingredients: string[];
  allergens: string[];
  dietary: string[];
  serving: [number, number];
  /** 100g 기준 참고 칼로리 */
  kcalPer100g: number;
}

const BASE_FOODS: SeedFood[] = [
  {
    id: 'TH_PAD_THAI',
    en: 'Pad Thai',
    ko: '팟타이',
    local: ['ผัดไทย'],
    aliases: ['Phad Thai', 'Pad Thai Goong', '팟타이꿍', '패드타이', '팟 타이'],
    country: '태국',
    category: 'noodle',
    description: '쌀국수를 타마린드 소스에 볶은 태국 대표 면 요리',
    ingredients: ['rice noodles', 'egg', 'tamarind', 'fish sauce', 'bean sprouts', 'peanut', 'shrimp'],
    allergens: ['peanut', 'egg', 'crustacean', 'fish', 'soy'],
    dietary: [],
    serving: [300, 420],
    kcalPer100g: 165,
  },
  {
    id: 'TH_TOM_YUM_GOONG',
    en: 'Tom Yum Goong',
    ko: '똠얌꿍',
    local: ['ต้มยำกุ้ง'],
    aliases: ['Tom Yam Kung', '톰얌꿍', '똠양꿍'],
    country: '태국',
    category: 'soup',
    description: '새우와 레몬그라스로 끓인 매콤새콤한 태국 수프',
    ingredients: ['shrimp', 'lemongrass', 'galangal', 'kaffir lime', 'chili', 'fish sauce', 'mushroom'],
    allergens: ['crustacean', 'fish'],
    dietary: [],
    serving: [300, 400],
    kcalPer100g: 45,
  },
  {
    id: 'TH_SOM_TAM',
    en: 'Som Tam (Green Papaya Salad)',
    ko: '솜땀',
    local: ['ส้มตำ'],
    aliases: ['Papaya Salad', '쏨땀', '파파야 샐러드'],
    country: '태국',
    category: 'salad',
    description: '풋파파야를 절구에 빻아 무친 매콤한 태국식 샐러드',
    ingredients: ['green papaya', 'peanut', 'dried shrimp', 'fish sauce', 'lime', 'chili', 'tomato'],
    allergens: ['peanut', 'crustacean', 'fish'],
    dietary: [],
    serving: [200, 300],
    kcalPer100g: 85,
  },
  {
    id: 'TH_POO_PAD_PONG_CURRY',
    en: 'Poo Pad Pong Curry',
    ko: '푸팟퐁커리',
    local: ['ปูผัดผงกะหรี่'],
    aliases: ['Crab Curry', '뿌팟퐁커리', '푸팟퐁 커리'],
    country: '태국',
    category: 'curry',
    description: '게살을 커리 가루와 달걀에 볶아낸 태국식 커리 요리',
    ingredients: ['crab', 'egg', 'curry powder', 'coconut milk', 'evaporated milk', 'celery'],
    allergens: ['crustacean', 'egg', 'dairy'],
    dietary: [],
    serving: [300, 450],
    kcalPer100g: 155,
  },
  {
    id: 'TH_GREEN_CURRY',
    en: 'Green Curry',
    ko: '그린커리',
    local: ['แกงเขียวหวาน'],
    aliases: ['Gaeng Keow Wan', '깽키여우완', '그린 커리'],
    country: '태국',
    category: 'curry',
    description: '코코넛 밀크와 그린커리 페이스트로 끓인 태국 커리',
    ingredients: ['coconut milk', 'green curry paste', 'chicken', 'thai basil', 'eggplant', 'fish sauce', 'shrimp paste'],
    allergens: ['fish', 'crustacean'],
    dietary: [],
    serving: [300, 400],
    kcalPer100g: 130,
  },
  {
    id: 'JP_TONKATSU',
    en: 'Tonkatsu',
    ko: '돈카츠',
    local: ['とんかつ', '豚カツ'],
    aliases: ['Pork Cutlet', '돈까스', '톤카츠'],
    country: '일본',
    category: 'fried',
    description: '돼지고기 등심에 빵가루를 입혀 튀긴 일본식 커틀릿',
    ingredients: ['pork', 'wheat flour', 'panko', 'egg', 'cabbage'],
    allergens: ['gluten', 'egg'],
    dietary: [],
    serving: [200, 300],
    kcalPer100g: 260,
  },
  {
    id: 'JP_SASHIMI',
    en: 'Assorted Sashimi',
    ko: '모듬 사시미',
    local: ['刺身', '盛り合わせ'],
    aliases: ['Sashimi', '사시미', '회'],
    country: '일본',
    category: 'raw',
    description: '신선한 생선을 얇게 저며 낸 일본식 회',
    ingredients: ['raw fish', 'salmon', 'tuna', 'soy sauce', 'wasabi'],
    allergens: ['fish', 'soy'],
    dietary: [],
    serving: [150, 250],
    kcalPer100g: 130,
  },
  {
    id: 'JP_SOBA',
    en: 'Soba Noodles',
    ko: '소바',
    local: ['そば', '蕎麦'],
    aliases: ['Buckwheat Noodles', '메밀국수', '자루소바'],
    country: '일본',
    category: 'noodle',
    description: '메밀로 만든 일본식 국수',
    ingredients: ['buckwheat', 'wheat flour', 'soy sauce', 'dashi', 'bonito'],
    allergens: ['gluten', 'soy', 'fish'],
    dietary: [],
    serving: [250, 350],
    kcalPer100g: 130,
  },
  {
    id: 'JP_RAMEN',
    en: 'Tonkotsu Ramen',
    ko: '라멘',
    local: ['ラーメン'],
    aliases: ['Ramen', '돈코츠라멘', '라면'],
    country: '일본',
    category: 'noodle',
    description: '돼지뼈 육수에 밀 면을 넣은 일본식 라멘',
    ingredients: ['wheat noodles', 'pork bone broth', 'pork belly', 'egg', 'green onion', 'soy sauce'],
    allergens: ['gluten', 'egg', 'soy'],
    dietary: [],
    serving: [400, 600],
    kcalPer100g: 110,
  },
  {
    id: 'VN_PHO_BO',
    en: 'Pho Bo (Beef Noodle Soup)',
    ko: '퍼보 (소고기 쌀국수)',
    local: ['Phở bò'],
    aliases: ['Pho', '쌀국수', '포보', '퍼 보'],
    country: '베트남',
    category: 'noodle',
    description: '소뼈 육수에 쌀국수를 말아낸 베트남 대표 국수',
    ingredients: ['rice noodles', 'beef', 'beef broth', 'fish sauce', 'basil', 'lime', 'bean sprouts'],
    allergens: ['fish'],
    dietary: [],
    serving: [450, 650],
    kcalPer100g: 65,
  },
  {
    id: 'VN_BUN_CHA',
    en: 'Bun Cha',
    ko: '분짜',
    local: ['Bún chả'],
    aliases: ['Bun Cha Hanoi', '분 짜'],
    country: '베트남',
    category: 'noodle',
    description: '숯불 돼지고기와 쌀국수를 새콤한 소스에 찍어 먹는 하노이 음식',
    ingredients: ['pork', 'rice vermicelli', 'fish sauce', 'herbs', 'papaya', 'sugar'],
    allergens: ['fish'],
    dietary: [],
    serving: [350, 500],
    kcalPer100g: 110,
  },
  {
    id: 'VN_BANH_MI',
    en: 'Banh Mi',
    ko: '반미',
    local: ['Bánh mì'],
    aliases: ['Vietnamese Sandwich', '반 미'],
    country: '베트남',
    category: 'sandwich',
    description: '바게트에 고기와 채소를 넣은 베트남식 샌드위치',
    ingredients: ['baguette', 'pork', 'pate', 'mayonnaise', 'pickled carrot', 'cilantro', 'egg'],
    allergens: ['gluten', 'egg'],
    dietary: [],
    serving: [180, 260],
    kcalPer100g: 240,
  },
  {
    id: 'KR_BIBIMBAP',
    en: 'Bibimbap',
    ko: '비빔밥',
    local: ['비빔밥'],
    aliases: ['Bi Bim Bap', '돌솥비빔밥'],
    country: '한국',
    category: 'rice',
    description: '밥에 나물과 고추장을 넣어 비벼 먹는 한국 음식',
    ingredients: ['rice', 'vegetables', 'egg', 'beef', 'gochujang', 'sesame oil', 'soy'],
    allergens: ['egg', 'soy'],
    dietary: [],
    serving: [400, 550],
    kcalPer100g: 130,
  },
  {
    id: 'KR_BULGOGI',
    en: 'Bulgogi',
    ko: '불고기',
    local: ['불고기'],
    aliases: ['Korean BBQ Beef', '소불고기'],
    country: '한국',
    category: 'meat',
    description: '간장 양념에 재운 소고기를 구운 한국 음식',
    ingredients: ['beef', 'soy sauce', 'sugar', 'pear', 'garlic', 'sesame oil'],
    allergens: ['soy', 'gluten'],
    dietary: [],
    serving: [200, 300],
    kcalPer100g: 190,
  },
  {
    id: 'IT_MARGHERITA_PIZZA',
    en: 'Margherita Pizza',
    ko: '마르게리타 피자',
    local: ['Pizza Margherita'],
    aliases: ['Margherita', '마르게리따'],
    country: '이탈리아',
    category: 'pizza',
    description: '토마토, 모차렐라, 바질을 올린 나폴리식 피자',
    ingredients: ['wheat flour', 'tomato', 'mozzarella', 'basil', 'olive oil'],
    allergens: ['gluten', 'dairy'],
    dietary: ['lacto'],
    serving: [250, 400],
    kcalPer100g: 250,
  },
  {
    id: 'IT_CARBONARA',
    en: 'Spaghetti Carbonara',
    ko: '까르보나라',
    local: ['Spaghetti alla Carbonara'],
    aliases: ['Carbonara', '카르보나라'],
    country: '이탈리아',
    category: 'pasta',
    description: '달걀노른자와 관찰레, 페코리노 치즈로 만든 로마식 파스타',
    ingredients: ['spaghetti', 'egg', 'pecorino cheese', 'guanciale', 'pork', 'black pepper'],
    allergens: ['gluten', 'egg', 'dairy'],
    dietary: [],
    serving: [300, 400],
    kcalPer100g: 220,
  },
];

/**
 * 전체 표준 음식 목록.
 * 기존 태국·이탈리아 데이터에 여행 대상국(한국·일본·중국·베트남·미국·방글라데시)을 더한다.
 */
export const SEED_FOODS: SeedFood[] = [
  ...BASE_FOODS,
  ...KOREAN_FOODS,
  ...JAPANESE_FOODS,
  ...CHINESE_FOODS,
  ...VIETNAMESE_FOODS,
  ...AMERICAN_FOODS,
  ...BANGLADESHI_FOODS,
];

/** 시드 데이터를 적재한다. 이미 있으면 갱신만 하므로 매 실행마다 호출해도 안전하다. */
export const seedStandardFoods = async (): Promise<void> => {
  const insertNutritionSql = (
    `INSERT INTO nutrition_references (nutrition_reference_id, standard_food_id, source_name, source_item_id,
       reference_amount_g, energy_kcal, carbohydrate_g, protein_g, fat_g, sodium_mg, raw_payload, source_updated_at, collected_at)
     VALUES (?, ?, 'SEED', ?, 100, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)
     ON CONFLICT(standard_food_id, source_name, source_item_id) DO NOTHING`
  );

  for (const food of SEED_FOODS) {
    await upsertStandardFood({
      standard_food_id: food.id,
      standard_name_en: food.en,
      name_ko: food.ko,
      local_names: food.local,
      aliases: food.aliases,
      country: food.country,
      category: food.category,
      typical_description: food.description,
      typical_ingredients: food.ingredients,
      typical_allergens: food.allergens,
      dietary_tags: food.dietary,
      serving_weight_min_g: food.serving[0],
      serving_weight_max_g: food.serving[1],
    });

    await db.run(insertNutritionSql, [newId('ntr'), food.id, food.id, food.kcalPer100g, nowIso()]);
  }
};
