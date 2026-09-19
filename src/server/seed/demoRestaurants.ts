/**
 * 지도 API 키가 없을 때 UI 개발/시연에 사용하는 데모 식당 데이터.
 * GOOGLE_MAPS_API_KEY 를 설정하면 실제 Places API 결과로 대체된다.
 * place_id 는 실제 Google Place ID 와 충돌하지 않도록 demo_ 접두사를 쓴다.
 */
export interface DemoRestaurant {
  place_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  category: string;
  rating: number;
  review_count: number;
  photo_url: string | null;
  business_status: string;
}

export const DEMO_RESTAURANTS: DemoRestaurant[] = [
  {
    place_id: 'demo_bkk_thipsamai',
    name: 'Thip Samai Pad Thai',
    address: '313-315 Maha Chai Rd, Samran Rat, Phra Nakhon, Bangkok',
    latitude: 13.7519,
    longitude: 100.5052,
    country: '태국',
    region: 'Bangkok',
    category: 'Thai restaurant',
    rating: 4.3,
    review_count: 18420,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_bkk_jayfai',
    name: 'Jay Fai',
    address: '327 Maha Chai Rd, Samran Rat, Phra Nakhon, Bangkok',
    latitude: 13.7527,
    longitude: 100.5041,
    country: '태국',
    region: 'Bangkok',
    category: 'Street food',
    rating: 4.1,
    review_count: 5230,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_bkk_somtam',
    name: 'Somtam Nua',
    address: '392/14 Siam Square Soi 5, Pathum Wan, Bangkok',
    latitude: 13.7448,
    longitude: 100.5342,
    country: '태국',
    region: 'Bangkok',
    category: 'Isaan restaurant',
    rating: 4.2,
    review_count: 9120,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_bkk_veganist',
    name: 'Veganerie Concept',
    address: '38 Sukhumvit 24 Alley, Khlong Tan, Khlong Toei, Bangkok',
    latitude: 13.7295,
    longitude: 100.5686,
    country: '태국',
    region: 'Bangkok',
    category: 'Vegan restaurant',
    rating: 4.5,
    review_count: 3110,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_tokyo_izakaya',
    name: '渋谷 炉端居酒屋',
    address: '2 Chome-9-11 Shibuya, Shibuya City, Tokyo',
    latitude: 35.659,
    longitude: 139.7016,
    country: '일본',
    region: 'Tokyo',
    category: 'Izakaya',
    rating: 4.0,
    review_count: 1280,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_tokyo_tonkatsu',
    name: 'とんかつ 和幸 渋谷店',
    address: '1 Chome-24-12 Shibuya, Shibuya City, Tokyo',
    latitude: 35.6595,
    longitude: 139.7038,
    country: '일본',
    region: 'Tokyo',
    category: 'Tonkatsu restaurant',
    rating: 4.2,
    review_count: 2140,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_hanoi_pho',
    name: 'Phở Gia Truyền Bát Đàn',
    address: '49 Bát Đàn, Cửa Đông, Hoàn Kiếm, Hà Nội',
    latitude: 21.0329,
    longitude: 105.8471,
    country: '베트남',
    region: 'Hanoi',
    category: 'Pho restaurant',
    rating: 4.1,
    review_count: 7640,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_hanoi_buncha',
    name: 'Bún Chả Hương Liên',
    address: '24 Lê Văn Hưu, Phan Chu Trinh, Hai Bà Trưng, Hà Nội',
    latitude: 21.0166,
    longitude: 105.8517,
    country: '베트남',
    region: 'Hanoi',
    category: 'Vietnamese restaurant',
    rating: 4.0,
    review_count: 8900,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_seoul_bibimbap',
    name: '고궁 비빔밥 종로점',
    address: '서울 종로구 인사동길 12',
    latitude: 37.5735,
    longitude: 126.9855,
    country: '한국',
    region: 'Seoul',
    category: 'Korean restaurant',
    rating: 4.3,
    review_count: 4210,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
  {
    place_id: 'demo_seoul_halal',
    name: 'Eid Halal Korean Food',
    address: '서울 용산구 우사단로10길 62',
    latitude: 37.5335,
    longitude: 126.9964,
    country: '한국',
    region: 'Seoul',
    category: 'Halal restaurant',
    rating: 4.4,
    review_count: 1560,
    photo_url: null,
    business_status: 'OPERATIONAL',
  },
];
