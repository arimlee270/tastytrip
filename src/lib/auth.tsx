import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from './api';
import type { Companion, Member, User, UserProfile } from '../types';

/**
 * 로그인 상태 컨텍스트.
 * 로그인하지 않아도 기존 기능은 그대로 쓸 수 있고(게스트 모드),
 * 로그인하면 프로필과 동반인 정보가 계정에 저장된다. (계획서 3장)
 */

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  companions: Companion[];
  loading: boolean;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  signup: (body: { email: string; password: string; nickname?: string }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** 화면의 여행 구성원 목록을 계정에 저장 */
  pushParty: (party: Member[]) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** 계정에 저장된 프로필/동반인을 화면용 Member[] 로 변환 */
export const accountToParty = (
  user: User | null,
  profile: UserProfile | null,
  companions: Companion[]
): Member[] => {
  if (!user) return [];
  return [
    {
      id: 'self',
      name: user.nickname || '여행자 1',
      allergies: profile?.allergies ?? [],
      diets: profile?.dietary_tags ?? [],
      notes: profile?.preference_text ?? '',
    },
    ...companions.map((c) => ({
      id: c.companion_id,
      name: c.nickname,
      allergies: c.allergies,
      diets: c.dietary_tags,
      notes: (c.avoid_ingredients || []).join(', '),
    })),
  ];
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!api.getToken()) {
      setUser(null);
      setProfile(null);
      setCompanions([]);
      setLoading(false);
      return;
    }
    try {
      const me = await api.fetchMe();
      setUser(me.user);
      setProfile(me.profile);
      setCompanions(me.companions);
    } catch {
      // 토큰이 만료되었거나 서버가 계정을 모르면 게스트로 되돌린다.
      api.setToken(null);
      setUser(null);
      setProfile(null);
      setCompanions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      api.setToken(res.token);
      setUser(res.user);
      setProfile(res.profile);
      await refresh();
    },
    [refresh]
  );

  const loginWithGoogle = useCallback(
    async (credential: string) => {
      const res = await api.loginWithGoogle(credential);
      api.setToken(res.token);
      setUser(res.user);
      setProfile(res.profile);
      await refresh();
    },
    [refresh]
  );

  const signup = useCallback(
    async (body: { email: string; password: string; nickname?: string }) => {
      const res = await api.signup(body);
      api.setToken(res.token);
      setUser(res.user);
      setProfile(res.profile);
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(() => {
    api.setToken(null);
    setUser(null);
    setProfile(null);
    setCompanions([]);
  }, []);

  const pushParty = useCallback(
    async (party: Member[]) => {
      if (!api.getToken()) return;
      await api.syncParty(party);
      await refresh();
    },
    [refresh]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      companions,
      loading,
      isLoggedIn: !!user,
      login,
      loginWithGoogle,
      signup,
      logout,
      refresh,
      pushParty,
    }),
    [user, profile, companions, loading, login, loginWithGoogle, signup, logout, refresh, pushParty]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
