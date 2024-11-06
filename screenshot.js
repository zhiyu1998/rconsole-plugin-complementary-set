import fs from "fs";
import puppeteer from "../../lib/puppeteer/puppeteer.js";

// 截图前等待的时间
const screenWaitTime = 3;

let fullScreen = false;

export class Screenshot extends plugin {
    constructor() {
        super({
            name: "http截图",
            dsc: "http截图",
            /** https://oicqjs.github.io/oicq/#events */
            event: "message",
            priority: 5000,
            rule: [
                {
                    /** 命令正则匹配 */
                    reg: "^http",
                    /** 执行方法 */
                    fnc: "screenshot",
                },
                {
                    /** 命令正则匹配 */
                    reg: "^截图切换$",
                    /** 执行方法 */
                    fnc: "screenshotStatus",
                },
                {
                    /** 命令正则匹配 */
                    reg: "^#gittr$",
                    /** 执行方法 */
                    fnc: "githubTrending",
                },
            ],
        });
    }

    async delay(timeout) {
        return new Promise(resolve => setTimeout(resolve, timeout));
    }

    async screenshotStatus(e) {
        fullScreen = !fullScreen;
        if (fullScreen === true) {
            e.reply("截图已开启全屏模式");
            logger.info("[截图] 开启全屏模式");
        } else {
            e.reply("截图已关闭全屏模式");
            logger.info("[截图] 关闭全屏模式");
        }
        return true;
    }

    async screenshot(e) {
        if (!e.isMaster) {
            logger.info("[截图] 检测到当前不是主人，忽略");
            return;
        }
        await this.sendScreenShot(this.e.msg.trim(), fullScreen);
    }

    async githubTrending(e) {
        if (!e.isMaster) {
            logger.info("[截图] 检测到当前不是主人，忽略");
            return;
        }
        await this.sendNormalScreenShot("https://github.com/trending", true);
    }

    async sendNormalScreenShot(link) {
        // 打开一个新的页面
        const browser = await puppeteer.browserInit();
        const page = await browser.newPage();
        // 导航到你想要截图的URL
        await page.goto(link);
        logger.info(`开始截图...${ link }`);
        // 设置截图的大小和视口尺寸
        // await page.setViewport({ width: 1280, height: 800 });
        // 截图并保存到文件
        const buff = await page.screenshot({
            path: './screenshot.png',
            type: 'jpeg',
            fullPage: true,
            omitBackground: false,
            quality: 70
        });
        await this.e.reply(segment.image(fs.readFileSync("./screenshot.png")));
    }

    async sendScreenShot(link, fullPage = false) {
        // 打开一个新的页面
        const browser = await puppeteer.browserInit();
        let page = await browser.newPage();
        // 导航到你想要截图的URL
        await page.goto(link);
        logger.info(`开始截图...${link}`);
        // 设置截图的大小和视口尺寸
        await page.setViewport({ width: 1920, height: 1080 });
        // 显式等待几秒
        await this.delay(screenWaitTime * 1000);
        // 截图并保存到文件
        await page.screenshot({
            path: "./screenshot.png",
            type: "jpeg",
            fullPage: fullPage,
            omitBackground: false,
            quality: 50,
        });

        const screenshotBase64 = fs.readFileSync("./screenshot.png", "base64");
        // 生成包含 Base64 图片的 HTML
        const htmlContent = screenRender(screenshotBase64);
        await page.setViewport({
            width: 1280,
            height: 720,
            deviceScaleFactor: 10, // 根据显示器的分辨率调整比例，2 是常见的 Retina 显示比例
        });
        // 设置页面内容为包含 Base64 图片的 HTML
        await page.setContent(htmlContent, {
            waitUntil: "networkidle0",
        });
        // 获取页面上特定元素的位置和尺寸
        const element = await page.$(".browser-window"); // 可以用CSS选择器选中你要截取的部分
        // 直接截图该元素
        await element.screenshot({
            path: "./screenshot.png",
            type: "jpeg",
            fullPage: false,
            omitBackground: false,
            quality: 50,
        });

        await this.e.reply(segment.image(fs.readFileSync("./screenshot.png")));
    }
}

function screenRender(screenshotBase64) {
    return `
     <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>美化截图</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 500vh;
                margin: 0;
            }
            .browser-window {
                width: 80%;
                height: auto;
                max-width: 900px;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                background-color: white;
                padding: 20px;
            }
            .browser-header {
                display: flex;
                align-items: center;
                background-color: #f0f0f0;
                padding: 8px 15px;
                border-radius: 10px 10px 0 0;
            }
            .browser-header .buttons {
                display: flex;
                gap: 6px;
            }
            .browser-header .buttons div {
                width: 12px;
                height: 12px;
                border-radius: 50%;
            }
            .browser-header .buttons .close {
                background-color: #ff5f57;
            }
            .browser-header .buttons .minimize {
                background-color: #ffbd2e;
            }
            .browser-header .buttons .maximize {
                background-color: #28c940;
            }
            .screenshot {
                width: 100%;
                height: auto;
                border-radius: 0 0 10px 10px;
            }
        </style>
    </head>
    <body>

        <div class="container">
        <div class="browser-window">
            <div class="browser-header">
                <div class="buttons">
                    <div class="close"></div>
                    <div class="minimize"></div>
                    <div class="maximize"></div>
                </div>
            </div>
            <img class="screenshot" src="data:image/png;base64,${ screenshotBase64 }" alt="Screenshot">
        </div>
</div>

    </body>
    </html>
  `;
}
