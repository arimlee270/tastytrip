import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Agent, setGlobalDispatcher } from 'undici';

import { env, flags, publicConfig, warnUnsafeConfig } from './src/server/env';
import { authRouter, usersRouter } from './src/server/routes/auth';
import { companionsRouter } from './src/server/routes/companions';
import { restaurantsRouter } from './src/server/routes/restaurants';
import { placesRouter } from './src/server/routes/places';
import { imagesRouter } from './src/server/routes/images';
import { menusRouter } from './src/server/routes/menus';
import { adminPublicDataRouter, publicFoodRouter } from './src/server/routes/publicFood';
import { recommendationsRouter } from './src/server/routes/recommendations';
import { reportsRouter } from './src/server/routes/reports';
import { seedStandardFoods } from './src/server/seed/standardFoods';
import { initDb } from './src/server/db';
import { rateLimit, requireAdmin } from './src/server/rateLimit';

// 외부 API 호출 타임아웃을 넉넉히 잡는다 (기존 설정 유지).
setGlobalDispatcher(
  new Agent({
    headersTimeout: 600000,
    bodyTimeout: 600000,
    connect: { timeout: 600000 },
  })
);

const app = express();
// base64 이미지 업로드를 허용하기 위한 용량 설정 (기존과 동일)
app.use(express.json({ limit: '10mb' }));

/* --------------------------- API 라우팅 --------------------------- */

// 프런트엔드가 지도 키 유무 등을 알 수 있도록 공개 설정을 내려준다.
app.get('/api/config', (_req, res) => res.json(publicConfig()));

// 사진과 이미지 검색은 서버가 대신 호출한다 (키를 브라우저로 내보내지 않기 위함).
app.use('/api/places', placesRouter);
app.use('/api/images', rateLimit(60), imagesRouter);

app.use('/api/auth', rateLimit(30), authRouter);
app.use('/api/users', usersRouter);
app.use('/api/companions', companionsRouter);
app.use('/api/restaurants', restaurantsRouter);
app.use('/api/public-food', publicFoodRouter);
// 공개 데이터 동기화는 외부 API 를 수백 번 호출하므로 관리자만 부를 수 있다.
app.use('/api/admin/public-data', requireAdmin, adminPublicDataRouter);
app.use('/api/recommendations', recommendationsRouter);

// 아래 두 라우터는 /api 하위의 여러 경로를 직접 정의한다.
// (/api/analyze-menu, /api/menus/:id, /api/reports/:id/verify 등)
// 메뉴 분석은 호출마다 Gemini 요금이 나가므로 횟수를 제한한다.
app.use('/api', rateLimit(), menusRouter);
app.use('/api', reportsRouter);

/* --------------------------- 서버 기동 --------------------------- */

async function initServer() {
  const isProduction = env.nodeEnv === 'production';

  // 스키마 생성 -> 마이그레이션 -> 시드 순서로 실행한다.
  await initDb();
  await seedStandardFoods();

  // 키 노출 등 위험한 설정을 기동 시 한 번 알린다.
  warnUnsafeConfig();

  console.log(
    `[TastyTrip] 기능 상태 — Gemini: ${flags.hasGemini ? 'ON' : 'OFF'}, ` +
      `지도: ${flags.hasGoogleMaps ? 'Google Places' : '데모 데이터'}, ` +
      `식약처: ${flags.hasMfds ? 'ON' : 'OFF'}, USDA: ${flags.hasUsda ? 'ON' : 'OFF'}`
  );

  if (isProduction) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // 개발 서버는 기본적으로 모르는 Host 헤더를 차단한다.
        // 휴대폰 테스트(같은 와이파이 IP, 임시 HTTPS 터널)에서 접속할 수 있도록 허용한다.
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${env.port} (${isProduction ? 'production' : 'development'})`);
  });
}

initServer().catch((err) => {
  console.error('Failed to start full-stack server:', err);
  process.exit(1);
});
