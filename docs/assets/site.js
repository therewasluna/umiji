// Umiji wiki: language switch, screenshot zoom, copy buttons, table-of-contents highlight, concept search.
// Pages that render content later (the API guide) fire `wiki:render` to get copy buttons and the highlight.
;(() => {
    // Both languages use the same ids, so switching keeps your place.
    document.querySelector('.lang-btn')?.addEventListener('click', (e) => {
        e.currentTarget.href = e.currentTarget.href.split('#')[0] + location.hash
    })

    // Click a screenshot to see it full size.
    document.addEventListener('click', (e) => {
        const frame = e.target.closest('.shot .window, .shot .handset')
        if (!frame) return
        const img = frame.querySelector('img')
        const layer = document.createElement('div')
        layer.className = 'zoom'
        layer.setAttribute('role', 'dialog')
        layer.setAttribute('aria-label', img.alt)
        layer.innerHTML = `<img src="${img.currentSrc || img.src}" alt="">`
        layer.querySelector('img').alt = img.alt
        const close = () => {
            layer.remove()
            document.removeEventListener('keydown', onKey)
        }
        const onKey = (ev) => ev.key === 'Escape' && close()
        layer.addEventListener('click', close)
        document.addEventListener('keydown', onKey)
        document.body.append(layer)
    })

    const fa = document.documentElement.lang === 'fa'
    const t = fa
        ? { copy: 'کپی', copied: 'کپی شد', manual: 'با Ctrl+C کپی کنید' }
        : { copy: 'Copy', copied: 'Copied', manual: 'Press Ctrl+C' }
    const addCopyButtons = () => document.querySelectorAll('pre[data-copy]:not(:has(> .copy-btn))').forEach((pre) => {
        const btn = document.createElement('button')
        btn.className = 'copy-btn'
        btn.type = 'button'
        btn.textContent = t.copy
        btn.addEventListener('click', async () => {
            const text = [...pre.querySelectorAll('code')].map((c) => c.innerText).join('\n')
            try {
                await navigator.clipboard.writeText(text.replace(/^\s*#.*$/gm, '').trim())
                btn.textContent = t.copied
            } catch {
                btn.textContent = t.manual
            }
            setTimeout(() => (btn.textContent = t.copy), 1600)
        })
        pre.append(btn)
    })

    addCopyButtons()

    const toc = document.querySelector('.toc')
    if (toc) {
        toc.querySelector('.toc-toggle')?.addEventListener('click', () => {
            const open = toc.classList.toggle('open')
            toc.querySelector('.toc-toggle').setAttribute('aria-expanded', open)
        })
        let spy
        const watch = () => {
            spy?.disconnect()
            const links = new Map([...toc.querySelectorAll('a[href^="#"]')].map((a) => [a.hash.slice(1), a]))
            const targets = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean)
            let current
            spy = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        if (!entry.isIntersecting) continue
                        current?.classList.remove('active')
                        current = links.get(entry.target.id)
                        current?.classList.add('active')
                    }
                },
                { rootMargin: '-90px 0px -65% 0px' }
            )
            targets.forEach((t) => spy.observe(t))
        }
        watch()
        document.addEventListener('wiki:render', watch)
    }
    // the API page renders its reference after load
    document.addEventListener('wiki:render', addCopyButtons)

    const search = document.querySelector('#concept-search')
    if (search) {
        // Persian: match ی/ي and ک/ك, Persian and Arabic digits, with or without the half-space
        const norm = (t) =>
            t
                .toLowerCase()
                .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0)
                .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660)
                .replace(/ي/g, 'ی')
                .replace(/ك/g, 'ک')
                .replace(/\u200c/g, '')
        const items = [...document.querySelectorAll('.concept')].map((el) => ({
            el,
            text: norm(el.textContent)
        }))
        const groups = [...document.querySelectorAll('.group-block')]
        const empty = document.querySelector('.empty')
        const run = () => {
            const words = norm(search.value).trim().split(/\s+/).filter(Boolean)
            let shown = 0
            for (const { el, text } of items) {
                const hit = words.every((w) => text.includes(w))
                el.hidden = !hit
                if (hit) shown++
            }
            groups.forEach((g) => (g.hidden = !g.querySelector('.concept:not([hidden])')))
            empty.style.display = shown ? 'none' : 'block'
        }
        search.addEventListener('input', run)
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== search) {
                e.preventDefault()
                search.focus()
            }
            if (e.key === 'Escape' && document.activeElement === search) {
                search.value = ''
                run()
            }
        })
    }
})()
