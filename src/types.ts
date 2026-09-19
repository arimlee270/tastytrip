// TastyTrip 공통 타입 정의 (클라이언트 / 서버 공용)

/* ------------------------------------------------------------------ */
/* 사용자 & 프로필                                                      */
/* ------------------------------------------------------------------ */

/** 기존 App.tsx 의 여행 구성원. 본인(index 0) + 동반인으로 사용된다. */
export interface Member {
  id: string;
  name: string;
  allergies: string[];
  diets: string[];
  notes: string;
}

export interface User {
  user_id: string;
  email: string;
  nickname: string;
  nationality: string | null;
  language: string | null;
  destination_country: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  profile_id: string;
  user_id: string;
  allergies: string[];
  dietary_tags: string[];
  avoid_ingredients: string[];
  preference_text: string;
}

export interface Companion {
  companion_id: string;
  user_id: string;
  nickname: string;
  allergies: string[];
  dietary_tags: string[];
  avoid_ingredients: string[];
}

/** 본인 + 동반인 조건을 합친 파티 필터. (계획서 3.3) */
export interface PartyFilter {
  allergies: string[];
  dietary_tags: string[];
  avoid_ingredients: string[];
  notes: string[];
  memberCount: number;
  /** 누가 못 먹는지 이름으로 알려주기 위해 구성원 원본을 함께 들고 다닌다. */
  members: Member[];
}

/** 특정 메뉴를 못 먹는(또는 주의해야 하는) 구성원 한 명 */
export interface MemberWarning {
  name: string;
  /** 'red' = 섭취 부적합, 'yellow' = 확인 필요 */
  level: 'red' | 'yellow';
  /** 걸린 이유 (표시용 라벨) */
  reasons: string[];
}

/* ------------------------------------------------------------------ */
/* 식당 & 메뉴                                                          */
/* ------------------------------------------------------------------ */

export interface Restaurant {
  restaurant_id: string;
  place_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  region: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  photo_url: string | null;
  business_status: string | null;
  last_synced_at: string | null;
  /** 이 정보를 어떤 표시 언어로 받아왔는지 (언어가 바뀌면 다시 조회한다) */
  language_code?: string | null;
  /** 조회 위치 기준 거리(m). nearby 검색 시에만 채워진다. */
  distance_m?: number;
  /** 등록된 메뉴 수 */
  menu_count?: number;
  source?: 'google' | 'demo' | 'db';
}

export interface RestaurantMenu {
  menu_id: string;
  restaurant_id: string;
  standard_food_id: string | null;
  original_name: string;
  translated_name: string | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  version: number;
  status: 'active' | 'archived';
  last_verified_at: string | null;
}

export type SourceType =
  | 'official_nutrition' // 공식 영양정보 (식약처 등 공식 표시 정보와 직접 매칭)
  | 'public_data' // 공개 데이터 기반 추정 (식약처/USDA 등 외부 공개 데이터 조회 결과)
  | 'reference_recipe' // 일반 레시피 기준 추정 (내장 표준 음식 참고값)
  | 'ai_estimate' // AI 추정
  | 'restaurant_verified' // 식당 확인
  | 'user_reported'; // 사용자 정보

export interface CalorieEstimate {
  min: number;
  max: number;
  unit: 'kcal';
  basis: string;
  confidence: number;
}

export interface AllergenRisk {
  level: 'low' | 'medium' | 'high';
  items: string[];
  message: string;
}

export interface DietaryFit {
  vegan: 'suitable' | 'not_suitable' | 'uncertain';
  halal: 'suitable' | 'not_suitable' | 'uncertain';
}

/** 결과 카드 1장에 해당하는 데이터. 기존 필드는 그대로 두고 추가 필드는 optional. */
export interface Dish {
  // --- 기존 필드 (카메라 분석 결과 카드 UI 가 사용) ---
  name: string;
  original: string;
  imageUrl: string;
  primary_query: string;
  secondary_query: string;
  fallback_query: string;
  active_query?: string;
  desc: string;
  taste: string;
  status: 'green' | 'yellow' | 'red';
  badge: string;
  warning: string;
  pair: string;
  order: string;
  phrase: string;
  etiquette: string;
  /** [작성자, 내용, 내가 쓴 리뷰의 id, 별점(1~5)] */
  reviews: [string, string, string?, number?][];

  // --- 추가 개발 필드 ---
  standard_food_name?: string;
  standard_food_id?: string;
  menu_id?: string;
  restaurant_id?: string;
  /** 화면에 표시할 재료 (표시 언어) */
  typical_ingredients?: string[];
  /** 알레르기·식단 판정에만 쓰는 재료 목록 (영문 원어 포함, 표시하지 않음) */
  match_ingredients?: string[];
  /** 알레르기 판정에만 쓰는 알레르겐 목록 (영문 원어 포함, 표시하지 않음) */
  match_allergens?: string[];
  allergen_risk?: AllergenRisk;
  dietary?: DietaryFit;
  estimated_calories?: CalorieEstimate;
  source_type?: SourceType;
  source_summary?: string[];
  confidence_score?: number;
  last_verified_at?: string | null;
  verification_message?: string;
  /** 이 식당을 방문한 사용자들이 남긴 확인 정보 (계획서 8장) */
  user_notes?: string[];
  /** 동반인 중 누가 이 메뉴를 못 먹는지 (계획서 3.3 / 10.4) */
  member_warnings?: MemberWarning[];
  /** DB 캐시에서 나온 결과인지 (Gemini 호출 없이 응답) */
  from_cache?: boolean;
}

export interface AnalyzeMenuResponse {
  dishes: Dish[];
  meta?: {
    gemini_called: boolean;
    result_source: 'db' | 'gemini' | 'mixed';
    restaurant_id?: string;
  };
}

/* ------------------------------------------------------------------ */
/* 공개 데이터                                                          */
/* ------------------------------------------------------------------ */

export interface StandardFood {
  standard_food_id: string;
  standard_name_en: string;
  name_ko: string | null;
  local_names: string[];
  aliases: string[];
  country: string | null;
  category: string | null;
  typical_description: string | null;
  typical_ingredients: string[];
  typical_allergens: string[];
  dietary_tags: string[];
}

export interface NutritionReference {
  nutrition_reference_id: string;
  standard_food_id: string;
  source_name: string; // MFDS_FOOD_NUTRITION | USDA | SEED ...
  source_item_id: string | null;
  reference_amount_g: number | null;
  energy_kcal: number | null;
  carbohydrate_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  sodium_mg: number | null;
  source_updated_at: string | null;
}

/** Gemini 프롬프트에 근거로 넣는 참고 데이터 묶음 (계획서 8.2) */
export interface ReferenceBundle {
  standard_food_id?: string;
  typical_ingredients: string[];
  allergen_candidates: string[];
  nutrition_records: {
    source: string;
    basis: string;
    energy_kcal: number | null;
  }[];
  estimated_serving_weight_g: { min: number; max: number };
  official_notes?: string[];
}

/* ------------------------------------------------------------------ */
/* 신고 / 로그                                                          */
/* ------------------------------------------------------------------ */

export type ReportType = 'ingredient' | 'allergen' | 'calorie' | 'price' | 'other';

export interface MenuReport {
  report_id: string;
  menu_id: string;
  user_id: string | null;
  report_type: ReportType;
  report_text: string;
  evidence_url: string | null;
  visit_date: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* 추천                                                                 */
/* ------------------------------------------------------------------ */

export interface RecommendationReason {
  key: string;
  value?: number;
}

export interface RestaurantRecommendation {
  restaurant: Restaurant;
  score: number;
  reasons: RecommendationReason[];
  safe_menu_count: number;
  vegan_menu_count: number;
  excluded: boolean;
}

export interface MenuRecommendation {
  menu_id: string;
  restaurant_id: string;
  restaurant_name: string;
  name: string;
  original_name: string;
  status: 'green' | 'yellow' | 'red';
  estimated_calories?: CalorieEstimate;
  score: number;
  reasons: RecommendationReason[];
}
