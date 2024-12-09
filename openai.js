import axios from "axios";
import fs from "fs";
import path from "path";
import config from "../model/config.js";

const prompt = "请用中文回答问题";
// 默认查询，也就是你只发送'#gemini'时，默认使用的发送，建议写的通用一些，这样可以使用在不限于video、image、file等
const defaultQuery = "描述一下内容";
// base URL
const openaiBaseURL = "";
// API Key
const openaiApiKey = "";
// 模型
const openaiModel = "";

export class OpenAI extends plugin {
    constructor() {
        super({
            name: '[R插件补集] OpenAI 多模态助手',
            dsc: '来自 R插件补集 的 OpenAI 多模态助手，支持任何 OpenAI规范的模型',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: /^[^#][sS]*/,
                    fnc: 'chat'
                },
            ]
        });
        // 配置文件
        this.toolsConfig = config.getConfig("tools");
        // 设置基础 URL 和 headers
        this.baseURL = openaiBaseURL || this.toolsConfig.aiBaseURL;
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + (openaiApiKey || this.toolsConfig.aiApiKey)
        };
        this.model = openaiModel || this.toolsConfig.aiModel;
        // 临时存储消息id，请勿修改
        this.tmpMsgQueue = [];
    }

    async downloadFile(url, outputPath) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.promises.writeFile(outputPath, response.data);
            logger.info(`文件已成功下载至 ${ outputPath }`);
            return outputPath;
        } catch (error) {
            logger.error('无法下载文件:', error.message);
            throw error;
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
                        // 如果是图片，直���获取URL
                        url = msg.data?.url;
                        fileExt = msg.data?.file?.match(/\.(jpg|jpeg|png|gif|webp)(?=\.|$)/i)?.[1] || 'jpg';
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
                ];
            }

            return replyMessages;
        }

        let replyMessages = [];
        // 这种情况是直接发送的
        const curMsg = await e.bot.sendApi("get_group_msg_history", {
            "group_id": e.group_id,
            "count": 1
        });
        const messages = curMsg.data.messages[0]?.message;
        for (const msg of messages) {
            if (msg.type === "image") {
                replyMessages.push({
                    url: msg.data?.url,
                    fileExt: await this.extractFileExtension(msg.data?.file_id),
                    fileType: "image"
                });
            }
            // 如果以后有其他文件再添加
        }
        return replyMessages;
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
                                    // 从file字段中提取真实的文件扩展名
                                    const fileExt = item.data?.file?.match(/\.(jpg|jpeg|png|gif|webp)(?=\.|$)/i)?.[1] || 'jpg';
                                    forwardMessages.push({
                                        url: item.data?.url,
                                        fileExt: fileExt.toLowerCase(),
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

    async chat(e) {
        if (!e.msg || e.msg?.startsWith('#')) {
            return false
        }
        if ((e.isGroup || e.group_id) && !(e.atme || e.atBot || (e.at === e.self_id))) {
            return false
        }

        let query = e.msg.trim();

        // 自动判断是否有引用文件和图片
        const replyMessages = await this.autoGetUrl(e);
        // logger.info(replyMessages);

        const collection = [];
        for (let [index, replyItem] of replyMessages.entries()) {
            const { url, fileExt, fileType } = replyItem;
            // 如果链接不为空，并且引用的内容不是文本
            const downloadFileName = path.resolve(`./data/tmp${ index }.${ fileExt }`);
            // 默认如果什么也不发送的查询
            if (fileType === "image") {
                await this.downloadFile(url, downloadFileName);
                collection.push({
                    downloadFileName,
                    fileType
                });
            } else if (fileType === "video" || fileType === "file") {
                // file类型
                await this.downloadFile(url, downloadFileName);
                collection.push({
                    downloadFileName,
                    fileType: "file"
                });
            } else if (fileType === "text") {
                // 如果是一个文本
                query += `\n引用："${ url }"`;
            }
        }
        // logger.info(query);
        // logger.info(collection);

        // 如果是有图像数据的
        if (collection.length > 0) {
            const completion = await this.fetchOpenAI(query || defaultQuery, collection);
            // 这里统一处理撤回消息，表示已经处理完成
            await this.clearTmpMsg(e);
            await e.reply(completion, true);
            return;
        }

        // 如果引用的仅是一个文本
        if (replyMessages.length > 0 && replyMessages?.[0].fileType === "text") {
            query += `\n引用："${ replyMessages?.[0].url }"`;
        }

        const completion = await this.fetchOpenAI(query);
        // 这里统一处理撤回消息，示已经处理完成
        await this.clearTmpMsg(e);
        await e.reply(completion, true);
        return true;
    }

    async fetchOpenAI(query, collection = []) {
        const openAiData = await Promise.all(collection.map(async item => {
            const { downloadFileName, fileType } = item;
            const base64 = await toBase64(downloadFileName);
            if (fileType === "image") {
                return {
                    type: "image_url",
                    image_url: {
                        url: base64,
                    }
                };
            } else {
                return {
                    type: "file",
                    file_url: {
                        url: base64,
                    }
                };
            }
        }));

        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        "role": "system",
                        "content": prompt
                    },
                    {
                        role: "user",
                        content: [
                            ...openAiData,
                            {
                                type: "text",
                                text: query || defaultQuery,
                            }
                        ],
                    },
                ],
            }),
            timeout: 100000
        });
        return (await completion.json()).choices[0].message.content;
    }
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
