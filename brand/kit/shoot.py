import asyncio
from playwright.async_api import async_playwright
jobs=[("banner",1500,500,"x-banner.png"),("og",1200,630,"og.png"),("card",1080,1080,"launch-card.png")]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox","--allow-file-access-from-files"])
        for id,w,h,out in jobs:
            pg = await b.new_page(viewport={"width":w,"height":h})
            await pg.goto(f"file:///home/claude/heimdall/brand/kit/kit.html#{id}"); await pg.evaluate("document.fonts.ready"); await pg.wait_for_timeout(600)
            await pg.screenshot(path=f"/home/claude/heimdall/brand/kit/{out}")
        await b.close()
asyncio.run(main())
