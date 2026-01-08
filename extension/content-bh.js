(() => {
  if (document.getElementById('bh-grabber-btn')) return

  const btn = document.createElement('button')
  btn.id = 'bh-grabber-btn'
  btn.type = 'button'
  btn.textContent = 'Download Images'
  btn.style.cssText = [
    'position:fixed',
    'right:18px',
    'bottom:18px',
    'z-index:999999',
    'background:#1f6f5c',
    'color:#fff',
    'border:1px solid #165746',
    'border-radius:999px',
    'padding:12px 16px',
    'font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial',
    'box-shadow:0 12px 24px rgba(0,0,0,0.18)',
    'cursor:pointer'
  ].join(';')

  const note = document.createElement('div')
  note.id = 'bh-grabber-note'
  note.style.cssText = [
    'position:fixed',
    'right:18px',
    'bottom:64px',
    'z-index:999999',
    'background:#ffffff',
    'color:#1f2a2e',
    'border:1px solid #e3e0db',
    'border-radius:10px',
    'padding:8px 10px',
    'font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial',
    'box-shadow:0 10px 20px rgba(0,0,0,0.12)',
    'display:none'
  ].join(';')

  document.body.appendChild(btn)
  document.body.appendChild(note)

  const showNote = (text) => {
    note.textContent = text
    note.style.display = 'block'
    clearTimeout(note.__t)
    note.__t = setTimeout(() => {
      note.style.display = 'none'
    }, 2500)
  }

  const extractUrls = () => {
    const root =
      document.querySelector('[data-selenium="modalContent"]') ||
      document.querySelector('[data-selenium="mediaGalleryModal"]') ||
      document
    const urls = new Set()
    const pick = (v) => {
      if (!v || typeof v !== 'string') return
      const u = v.startsWith('//') ? 'https:' + v : v
      urls.add(u)
    }
    root.querySelectorAll('img').forEach((img) => {
      pick(img.src)
      pick(img.getAttribute('data-src'))
      pick(img.getAttribute('data-lazy'))
      pick(img.getAttribute('data-original'))
      pick(img.getAttribute('srcset'))
      pick(img.getAttribute('data-srcset'))
    })
    root.querySelectorAll('[data-zoom-image],[data-full],[data-hires]').forEach((el) => {
      pick(el.getAttribute('data-zoom-image'))
      pick(el.getAttribute('data-full'))
      pick(el.getAttribute('data-hires'))
    })
    const expanded = []
    urls.forEach((u) => {
      if (u.includes(' ')) {
        u.split(',').forEach((p) => expanded.push(p.trim().split(' ')[0]))
      } else {
        expanded.push(u)
      }
    })
    const filtered = expanded.filter(
      (u) => /bhphoto(video)?\.com\//i.test(u) && /\/images\//i.test(u)
    )
    return Array.from(new Set(filtered))
  }

  btn.addEventListener('click', async () => {
    const urls = extractUrls()
    if (!urls.length) {
      showNote('Open the product gallery modal first.')
      return
    }
    const payload = {
      urls,
      name: document.title || '',
      source: location.href,
      ts: Date.now()
    }
    chrome.storage.local.set({ bhImport: payload }, () => {
      showNote(`Found ${urls.length} images. Opening app...`)
      window.open('https://bhphoto.camerabazar.net/?import=1', '_blank')
    })
  })
})()
