import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Bookmark,
  Check,
  Clock,
  LogIn,
  LogOut,
  Save,
  Trash2,
  User as UserIcon,
  Search,
} from 'lucide-react';
import * as api from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Member, Restaurant } from '../types';
import { COUNTRY_LIST } from '../lib/maps';

/**
 * 계획서 14.2 — 내 정보 화면.
 * 기존 STEP 1(여정 설정) / STEP 2(안심 필터) 를 하나의 탭으로 통합하고,
 * 계정, 저장한 식당, 분석 기록을 추가했다.
 */

interface ProfileScreenProps {
  t: Record<string, any>;
  langCode: string;
  party: Member[];
  homeCountry: string;
  displayLanguage: string;
  travelCountry: string;
  onChangeHomeCountry: (v: string) => void;
  onChangeDisplayLanguage: (v: string) => void;
  onChangeTravelCountry: (v: string) => void;
  onChangeParty: (party: Member[]) => void;
  onGoLogin: () => void;
  onSelectRestaurant: (restaurant: Restaurant) => void;
  playBeep: () => void;
}

const selectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 20 20'%3E%3Cpath fill='%238b746c' d='m5 7 5 6 5-6z'/%3E%3C/svg%3E")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
};

const COUNTRY_KEYS = COUNTRY_LIST;

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  t,
  langCode,
  party,
  homeCountry,
  displayLanguage,
  travelCountry,
  onChangeHomeCountry,
  onChangeDisplayLanguage,
  onChangeTravelCountry,
  onChangeParty,
  onGoLogin,
  onSelectRestaurant,
  playBeep,
}) => {
  const { user, isLoggedIn, logout, pushParty } = useAuth();
  const [savedRestaurants, setSavedRestaurants] = useState<Restaurant[]>([]);
  const [history, setHistory] = useState<{ searched_at: string; query_text: string; restaurant_name: string | null }[]>([]);
  const [savedMsg, setSavedMsg] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);

  /** 입력한 글자로 나라를 걸러낸다. 한국어 이름과 영문 키를 모두 본다. */
  const countryMatches = (() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRY_KEYS;
    return COUNTRY_KEYS.filter((c) => {
      const label = String(t.countries?.[c] || c).toLowerCase();
      return c.toLowerCase().includes(q) || label.includes(q);
    });
  })();

  useEffect(() => {
    if (!isLoggedIn) {
      setSavedRestaurants([]);
      setHistory([]);
      return;
    }
    api
      .fetchSavedRestaurants()
      .then((r) => setSavedRestaurants(r.restaurants))
      .catch(() => setSavedRestaurants([]));
    api
      .fetchHistory()
      .then((r) => setHistory(r.history))
      .catch(() => setHistory([]));
  }, [isLoggedIn]);

  const handleAddMember = () => {
    const defaultNames: Record<string, string> = {
      ko: `여행자 ${party.length + 1}`,
      en: `Traveler ${party.length + 1}`,
      ja: `旅行者 ${party.length + 1}`,
      zh: `旅行者 ${party.length + 1}`,
      fr: `Voyageur ${party.length + 1}`,
      th: `ผู้ร่วมเดินทาง ${party.length + 1}`,
      bn: `ভ্রমণকারী ${party.length + 1}`,
    };
    onChangeParty([
      ...party,
      {
        id: `m-${Date.now()}-${party.length}`,
        name: defaultNames[langCode] || `Traveler ${party.length + 1}`,
        allergies: [],
        diets: [],
        notes: '',
      },
    ]);
    playBeep();
  };

  const handleRemoveMember = (id: string) => {
    if (party.length <= 1) return;
    onChangeParty(party.filter((m) => m.id !== id));
    playBeep();
  };

  const handleToggleRestriction = (memberId: string, type: 'allergies' | 'diets', item: string) => {
    onChangeParty(
      party.map((m) => {
        if (m.id !== memberId) return m;
        const list = m[type];
        return { ...m, [type]: list.includes(item) ? list.filter((x) => x !== item) : [...list, item] };
      })
    );
  };

  const saveToAccount = async () => {
    await pushParty(party);
    playBeep();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  return (
    <motion.section
      key="me"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div>
        <span className="kicker text-[11px] font-black text-primary tracking-wider uppercase block mb-1">PROFILE</span>
        <h1 className="title text-2xl font-black text-neutral-900 tracking-tight leading-none">{t.myProfileTitle}</h1>
        <p className="sub text-xs text-muted-trip mt-1">{t.myProfileSub}</p>
      </div>

      {/* 계정 */}
      <div className="bg-white border border-line-trip rounded-2xl p-3.5 shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full bg-soft-trip flex items-center justify-center shrink-0">
            <UserIcon className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black text-neutral-900 truncate">
              {isLoggedIn ? user?.nickname : t.guestMode}
            </div>
            <div className="text-[10px] text-muted-trip truncate">{isLoggedIn ? user?.email : t.syncNotice}</div>
          </div>
        </div>

        {isLoggedIn ? (
          <button
            onClick={() => {
              logout();
              playBeep();
            }}
            className="shrink-0 text-[11px] font-black text-muted-trip hover:text-danger-trip border border-line-trip rounded-xl px-2.5 py-1.5 flex items-center gap-1 transition-all cursor-pointer bg-white"
          >
            <LogOut className="w-3 h-3" />
            {t.logoutBtn}
          </button>
        ) : (
          <button
            onClick={onGoLogin}
            className="shrink-0 text-[11px] font-black text-white bg-primary hover:bg-primary2 rounded-xl px-3 py-1.5 flex items-center gap-1 transition-all cursor-pointer border-0"
          >
            <LogIn className="w-3 h-3" />
            {t.loginBtn}
          </button>
        )}
      </div>

      {/* 여정 설정 (기존 STEP 1) */}
      <div className="bg-gradient-to-br from-white to-soft-trip/50 border border-line-trip rounded-[22px] p-4 shadow-sm space-y-3">
        <h2 className="text-xs font-black text-neutral-900">{t.step1Title}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="label text-[12px] font-bold text-neutral-800" htmlFor="home-country">
              {t.homeCountryLabel}
            </label>
            <select
              id="home-country"
              value={homeCountry}
              onChange={(e) => onChangeHomeCountry(e.target.value)}
              className="w-full border border-line-trip rounded-2xl bg-white p-3 pr-8 outline-none text-xs text-neutral-800 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all appearance-none cursor-pointer"
              style={selectStyle}
            >
              {COUNTRY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {t.countries?.[c] || c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="label text-[12px] font-bold text-neutral-800" htmlFor="display-language">
              {t.displayLanguageLabel}
            </label>
            <select
              id="display-language"
              value={displayLanguage}
              onChange={(e) => onChangeDisplayLanguage(e.target.value)}
              className="w-full border border-line-trip rounded-2xl bg-white p-3 pr-8 outline-none text-xs text-neutral-800 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all appearance-none cursor-pointer"
              style={selectStyle}
            >
              <option value="한국어">한국어 (Korean)</option>
              <option value="English">English</option>
              <option value="日本語">日本語 (Japanese)</option>
              <option value="简体中文">简体中文 (Chinese)</option>
              <option value="Français">Français (French)</option>
              <option value="ไทย">ไทย (Thai)</option>
              <option value="বাংলা">বাংলা (Bengali)</option>
            </select>
          </div>

          <div className="col-span-2 space-y-2">
            <label className="label text-[12px] font-bold text-neutral-800" htmlFor="travel-country">
              {t.travelCountryLabel}
            </label>
            {/*
             * 나라가 65개라 목록에서 훑기 어렵다.
             * 입력창에 몇 글자만 쳐서 걸러낸 뒤 고르도록 한다.
             */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-trip absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="travel-country"
                type="text"
                value={countryOpen ? countryQuery : t.countries?.[travelCountry] || travelCountry}
                onChange={(e) => {
                  setCountryQuery(e.target.value);
                  setCountryOpen(true);
                }}
                onFocus={() => {
                  setCountryQuery('');
                  setCountryOpen(true);
                }}
                onBlur={() => {
                  // 목록의 항목을 누를 시간을 준 뒤 닫는다.
                  setTimeout(() => setCountryOpen(false), 150);
                }}
                placeholder={t.countrySearchPlaceholder}
                className="w-full border border-line-trip rounded-2xl bg-white p-3 pl-9 outline-none text-sm font-bold text-neutral-800 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all cursor-pointer"
              />

              {countryOpen && (
                <div className="absolute z-30 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto bg-white border border-line-trip rounded-2xl shadow-lg py-1">
                  {countryMatches.length === 0 && (
                    <div className="px-3 py-2.5 text-[11px] text-muted-trip">{t.countryNoMatch}</div>
                  )}
                  {countryMatches.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChangeTravelCountry(c);
                        setCountryOpen(false);
                        setCountryQuery('');
                        playBeep();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors cursor-pointer ${
                        c === travelCountry ? 'bg-soft-trip text-primary' : 'text-neutral-700 hover:bg-soft-trip/50'
                      }`}
                    >
                      {t.countries?.[c] || c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 여행 구성원 (기존 STEP 2) */}
      <div className="flex items-center justify-between bg-white border border-line-trip rounded-2xl p-3.5 shadow-sm">
        <div className="text-xs">
          <span className="font-extrabold text-neutral-800 block">
            {langCode === 'en' ? 'Travel Companions' : '여행 동반 구성원'}
          </span>
          <span className="text-[10px] text-muted-trip">
            {langCode === 'en' ? 'Total' : '총'} {party.length}
            {langCode === 'en' ? ' traveler(s)' : '명'}
          </span>
        </div>
        <button
          onClick={handleAddMember}
          className="bg-primary hover:bg-primary2 text-white border-0 rounded-xl px-4 py-2 text-xs font-black shadow-xs transition-all flex items-center gap-1 cursor-pointer"
          id="btn-add-member"
        >
          {t.addMember}
        </button>
      </div>

      <div className="stack space-y-4">
        {party.map((member, idx) => (
          <div key={member.id} className="member bg-white border border-line-trip rounded-[22px] p-4 shadow-sm space-y-3">
            <div className="member-head flex items-center justify-between border-b border-soft-trip pb-2">
              <div className="flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-primary" />
                <input
                  type="text"
                  value={member.name}
                  onChange={(e) =>
                    onChangeParty(party.map((m) => (m.id === member.id ? { ...m, name: e.target.value } : m)))
                  }
                  className="member-name font-black text-sm text-neutral-900 bg-transparent border-0 border-b border-transparent focus:border-primary/40 focus:ring-0 p-0 outline-none w-32"
                  placeholder={langCode === 'en' ? `Traveler ${idx + 1}` : `구성원 ${idx + 1}`}
                />
              </div>

              <div className="flex items-center gap-1.5">
                {idx > 0 ? (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="text-xs text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl px-2.5 py-1 flex items-center gap-1 font-bold cursor-pointer transition-all"
                    title={t.removeMember}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{t.removeMember}</span>
                  </button>
                ) : (
                  <span className="pill text-[10px] font-black text-primary bg-soft-trip rounded-full px-2.5 py-1">
                    {t.filterDesignator}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="mini-label text-[11px] font-black text-neutral-800">{t.allergyLabel}</div>
              <div className="chips flex flex-wrap gap-1.5">
                {t.allergiesList.map((allergy: any) => {
                  const isChecked = member.allergies.includes(allergy.key);
                  return (
                    <label key={allergy.key} className="chip relative cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleRestriction(member.id, 'allergies', allergy.key)}
                        className="absolute opacity-0 pointer-events-none"
                      />
                      <span
                        className={`inline-flex border rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                          isChecked
                            ? 'bg-soft-trip border-primary text-primary font-bold'
                            : 'bg-white border-line-trip text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {allergy.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="mini-label text-[11px] font-black text-neutral-800">{t.dietLabel}</div>
              <div className="chips flex flex-wrap gap-1.5">
                {t.dietsList.map((diet: any) => {
                  const isChecked = member.diets.includes(diet.key);
                  return (
                    <label key={diet.key} className="chip relative cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleRestriction(member.id, 'diets', diet.key)}
                        className="absolute opacity-0 pointer-events-none"
                      />
                      <span
                        className={`inline-flex border rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                          isChecked
                            ? 'bg-soft-trip border-primary text-primary font-bold'
                            : 'bg-white border-line-trip text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {diet.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <div className="mini-label text-[11px] font-black text-neutral-800">{t.customNotesLabel}</div>
              <textarea
                rows={2}
                value={member.notes}
                onChange={(e) =>
                  onChangeParty(party.map((m) => (m.id === member.id ? { ...m, notes: e.target.value } : m)))
                }
                placeholder={t.customNotesPlaceholder}
                className="w-full text-xs border border-line-trip rounded-xl bg-white p-2 outline-none text-neutral-800 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all resize-none"
              />
            </div>
          </div>
        ))}
      </div>

      {isLoggedIn ? (
        <button
          onClick={saveToAccount}
          className="w-full border-0 rounded-2xl p-3.5 bg-gradient-to-r from-primary to-primary2 text-white font-black text-xs shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          {savedMsg ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{savedMsg ? t.profileSaved : t.saveProfileBtn}</span>
        </button>
      ) : (
        /*
         * 게스트 모드에도 저장 버튼이 없을 뿐 실제로는 수정할 때마다 기기에 바로 저장된다.
         * 버튼이 없어서 저장이 안 되는 것으로 오해하지 않도록 명시해 준다.
         */
        <div className="bg-soft-trip/40 border border-primary/20 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs font-black text-neutral-800">{t.guestAutoSaveTitle}</span>
          </div>
          <p className="text-[11px] text-muted-trip leading-relaxed">{t.guestAutoSaveBody}</p>
          <button
            onClick={() => {
              playBeep();
              onGoLogin();
            }}
            className="w-full border-0 rounded-xl py-2.5 bg-gradient-to-r from-primary to-primary2 text-white font-black text-[11px] shadow-md shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
          >
            {t.loginBtn}
          </button>
        </div>
      )}

      {/* 저장한 식당 */}
      {isLoggedIn && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Bookmark className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-black text-neutral-800">{t.savedRestaurants}</span>
          </div>
          {savedRestaurants.length === 0 ? (
            <div className="bg-white border border-line-trip rounded-2xl p-4 text-center text-[11px] text-muted-trip">
              {t.noRestaurants}
            </div>
          ) : (
            savedRestaurants.map((r) => (
              <button
                key={r.restaurant_id}
                onClick={() => onSelectRestaurant(r)}
                className="w-full text-left bg-white border border-line-trip rounded-2xl p-3 hover:border-primary/50 transition-all cursor-pointer"
              >
                <div className="text-xs font-black text-neutral-900 truncate">{r.name}</div>
                <div className="text-[10px] text-muted-trip truncate">{r.address || r.category || '-'}</div>
              </button>
            ))
          )}
        </div>
      )}

      {/* 분석 기록 */}
      {isLoggedIn && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-black text-neutral-800">{t.analysisHistory}</span>
          </div>
          {history.length === 0 ? (
            <div className="bg-white border border-line-trip rounded-2xl p-4 text-center text-[11px] text-muted-trip">
              {t.noHistory}
            </div>
          ) : (
            <div className="bg-white border border-line-trip rounded-2xl divide-y divide-line-trip/60">
              {history.slice(0, 10).map((h, i) => (
                <div key={i} className="p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-neutral-800 truncate">{h.query_text}</div>
                    {h.restaurant_name && <div className="text-[10px] text-muted-trip truncate">{h.restaurant_name}</div>}
                  </div>
                  <span className="text-[10px] text-muted-trip shrink-0">{h.searched_at.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
};
