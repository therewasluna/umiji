// Renders tools/banner/banner.html into assets/social-preview.png (1280×640, GitHub's social preview)
// and assets/banner.png (README header, 2× for sharp text). Run from the umiji repo root:
//   PLAYWRIGHT=/path/to/node_modules/playwright CHROME=/path/to/chrome node tools/banner/render.cjs
const path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')

const page = 'file://' + path.resolve(__dirname, 'banner.html')
const out = (f) => path.resolve(__dirname, '../../assets', f)

;(async () => {
    const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
    for (const [file, url, height, scale] of [
        ['social-preview.png', page, 640, 1],
        ['banner.png', page + '?readme', 420, 2]
    ]) {
        const tab = await browser.newPage({ viewport: { width: 1280, height }, deviceScaleFactor: scale })
        await tab.goto(url, { waitUntil: 'networkidle' })
        await tab.evaluate(() => document.fonts.ready)
        await tab.screenshot({ path: out(file) })
        console.log(file)
    }
    await browser.close()
})()
