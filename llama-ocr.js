import axios from "axios";
import fs from "fs";
import path from "path";
import { ocr } from "llama-ocr";

// https://www.together.ai/ 进行注册
const TOGETHER_API_KEY = "";

// 存储位置
let kimiImgPath = "./data/kimiImgTmp.png";
// 搜索聊天记录阈值，建议5~10
const SEARCH_THRESHOLD = 10;

export class LlamaOcr extends plugin {
    constructor() {
        super({
            name: "[R插件补集]LLama-OCR",
            dsc: "使用 Together AI的免费 Llama 3.2 端点来解析图像并返回 markdown",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^#llaocr$",
                    fnc: "llaOCR",
                }
            ]
        })
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

    async llaOCR(e) {
        const query = e.msg.replace(/^#llaocr/, '').trim();

        let url;
        if (e?.reply_id !== undefined) {
            e.reply("正在上传引用图片，请稍候...", true);
            const replyMsg = await e.getReply();
            const message = replyMsg?.message;
            url = message?.[0]?.url;
        } else {
            e.reply("正在获取聊天最新的图片，请稍候...", true);
            url = await this.getLatestImage(e);
            if (url === "") {
                e.reply("没有找到聊天最新的图片", true);
                return false;
            }
        }
        logger.info(url);
        // 下载图片
        kimiImgPath = path.resolve(kimiImgPath);
        await this.downloadImage(url, kimiImgPath);
        setTimeout(async () => {
            const markdown = await ocr({
                filePath: kimiImgPath, // path to your image (soon PDF!)
                apiKey: TOGETHER_API_KEY, // Together AI API key
            });
            e.reply(markdown, true);
        }, 1000);

        return true;
    }
}
