/** Google Identity Services(구글 로그인 버튼) 로더 */

let loadPromise: Promise<boolean> | null = null;

export const loadGoogleSignIn = (): Promise<boolean> => {
  if ((window as any).google?.accounts?.id) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn('[google] 로그인 스크립트를 불러오지 못했습니다.');
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return loadPromise;
};

export interface RenderButtonOptions {
  clientId: string;
  container: HTMLElement;
  /** 로그인 성공 시 ID 토큰(credential) 전달 */
  onCredential: (credential: string) => void;
  locale?: string;
  width?: number;
}

/**
 * 구글 로그인 버튼을 그린다.
 * 반환값은 정리 함수이며, 화면을 떠날 때 호출하면 된다.
 */
export const renderGoogleButton = async (opts: RenderButtonOptions): Promise<() => void> => {
  const ok = await loadGoogleSignIn();
  if (!ok) return () => undefined;

  const google = (window as any).google;
  google.accounts.id.initialize({
    client_id: opts.clientId,
    callback: (response: { credential?: string }) => {
      if (response?.credential) opts.onCredential(response.credential);
    },
    // 팝업 차단 등의 문제를 줄이기 위해 자동 선택은 끈다.
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  opts.container.innerHTML = '';
  google.accounts.id.renderButton(opts.container, {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    logo_alignment: 'center',
    locale: opts.locale || 'ko',
    width: opts.width || 300,
  });

  return () => {
    try {
      google.accounts.id.cancel();
    } catch {
      /* 무시 */
    }
  };
};
