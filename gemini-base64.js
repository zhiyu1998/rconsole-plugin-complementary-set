import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import fs from "fs";
import path from "path";

const prompt = "请用中文回答问题";
// ai Key
const aiApiKey = "";
// ai 模型
const model = "gemini-1.5-flash";
// 填写你的LLM Crawl 服务器地址，填写后即启用，例如：http://localhost:5000
const llmCrawlBaseUrl = "";

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
        this.genAI = new GoogleGenerativeAI(aiApiKey);
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
                .on('finish', () => logger.info('图片下载完成，准备上传给Gemini'))
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
            e.reply("正在上传引用，请稍候...", true, { recallMsg: 10 });
            const replyMsg = await this.getReplyMsg(e);
            const messages = replyMsg?.message; // 获取消息数组

            if (Array.isArray(messages) && messages.length > 0) {
                // 遍历消息数组寻找第一个有用的元素
                for (const msg of messages) {
                    fileType = msg.type;

                    if (fileType === "image") {
                        // 如果是图片，直接获取URL
                        url = msg.data?.url;
                        fileExt = await this.extractFileExtension(msg.data?.file_id);
                        break;
                    } else if (fileType === "file") {
                        // 如果是文件，获取文件信息
                        const file_id = msg.data?.file_id;
                        const latestFileUrl = await e.bot.sendApi("get_group_file_url", {
                            "group_id": e.group_id,
                            "file_id": file_id
                        });
                        url = latestFileUrl.data.url;
                        fileExt = await this.extractFileExtension(msg.data?.file_id);
                        break;
                    } else if (fileType === "video") {
                        // 如果是一个视频
                        url = msg.data?.path;
                        fileExt = await this.extractFileExtension(msg.data?.file_id);
                        break;
                    }
                }
            }

            // 如果什么也匹配不到会返回：{ url: '', fileExt: undefined, fileType: 'text' }
            if (url === undefined && fileType === 'text') {
                // 获取文本数据到 url 变量
                url = messages?.[0].data?.text || messages?.[1].data?.text;
            }

            return {
                url: url || "",
                fileExt: fileExt,
                fileType: fileType || ""
            };
        }

        return {
            url: "",
            fileExt: "",
            fileType: ""
        };
    }


    async chat(e) {
        let query = e.msg.replace(/^#[Gg][Ee][Mm][Ii][Nn][Ii]/, '').trim();
        // 自动判断是否有引用文件和图片
        const { url, fileExt, fileType } = await this.autoGetUrl(e);
        logger.info({ url, fileExt, fileType });
        // 如果链接不为空，并且引用的内容不是文本
        if (url !== "" && fileType !== "text") {
            const downloadFileName = path.resolve(`./data/tmp.${ fileExt }`);
            // 默认如果什么也不发送的查询
            let defaultQuery = "描述一下内容";
            if (fileType === "image") {
                await this.downloadImage(url, downloadFileName);
            } else {
                // file类型
                await this.downloadFile(url, downloadFileName);
            }
            setTimeout(async () => {
                // 发送请求
                const completion = await this.fetchGeminiReq(query || defaultQuery, getMimeType(downloadFileName), downloadFileName);
                await e.reply(completion, true);
            }, 1000);
            return true;
        }
        // 如果引用的是一个文本
        if (fileType === "text") {
            query += `引用："${ url }"`;
        }

        // -- 下方可能返回的值为 { url: '', fileExt: '', fileType: '' }
        // 判断是否包含 https 链接
        query = await this.extendsSearchQuery(query);

        // 请求 Gemini
        const completion = await this.fetchGeminiReq(query);
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
            query += `\n搜索结果：${ llmData }`;
        } else if (query.trim().startsWith("搜索")) {
            // 需要搜索
            const llmData = await this.fetchLLMCrawlReq(`https://www.baidu.com/s?wd=${ query.replace("搜索", "") }`);
            query += `\n搜索结果：${ llmData }`;
        }
        return query;
    }

    async fetchGeminiReq(query, contentType, contentData = null) {
        // 定义通用的消息内容
        const client = this.genAI.getGenerativeModel({ model: model });

        // 如果 query 是字符串，转换为数组
        const queryArray = Array.isArray(query) ? query : [{ text: query }];

        // 构建生成内容数组
        const contentArray = contentData
            ? [prompt, ...queryArray, toGeminiInitData(contentData)]
            : [prompt, ...queryArray];

        // 调用生成接口
        const result = await client.generateContent(contentArray);

        // 返回生成的文本
        return result.response.text();
    }

    async fetchLLMCrawlReq(query) {
        // 提取 http 链接
        const reqUrl = extractUrls(query)?.[0];
        const data = await fetch(`${ llmCrawlBaseUrl }/crawl?url=${ reqUrl }`).then(resp => resp.json());
        return data.data;
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
    '.js': 'application/javascript', // 或 'text/javascript'
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.xml': 'text/xml',
    '.rtf': 'application/rtf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',

    // Programming languages
    '.py': 'application/x-python',
    '.java': 'text/x-java-source',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++src',
    '.php': 'application/x-php',
    '.sh': 'application/x-shellscript'
};


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
