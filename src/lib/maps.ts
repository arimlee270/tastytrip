/** Google Maps JavaScript API 동적 로더. 키가 없으면 로드하지 않는다. */

let loadPromise: Promise<boolean> | null = null;

export const loadGoogleMaps = (apiKey: string): Promise<boolean> => {
  if (!apiKey) return Promise.resolve(false);
  if ((window as any).google?.maps) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    /*
     * loading=async 를 쓰지 않는다.
     *
     * 그 방식으로 부르면 스크립트를 받아도 google.maps.Map 이 만들어지지 않는다.
     * importLibrary 가 돌려주는 객체에서 생성자를 꺼내 써야 하는데, 우리 코드는
     * google.maps.Map 을 직접 쓰는 곳이 여러 군데라 전부 바꾸는 편보다
     * 예전 방식으로 부르는 쪽이 간단하고 덜 깨진다.
     */
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      const ready = !!(window as any).google?.maps?.Map;
      if (!ready) console.warn('[maps] 스크립트는 받았지만 지도 생성자가 없습니다.');
      resolve(ready);
    };

    script.onerror = () => {
      console.warn('[maps] Google Maps 스크립트를 불러오지 못했습니다. 목록 보기로 대체합니다.');
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return loadPromise;
};

export interface Coords {
  lat: number;
  lng: number;
}

/** 브라우저 위치 권한 요청 */
export const getCurrentPosition = (): Promise<Coords> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 기능을 지원하지 않습니다.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

/** 여행 목적지 국가별 기본 좌표 (위치 권한이 없을 때 사용) */
/**
 * 여행 국가별 지도 시작 좌표 (대개 그 나라 최대 도시 또는 음식 상권 중심).
 * 여기 있는 나라가 곧 프로필에서 고를 수 있는 나라 목록이 된다.
 */
export const COUNTRY_CENTERS: Record<string, Coords> = {
  // 동아시아
  한국: { lat: 37.5665, lng: 126.978 },
  일본: { lat: 35.6595, lng: 139.7005 },
  중국: { lat: 31.2304, lng: 121.4737 },
  대만: { lat: 25.033, lng: 121.5654 },
  홍콩: { lat: 22.3193, lng: 114.1694 },
  마카오: { lat: 22.1987, lng: 113.5439 },
  몽골: { lat: 47.8864, lng: 106.9057 },

  // 동남아시아
  태국: { lat: 13.7466, lng: 100.5347 },
  베트남: { lat: 21.0285, lng: 105.8542 },
  싱가포르: { lat: 1.3521, lng: 103.8198 },
  말레이시아: { lat: 3.139, lng: 101.6869 },
  인도네시아: { lat: -6.2088, lng: 106.8456 },
  필리핀: { lat: 14.5995, lng: 120.9842 },
  캄보디아: { lat: 11.5564, lng: 104.9282 },
  라오스: { lat: 17.9757, lng: 102.6331 },
  미얀마: { lat: 16.8409, lng: 96.1735 },
  브루나이: { lat: 4.9031, lng: 114.9398 },

  // 남아시아 · 중앙아시아
  인도: { lat: 28.6139, lng: 77.209 },
  방글라데시: { lat: 23.8103, lng: 90.4125 },
  네팔: { lat: 27.7172, lng: 85.324 },
  스리랑카: { lat: 6.9271, lng: 79.8612 },
  파키스탄: { lat: 24.8607, lng: 67.0011 },
  우즈베키스탄: { lat: 41.2995, lng: 69.2401 },
  카자흐스탄: { lat: 43.222, lng: 76.8512 },

  // 중동
  아랍에미리트: { lat: 25.2048, lng: 55.2708 },
  튀르키예: { lat: 41.0082, lng: 28.9784 },
  사우디아라비아: { lat: 24.7136, lng: 46.6753 },
  카타르: { lat: 25.2854, lng: 51.531 },
  이스라엘: { lat: 32.0853, lng: 34.7818 },
  요르단: { lat: 31.9539, lng: 35.9106 },

  // 유럽
  프랑스: { lat: 48.8566, lng: 2.3522 },
  이탈리아: { lat: 41.9028, lng: 12.4964 },
  스페인: { lat: 40.4168, lng: -3.7038 },
  포르투갈: { lat: 38.7223, lng: -9.1393 },
  영국: { lat: 51.5074, lng: -0.1278 },
  독일: { lat: 52.52, lng: 13.405 },
  네덜란드: { lat: 52.3676, lng: 4.9041 },
  벨기에: { lat: 50.8503, lng: 4.3517 },
  스위스: { lat: 47.3769, lng: 8.5417 },
  오스트리아: { lat: 48.2082, lng: 16.3738 },
  체코: { lat: 50.0755, lng: 14.4378 },
  폴란드: { lat: 52.2297, lng: 21.0122 },
  헝가리: { lat: 47.4979, lng: 19.0402 },
  그리스: { lat: 37.9838, lng: 23.7275 },
  스웨덴: { lat: 59.3293, lng: 18.0686 },
  노르웨이: { lat: 59.9139, lng: 10.7522 },
  덴마크: { lat: 55.6761, lng: 12.5683 },
  핀란드: { lat: 60.1699, lng: 24.9384 },
  아일랜드: { lat: 53.3498, lng: -6.2603 },
  크로아티아: { lat: 45.815, lng: 15.9819 },
  러시아: { lat: 55.7558, lng: 37.6173 },

  // 아메리카
  미국: { lat: 40.7128, lng: -74.006 },
  캐나다: { lat: 43.6532, lng: -79.3832 },
  멕시코: { lat: 19.4326, lng: -99.1332 },
  브라질: { lat: -23.5505, lng: -46.6333 },
  아르헨티나: { lat: -34.6037, lng: -58.3816 },
  페루: { lat: -12.0464, lng: -77.0428 },
  칠레: { lat: -33.4489, lng: -70.6693 },
  콜롬비아: { lat: 4.711, lng: -74.0721 },

  // 오세아니아 · 아프리카
  호주: { lat: -33.8688, lng: 151.2093 },
  뉴질랜드: { lat: -36.8485, lng: 174.7633 },
  이집트: { lat: 30.0444, lng: 31.2357 },
  모로코: { lat: 33.5731, lng: -7.5898 },
  남아프리카공화국: { lat: -33.9249, lng: 18.4241 },
  케냐: { lat: -1.2921, lng: 36.8219 },
};

/** 프로필 국가 선택 목록 (지도 좌표가 있는 나라만 고를 수 있다) */
export const COUNTRY_LIST: string[] = Object.keys(COUNTRY_CENTERS);

/** 두 지점 사이의 직선거리(m). 지도를 얼마나 옮겼는지 재는 데 쓴다. */
export const haversineMeters = (a: Coords, b: Coords): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

export const formatDistance = (meters?: number): string => {
  if (meters == null) return '-';
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
};
