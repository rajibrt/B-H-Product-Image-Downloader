# B&H Product Image Downloader (Windows Quick Start)

এই প্রজেক্টটা B&H প্রোডাক্ট পেজ থেকে ইমেজ URL এক্সট্রাক্ট করে ডাউনলোড/ZIP করতে পারে। উইন্ডোজ‑এ নতুন ল্যাপটপে সেটআপ করার জন্য নিচের ডকুমেন্টেশনটা ফলো করুন।

## কি কি লাগবে (Prerequisites)

1) **Node.js 18+** (LTS recommended)
2) **Git** (optional, যদি রিপো ক্লোন করতে চান)
3) **Playwright Chromium** (ব্রাউজার ইঞ্জিন)
4) **Stable Internet connection**

> নোট: Playwright browser ইনস্টল না থাকলে `/api/extract` 500 error দিবে। নতুন ল্যাপটপে একবার `npx playwright install chromium` চালানো **দরকার**।

## দ্রুত চেকলিস্ট (Windows Setup)

- [ ] Node.js 18+ ইনস্টল আছে কি? `node -v`
- [ ] প্রজেক্ট ফোল্ডারে ঢুকেছেন কি?
- [ ] ডিপেন্ডেন্সি ইনস্টল করেছেন কি? `npm install`
- [ ] Playwright Chromium ইনস্টল করেছেন কি? `npx playwright install chromium`
- [ ] সার্ভার রান হচ্ছে কি? `node src/index.js`
- [ ] Cloudflare block হলে headful মোডে চালাচ্ছেন কি?

## নতুন ল্যাপটপে স্টেপ‑বাই‑স্টেপ

### 1) প্রজেক্ট নেওয়া
- ZIP ডাউনলোড করে extract করুন, অথবা Git দিয়ে:

```bash
git clone <your-repo-url>
cd bh-image-downloader
```

### 2) ডিপেন্ডেন্সি ইনস্টল
```bash
npm install
```

### 3) Playwright Chromium ইনস্টল (প্রথমবার দরকার)
```bash
npx playwright install chromium
```

### 4) সার্ভার চালানো
**PowerShell:**
```powershell
node src/index.js
```

ওপেন করুন: `http://localhost:3000`

### 5) যদি Cloudflare ব্লক করে (প্রায়ই headless‑এ হয়)
**PowerShell (Headful):**
```powershell
$env:HEADFUL="1"; node src/index.js
```

এবার ব্রাউজার ওপেন হবে। যদি Cloudflare challenge আসে, ম্যানুয়ালি solve করুন। তারপর আবার UI থেকে Fetch দিন।

## Optional: Session Seed (যদি বারবার ব্লক হয়)
```powershell
node scripts/seed.js
```
- ব্রাউজার ওপেন হবে
- Cloudflare solve করুন
- Console‑এ Enter চাপুন
- `storage/bh.json` সেভ হবে

তারপর normal সার্ভার চালালেই হবে।

## সাধারণ সমস্যা ও সমাধান

### 1) `POST /api/extract 500` error
সম্ভাব্য কারণ:
- Playwright browser ইনস্টল নাই
- Node version কম
- Cloudflare block

সমাধান:
- `node -v` দিয়ে চেক করুন (18+)
- `npx playwright install chromium`
- `HEADFUL=1` দিয়ে চালান

### 2) PowerShell‑এ `HEADFUL` কাজ করে না
PowerShell‑এ এইভাবে লিখতে হবে:
```powershell
$env:HEADFUL="1"; node src/index.js
```
CMD হলে:
```cmd
set HEADFUL=1 && node src/index.js
```

## Production/Deployment (Local Node Server)
এই প্রজেক্টটা লোকাল Node সার্ভার হিসেবে রান করার জন্য বানানো। অন্য PC‑তে চালাতে হলে একই স্টেপ ফলো করলেই হবে।

## Useful Commands

```bash
npm install
npx playwright install chromium
node src/index.js
```

```powershell
$env:HEADFUL="1"; node src/index.js
```

## Notes
- ইমেজ এক্সট্রাকশন B&H সাইটের লেআউট/Cloudflare পরিবর্তনে প্রভাবিত হতে পারে।
- UI‑তে error দেখালে সেটার details দেখে ডিবাগ করা সহজ হবে।
