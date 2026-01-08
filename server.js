// server.js
import express from 'express'
import archiver from 'archiver'
import fs from 'fs'
import sharp from 'sharp'

const app = express()
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '1mb' }))
app.use(express.static('public'))

/**
 * Normalize B&H image URL to highest likely quality.
 * Handles Cloudflare cdn-cgi/image wrapper and upsizes images{N}x{N} to images2000x2000.
 */
function toHiRes(url) {
  if (!url || typeof url !== 'string') return null

  // If it's a Cloudflare resized URL like:
  // https://www.bhphotovideo.com/cdn-cgi/image/fit=scale-down,width=500,quality=95/https%3A//www.bhphotovideo.com/images/images500x500/...
  const cfPrefix = '/cdn-cgi/image/'
  if (url.includes(cfPrefix)) {
    const tail = url.split(cfPrefix)[1]
    // tail = "fit=.../https%3A//www.bhphotovideo.com/images/images500x500/..."
    const encoded = tail.substring(tail.indexOf('/') + 1)
    try {
      url = decodeURIComponent(encoded)
    } catch {
      // if decode fails, keep original
    }
  }

  // Force https
  url = url.replace(/^http:\/\//i, 'https://')

  // Upsize known B&H pattern images{N}x{N} -> images2000x2000
  url = url.replace(/\/images\/images\d+x\d+\//i, '/images/images2000x2000/')

  // Upsize common thumbnail folders
  url = url.replace(
    /\/images\/multiple_images\/thumbnails\//i,
    '/images/multiple_images/'
  )
  url = url.replace(
    /\/images\/multiple_images\/thumbs\//i,
    '/images/multiple_images/'
  )
  url = url.replace(
    /\/images\/multiple_images\/images\d+x\d+\//i,
    '/images/multiple_images/images2000x2000/'
  )
  url = url.replace(/\/images\/smallimages\//i, '/images/images2000x2000/')

  // If still a cdn-cgi image URL, try bump width
  if (url.includes(cfPrefix)) {
    url = url.replace(/width=\d+/i, 'width=2000')
  }

  return url
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))]
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return null
  let u = url.trim()
  if (u.startsWith('//')) u = 'https:' + u
  return u
}

function isBhImageUrl(url) {
  if (!url) return false
  const u = normalizeUrl(url) || ''
  return (
    (u.includes('bhphotovideo.com/') || u.includes('bhphoto.com/')) &&
    (u.includes('/images/') || u.includes('/cdn-cgi/image/'))
  )
}

function isLikelyGalleryImage(url) {
  if (!isBhImageUrl(url)) return false
  const u = normalizeUrl(url) || ''
  const allow = [
    '/images/images',
    '/images/multiple_images/',
    '/images/itemzoom/',
    '/images/largeimages/',
  ]
  const deny = [
    '/images/oldIEmessage/',
    '/images/manufacturers/',
    '/explora/sites/',
    '/images/icons/',
    '/images/brands/',
  ]
  if (deny.some((d) => u.includes(d))) return false
  if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) return false
  return allow.some((a) => u.includes(a))
}

function isMainHiRes(url) {
  const u = normalizeUrl(url) || ''
  return (
    u.includes('/images/images2000x2000/') ||
    u.includes('/images/multiple_images/images2000x2000/') ||
    u.includes('/images/itemzoom/') ||
    u.includes('/images/largeimages/')
  )
}

function extractUrlsFromString(value) {
  if (!value || typeof value !== 'string') return []
  const out = new Set()
  const cleaned = value
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
  const httpMatches = cleaned.match(/https?:\/\/[^"'\\s)]+/gi) || []
  httpMatches.forEach((u) => out.add(u))
  const escapedMatches = cleaned.match(/https?:\\\/\\\/[^"'\\s)]+/gi) || []
  escapedMatches.forEach((u) => out.add(u.replace(/\\\//g, '/')))
  const protoMatches = cleaned.match(/\/\/[^"'\\s)]+/gi) || []
  protoMatches.forEach((u) => out.add(`https:${u}`))
  const relMatches =
    cleaned.match(
      /\/images\/(?:multiple_images|images\d+x\d+|itemzoom|largeimages|smallimages)[^"'\\s)]+/gi
    ) || []
  relMatches.forEach((p) => out.add(`https://www.bhphotovideo.com${p}`))
  return Array.from(out)
}

function safeBaseName(input) {
  const raw = (input || '').trim()
  if (!raw) return 'bh-image'
  const clean = raw
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 60)
  return clean || 'bh-image'
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch
  const mod = await import('node-fetch')
  return mod.default
}

async function fetchWithHeaders(url) {
  const fetchFn = await getFetch()
  return fetchFn(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      referer: 'https://www.bhphotovideo.com/',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
}

let persistentContext

app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {}
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' })
  }

  // Basic allowlist for safety
  let u
  try {
    u = new URL(url)
  } catch {
    return res.status(400).json({ error: 'Invalid url' })
  }
  if (!/(\.|^)bhphotovideo\.com$/i.test(u.hostname)) {
    return res
      .status(400)
      .json({ error: 'Only bhphotovideo.com links are supported.' })
  }

  let browser
  let context
  let page
  let blocked = false
  try {
    const { chromium } = await import('playwright')
    const headless =
      process.env.HEADFUL === '1' || process.env.HEADLESS === '0'
        ? false
        : true
    const usePersistent = !headless && process.env.PERSISTENT !== '0'
    if (usePersistent) {
      const profileDir = 'storage/profile'
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true })
      if (!persistentContext) {
        persistentContext = await chromium.launchPersistentContext(profileDir, {
          headless,
          args: ['--disable-blink-features=AutomationControlled'],
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
          locale: 'en-US',
          timezoneId: 'Asia/Dhaka',
          viewport: { width: 1280, height: 800 },
        })
        await persistentContext.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        })
      }
      context = persistentContext
    } else {
      browser = await chromium.launch({
        headless,
        args: ['--disable-blink-features=AutomationControlled'],
      })
      const storagePath = 'storage/bh.json'
      const hasStorage = fs.existsSync(storagePath)
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'Asia/Dhaka',
        viewport: { width: 1280, height: 800 },
        storageState: hasStorage ? storagePath : undefined,
      })
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
    }
    page = await context.newPage()
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
    })

    const responseUrls = new Set()
    const jsonUrls = new Set()
    page.on('response', async (resp) => {
      const u = normalizeUrl(resp.url())
      if (isLikelyGalleryImage(u)) responseUrls.add(u)
      const ct = resp.headers()['content-type'] || ''
      if (ct.includes('application/json')) {
        try {
          const text = await resp.text()
          extractUrlsFromString(text)
            .map(normalizeUrl)
            .filter(isLikelyGalleryImage)
            .forEach((x) => jsonUrls.add(x))
        } catch {}
      }
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })

    // Wait a bit for gallery thumbs to load (best effort)
    await page.waitForTimeout(1500)

    const forceModal = process.env.FORCE_MODAL === '1'

    // Open gallery modal if it is not already open.
    try {
      const modal = page.locator('[data-selenium="modalContent"]')
      if ((await modal.count()) === 0) {
        const candidates = [
          '[data-selenium^="inlineMediaOpenMedia"]',
          '[data-selenium="mediaGalleryModalButton"]',
          '[data-selenium="productMainImage"] img',
          '[data-selenium="productMainImage"]',
          '[data-selenium="mediaGalleryMainImage"] img',
          '[data-selenium="mediaGallery"] img',
          '[data-selenium="mediaGalleryCarousel"] img',
          '[data-selenium="galleryImage"]',
          '[data-selenium="mediaGalleryImageThumbnail"]',
          'button[aria-label*="Expand"]',
          'button[aria-label*="Zoom"]',
          'button[title*="Expand"]',
          'button[title*="Zoom"]',
        ]
        for (const sel of candidates) {
          const clickable = page.locator(sel).first()
          if ((await clickable.count()) > 0) {
            await clickable.scrollIntoViewIfNeeded().catch(() => {})
            await clickable.click({ timeout: 5000, force: true }).catch(() => {})
            const opened = await page
              .waitForSelector('[data-selenium="modalContent"]', {
                timeout: 6000,
              })
              .then(() => true)
              .catch(() => false)
            if (opened) break
          }
        }
      }
    } catch {}

    const modalLocator = page
      .locator('[data-selenium="modalContent"], [data-selenium="mediaGalleryModal"]')
      .first()
    const modalFound = (await modalLocator.count()) > 0
    if (forceModal && !modalFound) {
      return res.status(400).json({
        error:
          'Gallery modal not found. Open the product image modal first, then retry.',
      })
    }

    // Click through modal images to trigger all gallery items.
    const modalSequenceUrls = new Set()
    try {
      if (modalFound) {
        const thumbSelector =
          '[data-selenium="mediaGalleryImageThumbnail"], [data-selenium="thumbnailImage"]'
        const thumbs = page.locator(thumbSelector)
        const thumbCount = await thumbs.count()
        if (thumbCount > 0) {
          for (let i = 0; i < thumbCount; i++) {
            await thumbs.nth(i).scrollIntoViewIfNeeded().catch(() => {})
            await thumbs.nth(i).click({ timeout: 3000, force: true }).catch(() => {})
            await page.waitForTimeout(150)
            const urls = await page.evaluate(() => {
              const root =
                document.querySelector('[data-selenium="modalContent"]') ||
                document.querySelector('[data-selenium="mediaGalleryModal"]')
              if (!root) return []
              const out = new Set()
              const pick = (v) => {
                if (!v || typeof v !== 'string') return
                const u = v.startsWith('//') ? 'https:' + v : v
                out.add(u)
              }
              root.querySelectorAll('img').forEach((img) => {
                pick(img.src)
                pick(img.getAttribute('data-src'))
                pick(img.getAttribute('data-lazy'))
                pick(img.getAttribute('data-original'))
                pick(img.getAttribute('srcset'))
                const ds = img.getAttribute('data-srcset')
                if (ds) pick(ds)
              })
              root.querySelectorAll('[data-zoom-image]').forEach((el) =>
                pick(el.getAttribute('data-zoom-image'))
              )
              root.querySelectorAll('[data-full]').forEach((el) =>
                pick(el.getAttribute('data-full'))
              )
              root.querySelectorAll('[data-hires]').forEach((el) =>
                pick(el.getAttribute('data-hires'))
              )
              return Array.from(out)
            })
            urls
              .map(normalizeUrl)
              .filter(isLikelyGalleryImage)
              .forEach((u) => modalSequenceUrls.add(u))
          }
        }

        const nextSelectors = [
          '[data-selenium="galleryNext"]',
          '[data-selenium="modalNext"]',
          '[data-selenium="mediaGalleryNext"]',
          '[data-selenium="sliderArrowRight"]',
          'button[aria-label="Next"]',
          'button[title*="Next"]',
        ]
        let repeats = 0
        for (let i = 0; i < 40; i++) {
          const urls = await page.evaluate(() => {
            const root =
              document.querySelector('[data-selenium="modalContent"]') ||
              document.querySelector('[data-selenium="mediaGalleryModal"]')
            if (!root) return []
            const out = new Set()
            const pick = (v) => {
              if (!v || typeof v !== 'string') return
              const u = v.startsWith('//') ? 'https:' + v : v
              out.add(u)
            }
            root.querySelectorAll('img').forEach((img) => {
              pick(img.src)
              pick(img.getAttribute('data-src'))
              pick(img.getAttribute('data-lazy'))
              pick(img.getAttribute('data-original'))
              pick(img.getAttribute('srcset'))
              const ds = img.getAttribute('data-srcset')
              if (ds) pick(ds)
            })
            root.querySelectorAll('[data-zoom-image]').forEach((el) =>
              pick(el.getAttribute('data-zoom-image'))
            )
            root.querySelectorAll('[data-full]').forEach((el) =>
              pick(el.getAttribute('data-full'))
            )
            root.querySelectorAll('[data-hires]').forEach((el) =>
              pick(el.getAttribute('data-hires'))
            )
            return Array.from(out)
          })
          const before = modalSequenceUrls.size
          urls
            .map(normalizeUrl)
            .filter(isLikelyGalleryImage)
            .forEach((u) => modalSequenceUrls.add(u))
          if (modalSequenceUrls.size === before) repeats++
          else repeats = 0

          let clicked = false
          for (const sel of nextSelectors) {
            const btn = page.locator(sel).first()
            if ((await btn.count()) > 0) {
              await btn.click({ timeout: 3000 }).catch(() => {})
              clicked = true
              break
            }
          }
          if (!clicked || repeats >= 4) break
          await page.waitForTimeout(250)
        }
      }
    } catch {}

    // Extract URLs from gallery modal only if present.
    const raw = await page.evaluate(async () => {
      const urls = new Set()

      const pick = (v) => {
        if (!v || typeof v !== 'string') return
        const u = v.startsWith('//') ? 'https:' + v : v
        urls.add(u)
      }

      const root =
        document.querySelector('[data-selenium="modalContent"]') ||
        document.querySelector('[data-selenium="mediaGalleryModal"]') ||
        document.querySelector('[data-selenium="mediaGallery"]') ||
        document.querySelector('[data-selenium="mediaGalleryCarousel"]') ||
        document.querySelector('[data-selenium="galleryThumbnails"]') ||
        document.querySelector('[data-selenium="thumbsContainer"]') ||
        document.querySelector('[data-selenium="thumbnailStrip"]')
      if (!root) return []

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const scrollable = [root].concat(
        [
          root.querySelector('[data-selenium="thumbnailStrip"]'),
          root.querySelector('[data-selenium="thumbsContainer"]'),
          root.querySelector('[data-selenium="galleryThumbnails"]'),
        ].filter(Boolean)
      )
      for (const el of scrollable) {
        const max = Math.max(0, el.scrollHeight - el.clientHeight)
        if (max <= 0) continue
        for (let pos = 0; pos <= max; pos += Math.max(200, el.clientHeight)) {
          el.scrollTo(0, pos)
          await sleep(200)
        }
        const maxX = Math.max(0, el.scrollWidth - el.clientWidth)
        if (maxX > 0) {
          for (
            let posX = 0;
            posX <= maxX;
            posX += Math.max(200, el.clientWidth)
          ) {
            el.scrollTo(posX, 0)
            await sleep(200)
          }
        }
      }

      // img sources
      root.querySelectorAll('img').forEach((img) => {
        pick(img.src)
        pick(img.getAttribute('data-src'))
        pick(img.getAttribute('data-lazy'))
        pick(img.getAttribute('data-original'))
        pick(img.getAttribute('srcset'))
        const ds = img.getAttribute('data-srcset')
        if (ds) pick(ds)
      })

      // picture/source srcset
      root.querySelectorAll('source').forEach((s) => {
        pick(s.getAttribute('srcset'))
        pick(s.getAttribute('data-srcset'))
      })

      // common image-related data attributes
      const attrs = [
        'data-zoom-image',
        'data-zoom',
        'data-zoom-url',
        'data-image',
        'data-full',
        'data-hires',
        'data-large',
        'data-src-large',
        'data-lazy-src',
        'data-lazy-srcset',
      ]
      root.querySelectorAll('*').forEach((el) => {
        for (const a of attrs) {
          const v = el.getAttribute && el.getAttribute(a)
          if (v) pick(v)
        }
      })

      // generic attribute scan (catches hidden data arrays)
      root.querySelectorAll('*').forEach((el) => {
        if (!el.getAttributeNames) return
        for (const name of el.getAttributeNames()) {
          const v = el.getAttribute(name)
          if (!v || typeof v !== 'string') continue
          if (
            (v.includes('bhphotovideo.com/') || v.includes('bhphoto.com/')) &&
            (v.includes('/images/') || v.includes('/cdn-cgi/image/'))
          ) {
            pick(v)
          }
        }
      })

      // background-image URLs
      root.querySelectorAll('[style*="background"]').forEach((el) => {
        const style = el.getAttribute('style') || ''
        const matches = style.match(/url\(([^)]+)\)/gi) || []
        matches.forEach((m) => {
          const val = m.replace(/^url\((['"]?)/, '').replace(/(['"]?)\)$/, '')
          pick(val)
        })
      })

      // thumbnails in page (outside modal)
      document
        .querySelectorAll(
          '[data-selenium="mediaGalleryImageThumbnail"], [data-selenium="thumbnailImage"]'
        )
        .forEach((img) => {
          pick(img.src)
          pick(img.getAttribute('data-src'))
          pick(img.getAttribute('data-lazy'))
          pick(img.getAttribute('data-original'))
          pick(img.getAttribute('srcset'))
        })
      document
        .querySelectorAll('[data-selenium^="inlineMediaOpenMedia"]')
        .forEach((btn) => {
          const style = btn.getAttribute('style') || ''
          const matches = style.match(/url\(([^)]+)\)/gi) || []
          matches.forEach((m) => {
            const val = m.replace(/^url\((['"]?)/, '').replace(/(['"]?)\)$/, '')
            pick(val)
          })
        })

      // Expand srcset entries to URLs
      const expanded = []
      urls.forEach((u) => {
        if (typeof u !== 'string') return
        if (u.includes(' ')) {
          // likely srcset
          u.split(',').forEach((part) =>
            expanded.push(part.trim().split(' ')[0])
          )
        } else {
          expanded.push(u)
        }
      })

      return expanded
    })

    // If modal not found, do a wider scan and filter hard.
    let fallbackRaw = []
    if (raw.length === 0 && !forceModal) {
      fallbackRaw = await page.evaluate(() => {
        const urls = new Set()
        const pick = (v) => {
          if (!v || typeof v !== 'string') return
          const u = v.startsWith('//') ? 'https:' + v : v
          urls.add(u)
        }
        const selectors = [
          '[data-selenium="mediaGalleryImageThumbnail"]',
          '[data-selenium="thumbnailImage"]',
          '[data-selenium="thumbnail"] img',
          '[data-selenium="mediaGallery"] img',
          '[data-selenium="mediaGalleryCarousel"] img',
          '[data-selenium="galleryThumbnails"] img',
          '[data-selenium="thumbsContainer"] img',
          '[data-selenium="thumbnailStrip"] img',
        ]
        document.querySelectorAll(selectors.join(',')).forEach((img) => {
          pick(img.src)
          pick(img.getAttribute('data-src'))
          pick(img.getAttribute('data-lazy'))
          pick(img.getAttribute('data-original'))
          pick(img.getAttribute('srcset'))
          const ds = img.getAttribute('data-srcset')
          if (ds) pick(ds)
        })
        const expanded = []
        urls.forEach((u) => {
          if (typeof u !== 'string') return
          if (u.includes(' ')) {
            u.split(',').forEach((part) =>
              expanded.push(part.trim().split(' ')[0])
            )
          } else {
            expanded.push(u)
          }
        })
        return expanded
      })
    }

    const html = await page.content()
    const htmlMatches = html.match(/https?:\/\/[^"'()\s]+/gi) || []
    const relMatches =
      html.match(
        /\/images\/(?:multiple_images|images\d+x\d+|itemzoom|largeimages|smallimages)[^"'()\s]+/gi
      ) || []
    const htmlExtracted = extractUrlsFromString(html)

    const expandedRaw = raw.flatMap(extractUrlsFromString)
    // Filter likely product images (B&H images CDN patterns)
    const filtered = expandedRaw
      .map((s) => (s || '').trim())
      .map(normalizeUrl)
      .filter(isLikelyGalleryImage)

    const expandedFallback = fallbackRaw.flatMap(extractUrlsFromString)
    const fallbackFiltered = expandedFallback
      .map((s) => (s || '').trim())
      .map(normalizeUrl)
      .filter(isLikelyGalleryImage)

    const htmlFiltered = htmlExtracted
      .concat(htmlMatches)
      .map(normalizeUrl)
      .filter(isLikelyGalleryImage)
    const relFiltered = relMatches
      .map((p) => `https://www.bhphotovideo.com${p}`)
      .map(normalizeUrl)
      .filter(isLikelyGalleryImage)

    const merged = (modalFound ? filtered : fallbackFiltered)
      .concat(modalFound ? Array.from(modalSequenceUrls) : Array.from(responseUrls))
      .concat(modalFound ? [] : Array.from(jsonUrls))
      .concat(modalFound ? [] : htmlFiltered)
      .concat(modalFound ? [] : relFiltered)

    let pageTitle = await page.title()
    if (/just a moment|attention required|enable cookies/i.test(pageTitle)) {
      if (headless) {
        blocked = true
        return res.status(403).json({
          error:
            'Blocked by Cloudflare. Run `npm run seed` once to save a browser session, then retry. If still blocked, run with HEADFUL=1.',
        })
      }
      // In headful mode, allow user to solve the challenge manually.
      try {
        const waitMs = Number(process.env.CF_WAIT_MS || 180000)
        // Give extra time for manual challenge solving.
        await page.waitForFunction(
          () => !/just a moment/i.test(document.title),
          { timeout: waitMs }
        )
        pageTitle = await page.title()
      } catch {
        blocked = true
        return res.status(403).json({
          error:
            'Blocked by Cloudflare. Solve the challenge in the opened browser, then retry.',
        })
      }
    }

    const hi = uniq(merged.map(toHiRes)).filter(isMainHiRes)

    const debug = req.query.debug === '1'
    if (debug) {
      const imgCount = await page.locator('img').count()
      console.log('[extract] raw:', raw.length)
      console.log('[extract] hi:', hi.length)
      console.log('[extract] htmlMatches:', htmlMatches.length)
      console.log('[extract] jsonUrls:', jsonUrls.size)
      console.log('[extract] htmlExtracted:', htmlExtracted.length)
      console.log('[extract] title:', pageTitle)
      console.log('[extract] imgCount:', imgCount)
      console.log('[extract] modalFound:', modalFound)
    }

    // Return as objects for UI
    const productName = pageTitle
      .replace(/\s*\|\s*B&H.*$/i, '')
      .replace(/\s*-\s*B&H.*$/i, '')
      .replace(/\s*B&H.*$/i, '')
      .trim()

    const items = hi.map((hiUrl, i) => ({
      id: i + 1,
      hiUrl,
      // a lightweight preview: downscale via cdn-cgi if possible
      previewUrl: hiUrl.includes('/images/images')
        ? hiUrl.replace(
            /\/images\/images2000x2000\//i,
            '/images/images500x500/'
          )
        : hiUrl,
    }))

    if (debug) {
      const imgCount = await page.locator('img').count()
      return res.json({
        count: items.length,
        items,
        productName,
        debug: {
          raw: raw.length,
          expandedRaw: expandedRaw.length,
          hi: hi.length,
          htmlMatches: htmlMatches.length,
          jsonUrls: jsonUrls.size,
          htmlExtracted: htmlExtracted.length,
          relMatches: relMatches.length,
          title: pageTitle,
          imgCount,
          modalFound,
          sampleRaw: raw.slice(0, 5),
          fallbackRaw: fallbackRaw.length,
          sampleHi: hi.slice(0, 5),
        },
      })
    }
    res.json({ count: items.length, items, productName })
  } catch (e) {
    res
      .status(500)
      .json({
        error: 'Failed to extract images',
        details: String(e?.message || e),
      })
  } finally {
    if (page && !(blocked && !browser)) {
      await page.close().catch(() => {})
    }
    if (context && browser) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
})

// Proxy download single image (forces download + avoids CORS)
app.get('/api/download', async (req, res) => {
  const url = req.query.url
  if (!url || typeof url !== 'string')
    return res.status(400).send('Missing url')

  try {
    const hiUrl = toHiRes(url)
    const r = await fetchWithHeaders(hiUrl)
    if (!r.ok) return res.status(502).send('Upstream fetch failed')

    const ct = r.headers.get('content-type') || 'application/octet-stream'
    const ext = ct.includes('png')
      ? 'png'
      : ct.includes('webp')
      ? 'webp'
      : 'jpg'
    const filename = `bh-image-${Date.now()}.${ext}`

    res.setHeader('Content-Type', ct)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    const buf = Buffer.from(await r.arrayBuffer())
    res.send(buf)
  } catch (e) {
    res.status(500).send('Download failed')
  }
})

// Download all as ZIP
app.post('/api/zip', async (req, res) => {
  const { urls, name } = req.body || {}
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array' })
  }

  const base = safeBaseName(name)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`)

  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('error', () => res.status(500).end())
  archive.pipe(res)

  let idx = 1
  for (const u of urls) {
    try {
      const hiUrl = toHiRes(u)
      const r = await fetchWithHeaders(hiUrl)
      if (!r.ok) continue

      const ct = r.headers.get('content-type') || ''
      const ext = ct.includes('png')
        ? 'png'
        : ct.includes('webp')
        ? 'webp'
        : 'jpg'
      const file = `${base}-${String(idx).padStart(2, '0')}.${ext}`
      idx++

      const buf = Buffer.from(await r.arrayBuffer())
      archive.append(buf, { name: file })
    } catch {
      // skip failures
    }
  }

  await archive.finalize()
})

// Download all as WEBP ZIP
app.post('/api/zip-webp', async (req, res) => {
  const { urls, name, quality } = req.body || {}
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array' })
  }

  const base = safeBaseName(name)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${base}-webp.zip"`)

  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('error', () => res.status(500).end())
  archive.pipe(res)

  const q =
    typeof quality === 'number'
      ? Math.min(90, Math.max(50, Math.round(quality)))
      : 75
  let idx = 1
  for (const u of urls) {
    try {
      const hiUrl = toHiRes(u)
      const r = await fetchWithHeaders(hiUrl)
      if (!r.ok) continue

      const buf = Buffer.from(await r.arrayBuffer())
      const webp = await sharp(buf)
        .webp({ quality: q, effort: 6, smartSubsample: true })
        .toBuffer()
      const file = `${base}-${String(idx).padStart(2, '0')}.webp`
      idx++

      archive.append(webp, { name: file })
    } catch {
      // skip failures
    }
  }

  await archive.finalize()
})

// Proxy preview image (avoids client-side blocking)
app.get('/api/preview', async (req, res) => {
  const url = req.query.url
  if (!url || typeof url !== 'string')
    return res.status(400).send('Missing url')
  try {
    const hiUrl = toHiRes(url)
    if (
      !isLikelyGalleryImage(hiUrl) &&
      !isBhImageUrl(hiUrl) ||
      /[{}"]/g.test(hiUrl)
    ) {
      return res.status(400).send('Invalid url')
    }
    const r = await fetchWithHeaders(hiUrl)
    if (!r.ok) return res.status(502).send('Upstream fetch failed')
    const ct = r.headers.get('content-type') || 'application/octet-stream'
    res.setHeader('Content-Type', ct)
    const buf = Buffer.from(await r.arrayBuffer())
    res.send(buf)
  } catch {
    res.status(500).send('Preview failed')
  }
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Running: http://localhost:${port}`)
})
