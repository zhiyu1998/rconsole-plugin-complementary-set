import axios from "axios";
import fs from "fs";
import path from "path";
import config from "../model/config.js";
import { redisGetKey, redisSetKey } from "../utils/redis-util.js";

const prompt = "模拟在群里呆了20年的热心大佬，擅长使用各种工具、搜索网页以及帮助群友解决问题。请用中文回答问题,回答尽量简洁明了，禁止使用markdown语法。";
// 默认查询，建议写的通用一些，这样可以使用在不限于video、image、file等
const defaultQuery = "描述一下内容";
// base URL
const openaiBaseURL = "";
// API Key
const openaiApiKey = "";
// 模型
const openaiModel = "gpt-5.5";

// === 生图配置（与聊天配置独立） ===
// 生图模型
const imageGenModel = "gpt-image-2";
// 生图 base URL（留空则复用聊天配置）
const imageGenBaseURL = "";
// 生图 API Key（留空则复用聊天配置）
const imageGenApiKey = "";
// 生图接口模式：openai = 保留原 /v1/images/*；codex-proxy = /v1/responses + image_generation 工具
// 参考：https://github.com/icebear0828/codex-proxy
const imageGenProvider = "openai";
// codex-proxy 图像工具的宿主模型，不要填 gpt-image-2
const imageHostModel = "gpt-5.5";
// codex-proxy 图像工具参数
const imageGenSize = "1024x1024";
const imageGenOutputFormat = "png";

// 每日 8 点 06 分自动清理临时文件和对话记录
const CLEAN_CRON = "6 8 * * *";
// 每个用户最多保留的对话历史轮数（1轮 = 1条用户消息 + 1条助手回复）
const MAX_HISTORY_ROUNDS = 10;

// Redis 对话历史 key 前缀
const HISTORY_KEY_PREFIX = "Yz:openai:history:";
// 对话历史过期时间（秒），默认 24 小时，配合每日定时清理
const HISTORY_TTL = 86400;

export class OpenAI extends plugin {
    constructor() {
        super({
            name: '[R插件补集] OpenAI 多模态助手',
            dsc: '来自 R插件补集 的 OpenAI 多模态助手，支持任何 OpenAI规范的模型',
            event: 'message',
            priority: 5001,
            rule: [
                {
                    reg: /^#生图[\s\S]+/,
                    fnc: 'generateImage'
                },
                {
                    reg: /^[^#][sS]*/,
                    fnc: 'chat'
                },
            ]
        });
        this.task = {
            cron: CLEAN_CRON,
            name: 'OpenAI-自动清理临时文件',
            fnc: () => this.autoCleanTmp(),
            log: false
        };
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
        // 生图配置（优先级：代码顶部 > 聊天配置回退）
        this.imageGenBaseURL = imageGenBaseURL || this.baseURL;
        this.imageGenApiKey = imageGenApiKey || this.headers["Authorization"]?.replace("Bearer ", "") || "";
        this.imageGenModel = imageGenModel || "gpt-image-2";
        this.imageGenProvider = imageGenProvider || "openai";
        this.imageHostModel = imageHostModel || this.model;
        this.imageGenSize = imageGenSize || "1024x1024";
        this.imageGenOutputFormat = imageGenOutputFormat || "png";
    }

    /**
     * 自动清理垃圾函数
     * @returns {Promise<void>}
     */
    async autoCleanTmp() {
        // 清理 Redis 中的对话历史记录
        try {
            const historyKeys = await redis.keys(`${HISTORY_KEY_PREFIX}*`);
            if (historyKeys.length > 0) {
                await redis.del(...historyKeys);
                logger.info(`[R插件补集][OpenAI] 已清理 Redis 中 ${historyKeys.length} 个用户的对话历史记录`);
            }
        } catch (err) {
            logger.error(`[R插件补集][OpenAI] 清理 Redis 对话历史失败:`, err);
        }

        const fullPath = path.resolve("./data");

        // 检查目录是否存在
        if (!fs.existsSync(fullPath)) {
            logger.error(`[R插件补集][OpenAI自动清理临时文件] 目录不存在: ${fullPath}`);
            return;
        }

        // 读取目录内容
        fs.readdir(fullPath, (err, files) => {
            if (err) {
                logger.error(`[R插件补集][OpenAI自动清理临时文件] 无法读取目录: ${fullPath}`, err);
                return;
            }

            // 筛选以 prefix 开头的文件
            const tmpFiles = files.filter(file => file.startsWith("tmp"));

            // 删除筛选到的文件
            tmpFiles.forEach(file => {
                const filePath = path.join(fullPath, file);
                fs.unlink(filePath, err => {
                    if (err) {
                        logger.error(`[R插件补集][OpenAI自动清理临时文件] 删除文件失败: ${filePath}`, err);
                    } else {
                        logger.info(`[R插件补集][OpenAI自动清理临时文件] 已删除: ${filePath}`);
                    }
                });
            });

            if (tmpFiles.length === 0) {
                logger.info(`[R插件补集][OpenAI自动清理临时文件] 暂时没有清理的文件。`);
            }
        });
    }

    async downloadFile(url, outputPath) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.promises.writeFile(outputPath, response.data);
            logger.info(`文件已成功下载至 ${outputPath}`);
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
        const userId = String(e.user_id);

        // 自动判断是否有引用文件和图片
        const replyMessages = await this.autoGetUrl(e);
        // logger.info(replyMessages);

        const collection = [];
        for (let [index, replyItem] of replyMessages.entries()) {
            const { url, fileExt, fileType } = replyItem;
            // 如果链接不为空，并且引用的内容不是文本
            const downloadFileName = path.resolve(`./data/tmp${index}.${fileExt}`);
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
                query += `\n引用："${url}"`;
            }
        }

        // 如果是有图像数据的
        if (collection.length > 0) {
            const completion = await this.fetchOpenAI(userId, query || defaultQuery, collection);
            // 这里统一处理撤回消息，表示已经处理完成
            await this.clearTmpMsg(e);
            await this.splitCompletion(e, completion);
            return;
        }

        const completion = await this.fetchOpenAI(userId, query);
        // 这里统一处理撤回消息，示已经处理完成
        await this.clearTmpMsg(e);
        await this.splitCompletion(e, completion);
        return true;
    }

    /**
     * 生图功能：#生图 <prompt>
     * 支持文生图（/v1/images/generations）和图生图/编辑（/v1/images/edits）
     * 当用户引用了包含图片的消息时，自动使用图生图编辑模式
     * @param e
     * @returns {Promise<boolean>}
     */
    async generateImage(e) {
        // 提取 #生图 后面的 prompt 文本
        const promptText = e.msg.replace(/^#生图\s*/, "").trim();
        if (!promptText) {
            await e.reply("请在 #生图 后输入图片描述，例如：#生图 一只穿宇航服的猫在月球散步");
            return false;
        }

        // 检查是否引用了包含图片的消息（图生图 / 编辑模式）
        let editImages = [];
        if (e.reply_id !== undefined) {
            try {
                const replyItems = await this.autoGetUrl(e);
                for (const item of replyItems) {
                    if (item.fileType === "image" && item.url) {
                        editImages.push(item);
                    }
                }
                // 清理 autoGetUrl 产生的临时消息
                await this.clearTmpMsg(e);
            } catch (err) {
                logger.warn(`[OpenAI][生图] 获取引用图片失败: ${err.message}`);
            }
        }

        const isEditMode = editImages.length > 0;
        const modeText = isEditMode ? "图生图" : "文生图";
        await e.reply(`🎨 正在${modeText}，请稍候...`, true);

        // 生图最大重试次数
        const MAX_RETRIES = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (this.imageGenProvider === "codex-proxy") {
                    logger.info(`[OpenAI][生图] 第${attempt}次请求 | 模式: ${modeText} | Provider: codex-proxy | 宿主模型: ${this.imageHostModel} | prompt: ${promptText.slice(0, 100)}`);

                    const imgBuffer = await this.requestCodexProxyImage(promptText, editImages);
                    const imageExt = this.imageGenOutputFormat === "jpeg" ? "jpg" : this.imageGenOutputFormat;
                    const tmpImgPath = path.resolve(`./data/tmp_img_${Date.now()}.${imageExt}`);

                    await fs.promises.writeFile(tmpImgPath, imgBuffer);
                    await e.reply(segment.image(tmpImgPath));
                    fs.unlink(tmpImgPath, () => {});

                    logger.info(`[OpenAI][生图] 完成 | 模式: ${modeText} | Provider: codex-proxy | 临时文件: ${tmpImgPath}`);
                    return true;
                }

                const base = this.imageGenBaseURL.replace(/\/+$/, "");
                let url, headers, body;

                if (isEditMode) {
                    // ====== 图生图 / 编辑模式：/v1/images/edits + FormData ======
                    const endpoint = base.endsWith("/v1") ? "/images/edits" : "/v1/images/edits";
                    url = `${base}${endpoint}`;

                    const formData = new FormData();
                    formData.append("model", this.imageGenModel);
                    formData.append("prompt", promptText);
                    formData.append("quality", "medium");
                    formData.append("size", "1024x1024");

                    // 下载引用的图片并添加到 FormData
                    for (let i = 0; i < editImages.length; i++) {
                        const img = editImages[i];
                        const tmpPath = path.resolve(`./data/tmp_edit_${Date.now()}_${i}.${img.fileExt || "png"}`);
                        await this.downloadFile(img.url, tmpPath);
                        const imgBuffer = await fs.promises.readFile(tmpPath);
                        const mimeType = getMimeType(tmpPath);
                        const imgBlob = new Blob([imgBuffer], { type: mimeType });
                        formData.append("image[]", imgBlob, `reference_${i}.${img.fileExt || "png"}`);
                        fs.unlink(tmpPath, () => {});
                    }

                    // FormData 模式：不要设置 Content-Type，让 fetch 自动设置 multipart boundary
                    headers = {
                        "Authorization": "Bearer " + this.imageGenApiKey
                    };
                    body = formData;
                } else {
                    // ====== 文生图模式：/v1/images/generations + JSON ======
                    const endpoint = base.endsWith("/v1") ? "/images/generations" : "/v1/images/generations";
                    url = `${base}${endpoint}`;

                    headers = {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + this.imageGenApiKey
                    };
                    body = JSON.stringify({
                        model: this.imageGenModel,
                        prompt: promptText,
                        n: 1,
                        size: "1024x1024",
                        quality: "medium",
                        response_format: "b64_json"
                    });
                }

                logger.info(`[OpenAI][生图] 第${attempt}次请求 | 模式: ${modeText} | 模型: ${this.imageGenModel} | prompt: ${promptText.slice(0, 100)}`);

                // 超时设为 10 分钟（600 秒），避免代理 504
                const response = await fetch(url, {
                    method: "POST",
                    headers,
                    body,
                    timeout: 600000
                });

                const rawText = await response.text();
                if (!response.ok) {
                    throw new Error(`生图请求失败(${response.status}): ${rawText.slice(0, 500)}`);
                }

                // 解析响应 JSON
                let result;
                try {
                    result = JSON.parse(rawText);
                } catch {
                    throw new Error(`生图响应解析失败: ${rawText.slice(0, 500)}`);
                }

                const imageData = result?.data?.[0];
                if (!imageData) {
                    throw new Error("生图响应中未找到图片数据");
                }

                // 获取图片 buffer
                let imgBuffer;
                if (imageData.b64_json) {
                    imgBuffer = Buffer.from(imageData.b64_json, "base64");
                } else if (imageData.url) {
                    // 如果返回的是 URL，下载图片
                    const imgResp = await axios.get(imageData.url, { responseType: "arraybuffer" });
                    imgBuffer = imgResp.data;
                } else {
                    throw new Error("生图响应中未找到图片数据（无 b64_json 和 url）");
                }

                // 保存临时图片文件
                const tmpImgPath = path.resolve(`./data/tmp_img_${Date.now()}.png`);
                await fs.promises.writeFile(tmpImgPath, imgBuffer);

                // 发送图片给用户
                await e.reply(segment.image(tmpImgPath));

                // 清理临时文件
                fs.unlink(tmpImgPath, () => {});

                logger.info(`[OpenAI][生图] 完成 | 模式: ${modeText} | 临时文件: ${tmpImgPath}`);
                return true; // 成功，直接返回
            } catch (error) {
                lastError = error;
                logger.warn(`[OpenAI][生图] 第${attempt}次请求失败: ${error.message || error}`);

                // 如果还有重试次数，等待后重试
                if (attempt < MAX_RETRIES) {
                    const waitSec = attempt * 5;
                    logger.info(`[OpenAI][生图] ${waitSec}秒后进行重试...`);
                    await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                }
            }
        }

        // 所有重试都失败了
        logger.error(`[OpenAI][生图] 最终失败:`, lastError?.message || lastError);
        await e.reply(`生图失败: ${lastError?.message || "未知错误"}`);
        return true;
    }

    /**
     * codex-proxy 图像生成/编辑：/v1/responses + image_generation 工具
     * @param {string} promptText
     * @param {Array} editImages
     * @returns {Promise<Buffer>}
     */
    async requestCodexProxyImage(promptText, editImages = []) {
        const base = this.imageGenBaseURL.replace(/\/+$/, "");
        const endpoint = base.endsWith("/v1") ? "/responses" : "/v1/responses";
        let content = promptText;

        if (editImages.length > 0) {
            content = [{ type: "input_text", text: promptText }];

            for (let i = 0; i < editImages.length; i++) {
                const img = editImages[i];
                const tmpPath = path.resolve(`./data/tmp_edit_${Date.now()}_${i}.${img.fileExt || "png"}`);
                await this.downloadFile(img.url, tmpPath);
                const dataUrl = await toBase64(tmpPath);
                fs.unlink(tmpPath, () => {});

                content.push({
                    type: "input_image",
                    image_url: dataUrl,
                    detail: "high"
                });
            }
        }

        const response = await fetch(`${base}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + this.imageGenApiKey
            },
            body: JSON.stringify({
                model: this.imageHostModel,
                stream: true,
                input: [{
                    role: "user",
                    content
                }],
                tools: [{
                    type: "image_generation",
                    size: this.imageGenSize,
                    output_format: this.imageGenOutputFormat,
                    background: "auto",
                    moderation: "auto"
                }]
            }),
            timeout: 600000
        });

        const rawText = await response.text();
        if (!response.ok) {
            throw new Error(`codex-proxy 生图请求失败(${response.status}): ${rawText.slice(0, 500)}`);
        }

        return parseCodexProxyImage(rawText);
    }

    /**
     * 适配 free 系列的回答
     * @param e
     * @param completion
     * @returns {Promise<void>}
     */
    async splitCompletion(e, completion) {
        // 如果出现搜索再进一步划分
        const contentSplit = completion.split("搜索结果来自：");
        await e.reply(contentSplit[0], true);
        if (contentSplit?.[1] !== undefined) {
            await e.reply(Bot.makeForwardMsg(contentSplit[1]
                .trim()
                .split("\n")
                .map(item => {
                    return {
                        message: { type: "text", text: item || "" },
                        nickname: e.sender.card || e.user_id,
                        user_id: e.user_id,
                    };
                })));
        }
    }

    async fetchOpenAI(userId, query, collection = []) {
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

        // 构建当前用户消息
        const userMessage = {
            role: "user",
            content: collection.length > 0
                ? [
                    ...openAiData,
                    {
                        type: "text",
                        text: query || defaultQuery,
                    }
                ]
                : query || defaultQuery,
        };

        // 从 Redis 获取该用户的历史记录，构建 messages 数组
        const historyKey = `${HISTORY_KEY_PREFIX}${userId}`;
        let history;
        try {
            const raw = await redis.get(historyKey);
            history = raw ? JSON.parse(raw) : [];
        } catch {
            history = [];
        }
        const messages = [
            { role: "system", content: prompt },
            ...history,
            userMessage,
        ];

        // 智能拼接 URL：如果 baseURL 已经以 /v1 结尾则不再重复添加
        const base = this.baseURL.replace(/\/+$/, "");
        const endpoint = base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions";
        const completion = await fetch(`${base}${endpoint}`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.model,
                stream: false,
                messages,
            }),
            timeout: 100000
        });

        const rawText = await completion.text();
        if (!completion.ok) {
            throw new Error(`[OpenAI] 请求失败(${completion.status}): ${rawText.slice(0, 1000)}`);
        }
        const reply = await parseCompletionText(rawText, completion.headers.get("content-type"));

        // 保存对话历史：只保存纯文本内容，丢弃图片等多媒体数据
        const plainUserMessage = collection.length > 0
            ? { role: "user", content: query || defaultQuery }
            : userMessage;
        history.push(plainUserMessage);
        history.push({ role: "assistant", content: reply });

        // 超过最大轮数时裁剪（保留最近 N 轮，每轮2条消息）
        const maxMessages = MAX_HISTORY_ROUNDS * 2;
        if (history.length > maxMessages) {
            history.splice(0, history.length - maxMessages);
        }
        // 将对话历史保存到 Redis，设置过期时间
        try {
            await redis.set(historyKey, JSON.stringify(history), 'EX', HISTORY_TTL);
        } catch (err) {
            logger.warn(`[R插件补集][OpenAI] 保存对话历史失败: ${err.message}`);
        }

        return reply;
    }
}

/**
 * 去除模型返回的思考内容（<think>...</think>）
 * @param {string} text
 * @returns {string}
 */
function stripThinkingTags(text) {
    if (typeof text !== "string") return text;
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * 兼容解析各类 OpenAI 兼容供应商返回格式（JSON / SSE）
 * @param {string} rawText
 * @param {string | null} contentType
 * @returns {string}
 */
function parseCompletionText(rawText, contentType = "") {
    const normalizedType = (contentType || "").toLowerCase();

    if (normalizedType.includes("application/json")) {
        const json = JSON.parse(rawText);
        const content = extractContentFromPayload(json);
        if (content) return content;

        // 某些供应商 content-type 报告为 JSON 但实际是 SSE
        if (rawText.includes("data:")) {
            const sseContent = parseSSEContent(rawText);
            if (sseContent) return sseContent;
        }

        // 输出调试信息帮助排查
        const finishReason = json?.choices?.[0]?.finish_reason;
        const hasToolCalls = Array.isArray(json?.choices?.[0]?.message?.tool_calls);
        const hasRefusal = !!json?.choices?.[0]?.message?.refusal;
        const hasReasoning = !!json?.choices?.[0]?.message?.reasoning_content;
        const contentValue = (JSON.stringify(json?.choices?.[0]?.message?.content) ?? "null").slice(0, 200);
        const topKeys = Object.keys(json || {}).join(", ");
        logger.warn(`[OpenAI] JSON 解析完成但未找到可用文本 | finish_reason=${finishReason} tool_calls=${hasToolCalls} refusal=${hasRefusal} reasoning=${hasReasoning} content=${contentValue} | 顶层keys: [${topKeys}]`);
        logger.warn(`[OpenAI] 完整响应(前800字符): ${rawText.slice(0, 800)}`);

        throw new Error(`[OpenAI] JSON 响应中未找到可用文本内容 (finish_reason=${finishReason}, keys=${topKeys})`);
    }

    // 某些兼容供应商即使 stream=false 仍返回 SSE（data: ...）
    if (rawText.includes("data:")) {
        const content = parseSSEContent(rawText);
        if (content) return content;
    }

    // 兜底：尝试把非标准 content-type 的文本当 JSON 解析
    try {
        const json = JSON.parse(rawText);
        const content = extractContentFromPayload(json);
        if (content) return stripThinkingTags(content);
    } catch (error) {
        // ignore
    }

    throw new Error(`[OpenAI] 无法解析响应内容: ${rawText.slice(0, 1000)}`);
}

/**
 * 从 JSON payload 中提取模型输出文本
 * @param {any} payload
 * @returns {string}
 */
function extractContentFromPayload(payload) {
    const messageContent = payload?.choices?.[0]?.message?.content;
    const deltaContent = payload?.choices?.[0]?.delta?.content;

    if (messageContent != null) return stripThinkingTags(normalizeContent(messageContent));
    if (deltaContent != null) return normalizeContent(deltaContent);

    // 兼容 refusal（某些模型 content 为 null 时附带拒绝原因）
    const refusal = payload?.choices?.[0]?.message?.refusal;
    if (typeof refusal === "string" && refusal) return refusal;

    // 兼容 reasoning_content（DeepSeek/Kimi 等推理模型返回的思考过程）
    const reasoningContent = payload?.choices?.[0]?.message?.reasoning_content;
    if (reasoningContent != null) return normalizeContent(reasoningContent);

    // 兼容 tool_calls（模型返回工具调用而非文本内容时，尝试从函数参数中提取文本）
    const toolCalls = payload?.choices?.[0]?.message?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        const parts = [];
        for (const tc of toolCalls) {
            try {
                const args = typeof tc?.function?.arguments === "string"
                    ? JSON.parse(tc.function.arguments)
                    : tc?.function?.arguments;
                if (typeof args === "string") {
                    parts.push(args);
                } else if (args && typeof args === "object") {
                    const text = args.content || args.text || args.input || args.query || args.message;
                    if (typeof text === "string") parts.push(text);
                    else parts.push(JSON.stringify(args));
                }
            } catch {
                if (typeof tc?.function?.arguments === "string") parts.push(tc.function.arguments);
            }
        }
        if (parts.length) return parts.join("\n");
    }

    // 兼容极少数供应商返回的 output_text 结构
    if (typeof payload?.output_text === "string") return payload.output_text;

    // 兼容 OpenAI Responses API 格式: output[].content[].text
    if (Array.isArray(payload?.output)) {
        const parts = [];
        for (const item of payload.output) {
            if (typeof item?.text === "string") parts.push(item.text);
            if (!Array.isArray(item?.content)) continue;
            for (const c of item.content) {
                if (typeof c?.text === "string") parts.push(c.text);
            }
        }
        if (parts.length) return parts.join();
    }

    // 兼容 legacy completions API: choices[0].text
    const legacyText = payload?.choices?.[0]?.text;
    if (legacyText != null) return normalizeContent(legacyText);

    return undefined;
}

/**
 * 解析 text/event-stream，拼接 delta 内容，或提取最终 message 内容
 * @param {string} rawText
 * @returns {string}
 */
function parseSSEContent(rawText) {
    const lines = rawText.split(/\r?\n/);
    let finalText = "";
    let deltaText = "";

    for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        try {
            const chunk = JSON.parse(data);
            const chunkText = extractContentFromPayload(chunk);

            // 如果已经是完整消息，优先使用它
            if (chunk?.choices?.[0]?.message?.content != null) {
                finalText = chunkText;
            } else if (chunk?.choices?.[0]?.delta?.content != null) {
                deltaText += chunkText;
            }
        } catch (error) {
            // 忽略无效 chunk，继续解析后续 data 行
        }
    }

    return stripThinkingTags(finalText || deltaText);
}

/**
 * 从 codex-proxy /v1/responses 响应中提取 image_generation_call.result
 * @param {string} rawText
 * @returns {Buffer}
 */
function parseCodexProxyImage(rawText) {
    const payloads = [];

    if (rawText.includes("data:")) {
        const lines = rawText.split(/\r?\n/);
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            try {
                payloads.push(JSON.parse(data));
            } catch (error) {
                // 忽略非 JSON SSE 片段
            }
        }
    } else {
        try {
            payloads.push(JSON.parse(rawText));
        } catch {
            throw new Error(`codex-proxy 生图响应解析失败: ${rawText.slice(0, 500)}`);
        }
    }

    for (const payload of payloads) {
        const result = findImageGenerationResult(payload);
        if (result) {
            return Buffer.from(result.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ""), "base64");
        }
    }

    throw new Error("codex-proxy 响应中未找到 image_generation_call.result");
}

/**
 * 递归查找 image_generation_call.result，兼容 SSE done 事件和非流式 responses payload
 * @param {any} value
 * @returns {string | null}
 */
function findImageGenerationResult(value) {
    if (!value || typeof value !== "object") return null;

    if (
        value.type === "image_generation_call" &&
        typeof value.result === "string" &&
        value.result.length > 0
    ) {
        return value.result;
    }

    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
        const found = findImageGenerationResult(child);
        if (found) return found;
    }

    return null;
}

/**
 * 规范化 content 字段（字符串或多段结构）
 * @param {any} content
 * @returns {string}
 */
function normalizeContent(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map(item => {
            if (typeof item === "string") return item;
            if (typeof item?.text === "string") return item.text;
            return "";
        })
        .join("");
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
        return `data:${getMimeType(filePath)};base64,${base64Data}`;
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
