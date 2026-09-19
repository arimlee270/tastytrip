import { Router } from 'express';
import { env } from '../env';

/**
 * Pexels 이미지 검색 중계.
 *
 * 예전에는 브라우저가 Pexels 를 직접 불렀는데, 그러려면 키를 프런트엔드
 * 번들에 넣어야 해서 빌드 결과물에 키가 글자 그대로 박혔다.
 * 이제 브라우저는 이 주소로 요청하고, 키는 서버에만 둔다.
 */
export const imagesRouter = Router();

imagesRouter.get('/search', async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (!query) {
    res.status(400).json({ error: '검색어가 필요합니다.' });
    return;
  }
  if (!env.pexelsApiKey) {
    // 키가 없으면 프런트가 기본 이미지로 넘어가도록 빈 결과를 준다.
    res.json({ photos: [] });
    return;
  }

  try {
    const url =
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}` +
      `&per_page=12&orientation=landscape`;
    const response = await fetch(url, { headers: { Authorization: env.pexelsApiKey } });
    if (!response.ok) {
      res.status(response.status).json({ photos: [] });
      return;
    }
    res.json(await response.json());
  } catch (error) {
    console.error('[images] Pexels 검색 실패:', (error as Error).message);
    res.json({ photos: [] });
  }
});
