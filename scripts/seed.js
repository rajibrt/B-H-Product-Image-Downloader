import fs from 'fs/promises'
import { existsSync } from 'fs'
import readline from 'readline'

const url =
  process.argv[2] ||
  'https://www.bhphotovideo.com/c/product/1338516-REG/sony_sel1635gm_fe_16_35mm_f_2_8_gm.html'
const storagePath = 'storage/bh.json'

async function main() {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: false, slowMo: 50 })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Dhaka',
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  console.log('Opening:', url)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  console.log('If you see a "Just a moment..." page, solve it in the browser.')
  console.log('When the product page loads, press Enter here to save session.')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  await new Promise((resolve) => rl.question('', resolve))
  rl.close()

  const title = await page.title()
  if (/just a moment/i.test(title)) {
    console.log('Still on Cloudflare page. Not saving session.')
    await browser.close()
    process.exit(1)
  }

  if (!existsSync('storage')) {
    await fs.mkdir('storage', { recursive: true })
  }
  await context.storageState({ path: storagePath })
  console.log('Saved session to', storagePath)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
