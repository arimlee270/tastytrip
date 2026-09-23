import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Camera,
  ChevronLeft,
  ExternalLink,
  Loader2,
  MapPin,
  Star,
  Utensils,
  Store,
} from 'lucide-react';
import * as api from '../lib/api';
import { formatDistance } from '../lib/maps';
import { format } from '../i18n';
import { DishCard } from '../components/DishCard';
import { ReportModal } from '../components/ReportModal';
import { useAuth } from '../lib/auth';
import type { Dish, Member, Restaurant } from '../types';

/** 계획서 4.3 / 5.1 / 5.2 — 식당 상세 및 식당별 메뉴 */

interface RestaurantScreenProps {
  restaurant: Restaurant;
  t: Record<string, any>;
  langCode: string;
  party: Member[];
  onBack: () => void;
  /** 이 식당의 메뉴판을 촬영하러 카메라 화면으로 이동 */
  onShootMenu: (restaurant: Restaurant) => void;
  onOpenLightbox: (url: string, name: string) => void;
  onAddReview: (dish: Dish, comment: string, rating: number) => void;
  onEditReview: (dish: Dish, reviewId: string, comment: string) => void;
  onDeleteReview: (dish: Dish, reviewId: string) => void;
  playBeep: () => void;
}

export const RestaurantScreen: React.FC<RestaurantScreenProps> = ({
  restaurant,
  t,
  langCode,
  party,
  onBack,
  onShootMenu,
  onOpenLightbox,
  onAddReview,
  onEditReview,
  onDeleteReview,
  playBeep,
}) => {
  const { isLoggedIn } = useAuth();
  const [detail, setDetail] = useState<Restaurant>(restaurant);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [lastVerifiedDays, setLastVerifiedDays] = useState<number | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
  const [reportTarget, setReportTarget] = useState<Dish | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  /** 같은 프랜차이즈 다른 지점에 등록된 메뉴 (참고용) */
  const [branchMenus, setBranchMenus] = useState<api.BranchMenu[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 저장된 정보가 다른 언어로 받아온 것이면 현재 표시 언어로 다시 받아온다.
      if (restaurant.place_id && restaurant.language_code !== langCode) {
        try {
          await api.syncPlace(restaurant.place_id, langCode);
        } catch {
          /* 동기화 실패 시 저장된 정보를 그대로 사용한다. */
        }
      }

      const [info, menus] = await Promise.all([
        api.fetchRestaurant(restaurant.restaurant_id, { lang: langCode }),
        api.fetchRestaurantMenus(restaurant.restaurant_id, { lang: langCode, party }),
      ]);
      setDetail({ ...restaurant, ...info.restaurant });
      setSaved(info.saved);
      setLastVerifiedDays(info.last_verified_days);
      setDishes(menus.dishes);

      const rec = await api.fetchRestaurantRecommendations({
        lat: info.restaurant.latitude ?? undefined,
        lng: info.restaurant.longitude ?? undefined,
        lang: langCode,
        party,
      });
      const mine = rec.recommendations.find((r) => r.restaurant.restaurant_id === restaurant.restaurant_id);
      setMatchScore(mine ? Math.round(mine.score * 100) : null);

      // 프랜차이즈면 다른 지점 메뉴를 참고로 가져온다. 실패해도 화면에는 지장이 없다.
      api
        .fetchBranchMenus(restaurant.restaurant_id)
        .then((r) => setBranchMenus(r.menus))
        .catch(() => setBranchMenus([]));
    } catch (err: any) {
      setError(err.message || '식당 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [restaurant, langCode, party]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 구글 지도의 해당 가게 페이지 주소.
   * Place ID 가 있으면 정확히 그 가게로, 데모 데이터면 이름/주소 검색으로 연결한다.
   */
  const googleMapsUrl = (() => {
    const query = encodeURIComponent(`${detail.name} ${detail.address || ''}`.trim());
    const isRealPlaceId = detail.place_id && !detail.place_id.startsWith('demo_');
    return isRealPlaceId
      ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(detail.place_id)}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`;
  })();

  const toggleSave = async () => {
    if (!isLoggedIn) {
      setError(t.loginRequired);
      return;
    }
    try {
      const res = saved
        ? await api.unsaveRestaurant(detail.restaurant_id)
        : await api.saveRestaurant(detail.restaurant_id);
      setSaved(res.saved);
      playBeep();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <motion.section
      key={`restaurant-${detail.restaurant_id}`}
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={onBack}
          className="shrink-0 border border-line-trip bg-white hover:bg-soft-trip/30 text-primary rounded-full p-1.5 transition-all cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          {/* 식당 이름은 길어도 전부 보이도록 줄바꿈한다. */}
          <h1 className="title text-lg font-black text-neutral-900 tracking-tight leading-snug break-words">
            {detail.name}
          </h1>
          <p className="text-[11px] text-muted-trip leading-snug break-words mt-0.5">{detail.address || '-'}</p>
        </div>
        <button
          onClick={toggleSave}
          className={`shrink-0 border rounded-full p-1.5 transition-all cursor-pointer ${
            saved ? 'bg-primary border-primary text-white' : 'bg-white border-line-trip text-primary hover:bg-soft-trip/30'
          }`}
          title={saved ? t.savedRestaurantBtn : t.saveRestaurantBtn}
        >
          {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
        </button>
      </div>

      {/* 기본 정보 */}
      <div className="bg-white border border-line-trip rounded-2xl p-3.5 shadow-sm space-y-2.5">
        <div className="flex items-center gap-3 text-[11px]">
          {detail.rating != null && (
            <span className="inline-flex items-center gap-0.5 font-bold text-amber-600">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              {detail.rating.toFixed(1)}
              {detail.review_count != null && (
                <span className="text-muted-trip font-normal">
                  ({detail.review_count} {t.reviewCountLabel})
                </span>
              )}
            </span>
          )}
          {detail.distance_m != null && (
            <span className="inline-flex items-center gap-0.5 font-bold text-muted-trip">
              <MapPin className="w-3 h-3" />
              {formatDistance(detail.distance_m)}
            </span>
          )}
          <span className="font-bold text-muted-trip">{detail.category || '-'}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {matchScore != null && (
            <span className="text-[10px] font-black text-primary bg-soft-trip border border-primary/30 rounded-full px-2 py-0.5">
              {t.matchScore} {matchScore}
            </span>
          )}
          {lastVerifiedDays != null && (
            <span className="text-[10px] font-bold text-muted-trip bg-white border border-line-trip rounded-full px-2 py-0.5">
              {t.lastVerified} D-{lastVerifiedDays}
            </span>
          )}
          {(detail.menu_count ?? dishes.length) > 0 && (
            <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              {t.savedFromDb}
            </span>
          )}
        </div>

        <button
          onClick={() => {
            playBeep();
            onShootMenu(detail);
          }}
          className="w-full border-0 rounded-xl py-3 bg-gradient-to-r from-primary to-primary2 text-white font-black text-xs shadow-md shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <Camera className="w-4 h-4" />
          <span>{t.shootMenuBtn}</span>
        </button>

        {/* 아직 메뉴 데이터가 없어도 구글 지도에서 가게 정보를 확인할 수 있게 한다. */}
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={playBeep}
          className="w-full border border-line-trip rounded-xl py-2.5 bg-white text-neutral-600 hover:text-primary hover:bg-soft-trip/35 font-black text-[11px] transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>{t.openInGoogleMaps}</span>
        </a>
      </div>

      {error && (
        <div className="bg-danger-trip/5 border border-danger-trip/20 rounded-xl p-3 text-[11px] text-danger-trip flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 메뉴 목록 */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs font-black text-neutral-800">
          {t.restaurantMenus} {dishes.length > 0 ? `(${dishes.length})` : ''}
        </span>
        {loading && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />}
      </div>

      {!loading && dishes.length === 0 && (
        <div className="bg-white border border-line-trip rounded-2xl p-5 text-center space-y-2">
          <Utensils className="w-6 h-6 text-primary mx-auto" />
          <p className="text-xs font-black text-neutral-800">{t.noMenuTitle}</p>
          <p className="text-[11px] text-muted-trip leading-relaxed">{t.noMenuBody}</p>
        </div>
      )}

      <div className="space-y-3">
        {dishes.map((dish, idx) => (
          <DishCard
            key={dish.menu_id || idx}
            dish={dish}
            index={idx}
            isOpen={activeCardIndex === idx}
            onToggle={() => setActiveCardIndex(activeCardIndex === idx ? null : idx)}
            t={t}
            langCode={langCode}
            onOpenLightbox={onOpenLightbox}
            onAddReview={(comment, rating) => onAddReview(dish, comment, rating)}
            onEditReview={(reviewId, comment) => onEditReview(dish, reviewId, comment)}
            onDeleteReview={(reviewId) => onDeleteReview(dish, reviewId)}
            onReport={(d) => setReportTarget(d)}
            playBeep={playBeep}
          />
        ))}
      </div>

      {/*
        같은 프랜차이즈 다른 지점의 메뉴.
        이 지점 메뉴로 섞지 않고 따로 묶어 보여준다. 지점마다 안 파는 메뉴가
        있어서, 있는 것처럼 보이면 손님이 없는 메뉴를 주문하게 된다.
      */}
      {branchMenus.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-1">
            <Store className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-black text-neutral-800">{t.branchMenusTitle}</span>
          </div>

          <p className="text-[11px] text-muted-trip leading-relaxed">{t.branchMenusNote}</p>

          <div className="bg-white border border-dashed border-line-trip rounded-2xl divide-y divide-line-trip/60">
            {branchMenus.map((m, i) => (
              <div key={i} className="p-2.5 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-soft-trip flex items-center justify-center shrink-0 overflow-hidden">
                  {m.image_url ? (
                    <img
                      src={m.image_url}
                      alt={m.translated_name || m.original_name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Utensils className="w-4 h-4 text-primary" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-neutral-800 truncate">
                    {m.translated_name || m.original_name}
                  </div>
                  <div className="text-[10px] text-muted-trip truncate">
                    {m.branch_count > 1 ? format(t.branchMenusFrom, { n: m.branch_count }) : m.from_branch}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              playBeep();
              onShootMenu(detail);
            }}
            className="w-full border border-line-trip rounded-xl py-2.5 bg-white text-neutral-600 hover:text-primary hover:bg-soft-trip/35 font-black text-[11px] transition-all cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{t.branchMenusCheck}</span>
          </button>
        </div>
      )}

      {reportTarget && (
        <ReportModal
          dish={reportTarget}
          t={t}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            setReportTarget(null);
            load();
          }}
          playBeep={playBeep}
        />
      )}
    </motion.section>
  );
};
