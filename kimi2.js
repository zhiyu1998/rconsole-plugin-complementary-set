import axios from "axios";
import fs from "fs";
import { marked } from "marked"
import path from "path";
import puppeteer from "../../../lib/puppeteer/puppeteer.js";
import config from "../model/config.js";

// 存储pdf、png位置
const kimiFilePath = "./data/kimiImgTmp.pdf";
let kimiImgPath = "./data/kimiImgTmp.png";
// 搜索聊天记录阈值，建议5~10
const SEARCH_THRESHOLD = 10;

export class kimiJS extends plugin {
    constructor() {
        super({
            name: 'Moonshot AI',
            dsc: 'Moonshot AI Assistant',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: '^#kimi',
                    fnc: 'chat'
                },
            ]
        });
        // 配置文件
        this.toolsConfig = config.getConfig("tools");
        // 设置基础 URL 和 headers
        this.baseURL = this.toolsConfig.aiBaseURL;
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.toolsConfig.aiApiKey
        };
    }

    /**
     * 图片下载
     * @param url
     * @param imgPath
     * @returns {Promise<unknown | void>}
     */
    async downloadImage(url, imgPath) {
        return axios({
            url,
            method: 'GET',
            responseType: 'stream'
        }).then(response => {
            response.data.pipe(fs.createWriteStream(imgPath))
                .on('finish', () => logger.info('图片下载完成，准备上传给Kimi'))
                .on('error', err => logger.error('图片下载失败:', err.message));
        }).catch(err => {
            logger.error('图片地址访问失败:', err.message);
        });
    }

    /**
     * 文档下载
     * @param url
     * @param outputPath
     * @returns {Promise<void>}
     */
    async downloadFile(url, outputPath) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.promises.writeFile(outputPath, response.data);
            logger.info(`文件已成功下载至 ${ outputPath }`);
        } catch (error) {
            logger.error('无法下载文件:', error);
        }
    }

    async getLatestImage(e) {
        // 获取最新的聊天记录，阈值为5
        const latestChat = await e.bot.sendApi("get_group_msg_history", {
            "group_id": e.group_id,
            "count": SEARCH_THRESHOLD
        });
        const messages = latestChat.data.messages;
        // 找到最新的图片
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages?.[i]?.message;
            if (message?.[0]?.type === "image") {
                return message?.[0].data?.url;
            }
        }
        return "";
    }

    /**
     * 获取最新的文档
     * @param e
     * @returns {Promise<*|string>}
     */
    async getLatestDocument(e) {
        // 获取最新的聊天记录，阈值为5
        const latestChat = await e.bot.sendApi("get_group_msg_history", {
            "group_id": e.group_id,
            "count": SEARCH_THRESHOLD
        });
        const messages = latestChat.data.messages;
        let file_id = "";
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages?.[i]?.message;
            if (message?.[0]?.type === "file") {
                file_id = message?.[0].data?.file_id;
                break;
            }
        }
        if (file_id === "") {
            return "";
        }
        // 获取文件信息
        const latestFileUrl = await e.bot.sendApi("get_group_file_url", {
            "group_id": e.group_id,
            "file_id": file_id
        });
        return latestFileUrl.data.url;
    }

    async markdownRender(e, query, aiContent) {
        // 打开一个新的页面
        const browser = await puppeteer.browserInit();
        const page = await browser.newPage();

        let aiReference;
        if (aiContent.indexOf("搜索结果来自：") !== -1) {
            const aiContentSplit = aiContent.split("搜索结果来自：");
            aiContent = aiContentSplit[0];
            aiReference = aiContentSplit?.[1] || "";
        }

        const htmlContent = renderHTML(e, query, aiContent);

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
        const element = await page.$(".chat-container"); // 可以用CSS选择器选中你要截取的部分
        // 直接截图该元素
        await element.screenshot({
            path: "./chat.png",
            type: "jpeg",
            fullPage: false,
            omitBackground: false,
            quality: 50,
        });
        await e.reply(segment.image(fs.readFileSync("./chat.png")));
        aiReference !== undefined && await e.reply(Bot.makeForwardMsg(aiReference
            .trim()
            .split("\n")
            .map(item => {
                return {
                    message: { type: "text", text: item || "" },
                    nickname: e.sender.card || e.user_id,
                    user_id: e.user_id,
                }
            })))
    }

    async chat(e) {
        const query = e.msg.replace(/^#kimi/, '').trim();
        // 文档处理
        if (query.startsWith("d")) {
            await this.document(e);
            return true;
        } else if (query.startsWith("p")) {
            await this.image(e);
            return true;
        }
        // 请求Kimi
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: "moonshot-v1-8k",
                messages: [
                    {
                        "role": "system",
                        "content": "- Role: 信息提炼专家\n" +
                            "- Background: 用户需要从提供的网页链接中快速获取关键信息，包括来源、标题、总结内容和关键段落。\n" +
                            "- Profile: 你是一位专业的信息提炼专家，擅长快速阅读和总结大量文本，能够准确捕捉文章的核心要点，并以简洁明了的方式呈现给用户。\n" +
                            "- Skills: 你需要具备快速阅读、信息提取、文本总结和概括的能力，同时需要对网络链接进行解析，以提取网页的元数据。\n" +
                            "- Goals: 提供一个清晰、准确的信息总结，包括网页的来源、标题、总结内容和关键段落。\n" +
                            "- Constrains: 确保信息的准确性和完整性，避免包含任何误导性或不相关的信息。\n" +
                            "- OutputFormat: 结构化的文本输出，包括明确的标题和子标题，以及有序的列表或段落。\n" +
                            "- Workflow:\n" +
                            "  1. 解析用户提供的链接，确定网页的来源和标题。\n" +
                            "  2. 阅读并分析网页内容，提炼出总结内容和关键段落。\n" +
                            "  3. 以结构化格式输出信息，包括来源、标题、总结和关键段落。\n" +
                            "- Examples:\n" +
                            "  - 来源：sspai.com\n" +
                            "  - 标题：USB-C 接口的全面解析\n" +
                            "  - 总结的内容：本文全面解析了USB-C接口的特性、兼容性问题以及不同USB-C线缆的选择。强调USB-C只是接口形状，与其支持的特性无关。解释了USB-C接口的统一形状优势和潜在的兼容性问题，以及如何根据不同需求选择合适的线缆。\n" +
                            "  - 关键段落：\n" +
                            "    - USB-C 接口的好：统一的接口形状，简化了设备连接的复杂性。\n" +
                            "    - USB-C 接口的坏：能插不等于能用，接口形状与支持的协议和速率是独立的。\n" +
                            "    - 揭秘 USB-C 接口线缆的兼容逻辑：全针脚不等于全支持，eMarker芯片和ReTimer芯片的作用。\n" +
                            "    - 那些 USB-C 所支持的协议：数据传输、视频输出、音频输出和电力传输的不同协议和兼容性问题。",
                    },
                    {
                        role: "user",
                        content: query
                    },
                ],
            }),
            timeout: 100000
        });
        await this.markdownRender(e, query, (await completion.json()).choices[0].message.content, true);
        return true;
    }

    async image(e) {
        e.reply("正在获取聊天最新的图片，请稍候...", true);
        const query = e.msg.replace(/^#kimip/, '').trim();
        const url = await this.getLatestImage(e);
        if (url === "") {
            e.reply("没有找到聊天最新的图片", true);
            return false;
        }
        // 下载图片
        kimiImgPath = path.resolve(kimiImgPath);
        await this.downloadImage(url, kimiImgPath);
        setTimeout(async () => {
            // 转换为base64
            const base64 = await toBase64(kimiImgPath);
            // 发送请求
            const completion = await fetch(this.baseURL + "/v1/chat/completions", {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    model: "step",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: base64,
                                    }
                                },
                                {
                                    type: "text",
                                    text: query || "图片中有什么？",
                                }
                            ],
                        },
                    ],
                }),
                timeout: 100000
            });
            const respContent = (await completion.json());
            await this.markdownRender(e, query || "图片中有什么？", respContent.choices[0].message.content);
        }, 1000);

        return true;
    }

    async document(e) {
        const query = e.msg.replace(/^#kimid/, '').trim();
        e.reply("正在获取聊天最新的文档文件，请稍候...", true);
        let url = await this.getLatestDocument(e);
        if (url === "") {
            e.reply("没有找到聊天最新的文档文件", true);
            return false;
        }
        url += "demo.pdf";
        // 下载pdf并转换成base64
        await this.downloadFile(url, kimiFilePath);
        const base64Data = await toBase64(kimiFilePath);
        setTimeout(async () => {
            // 发送请求
            const completion = await fetch(this.baseURL + "/v1/chat/completions", {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    model: "moonshot-v1-auto",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "file",
                                    file_url: {
                                        url: base64Data,
                                    }
                                },
                                {
                                    type: "text",
                                    text: query || "文档里说了什么？",
                                }
                            ],
                        },
                    ],
                }),
                timeout: 500000
            });
            const respContent = (await completion.json());
            await this.markdownRender(e, query || "文档里说了什么？", respContent.choices[0].message.content);
        }, 1000)
        return true;
    }
}


const renderHTML = (e, query, aiContent) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kimi Chat Interface</title>
    <style>
        body {
            background-color: #1a1a1a;
            color: #ffffff;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }
        .chat-container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .logo {
            text-align: center;
            margin-bottom: 20px;
        }
        .logo img {
            max-width: 200px;
            height: auto;
        }
        .message {
            margin-bottom: 20px;
            display: flex;
            align-items: flex-start;
        }
        .avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            margin-right: 12px;
        }
        .message-content {
            background-color: #2a2a2a;
            border-radius: 18px;
            padding: 12px 12px;
            max-width: 70%;
            font-size: 14px;
        }
        .user-message {
            justify-content: flex-end;
        }
        .user-message .message-content {
            background-color: #0066cc;
            margin-right: 12px;
        }
        .ai-message .message-content {
            background-color: #2a2a2a;
        }
        .user-message .avatar {
            order: 1;
            margin-right: 0;
            margin-left: 12px;
        }
        pre {
            background-color: #1e1e1e;
            border-radius: 8px;
            padding: 12px;
            overflow-x: auto;
        }
        code {
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="logo">
            <img src="https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/kimi/logo.png" alt="KIMI Logo">
        </div>
        <div class="message user-message">
            <div class="message-content">
                <p>${ query }</p>
            </div>
            <img src="http://q1.qlogo.cn/g?b=qq&nk=${ e.user_id }&s=100" alt="User Avatar" class="avatar">
        </div>
        <div class="message ai-message">
            <img src="https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/kimi/kimi.png" alt="AI Avatar" class="avatar">
            <div class="message-content">
                <div id="ai-content">${ marked.parse(aiContent) }</div>
            </div>
        </div>
    </div>
</body>
</html>`
}

/**
 * 转换路径图片为base64格式
 * @param {string} filePath - 图片路径
 * @returns {Promise<string>} Base64字符串
 */
async function toBase64(filePath) {
    try {
        const fileData = await fs.promises.readFile(filePath);
        const base64Data = fileData.toString('base64');
        return `data:${ getMimeType(filePath) };base64,${ base64Data }`;
    } catch (error) {
        logger.info(error);
    }
}

/**
 * 辅助函数：根据文件扩展名获取MIME类型
 * @param {string} filePath - 文件路径
 * @returns {string} MIME类型
 */
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return mimeTypes[ext] || 'application/octet-stream';
}

const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    // 添加其他文件类型和MIME类型的映射
};
