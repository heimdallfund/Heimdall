import asyncio, sys
from playwright.async_api import async_playwright
jobs = [a.split("=",1) for a in sys.argv[1:]]  # name=querystring
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader","--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width":1200,"height":1200})
        pg.on("console", lambda m: print("console:", m.text) if m.type=="error" else None)
        for name, qs in jobs:
            await pg.goto(f"file:///home/claude/heimdall/brand/3d/render.html?{qs}")
            await pg.wait_for_function("window.__done === true", timeout=60000)
            await pg.screenshot(path=f"/home/claude/heimdall/brand/3d/{name}.png", omit_background="clear=1" in qs)
            print("ok", name)
        await b.close()
asyncio.run(main())
