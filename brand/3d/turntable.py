import asyncio, math, subprocess, os
from playwright.async_api import async_playwright
FPS=30; N=150  # 5 s seamless loop
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader","--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width":1200,"height":1200})
        await pg.goto("file:///home/claude/heimdall/brand/3d/render.html?v=matte")
        await pg.wait_for_function("window.__done === true", timeout=60000)
        tmp="turntable.tmp.mp4"
        ff=subprocess.Popen(["ffmpeg","-y","-loglevel","error","-f","image2pipe","-framerate",str(FPS),"-c:v","mjpeg","-i","-","-c:v","libx264","-crf","18","-preset","veryfast","-pix_fmt","yuv420p","-movflags","+faststart",tmp],stdin=subprocess.PIPE)
        for i in range(N):
            t=i/N*2*math.pi
            await pg.evaluate(f"frame({-0.35+0.5*math.sin(t)}, {0.14+0.06*math.sin(2*t)}, {0.05*math.sin(t+math.pi/2)})")
            ff.stdin.write(await pg.screenshot(type="jpeg", quality=92))
        ff.stdin.close()
        if ff.wait()==0: os.replace(tmp,"heimdall-3d-loop.mp4")
        await b.close()
asyncio.run(main())
