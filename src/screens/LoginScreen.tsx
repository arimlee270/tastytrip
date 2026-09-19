import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { LogIn, Mail, Lock, User as UserIcon, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import * as api from '../lib/api';
import { renderGoogleButton } from '../lib/googleSignIn';

/** 계획서 14.1 로그인 화면 */

interface LoginScreenProps {
  t: Record<string, any>;
  langCode: string;
  onDone: () => void;
  onGuest: () => void;
  playBeep: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ t, langCode, onDone, onGuest, playBeep }) => {
  const { login, loginWithGoogle, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  // 구글 로그인 버튼 (클라이언트 ID 가 설정된 경우에만 표시)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    api
      .fetchConfig()
      .then(async (config) => {
        if (cancelled || !config.googleClientId || !googleBtnRef.current) return;
        setGoogleReady(true);
        cleanup = await renderGoogleButton({
          clientId: config.googleClientId,
          container: googleBtnRef.current,
          locale: langCode,
          onCredential: async (credential) => {
            setError(null);
            setBusy(true);
            try {
              await loginWithGoogle(credential);
              playBeep();
              onDone();
            } catch (err: any) {
              setError(err.message || t.loginFailed);
            } finally {
              setBusy(false);
            }
          },
        });
      })
      .catch(() => setGoogleReady(false));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [langCode, loginWithGoogle, onDone, playBeep, t.loginFailed]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup({ email, password, nickname });
      playBeep();
      onDone();
    } catch (err: any) {
      setError(err.message || t.loginFailed);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full text-xs border border-line-trip rounded-xl bg-white pl-9 pr-3 py-3 outline-none text-neutral-800 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all';

  return (
    <motion.section
      key="login"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div className="hero bg-gradient-to-br from-white to-soft-trip/50 border border-line-trip rounded-[28px] p-5 shadow-sm space-y-4">
        <div>
          <span className="kicker text-[11px] font-black text-primary tracking-wider uppercase block mb-1">ACCOUNT</span>
          <h1 className="title text-2xl font-black text-neutral-900 tracking-tight leading-none">
            {mode === 'login' ? t.loginTitle : t.signupBtn}
          </h1>
          <p className="sub text-xs text-muted-trip mt-2">{t.loginSub}</p>
        </div>

        {/* 구글 로그인 */}
        <div className={googleReady ? 'space-y-3' : 'hidden'}>
          <div ref={googleBtnRef} className="flex justify-center min-h-[40px]" />
          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-line-trip" />
            <span className="text-[10px] font-bold text-muted-trip">{t.orDivider}</span>
            <span className="h-px flex-1 bg-line-trip" />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <div className="relative">
              <UserIcon className="w-4 h-4 text-muted-trip absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t.nicknameLabel}
                className={inputClass}
                autoComplete="nickname"
              />
            </div>
          )}

          <div className="relative">
            <Mail className="w-4 h-4 text-muted-trip absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailLabel}
              className={inputClass}
              autoComplete="email"
              required
            />
          </div>

          <div className="relative">
            <Lock className="w-4 h-4 text-muted-trip absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`${t.passwordLabel} (8자 이상)`}
              className={inputClass}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </div>

          {error && (
            <div className="bg-danger-trip/5 border border-danger-trip/20 rounded-xl p-3 text-[11px] text-danger-trip flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn w-full border-0 rounded-2xl p-4 bg-gradient-to-r from-primary to-primary2 text-white font-black text-sm shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <LogIn className="w-4 h-4" />
            <span>{mode === 'login' ? t.loginBtn : t.signupBtn}</span>
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
          }}
          className="w-full text-[11px] font-bold text-primary hover:text-primary2 transition-colors cursor-pointer bg-transparent border-0"
        >
          {mode === 'login' ? t.toSignup : t.toLogin}
        </button>

        {mode === 'signup' && <p className="text-[10px] text-muted-trip text-center leading-relaxed">{t.termsNotice}</p>}
      </div>

      <button
        onClick={onGuest}
        className="w-full border border-line-trip bg-white text-neutral-600 hover:text-primary hover:bg-soft-trip/35 py-3.5 rounded-2xl text-xs font-black transition-all cursor-pointer"
      >
        {t.guestBtn}
      </button>

      <p className="text-[10px] text-muted-trip text-center leading-relaxed px-4">{t.syncNotice}</p>
    </motion.section>
  );
};
