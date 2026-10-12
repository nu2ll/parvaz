# 🕊️ کبوتر (Kabootar)

یک سرور پیام‌رسان **شبیه تلگرام**، کاملاً از صفر، با **Node.js و بدون هیچ وابستگی** (نه npm install، نه پکیج).
REST API + WebSocket برای پیام لحظه‌ای + SQLite داخلی Node + یک وب‌کلاینت راست‌به‌چپ فارسی.

> ⚠️ این پروژه هیچ کدی از تلگرام ندارد و از پروتکل MTProto هم استفاده نمی‌کند؛ فقط از نظر قابلیت‌ها شبیه است.

## قابلیت‌ها
- ثبت‌نام / ورود (رمز با scrypt، توکن تصادفی که فقط هشش ذخیره می‌شود)
- جستجوی کاربر با نام یا @username
- چت خصوصی، «پیام‌های ذخیره‌شده» (چت با خودت)
- گروه با نقش owner/admin/member، افزودن عضو، ترک گروه (مالکیت خودکار منتقل می‌شود)
- پیام لحظه‌ای روی WebSocket، چند دستگاه همزمان برای هر کاربر
- پاسخ (reply)، ویرایش (تا ۴۸ ساعت)، حذف برای همه
- «در حال نوشتن…»، تیک خوانده‌شدن ✓✓، تعداد پیام خوانده‌نشده
- آنلاین / آخرین بازدید
- تاریخچه با صفحه‌بندی (اسکرول به بالا)

## اجرا
نیاز: **Node.js 22.13 یا بالاتر**

```bash
node server.js          # یا: npm start
# باز کن: http://localhost:8080
```

با Docker:
```bash
docker compose up -d --build
```

تست کامل (۴۴ چک end-to-end):
```bash
npm test
```

## 🚀 دیپلوی خودکار روی Railway (فقط با GitHub)
همه‌چیز آماده است؛ هیچ متغیری لازم نیست دستی ست شود.

1. این پوشه را در یک ریپوی GitHub پوش کن.
2. در [railway.com](https://railway.com): **New Project ← Deploy from GitHub repo** و همین ریپو را انتخاب کن.
3. روی سرویس: **Settings ← Networking ← Generate Domain**.
4. (یک‌بار، برای اینکه پیام‌ها با هر دیپلوی پاک نشوند) روی سرویس راست‌کلیک ← **Attach Volume** با هر مسیری، مثلاً `/data`.

از این به بعد هر `git push` = دیپلوی خودکار. GitHub Actions هم با هر پوش تست‌ها را اجرا می‌کند؛
اگر می‌خواهی Railway فقط وقتی تست‌ها سبز شد دیپلوی کند، در Settings گزینه **Wait for CI** را روشن کن.

خودکار روی Railway: مسیر دیتابیس از Volume، `TRUST_PROXY`، و `ALLOWED_ORIGINS` از دامنه Railway.
اگر بعداً دامنه شخصی وصل کردی، `ALLOWED_ORIGINS=https://دامنه‌ات` را دستی اضافه کن.

### متغیرهای محیطی
| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | `8080` | پورت |
| `HOST` | `0.0.0.0` | آدرس bind |
| `DB_PATH` | `./data/chat.db` (روی Railway: داخل Volume) | فایل دیتابیس SQLite |
| `SESSION_TTL_DAYS` | `30` | عمر توکن ورود |
| `ALLOWED_ORIGINS` | خالی (همه)، روی Railway: دامنه Railway | Originهای مجاز برای WebSocket، جدا با کاما |
| `TRUST_PROXY` | خاموش، روی Railway: روشن | پشت nginx بگذار `1` تا IP واقعی برای rate limit خوانده شود |

## ساختار
```
server.js          HTTP + فایل‌های استاتیک + هدرهای امنیتی
src/ws.js          پیاده‌سازی WebSocket (RFC 6455) از صفر
src/realtime.js    گیت‌وی WebSocket: احراز هویت، رویدادها، heartbeat
src/routes.js      REST API
src/service.js     منطق اصلی چت (مشترک بین REST و WS)
src/db.js          اسکیمای SQLite و کوئری‌ها
src/auth.js        هش رمز، توکن‌ها
public/            وب‌کلاینت (HTML/CSS/JS خام)
test/smoke.js      تست end-to-end
```

## API
همه درخواست‌ها (به‌جز ثبت‌نام/ورود) هدر `Authorization: Bearer <token>` می‌خواهند. خطاها: `{"error":{"code","message"}}`

| متد | مسیر | بدنه / توضیح |
|---|---|---|
| POST | `/api/auth/register` | `{username, display_name, password}` → `{token, user}` |
| POST | `/api/auth/login` | `{username, password}` → `{token, user}` |
| POST | `/api/auth/logout` | باطل‌کردن توکن و قطع سوکت‌ها |
| GET / PATCH | `/api/me` | پروفایل / `{display_name}` |
| GET | `/api/users/search?q=` | جستجوی کاربر |
| GET | `/api/chats` | لیست گفتگوها با آخرین پیام و unread |
| POST | `/api/chats/private` | `{username}` باز کردن چت خصوصی |
| POST | `/api/chats/group` | `{title, usernames: []}` |
| GET | `/api/chats/:id` | جزئیات + اعضا |
| POST | `/api/chats/:id/members` | `{username}` (فقط ادمین) |
| POST | `/api/chats/:id/leave` | ترک گروه |
| GET | `/api/chats/:id/messages?before=&limit=` | تاریخچه |
| POST | `/api/chats/:id/messages` | `{text, reply_to?}` |
| POST | `/api/chats/:id/read` | `{message_id}` |
| PATCH / DELETE | `/api/messages/:id` | `{text}` / حذف |

## پروتکل WebSocket (`/ws`)
اولین فریم باید ظرف ۱۰ ثانیه احراز هویت باشد (توکن در URL نمی‌آید تا در لاگ‌ها نماند):
```json
{"type":"auth","token":"..."}
```
**کلاینت ← سرور:** `send {chat_id, text, reply_to?}` · `edit {message_id, text}` · `delete {message_id}` · `read {chat_id, message_id}` · `typing {chat_id}` · `ping`
(فیلد اختیاری `ref` در خطاها برگردانده می‌شود)

**سرور ← کلاینت:** `ready` · `message` · `message_updated` · `typing` · `read` · `presence` · `user` · `chat` · `chat_removed` · `error {code, message, ref}`

## امنیت (چیزهایی که انجام شده)
- رمز با scrypt + salt، مقایسه constant-time، زمان‌بندی یکسان برای کاربر ناموجود
- توکن ۲۵۶ بیتی، در دیتابیس فقط SHA-256 آن
- rate limit روی ورود، ثبت‌نام، ارسال پیام، typing و تعداد فریم WebSocket
- محدودیت حجم بدنه HTTP (64KB) و فریم WebSocket (1MB)، قطع کلاینت‌های کند
- CSP سخت‌گیرانه، بدون inline script؛ کلاینت همه‌چیز را با textContent رندر می‌کند (ضد XSS)
- غیرعضوها 404 می‌گیرند (شناسه چت‌ها قابل حدس‌زدن نیست)
- حذف پیام واقعاً متن را از دیتابیس پاک می‌کند

## قبل از انتشار عمومی حتماً
- **HTTPS اجباری** (نمونه `nginx.example.conf`) و `ALLOWED_ORIGINS` را ست کن
- بکاپ منظم از فایل دیتابیس
- این نسخه **رمزنگاری سرتاسری ندارد**؛ پیام‌ها روی سرور قابل خواندن‌اند. اگر محرمانگی مهم است، E2EE (مثلاً پروتکل Signal) لازم است
- rate limiter در حافظه است؛ برای چند سرور باید Redis بیاید

## قدم‌های بعدی پیشنهادی
آپلود فایل/عکس، کانال (یک‌طرفه)، نوتیفیکیشن Push، جستجو در پیام‌ها، اپ موبایل (React Native / Flutter روی همین API)، مهاجرت به Postgres + Redis برای مقیاس بالا.
