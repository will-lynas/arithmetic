import { expect, test } from '@playwright/test'
for(const theme of ['dark','light'])for(const [width,height]of [[1440,900],[1360,900],[1024,768],[768,900],[375,900],[812,375]])test(`mode rail separated from header ${theme} ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(theme=>localStorage.setItem('arithmetic:theme',theme),theme)
  for(const path of ['/multiplication','/multiplication/stats','/division']) {
    await page.goto(path)
    await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
    const modes=page.getByRole('navigation',{name:'Arithmetic modes'})
    const first=modes.getByRole('link',{name:'Multiplication',exact:true}),second=modes.getByRole('link',{name:'Division',exact:true})
    await expect(first).toBeVisible();await expect(second).toBeVisible()
    if(width===1440 || width===1360 || width===375)await page.screenshot({path:`artifacts/${process.env.ARITHMETIC_CAPTURE_PREFIX??'revised-nav'}-${path.slice(1).replaceAll('/','-')}-${theme}-${width}.png`,fullPage:true})
    const a=(await first.boundingBox())!,b=(await second.boundingBox())!,header=(await page.locator('.page-header').boundingBox())!,shell=(await page.locator('.shell').boundingBox())!
    expect(a.x).toBeGreaterThanOrEqual(8);expect(a.x).toBeLessThanOrEqual(40)
    expect(a.x).toBe(b.x);expect(b.y).toBeGreaterThanOrEqual(a.y+a.height+6)
    expect(a.y).toBeGreaterThanOrEqual(header.y+header.height+40)
    expect(a.y).toBeGreaterThanOrEqual(100);expect(a.y).toBeLessThanOrEqual(140)
    expect(a.x+a.width+10).toBeLessThanOrEqual(shell.x)
    expect(header.y).toBeLessThan(40)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await first.focus();await expect(first).toBeFocused()
    expect(await first.evaluate(e=>getComputedStyle(e).outlineStyle)).not.toBe('none')
    await page.keyboard.press('Tab');await expect(second).toBeFocused()
    const active=modes.locator('[aria-current="page"]')
    await expect(active).toHaveCount(1)
    expect(await active.evaluate(e=>getComputedStyle(e).borderLeftColor)).not.toBe('rgba(0, 0, 0, 0)')
    if(path.endsWith('/stats')) {
      await page.evaluate(()=>scrollTo(0,document.body.scrollHeight))
      expect(await modes.evaluate(e=>['fixed','sticky'].includes(getComputedStyle(e).position))).toBe(false)
      await page.evaluate(()=>scrollTo(0,0))
    }
  }
})
