import { Router } from 'express';
import { fetchPlacePhoto } from '../services/places';

/**
 * 구글 장소 사진 중계.
 *
 * 구글 사진 주소에는 API 키가 들어가야 하는데, 그 주소를 브라우저에 그대로
 * 주면 키가 노출된다. 그래서 브라우저는 키 없는 이 주소로 요청하고,
 * 서버가 키를 붙여 구글에서 받아 온 뒤 이미지 데이터만 넘겨준다.
 */
export const placesRouter = Router();

/** 사진 이름은 반드시 'places/{장소}/photos/{사진}' 형태여야 한다. */
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

placesRouter.get('/photo', async (req, res) => {
  const name = String(req.query.name || '');
  // 임의의 주소를 넣어 서버를 다른 곳으로 요청 보내게 만드는 것을 막는다.
  if (!PHOTO_NAME.test(name)) {
    res.status(400).json({ error: '잘못된 사진 주소입니다.' });
    return;
  }

  const width = Math.min(Math.max(Number(req.query.w) || 640, 64), 1600);

  try {
    const photo = await fetchPlacePhoto(name, width);
    if (!photo) {
      res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
      return;
    }
    // 사진은 잘 바뀌지 않으므로 브라우저가 하루 동안 다시 묻지 않게 한다.
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(photo.body));
  } catch (error) {
    console.error('[places] 사진 중계 실패:', (error as Error).message);
    res.status(502).json({ error: '사진을 가져오지 못했습니다.' });
  }
});
