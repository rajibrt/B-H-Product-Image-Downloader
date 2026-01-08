(() => {
  const boot = () => {
    chrome.storage.local.get('bhImport', (data) => {
      const payload = data && data.bhImport
      if (!payload || !Array.isArray(payload.urls) || payload.urls.length === 0) {
        return
      }

      const textarea = document.getElementById('pasteUrls')
      const importBtn = document.getElementById('importUrls')
      if (!textarea || !importBtn) return

      textarea.value = JSON.stringify(payload.urls, null, 2)
      if (!document.getElementById('name').value.trim() && payload.name) {
        document.getElementById('name').value = payload.name
          .replace(/\s*\|\s*B&H.*$/i, '')
          .replace(/\s*-\s*B&H.*$/i, '')
          .replace(/\s*B&H.*$/i, '')
          .trim()
      }
      importBtn.click()
      chrome.storage.local.remove('bhImport')
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
