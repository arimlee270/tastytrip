import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, Crosshair, Loader2, Search, Store, Utensils, X } from 'lucide-react';
import * as api from '../lib/api';
import { formatDistance, getCurrentPosition, type Coords } from '../lib/maps';
import type { Dish, Restaurant } from '../types';

/**
 * 계획서 5.2 / 5.3 — 분석 결과를 식당에 등록한다.
 * 사용자가 등록해 줄수록 그 가게의 메뉴 데이터가 쌓이고,
 * 다음 방문자는 AI 호출 없이 바로 조회할 수 있다.
 */

interface RegisterToRestaurantModalProps {
  dishes: Dish[];
  t: Record<string, any>;
  langCode: string;
  travelCountry: string;
  onClose: () => void;
  onRegistered: (restaurant: { restaurant_id: string; name: string }, count: number) => void;
  playBeep: () => void;
}

export const RegisterToRestaurantModal: React.FC<RegisterToRestaurantModalProps> = ({
  dishes,
  t,
  langCode,
  onClose,
  onRegistered,
  playBeep,
}) => {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [query, setQuery] = useState('');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 처음 열면 현재 위치 주변 식당을 보여준다. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const pos = await getCurrentPosition();
        if (cancelled) return;
        setCoords(pos);
        const res = await api.fetchNearby({ lat: pos.lat, lng: pos.lng, radius: 800, lang: langCode });
        if (!cancelled) setRestaurants(res.restaurants);
      } catch {
        // 위치를 못 받으면 검색으로 찾게 안내한다.
        if (!cancelled) setError(t.locationDenied);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [langCode, t.locationDenied]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.searchRestaurants({
        q: query.trim(),
        lat: coords?.lat,
        lng: coords?.lng,
        lang: langCode,
      });
      setRestaurants(res.restaurants);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const register = async (restaurant: Restaurant) => {
    setBusyId(restaurant.restaurant_id);
    setError(null);
    try {
      const res = await api.registerMenusToRestaurant(restaurant.restaurant_id, dishes, langCode);
      playBeep();
      onRegistered({ restaurant_id: restaurant.restaurant_id, name: restaurant.name }, res.registered);
    } catch (err: any) {
      setError(err.message || '등록에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-bg-trip border border-line-trip rounded-[28px] p-5 shadow-2xl w-full max-w-[360px] max-h-[80vh] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-trip/60 pb-3">
          <div className="flex items-center gap-2 text-primary">
            <Store className="w-4 h-4" />
            <h2 className="text-sm font-black text-neutral-900">{t.registerTitle}</h2>
          </div>
          <button
            onClick={onClose}
            className="bg-soft-trip hover:bg-line-trip/40 p-1.5 rounded-full transition-all cursor-pointer text-neutral-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-[11px] text-muted-trip leading-relaxed">{t.registerSub}</p>

        <div className="bg-soft-trip/50 border border-line-trip rounded-xl p-2.5">
          <div className="text-[11px] font-black text-neutral-800 mb-1">
            {t.registerDishCount?.replace('{n}', String(dishes.length)) ?? `${dishes.length}개 메뉴`}
          </div>
          <div className="text-[10px] text-muted-trip leading-relaxed line-clamp-2">
            {dishes.map((d) => d.name).join(', ')}
          </div>
        </div>

        <form onSubmit={search} className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-muted-trip absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full text-xs border border-line-trip rounded-xl bg-white pl-8 pr-3 py-2.5 outline-none text-neutral-800 focus:border-primary transition-all"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 bg-primary hover:bg-primary2 text-white rounded-xl px-3 transition-all cursor-pointer flex items-center justify-center border-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          </button>
        </form>

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
          {!loading && restaurants.length === 0 && (
            <p className="text-[11px] text-muted-trip text-center py-6">{t.noRestaurants}</p>
          )}

          {restaurants.map((r) => (
            <button
              key={r.restaurant_id || r.place_id}
              onClick={() => register(r)}
              disabled={busyId !== null}
              className="w-full text-left bg-white border border-line-trip rounded-xl p-2.5 flex items-center gap-2.5 hover:border-primary/50 transition-all cursor-pointer disabled:opacity-50"
            >
              <div className="w-8 h-8 rounded-lg bg-soft-trip flex items-center justify-center shrink-0">
                <Utensils className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black text-neutral-900 truncate">{r.name}</div>
                <div className="text-[10px] text-muted-trip truncate">
                  {r.category || '-'} · {formatDistance(r.distance_m)}
                  {(r.menu_count ?? 0) > 0 && ` · ${t.restaurantMenus} ${r.menu_count}`}
                </div>
              </div>
              {busyId === r.restaurant_id ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
              ) : (
                <Check className="w-4 h-4 text-muted-trip shrink-0" />
              )}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};
