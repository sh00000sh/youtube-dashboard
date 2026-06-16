# 유튜브 인게이지먼트 대시보드 🚀

동기화 버튼을 누르면 유튜브에서 조회수·좋아요·댓글을 가져와 보여주는 대시보드입니다.

---

## 🧩 이게 어떻게 움직이나요? (그림)

```
[너가 🔄 동기화 클릭]
   ↓ (화면이 일꾼에게 신호)
[일꾼(server.js)이 유튜브에 다녀옴]
   ↓ (숫자 받아서 냉장고에 저장)
[냉장고(Postgres DB)]
   ↓ (화면이 냉장고에서 꺼냄)
[표로 보여줌 ✅]
```

이 모든 게 **Railway 한 곳**에서 돌아갑니다.

---

## 1️⃣ 준비물 (열쇠 만들기)

### 유튜브 API 키
1. https://console.cloud.google.com 접속 → 구글 로그인
2. 좌측 상단 프로젝트 선택 → **새 프로젝트** 만들기
3. 검색창에 `YouTube Data API v3` → 클릭 → **사용 설정(Enable)**
4. 왼쪽 메뉴 **사용자 인증 정보** → **+ 사용자 인증 정보 만들기** → **API 키**
5. 나온 긴 문자열을 복사해 둔다 🔑

### 추적할 영상 ID 모으기
- 유튜브 영상 주소가 `https://youtu.be/abc123XYZ` 라면 → 영상 ID는 **`abc123XYZ`**
- 여러 개면 쉼표로: `abc123,def456,ghi789`

---

## 2️⃣ 깃허브에 코드 올리기

1. https://github.com 에서 **New repository** → 이름 `youtube-dashboard` → Create
2. 이 폴더(youtube-dashboard) 전체를 그 저장소에 올린다
   - 가장 쉬운 방법: **GitHub Desktop** 프로그램 설치 → `Add Local Repository` → 이 폴더 선택 → `Publish`

---

## 3️⃣ Railway에 올리기 (제일 중요)

1. https://railway.com 접속 → **Login with GitHub**
2. **New Project** → **Deploy from GitHub repo** → 방금 만든 `youtube-dashboard` 선택
3. 잠시 기다리면 자동으로 일꾼이 켜집니다.
4. **냉장고(DB) 추가**: 프로젝트 화면에서 **New → Database → Add PostgreSQL**
   - (Railway가 `DATABASE_URL`을 자동으로 일꾼에 연결해 줍니다. 손댈 것 없음)
5. **열쇠 넣기**: 일꾼(서비스) 클릭 → **Variables** 탭 → 아래 2개 추가
   | 이름 | 값 |
   |---|---|
   | `YOUTUBE_API_KEY` | 복사해 둔 유튜브 키 |
   | `VIDEO_IDS` | `영상ID1,영상ID2,영상ID3` |
6. **주소 만들기**: **Settings → Networking → Generate Domain** 클릭 → `https://....up.railway.app` 주소가 생김
7. 그 주소로 접속 → **🔄 동기화** 클릭 → 표에 숫자가 채워지면 성공! 🎉

---

## 🖥️ (선택) 내 컴퓨터에서 먼저 테스트

1. https://nodejs.org 에서 **LTS** 버전 설치
2. 이 폴더에서 `.env.example`을 복사해 `.env`로 만들고 값 채우기
3. 터미널에서:
   ```
   npm install
   npm start
   ```
4. 브라우저에서 http://localhost:3000 접속 → 동기화 테스트

---

## ❓ 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| 동기화 눌렀더니 "YOUTUBE_API_KEY가 없습니다" | Railway Variables에 키를 안 넣음 |
| "VIDEO_IDS가 비어 있습니다" | 추적할 영상 ID를 안 넣음 |
| "API key not valid" | 키가 틀렸거나 YouTube Data API v3를 Enable 안 함 |
| 표가 안 채워짐 | 영상 ID가 잘못됨 (watch?v= 뒤의 글자만) |

---

## 🔜 다음 단계 (나중에)
- **네이버TV**: 공식 API가 없어 자동화가 까다로움 → 수동 입력 칸 추가 권장
- **자동 동기화**: Railway의 Cron 기능으로 "매일 아침 9시 자동 동기화"도 가능
- **구독자 수**: 채널 통계(`channels` API)도 추가 가능
