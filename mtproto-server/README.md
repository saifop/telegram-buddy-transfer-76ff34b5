# Telegram MTProto Authentication Server

خادم Node.js للاتصال الفعلي بتيليجرام باستخدام بروتوكول MTProto.

## 🚀 النشر على Railway

1. **أنشئ حساب على Railway**: https://railway.app

2. **أنشئ مشروع جديد**:
   - اضغط "New Project"
   - اختر "Deploy from GitHub repo" أو "Empty Project"

3. **إذا اخترت Empty Project**:
   - اضغط "Add Service" → "Empty Service"
   - اربط الـ GitHub repo أو ارفع الملفات

4. **متغيرات البيئة** (اختياري):
   - `PORT`: المنفذ (Railway يحدده تلقائياً)

5. **بعد النشر**:
   - انسخ الـ URL الذي يعطيك إياه Railway (مثل: `https://your-app.railway.app`)
   - أضفه كـ secret في Lovable Cloud باسم `MTPROTO_SERVICE_URL`
   - القيمة: `https://your-app.railway.app/auth`

## 🌐 النشر على Render

1. **أنشئ حساب على Render**: https://render.com

2. **أنشئ Web Service جديد**:
   - اضغط "New +" → "Web Service"
   - اربط الـ GitHub repo

3. **الإعدادات**:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free (أو أعلى)

4. **بعد النشر**:
   - انسخ الـ URL
   - أضفه كـ secret في Lovable Cloud

## 📁 الملفات

- `index.js` - الخادم الرئيسي
- `package.json` - التبعيات
- `README.md` - هذا الملف

## 🔧 التشغيل المحلي

```bash
# تثبيت التبعيات
npm install

# التشغيل
npm start

# أو للتطوير (مع إعادة التشغيل التلقائي)
npm run dev
```

## 🔗 ربط الخادم بـ Lovable

بعد نشر الخادم:

1. افتح Lovable Cloud
2. اذهب إلى Secrets
3. أضف secret جديد:
   - **Name**: `MTPROTO_SERVICE_URL`
   - **Value**: `https://your-server-url.railway.app/auth`

## 📡 API Endpoints

### Health Check
```
GET /
```

### Authentication
```
POST /auth
Content-Type: application/json

Body:
{
  "action": "sendCode" | "verifyCode" | "verify2FA" | "getSession",
  ...params
}
```

#### Actions:

**sendCode**
```json
{
  "action": "sendCode",
  "apiId": "12345678",
  "apiHash": "abcdef1234567890",
  "phoneNumber": "+9647XXXXXXXXX"
}
```

**verifyCode**
```json
{
  "action": "verifyCode",
  "sessionId": "sess_xxx",
  "code": "12345"
}
```

**verify2FA**
```json
{
  "action": "verify2FA",
  "sessionId": "sess_xxx",
  "password": "your2FApassword"
}
```

**getSession**
```json
{
  "action": "getSession",
  "sessionId": "sess_xxx"
}
```

## ⚠️ ملاحظات أمنية

- لا تشارك ملفات الجلسة مع أي شخص
- استخدم HTTPS دائماً في الإنتاج
- الجلسات تنتهي تلقائياً بعد 10 دقائق
