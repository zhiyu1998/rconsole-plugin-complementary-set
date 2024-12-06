import axios from "axios";
import fs from "fs";
import { marked } from "marked";
import path from "path";
import puppeteer from "../../../lib/puppeteer/puppeteer.js";
import config from "../model/config.js";

export class kimiJS extends plugin {
    constructor() {
        super({
            name: '[R插件补集]Moonshot AI',
            dsc: 'Moonshot AI Assistant',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: /^#[Kk][Ii][Mm][Ii]/,
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
        // 模型参数
        this.aiModel = this.toolsConfig.aiModel;
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
                };
            })));
        await page.close();
    }

    async getReplyMsg(e) {
        const msgList = await e.bot.sendApi("get_group_msg_history", {
            "group_id": e.group_id,
            "count": 1
        });
        let msgId = msgList.data.messages[0]?.message[0]?.data.id;
        let msg = await e.bot.sendApi("get_msg", {
            "message_id": msgId
        });
        return msg.data;
    }

    async extractFileExtension(filename) {
        // 使用正则表达式匹配文件名后缀
        const match = filename.match(/\.([a-zA-Z0-9]+)$/);
        return match ? match[1] : null;
    }

    /**
     * 自动获取文件的地址、后缀
     * @param e
     * @returns {Promise<*|string>}
     */
    async autoGetUrl(e) {
        if (e?.reply_id !== undefined) {
            let url, fileType;
            e.reply("正在上传引用图片，请稍候...", true);
            const replyMsg = await this.getReplyMsg(e);
            const message = replyMsg?.message;
            fileType = message?.[0]?.type;
            // 图片
            if (fileType === "image") {
                url = message?.[0]?.data?.url;
            } else {
                // 其他文件
                const file_id = message?.[0]?.data?.file_id;
                // 获取文件信息
                const latestFileUrl = await e.bot.sendApi("get_group_file_url", {
                    "group_id": e.group_id,
                    "file_id": file_id
                });
                url = latestFileUrl.data.url;
            }
            return {
                url: url,
                fileExt: await this.extractFileExtension(message?.[0]?.data?.file_id),
                fileType
            };
        }
        return {
            url: "",
            fileExt: "",
            fileType: ""
        };
    }

    async chat(e) {
        const query = e.msg.replace(/^#[Kk][Ii][Mm][Ii]/, '').trim();
        // 自动判断是否有引用文件和图片
        const { url, fileExt, fileType } = await this.autoGetUrl(e);
        if (url !== "") {
            const downloadFileName = path.resolve(`./data/tmp.${ fileExt }`);
            let defaultQuery = "";
            if (fileType === "image") {
                await this.downloadImage(url, downloadFileName);
                defaultQuery = "图片中有什么？";
            } else {
                // file类型
                await this.downloadFile(url, downloadFileName);
                defaultQuery = "文件中有什么？";
            }
            setTimeout(async () => {
                const base64Data = await toBase64(downloadFileName);
                // 发送请求
                const completion = await this.fetchKimiRequest(query || defaultQuery, "file", base64Data);
                await this.markdownRender(e, query || defaultQuery, completion);
            }, 1000);
            return true;
        }
        // 请求Kimi
        const completion = await this.fetchKimiRequest(query);
        await this.markdownRender(e, query, completion);
        return true;
    }

    async fetchKimiRequest(query, contentType = "text", contentData = null) {
        // 定义通用的消息内容
        let content;

        switch (contentType) {
            case 'image':
                content = {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: contentData,
                            }
                        },
                        {
                            type: "text",
                            text: query || "图片中有什么？",
                        }
                    ]
                };
                break;
            case 'file':
                content = {
                    role: "user",
                    content: [
                        {
                            type: "file",
                            file_url: {
                                url: contentData,
                            }
                        },
                        {
                            type: "text",
                            text: query || "文档里说了什么？",
                        }
                    ]
                };
                break;
            default:
                content = {
                    role: "user",
                    content: query
                };
        }

        // 发起请求
        const completion = await fetch(`${ this.baseURL }/v1/chat/completions`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.aiModel,
                messages: [content],
            }),
            timeout: 500000
        });

        return (await completion.json()).choices[0].message.content;
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
</html>`;
};

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
