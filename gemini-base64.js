import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import fs from "fs";
import path from "path";

// 提示词
const prompt = "请用中文回答问题";
// 默认查询，也就是你只发送'#gemini'时，默认使用的发送，建议写的通用一些，这样可以使用在不限于video、image、file等
const defaultQuery = "描述一下内容";
// ai Key
const aiApiKey = "";
// ai 模型
const model = "gemini-1.5-flash";
// 填写你的LLM Crawl 服务器地址，填写后即启用，例如：http://localhost:5000，具体使用方法见：https://github.com/zhiyu1998/rconsole-plugin-complementary-set/tree/master/crawler
const llmCrawlBaseUrl = "";
// 每日 8 点 03 分自动清理临时文件
const CLEAN_CRON = "3 8 * * *";

export class Gemini extends plugin {
    constructor() {
        super({
            name: '[R插件补集]谷歌 Gemini',
            dsc: '谷歌 Gemini 多模态助手',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: /^#[Gg][Ee][Mm][Ii][Nn][Ii]/,
                    fnc: 'chat'
                },
            ]
        });
        this.task = {
            cron: CLEAN_CRON,
            name: 'Gemini-自动清理临时文件',
            fnc: () => this.autoCleanTmp(),
            log: false
        };
        this.genAI = new GoogleGenerativeAI(aiApiKey);
        // 临时存储消息id，请勿修改
        this.tmpMsgQueue = [];
    }

    /**
     * 自动清理垃圾函数
     * @returns {Promise<void>}
     */
    async autoCleanTmp() {
        const fullPath = path.resolve("./data");

        // 检查目录是否存在
        if (!fs.existsSync(fullPath)) {
            logger.error(`[R插件补集][Gemini自动清理临时文件] 目录不存在: ${fullPath}`);
            return;
        }

        // 读取目录内容
        fs.readdir(fullPath, (err, files) => {
            if (err) {
                logger.error(`[R插件补集][Gemini自动清理临时文件] 无法读取目录: ${fullPath}`, err);
                return;
            }

            // 筛选以 prefix 开头的文件
            const tmpFiles = files.filter(file => file.startsWith("tmp"));

            // 删除筛选到的文件
            tmpFiles.forEach(file => {
                const filePath = path.join(fullPath, file);
                fs.unlink(filePath, err => {
                    if (err) {
                        logger.error(`[R插件补集][Gemini自动清理临时文件] 删除文件失败: ${filePath}`, err);
                    } else {
                        logger.info(`[R插件补集][Gemini自动清理临时文件] 已删除: ${filePath}`);
                    }
                });
            });

            if (tmpFiles.length === 0) {
                logger.info(`[R插件补集][Gemini自动清理临时文件] 暂时没有清理的文件。`);
            }
        });
    }

    /**
     * 通用文件下载函数
     * @param {string} url - 文件的下载地址
     * @param {string} outputPath - 文件保存路径
     * @param {boolean} useStream - 是否使用流式写入（默认 false）
     * @returns {Promise<void>}
     */
    async downloadFile(url, outputPath, useStream = false) {
        try {
            if (useStream) {
                // 使用流式方式下载
                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                });
                await new Promise((resolve, reject) => {
                    response.data
                        .pipe(fs.createWriteStream(outputPath))
                        .on('finish', () => {
                            logger.info(`文件已成功流式下载至 ${outputPath}`);
                            resolve();
                        })
                        .on('error', (err) => {
                            logger.error('文件流下载失败:', err.message);
                            reject(err);
                        });
                });
            } else {
                // 使用一次性写入方式下载
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                await fs.promises.writeFile(outputPath, response.data);
                logger.info(`文件已成功下载至 ${outputPath}`);
            }
        } catch (error) {
            logger.error('无法下载文件:', error.message);
        }
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
            let url, fileType, fileExt;
            // 获取回复消息
            const replyMsg = await this.getReplyMsg(e);
            // 交互告知用户等待
            const tmpMsg = await e.reply("正在上传引用，请稍候...", true);
            // 如果存在就暂时存放到队列
            if (tmpMsg?.data?.message_id) {
                this.tmpMsgQueue.push(tmpMsg.data.message_id);
            }
            // 获取消息数组
            const messages = replyMsg?.message;

            // 先尝试处理forward消息
            if (Array.isArray(messages)) {
                const forwardMessages = await this.handleForwardMsg(messages);
                if (forwardMessages[0].url !== "") {
                    return forwardMessages;
                }
            }

            let replyMessages = [];

            if (Array.isArray(messages) && messages.length > 0) {
                // 遍历消息数组寻找第一个有用的元素
                for (const msg of messages) {
                    fileType = msg.type;

                    if (fileType === "image") {
                        // 如果是图片，直接获取URL
                        url = msg.data?.url;
                        fileExt = await this.extractFileExtension(msg.data?.file_id);
                        replyMessages.push({
                            url,
                            fileExt,
                            fileType
                        });
                    } else if (fileType === "file") {
                        // 如果是文件，获取文件信息
                        const file_id = msg.data?.file_id;
                        const latestFileUrl = await e.bot.sendApi("get_group_file_url", {
                            "group_id": e.group_id,
                            "file_id": file_id
                        });
                        url = latestFileUrl.data.url;
                        fileExt = await this.extractFileExtension(msg.data?.file_id);
                        replyMessages.push({
                            url,
                            fileExt,
                            fileType
                        });
                    } else if (fileType === "video") {
                        // 如果是一个视频
                        url = msg.data?.path;
                        fileExt = await this.extractFileExtension(msg.data?.file_id);
                        replyMessages.push({
                            url,
                            fileExt,
                            fileType
                        });
                    } else if (fileType === "text") {
                        // 如果是一个文本
                        url = msg.data?.text;
                        replyMessages.push({
                            url,
                            fileExt: "",
                            fileType
                        });
                    }
                }
            }

            // 如果什么也匹配不到会返回：{ url: '', fileExt: undefined, fileType: 'text' }
            if (url === undefined && fileType === 'text') {
                // 获取文本数据到 url 变量
                url = messages?.[0].data?.text || messages?.[1].data?.text;
                replyMessages = [
                    {
                        url,
                        fileExt: "",
                        fileType
                    }
                ]
            }

            return replyMessages;
        }

        return [{
            url: "",
            fileExt: "",
            fileType: ""
        }];
    }

    /**
     * 清除临时消息
     * @returns {Promise<void>}
     */
    async clearTmpMsg(e) {
        if (this.tmpMsgQueue?.length > 0) {
            for (const tmpMsgId of this.tmpMsgQueue) {
                await e.bot.sendApi("delete_msg", { "message_id": tmpMsgId });
            }
        }
    }

    async chat(e) {
        let query = e.msg.replace(/^#[Gg][Ee][Mm][Ii][Nn][Ii]/, '').trim();
        // 自动判断是否有引用文件和图片
        const replyMessages = await this.autoGetUrl(e);
        logger.info(replyMessages);

        const collection = [];
        for (let [index, replyItem] of replyMessages.entries()) {
            const { url, fileExt, fileType } = replyItem;
            // 如果链接不为空，并且引用的内容不是文本
            const downloadFileName = path.resolve(`./data/tmp${index}.${fileExt}`);
            // 默认如果什么也不发送的查询
            if (fileType === "image") {
                await this.downloadFile(url, downloadFileName, true);
                collection.push(downloadFileName);
            } else if (fileType === "video" || fileType === "file") {
                // file类型
                await this.downloadFile(url, downloadFileName, false);
                collection.push(downloadFileName);
            } else if (fileType === "text") {
                // 如果是一个文本
                query += `\n引用："${url}"`;
            }
        }
        logger.info(query);
        logger.info(collection);

        // 如果是有图像数据的
        if (collection.length > 0) {
            const completion = await this.fetchGeminiReq(query || defaultQuery, collection);
            // 这里统一处理撤回消息，表示已经处理完成
            await this.clearTmpMsg(e);
            await e.reply(completion, true);
            return;
        }

        // 如果引用的仅是一个文本
        if (replyMessages?.[0].fileType === "text") {
            query += `\n引用："${replyMessages?.[0].url}"`;
        }

        // -- 下方可能返回的值为 { url: '', fileExt: '', fileType: '' }
        // 判断是否包含 https 链接
        query = await this.extendsSearchQuery(query);

        // 请求 Gemini
        const completion = await this.fetchGeminiReq(query);
        // 这里统一处理撤回消息，示已经处理完成
        await this.clearTmpMsg(e);
        await e.reply(completion, true);
        return true;
    }

    /**
     * 扩展弱搜索能力
     * @param query
     * @returns {Promise<*>}
     */
    async extendsSearchQuery(query) {
        if (llmCrawlBaseUrl !== '' && isContainsUrl(query)) {
            // 单纯包含了链接
            const llmData = await this.fetchLLMCrawlReq(query);
            query += `\n搜索结果：${llmData}`;
        } else if (query.trim().startsWith("搜索")) {
            // 需要搜索
            const llmData = await this.fetchLLMCrawlReq(`https://www.baidu.com/s?wd=${query.replace("搜索", "")}`);
            query += `\n搜索结果：${llmData}`;
        }
        return query;
    }

    async fetchGeminiReq(query, contentData = []) {
        // 定义通用的消息内容
        const client = this.genAI.getGenerativeModel({ model: model });

        // 如果 query 是字符串，转换为数组
        const queryArray = Array.isArray(query) ? query : [{ text: query }];

        // 挨个初始化
        const geminiContentData = [];
        if (contentData.length > 0) {
            for (let i = 0; i < contentData.length; i++) {
                geminiContentData.push(toGeminiInitData(contentData[i]));
            }
        }

        // 构建生成内容数组
        const contentArray = geminiContentData.length > 0
            ? [prompt, ...queryArray, ...geminiContentData]
            : [prompt, ...queryArray];

        // 调用生成接口
        const result = await client.generateContent(contentArray);

        // 返回生成的文本
        return result.response.text();
    }

    async fetchLLMCrawlReq(query) {
        // 提取 http 链接
        const reqUrl = extractUrls(query)?.[0];
        const data = await fetch(`${llmCrawlBaseUrl}/crawl?url=${reqUrl}`).then(resp => resp.json());
        return data.data;
    }

    /**
     * 处理合并转发消息
     * @param messages 消息数组
     * @returns {Promise<Array>} 返回处理后的消息数组
     */
    async handleForwardMsg(messages) {
        let forwardMessages = [];

        // 遍历消息数组寻找forward类型的消息
        for (const msg of messages) {
            if (msg.type === "forward") {
                // 获取转发消息的内容
                const forwardContent = msg.data?.content;

                if (Array.isArray(forwardContent)) {
                    // 遍历转发消息内容
                    for (const forwardMsg of forwardContent) {
                        const message = forwardMsg.message;

                        if (Array.isArray(message)) {
                            // 遍历每条消息的内容
                            for (const item of message) {
                                if (item.type === "image") {
                                    forwardMessages.push({
                                        url: item.data?.url,
                                        fileExt: await this.extractFileExtension(item.data?.file),
                                        fileType: "image"
                                    });
                                } else if (item.type === "video") {
                                    forwardMessages.push({
                                        url: item.data?.path || item.data?.url,
                                        fileExt: await this.extractFileExtension(item.data?.file),
                                        fileType: "video"
                                    });
                                } else if (item.type === "text") {
                                    forwardMessages.push({
                                        url: item.data?.text,
                                        fileExt: "",
                                        fileType: "text"
                                    });
                                }
                            }
                        }
                    }
                    // 找到并处理完forward消息后直接返回
                    return forwardMessages;
                }
            }
        }

        // 如果没有找到forward消息,返回空数组
        return [{
            url: "",
            fileExt: "",
            fileType: ""
        }];
    }
}

/**
 * 转换路径图片为base64格式
 * @param {string} filePath - 图片路径
 * @returns {Promise<string>} Base64字符串
 */
function toGeminiInitData(filePath) {
    const fileData = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    return {
        inlineData: {
            data: Buffer.from(fileData).toString("base64"),
            mimeType
        },
    };
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

/**
 * 使用正则表达式来判断字符串中是否包含一个 http 或 https 的链接
 * @param string
 * @returns {boolean}
 */
function isContainsUrl(string) {
    const urlRegex = /(https?:\/\/[^\s]+)/g; // 匹配 http 或 https 开头的链接
    return urlRegex.test(string);
}

/**
 * 提取字符串中的链接
 * @param string
 * @returns {*|*[]}
 */
function extractUrls(string) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return string.match(urlRegex) || []; // 如果没有匹配，返回空数组
}

const mimeTypes = {
    // Audio
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.aiff': 'audio/aiff',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',

    // Images
    '.png': 'image/png',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/vnd.microsoft.icon',
    '.tiff': 'image/tiff',

    // Videos
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv',
    '.mpg': 'video/mpg',
    '.webm': 'video/webm',
    '.wmv': 'video/x-ms-wmv',
    '.3gpp': 'video/3gpp',

    // Documents and others
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript', // 或 'application/x-javascript'
    '.mjs': 'text/javascript', // 或 'application/x-javascript'
    '.json': 'application/json',
    '.md': 'text/md',
    '.csv': 'text/csv',
    '.xml': 'text/xml',
    '.rtf': 'text/rtf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',

    // Programming languages
    '.py': 'text/x-python', // 或 'application/x-python'
    '.java': 'text/x-java-source',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++src',
    '.php': 'application/x-php',
    '.sh': 'application/x-shellscript'
};
