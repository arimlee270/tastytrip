import type { Dish, Member } from '../types';

/** 기존 App.tsx 의 localStorage 로직을 옮긴 모듈 (Phase 1: 코드 정리) */

export interface CustomReview {
  id: string;
  author: string;
  comment: string;
  timestamp: number;
  /** 별점 1~5. 예전에 별점 없이 저장된 리뷰는 값이 없으므로 읽을 때 5로 본다. */
  rating?: number;
}

export type CustomReviewsMap = Record<string, CustomReview[]>;

export const getCustomReviewsMap = (): CustomReviewsMap => {
  try {
    const data = localStorage.getItem('tastytrip_custom_reviews');
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

export const saveCustomReviewsMap = (map: CustomReviewsMap): void => {
  try {
    localStorage.setItem('tastytrip_custom_reviews', JSON.stringify(map));
  } catch (e) {
    console.error('Failed to save custom reviews', e);
  }
};

export const mergeDishesWithCustomReviews = (dishesList: Dish[]): Dish[] => {
  const customMap = getCustomReviewsMap();
  return dishesList.map((dish) => {
    const key = (dish.original || dish.name).trim();
    const customReviews = customMap[key] || [];

    const defaultReviews: [string, string, string?, number?][] = (dish.reviews || []).map((r) => [
      r[0],
      r[1],
      undefined,
      r[3],
    ]);
    const formattedCustom: [string, string, string?, number?][] = customReviews.map((cr) => [
      cr.author,
      cr.comment,
      cr.id,
      cr.rating ?? 5,
    ]);

    return { ...dish, reviews: [...formattedCustom, ...defaultReviews] };
  });
};

/* --------------------------- 프로필 / 설정 --------------------------- */

export const DEFAULT_MEMBERS: Member[] = [
  {
    id: 'm1',
    name: '여행자 1',
    allergies: ['crustacean'],
    diets: [],
    notes: '고수 제외 희망',
  },
];

const ALLERGY_MAP: Record<string, string> = {
  갑각류: 'crustacean', Crustacean: 'crustacean',
  견과류: 'nuts', Nuts: 'nuts',
  유제품: 'dairy', Dairy: 'dairy',
  밀가루: 'gluten', Gluten: 'gluten',
  땅콩: 'peanut', Peanut: 'peanut',
  복숭아: 'peach', Peach: 'peach',
  대두: 'soy', Soy: 'soy',
  달걀: 'egg', Egg: 'egg',
};

const DIET_MAP: Record<string, string> = {
  비건: 'vegan', Vegan: 'vegan',
  할랄: 'halal', Halal: 'halal',
  '돼지고기 제외': 'nopork', 'No Pork': 'nopork',
  '소고기 제외': 'nobeef', 'No Beef': 'nobeef',
  락토: 'lacto', Lacto: 'lacto',
};

/** 예전 버전에서 저장된 현지화 문자열 키를 불변 키로 변환 */
export const loadParty = (): Member[] => {
  const saved = localStorage.getItem('tastytrip_party');
  if (!saved) return DEFAULT_MEMBERS;

  try {
    const parsed = JSON.parse(saved);
    return parsed.map((m: any, idx: number) => {
      let name = m.name;
      if (name === '나 (본인)' || name === 'Me (Self)') name = '여행자 1';
      else if (name === '지우' || name === 'Jiwoo' || name === '동반 구성원 2' || name === 'Companion 2') name = '여행자 2';
      else if (name && name.startsWith('동반 구성원 ')) name = name.replace('동반 구성원 ', '여행자 ');
      else if (name && name.startsWith('Companion ')) name = name.replace('Companion ', '여행자 ');

      return {
        ...m,
        name: name || `여행자 ${idx + 1}`,
        allergies: (m.allergies || []).map((a: string) => ALLERGY_MAP[a] || a),
        diets: (m.diets || []).map((d: string) => DIET_MAP[d] || d),
      };
    });
  } catch {
    return DEFAULT_MEMBERS;
  }
};

export const saveParty = (party: Member[]): void => {
  localStorage.setItem('tastytrip_party', JSON.stringify(party));
};

export const loadDishes = (): Dish[] | null => {
  const saved = localStorage.getItem('tastytrip_dishes');
  if (!saved) return null;
  try {
    return mergeDishesWithCustomReviews(JSON.parse(saved));
  } catch (e) {
    console.error('Failed to parse saved dishes', e);
    return null;
  }
};

export const saveDishes = (dishes: Dish[]): void => {
  if (dishes.length > 0) localStorage.setItem('tastytrip_dishes', JSON.stringify(dishes));
  else localStorage.removeItem('tastytrip_dishes');
};

export const readSetting = (key: string): string | null => localStorage.getItem(key);
export const writeSetting = (key: string, value: string): void => localStorage.setItem(key, value);
