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
// ai 模型，masterModel -- 主人专用模型，generalModel -- 通用模型，其他群友使用的模型
const masterModel = "gemini-2.0-flash-exp";
const generalModel = "gemini-2.0-flash-exp";
// 每日 8 点 03 分自动清理临时文件
const CLEAN_CRON = "3 8 * * *";
// 是否使用LLM Crawl，默认使用 Gemini 默认搜索
let isLLMSearch = false;
// 填写你的LLM Crawl 服务器地址，填写后即启用，例如：http://localhost:5000，具体使用方法见：https://github.com/zhiyu1998/rconsole-plugin-complementary-set/tree/master/crawler
const llmCrawlBaseUrl = "";

class KeyManager {
    constructor(apiKeys) {
        // 支持单个key或用逗号分隔的多个key
        this.apiKeys = Array.isArray(apiKeys) ? apiKeys : apiKeys.split(',').map(k => k.trim());
        
        // 验证key是否为空
        if (!this.apiKeys.length || this.apiKeys.some(key => !key)) {
            logger.error('[R插件补集][Gemini] API key 不能为空');
            throw new Error('API key cannot be empty');
        }

        // 当前使用的key索引
        this.currentIndex = 0;
        // 记录每个key的失败次数
        this.keyFailureCounts = {};
        // key最大失败次数，超过后会被标记为无效
        this.MAX_FAILURES = 3;

        // 初始化每个key的失败计数为0
        this.apiKeys.forEach(key => {
            this.keyFailureCounts[key] = 0;
        });
    }

    getNextKey() {
        const initialIndex = this.currentIndex;
        
        while (true) {
            const currentKey = this.apiKeys[this.currentIndex];
            
            // 如果当前key有效就返回
            if (this.isKeyValid(currentKey)) {
                return currentKey;
            }

            // 轮询下一个key
            this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
            
            // 如果已经检查了所有key还是没有找到有效的
            if (this.currentIndex === initialIndex) {
                // 重置所有key的失败计数，重新开始
                this.resetFailureCounts();
                return currentKey;
            }
        }
    }

    // 检查key是否有效(失败次数未超过阈值)
    isKeyValid(key) {
        return this.keyFailureCounts[key] < this.MAX_FAILURES;
    }

    // 处理key调用失败
    handleFailure(key) {
        this.keyFailureCounts[key]++;
        if (this.keyFailureCounts[key] >= this.MAX_FAILURES) {
            logger.warn(`API key ${key.substring(0,4)}... 已失败 ${this.MAX_FAILURES} 次，将被标记为无效`);
            
            // 当可用key数量为0时发出警告
            if (this.getValidKeyCount() === 0) {
                logger.error('[R插件补集][Gemini] 所有 API key 均已失效');
            }
        }
        return this.getNextKey();
    }

    // 重置所有key的失败计数
    resetFailureCounts() {
        Object.keys(this.keyFailureCounts).forEach(key => {
            this.keyFailureCounts[key] = 0;
        });
    }

    // 获取所有key的状态(有效/无效)
    getKeysStatus() {
        const validKeys = [];
        const invalidKeys = [];
        
        this.apiKeys.forEach(key => {
            if (this.isKeyValid(key)) {
                validKeys.push(key);
            } else {
                invalidKeys.push(key);
            }
        });

        return { validKeys, invalidKeys };
    }

    // 获取当前可用的key数量
    getValidKeyCount() {
        return this.apiKeys.filter(key => this.isKeyValid(key)).length;
    }
}

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
                {
                    reg: /^#gemiu$/,
                    fnc: 'update'
                }
            ]
        });
        this.task = {
            cron: CLEAN_CRON,
            name: 'Gemini-自动清理临时文件',
            fnc: () => this.autoCleanTmp(),
            log: false
        };
        try {
            this.keyManager = new KeyManager(aiApiKey);
            this.genAI = new GoogleGenerativeAI(this.keyManager.getNextKey());
        } catch (error) {
            logger.error('[R插件补集][Gemini] 初始化失败:', error.message);
            throw error;
        }
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
            logger.error(`[R插件补集][Gemini自动清理临时文件] 目录不存在: ${ fullPath }`);
            return;
        }

        // 读取目录内容
        fs.readdir(fullPath, (err, files) => {
            if (err) {
                logger.error(`[R插件补集][Gemini自动清理临时文件] 无法读取目录: ${ fullPath }`, err);
                return;
            }

            // 筛选以 prefix 开头的文件
            const tmpFiles = files.filter(file => file.startsWith("tmp"));

            // 删除筛选到的文件
            tmpFiles.forEach(file => {
                const filePath = path.join(fullPath, file);
                fs.unlink(filePath, err => {
                    if (err) {
                        logger.error(`[R插件补集][Gemini自动清理临时文件] 删除文件失败: ${ filePath }`, err);
                    } else {
                        logger.info(`[R插件补集][Gemini自动清理临时文件] 已删除: ${ filePath }`);
                    }
                });
            });

            if (tmpFiles.length === 0) {
                logger.info(`[R插件补集][Gemini自动清理临时文件] 暂时没有需要清理的文件。`);
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
                            logger.info(`文件已成功流式下载至 ${ outputPath }`);
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
                logger.info(`文件已成功下载至 ${ outputPath }`);
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
            // 如果存在消息ID，暂时存放到队列
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
            const downloadFileName = path.resolve(`./data/tmp${ index }.${ fileExt }`);
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
                query += `\n引用："${ url }"`;
            }
        }
        logger.mark(query);
        logger.mark(collection);

        // 如果是有图像数据的
        if (collection.length > 0) {
            const completion = await this.fetchGeminiReq(query || defaultQuery, collection);
            // 这里统一处理撤回消息，表示已经处理完成
            await this.clearTmpMsg(e);
            await e.reply(completion, true);
            return;
        }

        // -- 下方可能返回的值为 { url: '', fileExt: '', fileType: '' }
        // 判断当前模型是什么
        const curModel = e?.isMaster ? masterModel : generalModel;
        // 搜索关键字 并且 是 gemini-2.0-flash-exp即可触发
        if (["搜索", "检索", "给我"].some(prefix => query.trim().startsWith(prefix)) && isLLMSearch) {
            query = await this.extendsLLMSearchQuery(query);
        } else if (["搜索", "检索", "给我"].some(prefix => query.trim().startsWith(prefix)) && curModel === "gemini-2.0-flash-exp") {
            await this.extendsSearchQuery(e, query);
            return true;
        }

        // 请求 Gemini
        const completion = await this.fetchGeminiReq(query);
        // 这里统一处理撤回消息，示已经处理完成
        await this.clearTmpMsg(e);
        await e.reply(completion, true);
        return true;
    }

    async update(e) {
        if (e?.isMaster === false) {
            logger.mark("[R插件补集] Gemini 多模态助手：检测到不是主人更新");
            return false;
        }

        const giteeUrl = 'https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/gemini-base64.js';
        const githubUrl = 'https://raw.githubusercontent.com/zhiyu1998/rconsole-plugin-complementary-set/refs/heads/master/gemini-base64.js';
        try {
            await this.updateGeminiFile(githubUrl);
            e.reply('[R插件补集] Gemini 多模态助手更新成功！更新源：GitHub', true);
        } catch (error) {
            logger.warn('从 Gitee 更新失败，尝试从 GitHub 更新...');
            try {
                await this.updateGeminiFile(giteeUrl);
                e.reply('[R插件补集] Gemini 多模态助手更新成功！更新源：Gitee', true);
            } catch (githubError) {
                logger.error('从 GitHub 更新也失败了，请检查网络连接或链接是否有效。');
            }
        }
    }

    /**
     * Gemini 更新单文件
     * @param url
     * @returns {Promise<void>}
     */
    async updateGeminiFile(url) {
        const localFilePath = path.resolve('./plugins/rconsole-plugin/apps/gemini.js');
        try {
            const response = await axios.get(url);
            let newContent = response.data;

            let oldContent = '';
            try {
                oldContent = fs.readFileSync(localFilePath, 'utf8');
            } catch (err) {
                logger.warn('未找到旧文件，将使用新内容更新。');
            }

            // 需要保存的变量名字
            const variablesToPreserve = ['prompt', 'aiApiKey', 'masterModel', 'generalModel', "isLLMSearch", 'llmCrawlBaseUrl'];
            // 开始替换
            const updatedContent = preserveVariables(newContent, oldContent, variablesToPreserve);

            fs.writeFileSync(localFilePath, updatedContent, 'utf8');
        } catch (error) {
            logger.error(`下载更新时出错: ${error.message}`);
            throw error;
        }
    }

    /**
     * 扩展 2.0 Gemini LLM搜索能力
     * @param query
     * @returns {Promise<*>}
     */
    async extendsLLMSearchQuery(query) {
        if (llmCrawlBaseUrl !== '' && isContainsUrl(query)) {
            // 单纯包含了链接
            const llmData = await this.fetchLLMCrawlReq(query);
            query += `\n搜索结果：${llmData}`;
        } else if (query.trim().startsWith("搜索")) {
            // 需要搜索
            logger.mark(`[R插件补集][Gemini] 开始搜索：${query.replace("搜索", "")}`);
            const llmData = await this.fetchLLMCrawlReq(`https://m.sogou.com/web/searchList.jsp?keyword=${query.replace("搜索", "")}`);
            query += `\n搜索结果：${llmData}`;
        }
        return query;
    }

    /**
     * 扩展 2.0 Gemini 自带搜索能力
     * @param e
     * @param query
     * @returns {Promise<*>}
     */
    async extendsSearchQuery(e, query) {
        try {
            const modelSelect = e?.isMaster ? masterModel : generalModel;
            logger.mark(`[R插件补集][Gemini] 当前使用的模型为：${ modelSelect }`);

            const completion = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelSelect}:generateContent?key=${this.genAI._apiKey}`,
                {
                    contents: [{
                        parts: [
                            { text: prompt },
                            { text: query }
                        ]
                    }],
                    tools: [{
                        googleSearch: {}
                    }]
                },
                {
                    headers: {
                        "Content-Type": "application/json"
                    },
                    timeout: 100000
                }
            );

            const ans = completion.data.candidates?.[0].content?.parts?.map(item => item?.text || '').join("");
            await e.reply(ans, true);

            // 搜索的一些来源
            const searchChunks = completion.data.candidates?.[0].groundingMetadata?.groundingChunks;
            if (searchChunks !== undefined) {
                const searchChunksRes = searchChunks.map(item => {
                    const web = item.web;
                    return {
                        message: { type: "text", text: `📌 网站：${web.title}\n🌍 来源：${web.uri}` || "" },
                        nickname: e.sender.card || e.user_id,
                        user_id: e.user_id,
                    };
                });
                // 发送搜索来源
                await e.reply(Bot.makeForwardMsg(searchChunksRes));
            }
        } catch (error) {
            logger.error(`[R插件补集][Gemini] Search API error: ${error.message}`);
            const newKey = this.keyManager.handleFailure(this.genAI._apiKey);
            this.genAI = new GoogleGenerativeAI(newKey);
            return this.extendsSearchQuery(e, query); // Retry with new key
        }
    }

    /**
     * 请求 LLM Crawl 服务器
     * @param query
     * @returns {Promise<*>}
     */
    async fetchLLMCrawlReq(query) {
        // 提取 http 链接
        const reqUrl = extractUrls(query)?.[0];
        const data = await fetch(`${llmCrawlBaseUrl}/crawl?url=${reqUrl}`).then(resp => resp.json());
        return data.data;
    }

    async fetchGeminiReq(query, contentData = []) {
        try {
            // 如果是主人就用好的模型，其他群友使用 Flash
            const modelSelect = this?.e?.isMaster ? masterModel : generalModel;
            logger.mark(`[R插件补集][Gemini] 当前使用的模型为：${modelSelect}`);
            
            // 定义通用的消息内容
            const client = this.genAI.getGenerativeModel({ model: modelSelect });
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

            // 思考模式：有两段text，第一段是思考过程，第二段是回复内容，因此提取最后一个文本内容
            if (modelSelect.includes("thinking") && result?.response?.candidates?.[0]) {
                const parts = result.response.candidates[0].content?.parts;
                return parts?.filter(part => part.text).pop()?.text;
            }
            // 返回生成的文本
            return result.response.text();
            
        } catch (error) {
            logger.error(`[R插件补集][Gemini] Gemini API error: ${error.message}`);
            
            // 如果所有key都失效，直接返回错误信息
            if (this.keyManager.getValidKeyCount() === 0) {
                return '抱歉，当前所有 API key 均已失效，请稍后再试或联系管理员。';
            }

            const newKey = this.keyManager.handleFailure(this.genAI._apiKey);
            this.genAI = new GoogleGenerativeAI(newKey);
            return this.fetchGeminiReq(query, contentData);
        }
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

/**
 * 保留 aiApiKey 值
 * @param content    新的版本的数据
 * @param oldContent 之前版本的数据
 * @param variables  保留的变量名字
 * @returns {*}
 */
function preserveVariables(content, oldContent, variables) {
    variables.forEach(variable => {
        const regex = new RegExp(`const\\s+${variable}\\s*=\\s*\"(.*?)\";`);
        const match = oldContent.match(regex);
        const value = match ? match[1] : '';
        content = content.replace(regex, `const ${variable} = "${value}";`);
    });
    return content;
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
