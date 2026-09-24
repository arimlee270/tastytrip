import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useDragControls } from 'motion/react';
import {
  AlertTriangle,
  Crosshair,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Star,
  Utensils,
} from 'lucide-react';
import * as api from '../lib/api';
import { COUNTRY_CENTERS, formatDistance, getCurrentPosition, haversineMeters, loadGoogleMaps, type Coords } from '../lib/maps';
import { readSetting, writeSetting } from '../lib/storage';
import { format } from '../i18n';
import type { Member, Restaurant, RestaurantRecommendation } from '../types';

/** 계획서 4장 / 14.3 — 지도 화면 */

type SortKey = 'distance' | 'rating' | 'match';

interface MapScreenProps {
  t: Record<string, any>;
  travelCountry: string;
  langCode: string;
  party: Member[];
  onSelectRestaurant: (restaurant: Restaurant) => void;
  /** 메뉴가 없을 때 촬영 화면으로 보내기 위한 콜백 */
  onGoCamera: () => void;
  playBeep: () => void;
}

const CENTER_KEY = 'tastytrip_map_center';

/**
 * 마지막으로 보던 지도 위치를 돌려준다.
 *
 * 탭을 옮기면 이 화면은 통째로 사라졌다가 다시 만들어진다. 그때마다 여행 국가의
 * 기본 좌표로 되돌아가면, 사용자가 '내 위치'로 맞춰 둔 곳이 매번 풀린다.
 * 그래서 고른 위치를 기기에 적어 두고 다시 들어올 때 그대로 복원한다.
 * 다만 여행 국가를 바꾸면 이전 나라의 좌표는 의미가 없으므로 새로 시작한다.
 */
const loadSavedCenter = (country: string): Coords => {
  try {
    const raw = readSetting(CENTER_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.country === country && typeof saved.lat === 'number' && typeof saved.lng === 'number') {
        return { lat: saved.lat, lng: saved.lng };
      }
    }
  } catch {
    /* 저장값이 깨졌으면 기본 좌표로 넘어간다 */
  }
  return COUNTRY_CENTERS[country] || COUNTRY_CENTERS['태국'];
};

const rememberCenter = (country: string, coords: Coords): void => {
  try {
    writeSetting(CENTER_KEY, JSON.stringify({ country, lat: coords.lat, lng: coords.lng }));
  } catch {
    /* 저장에 실패해도 화면 동작에는 지장이 없다 */
  }
};

export const MapScreen: React.FC<MapScreenProps> = ({
  t,
  travelCountry,
  langCode,
  party,
  onSelectRestaurant,
  onGoCamera,
  playBeep,
}) => {
  const [config, setConfig] = useState<api.PublicConfig | null>(null);
  const [center, setCenterState] = useState<Coords>(() => loadSavedCenter(travelCountry));

  /** 위치를 바꿀 때마다 기기에 적어 둔다. 다음에 들어와도 이 자리에서 시작한다. */
  const setCenter = useCallback(
    (coords: Coords) => {
      setCenterState(coords);
      rememberCenter(travelCountry, coords);
    },
    [travelCountry]
  );
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [recommendations, setRecommendations] = useState<RestaurantRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  /** 지도 검색을 못 한 이유. 'quota' = 오늘 한도 소진, 'failed' = 일시 오류 */
  const [unavailable, setUnavailable] = useState<'quota' | 'failed' | null>(null);
  const [sort, setSort] = useState<SortKey>('distance');
  const [openOnly, setOpenOnly] = useState(false);
  const [safeOnly, setSafeOnly] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  /** 하단 시트 높이 단계. 지도를 넓게 보려면 접고, 목록을 보려면 펼친다. */
  const [sheet, setSheet] = useState<'peek' | 'half' | 'full'>('half');
  /** 하단 시트에서 보고 있는 탭 */
  const [sheetTab, setSheetTab] = useState<'list' | 'recommend'>('list');
  /** 입력 중 보여줄 가게 이름 후보 */
  const [suggestions, setSuggestions] = useState<api.Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  /** 지도를 옮겨서 지금 목록과 보이는 영역이 어긋났을 때 담아 두는 좌표 */
  const [pendingCenter, setPendingCenter] = useState<Coords | null>(null);

  /** 하단 시트를 손가락으로 끌기 위한 제어기 (손잡이에서만 끌리게 한다) */
  const dragControls = useDragControls();
  /** 화면 높이를 알아야 시트가 멈출 위치를 계산할 수 있다 */
  const shellRef = useRef<HTMLElement | null>(null);
  const [shellHeight, setShellHeight] = useState(0);

  /** 지도 리스너 안에서 최신 center 를 참조하기 위한 보관용 */
  const centerRef = useRef<Coords>(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  /* ------------------------- 설정 & 지도 로드 ------------------------- */

  useEffect(() => {
    api
      .fetchConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    // 설정을 아직 받기 전에는 조용히 넘어간다 (곧 다시 실행된다).
    if (!config) return;
    if (!config.mapsBrowserKey) {
      console.warn('[지도] 브라우저 지도 키가 없어 목록 보기로 대체합니다.');
      return;
    }
    let cancelled = false;
    loadGoogleMaps(config.mapsBrowserKey).then((ok) => {
      if (cancelled) return;
      if (!ok) {
        console.warn('[지도] 구글 지도 라이브러리를 불러오지 못했습니다.');
        return;
      }
      if (!mapDivRef.current) {
        console.warn('[지도] 지도를 그릴 자리를 찾지 못했습니다.');
        return;
      }

      const google = (window as any).google;
      const box = mapDivRef.current.getBoundingClientRect();
      console.log(`[지도] 생성 시작 — 자리 크기 ${Math.round(box.width)}x${Math.round(box.height)}`);

      try {
        mapRef.current = new google.maps.Map(mapDivRef.current, {
          center,
          zoom: 15,
          disableDefaultUI: true,
          zoomControl: true,
        });
        console.log('[지도] 생성 완료');
      } catch (e) {
        console.error('[지도] 생성 실패:', e);
        return;
      }

      /*
       * 지도를 옮기면 '이 지역 검색' 버튼을 띄운다.
       * 옮길 때마다 자동으로 다시 찾지 않는 이유는, 지도를 조금씩 끌 때마다
       * 구글 호출이 나가면 하루 검색 한도가 금방 바닥나기 때문이다.
       * 사용자가 누를 때만 찾으면 한 번의 이동에 한 번만 쓴다.
       */
      mapRef.current.addListener('idle', () => {
        const c = mapRef.current?.getCenter?.();
        if (!c) return;
        const moved = { lat: c.lat(), lng: c.lng() };
        setPendingCenter((prev) => {
          // 목록을 만든 자리에서 300m 이상 벗어났을 때만 버튼을 띄운다.
          const base = centerRef.current;
          const far = haversineMeters(base, moved) > 300;
          if (!far) return null;
          if (prev && haversineMeters(prev, moved) < 30) return prev;
          return moved;
        });
      });

      setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
    // 지도는 한 번만 생성한다. center 변경은 아래 effect 에서 처리.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.mapsBrowserKey]);

  useEffect(() => {
    if (mapReady && mapRef.current) mapRef.current.setCenter(center);
  }, [center, mapReady]);

  // 여행 국가를 바꾸면 이전 나라의 좌표는 의미가 없으므로 새 나라 기준으로 옮긴다.
  useEffect(() => {
    setCenterState(loadSavedCenter(travelCountry));
    // travelCountry 가 바뀔 때만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelCountry]);

  /* ---------------------------- 데이터 로드 ---------------------------- */

  const loadNearby = useCallback(
    async (coords: Coords, keyword?: string) => {
      setLoading(true);
      setError(null);
      try {
        // 표시 언어를 함께 보내야 가게 이름·업종이 해당 언어로 내려온다.
        const res = keyword
          ? await api.searchRestaurants({ q: keyword, lat: coords.lat, lng: coords.lng, lang: langCode })
          : await api.fetchNearby({ lat: coords.lat, lng: coords.lng, radius: 1500, lang: langCode });
          setRestaurants(res.restaurants);
        setIsDemo(res.demo);
        setUnavailable(null);

        const rec = await api.fetchRestaurantRecommendations({
          lat: coords.lat,
          lng: coords.lng,
          lang: langCode,
          party,
        });
        setRecommendations(rec.recommendations);
      } catch (err: any) {
        // 지도 검색이 막힌 경우에는 목록을 비우고 사정을 설명한다.
        if (err?.reason === 'quota' || err?.reason === 'failed') {
          setUnavailable(err.reason);
          setRestaurants([]);
          setRecommendations([]);
          setError(null);
        } else {
          setError(err.message || '식당 정보를 불러오지 못했습니다.');
        }
      } finally {
        setLoading(false);
      }
    },
    [langCode, party]
  );

  useEffect(() => {
    loadNearby(center);
    // 최초 진입, 중심 좌표 변경, 표시 언어 변경 시 다시 조회한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, langCode]);

  // 화면 크기가 바뀌면(회전, 창 크기 조절) 시트가 멈출 위치도 다시 잰다.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setShellHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ------------------------------ 마커 ------------------------------ */

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const google = (window as any).google;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    restaurants.forEach((r) => {
      if (r.latitude == null || r.longitude == null) return;

      // 지도 위에서 가게 이름이 바로 보이도록 핀 위에 이름표를 붙인다.
      // 이름이 길면 핀끼리 겹쳐 읽기 어려우므로 줄여서 보여준다(전체 이름은 목록에 있다).
      const shortName = r.name.length > 11 ? `${r.name.slice(0, 11)}…` : r.name;

      const marker = new google.maps.Marker({
        position: { lat: r.latitude, lng: r.longitude },
        map: mapRef.current,
        title: r.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#E8590C',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
          // 이름표를 핀 위쪽으로 올린다 (원 반지름 단위 기준).
          labelOrigin: new google.maps.Point(0, -2.6),
        },
        label: {
          text: shortName,
          className: 'map-pin-label',
          color: '#1f2937',
          fontSize: '11px',
          fontWeight: '700',
        },
      });
      marker.addListener('click', () => {
        playBeep();
        onSelectRestaurant(r);
      });
      markersRef.current.push(marker);
    });
  }, [restaurants, mapReady, onSelectRestaurant, playBeep]);

  /*
   * 입력하는 동안 가게 이름 후보를 찾는다.
   *
   * 글자를 칠 때마다 곧바로 부르면 요청이 우수수 나간다. 잠시 멈췄을 때만
   * 한 번 부른다. 우리 DB 조회라 비용은 들지 않지만 불필요한 왕복은 줄인다.
   */
  useEffect(() => {
    const text = query.trim();
    if (text.length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .fetchSuggestions({ q: text, lat: center.lat, lng: center.lng })
        .then((r) => setSuggestions(r.suggestions))
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, center.lat, center.lng]);

  /* ---------------------------- 사용자 조작 ---------------------------- */

  const useMyLocation = async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const coords = await getCurrentPosition();
      setCenter(coords);
      setPendingCenter(null);
      playBeep();
    } catch {
      setLocationError(t.locationDenied);
    } finally {
      setLocating(false);
    }
  };

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSuggestOpen(false);
    loadNearby(center, query.trim());
    playBeep();
  };

  /* ---------------------------- 목록 가공 ---------------------------- */

  const scoreById = new Map<string, RestaurantRecommendation>(
    recommendations.map((r) => [r.restaurant.restaurant_id, r] as [string, RestaurantRecommendation])
  );

  const visible = restaurants
    .filter((r) => (openOnly ? r.business_status !== 'CLOSED_PERMANENTLY' : true))
    .filter((r) => (safeOnly ? (scoreById.get(r.restaurant_id)?.safe_menu_count ?? 0) > 0 : true))
    .sort((a, b) => {
      if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
      if (sort === 'match') {
        return (scoreById.get(b.restaurant_id)?.score ?? 0) - (scoreById.get(a.restaurant_id)?.score ?? 0);
      }
      return (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER);
    });

  /** 지금 목록에서 메뉴가 등록돼 있는 식당 수 (안내 문구에 쓴다) */
  const withMenuCount = restaurants.filter((r) => (r.menu_count ?? 0) > 0).length;

  const chip = (active: boolean) =>
    `text-[11px] font-bold border rounded-full px-2.5 py-1 shrink-0 whitespace-nowrap shadow-sm transition-all cursor-pointer ${
      active ? 'bg-primary border-primary text-white' : 'bg-white/95 backdrop-blur-sm border-line-trip text-neutral-600 hover:bg-neutral-50'
    }`;

  /** 시트를 한 단계씩 올리고 내린다. */
  const cycleSheet = () => {
    playBeep();
    setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek');
  };

  /** 시트가 접혀 있을 때 탭을 누르면 자동으로 펼쳐 준다. */
  const openTab = (next: 'list' | 'recommend') => {
    playBeep();
    setSheetTab(next);
    if (sheet === 'peek') setSheet('half');
  };

  /*
   * 하단 시트가 멈추는 세 자리.
   * 시트 자체 높이는 고정해 두고 위아래로 밀어 올리고 내린다.
   * 높이를 직접 늘였다 줄이면 끄는 동안 안쪽 내용이 계속 다시 배치돼 버벅인다.
   *
   *   peek  손잡이만 남기고 내림 → 지도를 크게 본다
   *   half  절반쯤 올림         → 지도와 목록을 같이 본다
   *   full  끝까지 올림         → 목록만 본다
   */
  const SHEET_RATIO = 0.88;
  /**
   * 다 내렸을 때 남기는 높이 — 손잡이 바만 보인다.
   * 이만큼은 남겨야 다시 잡아 올릴 수 있다.
   */
  const PEEK_PX = 46;
  const sheetPx = shellHeight * SHEET_RATIO;
  /*
   * 아직 화면 높이를 재기 전(첫 그림)에는 0 이 된다.
   * 그때는 모든 자리를 0 으로 두어 시트가 펼쳐진 채로 나오게 한다.
   * 잘못 계산된 값으로 시트를 접어 버리면 목록이 아예 안 보인다.
   */
  const measured = shellHeight > 0;
  const snapY: Record<'peek' | 'half' | 'full', number> = {
    full: 0,
    half: measured ? Math.max(0, sheetPx - shellHeight * 0.5) : 0,
    peek: measured ? Math.max(0, sheetPx - PEEK_PX) : 0,
  };

  /** 끌어서 놓은 위치와 속도를 보고 가장 알맞은 자리를 고른다. */
  const settleSheet = (offsetY: number, velocityY: number) => {
    const current = snapY[sheet] + offsetY;
    // 빠르게 튕기면 위치와 상관없이 그 방향의 다음 자리로 보낸다.
    if (velocityY > 500) {
      setSheet(sheet === 'full' ? 'half' : 'peek');
      return;
    }
    if (velocityY < -500) {
      setSheet(sheet === 'peek' ? 'half' : 'full');
      return;
    }
    const nearest = (['full', 'half', 'peek'] as const).reduce((best, key) =>
      Math.abs(snapY[key] - current) < Math.abs(snapY[best] - current) ? key : best
    );
    setSheet(nearest);
  };

  /** 지도 위에 떠 있는 둥근 버튼 공통 모양 */
  const floatBtn =
    'w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm border border-line-trip shadow-md ' +
    'flex items-center justify-center text-primary hover:bg-soft-trip active:scale-95 transition-all cursor-pointer';

  return (
    <motion.section
      key="map"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      ref={shellRef}
      className="absolute inset-0"
    >
      {/* 지도 — 화면 전체를 채운다 */}
      {config?.mapsBrowserKey ? (
        <div ref={mapDivRef} className="absolute inset-0 bg-soft-trip/40" />
      ) : (
        <div className="absolute inset-0 bg-soft-trip/40 flex flex-col items-center justify-center gap-2 text-center px-8">
          <MapPin className="w-7 h-7 text-primary" />
          <p className="text-xs font-bold text-neutral-700 leading-relaxed">{t.mapKeyMissing}</p>
        </div>
      )}

      {/* ── 상단 떠 있는 검색·필터 ── */}
      {/* pointer-events-none 으로 빈 공간은 지도가 받고, 버튼만 클릭을 받는다. */}
      <div className="absolute top-0 inset-x-0 z-20 pointer-events-none px-3 pt-3 space-y-2">
        <form onSubmit={runSearch} className="pointer-events-auto flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-muted-trip absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSuggestOpen(true)}
              // 목록의 항목을 누를 시간을 준 뒤 닫는다.
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              placeholder={t.searchPlaceholder}
              className="w-full text-xs border border-line-trip rounded-full bg-white/95 backdrop-blur-sm shadow-md pl-8 pr-3 py-2.5 outline-none text-neutral-800 focus:border-primary transition-all"
            />

            {/* 입력하는 동안 보여주는 가게 이름 후보 */}
            {suggestOpen && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-line-trip rounded-2xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.restaurant_id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      playBeep();
                      setSuggestOpen(false);
                      setQuery(s.name);
                      onSelectRestaurant(s as unknown as Restaurant);
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-soft-trip/50 transition-colors cursor-pointer border-b border-line-trip/50 last:border-b-0"
                  >
                    <div className="text-[11px] font-bold text-neutral-800 truncate">{s.name}</div>
                    <div className="text-[10px] text-muted-trip truncate">
                      {[s.category, s.distance_m != null ? formatDistance(s.distance_m) : null, s.address]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full px-4 bg-gradient-to-r from-primary to-primary2 text-white text-xs font-black shadow-md hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
          >
            {t.searchBtn}
          </button>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className={floatBtn}
            title={t.useMyLocation}
          >
            {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          </button>
        </form>

        {/* 정렬·필터 — 가로로 넘치면 밀어서 본다 */}
        <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
          <button onClick={() => setSort('distance')} className={chip(sort === 'distance')}>
            {t.sortDistance}
          </button>
          <button onClick={() => setSort('rating')} className={chip(sort === 'rating')}>
            {t.sortRating}
          </button>
          <button onClick={() => setSort('match')} className={chip(sort === 'match')}>
            {t.sortMatch}
          </button>
          <span className="w-px h-4 bg-line-trip/80 shrink-0" />
          <button onClick={() => setOpenOnly(!openOnly)} className={chip(openOnly)}>
            {t.filterOpenNow}
          </button>
          <button onClick={() => setSafeOnly(!safeOnly)} className={chip(safeOnly)}>
            {t.filterSafeOnly}
          </button>
        </div>

        {/* 지도를 옮겼을 때만 나타나는 재검색 버튼 */}
        {pendingCenter && (
          <div className="pointer-events-none flex justify-center">
            <button
              onClick={() => {
                playBeep();
                setCenter(pendingCenter);
                setPendingCenter(null);
              }}
              className="pointer-events-auto inline-flex items-center gap-1.5 bg-primary text-white rounded-full shadow-lg px-4 py-2 text-[11px] font-black hover:scale-[1.03] active:scale-95 transition-all cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              {t.searchThisArea}
            </button>
          </div>
        )}

        {/* 지금 몇 곳이 잡혔는지 */}
        {!loading && visible.length > 0 && (
          <div className="pointer-events-auto inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-sm border border-line-trip rounded-full shadow-md pl-2.5 pr-3 py-1.5">
            <MapPin className="w-3 h-3 text-primary shrink-0" />
            <span className="text-[11px] font-bold text-neutral-700 truncate max-w-[190px]">
              {visible[0]?.address || t.nearbyList}
            </span>
            <span className="text-[11px] font-black text-primary shrink-0">{visible.length}</span>
          </div>
        )}

        {/*
         * 지도 검색이 막혔을 때는 없는 가게를 보여주지 않고 사정을 설명한다.
         * 이름 검색은 한도가 따로라 대개 살아 있으므로 그쪽으로 안내한다.
         */}
        {unavailable && (
          <div className="pointer-events-auto bg-white/97 backdrop-blur-sm border border-amber-300 rounded-xl shadow-md p-3 space-y-1">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="text-[11px] font-black text-neutral-800">
                {unavailable === 'quota' ? t.placesQuotaTitle : t.placesFailedTitle}
              </span>
            </div>
            <p className="text-[11px] text-muted-trip leading-relaxed pl-5">{t.placesUnavailableHelp}</p>
          </div>
        )}

        {!unavailable && (isDemo || locationError) && (
          <div className="pointer-events-auto bg-amber-50/95 backdrop-blur-sm border border-amber-200 rounded-xl shadow-md p-2.5 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{locationError || t.demoDataNotice}</span>
          </div>
        )}
      </div>

      {/* ── 하단 시트 ── */}
      <motion.div
        drag="y"
        // 손잡이를 잡았을 때만 끌리게 한다. 그래야 목록은 평소대로 스크롤된다.
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: snapY.peek }}
        dragElastic={0.04}
        onDragEnd={(_, info) => settleSheet(info.offset.y, info.velocity.y)}
        animate={{ y: snapY[sheet] }}
        transition={{ type: 'spring', stiffness: 400, damping: 42 }}
        // 높이는 CSS 비율로 준다. 픽셀 계산이 어긋나도 시트가 찌그러지지 않는다.
        style={{ height: `${SHEET_RATIO * 100}%` }}
        className="absolute inset-x-0 bottom-0 z-30 bg-white border-t border-line-trip rounded-t-[22px] shadow-[0_-8px_28px_rgba(0,0,0,0.13)] flex flex-col"
      >
        {/* 손잡이 — 끌어서 움직이고, 가볍게 누르면 한 단계씩 넘어간다 */}
        <button
          onPointerDown={(e) => dragControls.start(e)}
          onClick={cycleSheet}
          className="w-full pt-3 pb-2 flex justify-center shrink-0 cursor-grab active:cursor-grabbing group touch-none"
          title={t.nearbyList}
        >
          <span className="w-10 h-1.5 rounded-full bg-line-trip group-hover:bg-primary/50 transition-colors" />
        </button>

        {/* 탭 */}
        <div className="px-3 pb-2 flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => openTab('list')}
            className={`text-[11px] font-black rounded-full px-3 py-1.5 transition-all cursor-pointer ${
              sheetTab === 'list' ? 'bg-primary text-white shadow-sm' : 'bg-soft-trip/60 text-neutral-600 hover:bg-soft-trip'
            }`}
          >
            {t.nearbyList} {visible.length > 0 && visible.length}
          </button>
          {recommendations.length > 0 && (
            <button
              onClick={() => openTab('recommend')}
              className={`text-[11px] font-black rounded-full px-3 py-1.5 transition-all cursor-pointer inline-flex items-center gap-1 ${
                sheetTab === 'recommend' ? 'bg-primary text-white shadow-sm' : 'bg-soft-trip/60 text-neutral-600 hover:bg-soft-trip'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              {t.recommendTitle}
            </button>
          )}
          {loading && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin ml-auto" />}
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
          {error && (
            <div className="bg-danger-trip/5 border border-danger-trip/20 rounded-xl p-3 text-[11px] text-danger-trip">
              {error}
            </div>
          )}

          {sheetTab === 'recommend'
            ? recommendations.map((rec) => (
                <button
                  key={rec.restaurant.restaurant_id}
                  onClick={() => {
                    playBeep();
                    onSelectRestaurant(rec.restaurant);
                  }}
                  className="w-full text-left bg-gradient-to-br from-white to-soft-trip/40 border border-line-trip rounded-2xl p-3 hover:border-primary/50 transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-black text-neutral-900 truncate">{rec.restaurant.name}</div>
                    <div className="text-sm font-black text-primary shrink-0">{Math.round(rec.score * 100)}</div>
                  </div>
                  <div className="text-[10px] text-muted-trip truncate">
                    {rec.restaurant.category || '-'} · {formatDistance(rec.restaurant.distance_m)}
                  </div>
                  {rec.reasons[0] && (
                    <div className="mt-1 text-[10px] font-bold text-primary leading-snug">
                      {format(t[rec.reasons[0].key] || '', { n: rec.reasons[0].value ?? 0 })}
                    </div>
                  )}
                </button>
              ))
            : null}

          {sheetTab === 'list' && !loading && visible.length === 0 && (
            <div className="bg-white border border-line-trip rounded-2xl p-5 text-center space-y-2">
              {unavailable ? (
                <>
                  <p className="text-xs font-bold text-neutral-700">
                    {unavailable === 'quota' ? t.placesQuotaTitle : t.placesFailedTitle}
                  </p>
                  <p className="text-[11px] text-muted-trip leading-relaxed">{t.placesUnavailableHelp}</p>
                </>
              ) : safeOnly ? (
                /*
                 * '메뉴 확인된 곳' 으로 걸렀는데 아무것도 없는 상황.
                 * 이때 그냥 '식당 없음' 이라고만 하면 '근처에 안전한 식당이 없다'로
                 * 읽힌다. 실제로는 아직 아무도 메뉴를 등록하지 않은 것이므로,
                 * 그 차이를 분명히 밝히고 등록할 수 있는 길을 안내한다.
                 */
                <>
                  <p className="text-xs font-black text-neutral-800">{t.noMenuDataTitle}</p>
                  <p className="text-[11px] text-muted-trip leading-relaxed">
                    {format(t.noMenuDataBody || '', { n: withMenuCount })}
                  </p>
                  <button
                    onClick={() => {
                      playBeep();
                      onGoCamera();
                    }}
                    className="w-full border-0 rounded-xl py-2.5 bg-gradient-to-r from-primary to-primary2 text-white font-black text-[11px] shadow-md hover:scale-[1.01] active:scale-95 transition-all cursor-pointer"
                  >
                    {t.goShootMenu}
                  </button>
                </>
              ) : (
                <p className="text-xs font-bold text-neutral-700">{t.noRestaurants}</p>
              )}
            </div>
          )}

          {sheetTab === 'list' &&
            visible.map((r) => {
              const rec = scoreById.get(r.restaurant_id);
              return (
                <button
                  key={r.restaurant_id || r.place_id}
                  onClick={() => {
                    playBeep();
                    onSelectRestaurant(r);
                  }}
                  className="w-full text-left bg-white border border-line-trip rounded-2xl p-3 flex gap-3 items-center hover:border-primary/50 hover:bg-soft-trip/20 transition-all cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-xl bg-soft-trip flex items-center justify-center shrink-0 overflow-hidden">
                    {r.photo_url ? (
                      <img src={r.photo_url} alt={r.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Utensils className="w-5 h-5 text-primary" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-black text-neutral-900 truncate">{r.name}</div>
                    <div className="text-[10px] text-muted-trip truncate">{r.category || r.address || '-'}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {r.rating != null && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                          <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                          {r.rating.toFixed(1)}
                          {r.review_count != null && <span className="text-muted-trip font-normal">({r.review_count})</span>}
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-muted-trip">{formatDistance(r.distance_m)}</span>
                      {(r.menu_count ?? 0) > 0 && (
                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5">
                          {t.restaurantMenus} {r.menu_count}
                        </span>
                      )}
                    </div>
                  </div>

                  {rec && (
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] text-muted-trip font-bold">{t.matchScore}</div>
                      <div className="text-sm font-black text-primary">{Math.round(rec.score * 100)}</div>
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      </motion.div>
    </motion.section>
  );
};
