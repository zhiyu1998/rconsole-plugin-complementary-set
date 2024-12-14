// 1214更新：(1) 修复bug：关闭引用合并转发消息(file api版本不支持)。(2) #gemini帮助可以查看当前模型

import axios from "axios";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI, DynamicRetrievalMode } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

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

const helpContent = `指令：
(1) 多模态助手：[引用文件/引用文字/引用图片/图片](可选) + #gemini + [问题](可选)
(2) gemini 2.0专用搜索(测试版，免费)：#gemini搜索 + [问题]
(3) 接地搜索(免费API无法使用)：#gemini接地 + [问题]

当前模型： ${masterModel} (主人)| ${generalModel} (通用)

支持的文件格式有(不要超过2GB)：
  // 音频
  '.wav': 'audio/wav',
  '.mp3': 'audio/mp3',
  '.aiff': 'audio/aiff',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',

  // 图片
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',

  // 视频
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mov': 'video/mov',
  '.avi': 'video/avi',
  '.flv': 'video/x-flv',
  '.mpg': 'video/mpg',
  '.webm': 'video/webm',
  '.wmv': 'video/wmv',
  '.3gpp': 'video/3gpp',

  // 文档
  '.pdf': 'application/pdf',
  '.js': 'text/javascript',
  '.py': 'text/x-python',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.md': 'text/md',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.rtf': 'text/rtf',
`;

export class Gemini extends plugin {
  constructor() {
    super({
      name: '[R插件补集]谷歌 Gemini',
      dsc: '谷歌 Gemini 多模态助手',
      event: 'message',
      priority: 1,
      rule: [
        {
            reg: '^#gemini(?!接地|帮助)\\s*.*$',  // 使用否定前瞻(?!pattern)
            fnc: 'chat'
        },
        {
            reg: '^#gemini接地\\s*.*$',
            fnc: 'grounding'
        },
        {
            reg: '^#gemini帮助\\s*.*$',
            fnc: 'gemiHelp'
        }
    ],
    });
      this.task = {
          cron: CLEAN_CRON,
          name: 'Gemini-自动清理临时文件',
          fnc: () => this.autoCleanTmp(),
          log: false
      };
    this.genAI = new GoogleGenerativeAI(aiApiKey);
    this.fileManager = new GoogleAIFileManager(aiApiKey);
    // 临时存储消息id，请勿修改
    this.tmpMsgQueue = [];
    console.log('Gemini插件已初始化');
  }

    // gemini帮助
    async gemiHelp(e) {
        await e.reply(helpContent, true);
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
          const response = await axios.get(url, { responseType: 'arraybuffer' });
          await fs.promises.writeFile(outputPath, response.data);
          logger.info(`文件已成功下载至 ${outputPath}`);
        }
      } catch (error) {
        logger.error('无法下载文件:', error.message);
        throw error;
      }
    }

  // 获取最近消息
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

  // 匹配文件扩展名
  async extractFileExtension(filename) {
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

        // 先尝试处理forward消息 (file api 版本不支持)
        // if (Array.isArray(messages)) {
        //     const forwardMessages = await this.handleForwardMsg(messages);
        //     if (forwardMessages[0].url !== "") {
        //         return forwardMessages;
        //     }
        // }

        let replyMessages = [];

        if (Array.isArray(messages) && messages.length > 0) {
            // 遍历消息数组寻找第一个有用的元素
            for (const msg of messages) {
                fileType = msg.type;

                if (fileType === "image") {
                    // 如果是图片，直接获取URL
                    url = msg.data?.url;
                    fileExt = msg.data?.file?.match(/\.(jpg|jpeg|png|heic|heif|webp)(?=\.|$)/i)?.[1] || 'jpg';
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

    // 多模态功能
    async chat(e) {
        let query = e.msg.replace(/^#gemini/, '').trim();
        const replyMessages = await this.autoGetUrl(e);
        const collection = [];

        for (let [index, replyItem] of replyMessages.entries()) {
          const { url, fileExt, fileType } = replyItem;

          if (fileType === "image" || fileType === "video" || fileType === "file") {
            const downloadFileName = path.resolve(`./data/tmp${index}.${fileExt}`);

            if (fileType === "image") {
              await this.downloadFile(url, downloadFileName, true);
            } else {
              await this.downloadFile(url, downloadFileName, false);
            }
            collection.push(downloadFileName);

            // 模型选择：主人用主人模型，其他人用通用模型
            const model = this?.e?.isMaster ? masterModel : generalModel;
            // 初始化 model
            const geminiModel = this.genAI.getGenerativeModel({ model: model });

            await new Promise((resolve, reject) => {
              setTimeout(async () => {
                try {
                  const uploadResponse = await this.fileManager.uploadFile(downloadFileName, {
                    mimeType: getMimeType(downloadFileName),
                    displayName: `file_${Date.now()}`
                  });

                  let file = await this.fileManager.getFile(uploadResponse.file.name);
                  while (file.state === FileState.PROCESSING) {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    file = await this.fileManager.getFile(uploadResponse.file.name);
                  }

                  if (file.state === FileState.FAILED || file.state !== FileState.ACTIVE) {
                    throw new Error("处理失败，请稍后重试");
                  }

                  const result = await geminiModel.generateContent([
                    prompt,
                    {
                      fileData: {
                        mimeType: getMimeType(downloadFileName),
                        fileUri: file.uri
                      }
                    },
                    { text: query || defaultQuery }
                  ]);

                  await e.reply(result.response.text(), true);
                  resolve();
                } catch (error) {
                  logger.error('处理文件时出错:', error);
                  await e.reply('处理文件时出现错误，请稍后重试', true);
                  reject(error);
                }
              }, 1000);
            });
          } else if (fileType === "text") {
            query += `\n引用："${url}"`;
          }
        }

        if (collection.length === 0) {
          // 判断是否包含 https 链接，或者搜索字段
          const curModel = e?.isMaster ? masterModel : generalModel;
          // 满足 http 链接 | 搜索关键字 并且 是 gemini-2.0-flash-exp即可触发
          if ((isContainsUrl(query) || query.trim().startsWith("搜索")) && curModel === "gemini-2.0-flash-exp") {
            await this.extendsSearchQuery(e, query);
            return true;
          }

          // 模型选择：主人用主人模型，其他人用通用模型
          const model = this?.e?.isMaster ? masterModel : generalModel;
          // 初始化 model
          const geminiModel = this.genAI.getGenerativeModel({ model: model });
          const result = await geminiModel.generateContent([prompt, query]);
          await e.reply(result.response.text(), true);
        }

        // 清理临时消息
        await this.clearTmpMsg(e);
        return true;
      }

    // /**
    //  * 处理合并转发消息 (file api 版本不支持)
    //  * @param messages 消息数组
    //  * @returns {Promise<Array>} 返回处理后的消息数组
    //  */
    // async handleForwardMsg(messages) {
    //     let forwardMessages = [];

    //     // 遍历消息数组寻找forward类型的消息
    //     for (const msg of messages) {
    //         if (msg.type === "forward") {
    //             // 获取转发消息的内容
    //             const forwardContent = msg.data?.content;

    //             if (Array.isArray(forwardContent)) {
    //                 // 遍历转发消息内容
    //                 for (const forwardMsg of forwardContent) {
    //                     const message = forwardMsg.message;

    //                     if (Array.isArray(message)) {
    //                         // 遍历每条消息的内容
    //                         for (const item of message) {
    //                             if (item.type === "image") {
    //                                 // 从file字段中提取真实的文件扩展名
    //                                 const fileExt = item.data?.file?.match(/\.(jpg|jpeg|png|heic|heif|webp)(?=\.|$)/i)?.[1] || 'jpg';
    //                                 forwardMessages.push({
    //                                     url: item.data?.url,
    //                                     fileExt: fileExt.toLowerCase(),
    //                                     fileType: "image"
    //                                 });
    //                             } else if (item.type === "video") {
    //                                 forwardMessages.push({
    //                                     url: item.data?.path || item.data?.url,
    //                                     fileExt: await this.extractFileExtension(item.data?.file),
    //                                     fileType: "video"
    //                                 });
    //                             } else if (item.type === "text") {
    //                                 forwardMessages.push({
    //                                     url: item.data?.text,
    //                                     fileExt: "",
    //                                     fileType: "text"
    //                                 });
    //                             }
    //                         }
    //                     }
    //                 }
    //                 // 找到并处理完forward消息后直接返回
    //                 return forwardMessages;
    //             }
    //         }
    //     }

    //     // 如果没有找到forward消息,返回空数组
    //     return [{
    //         url: "",
    //         fileExt: "",
    //         fileType: ""
    //     }];
    // }


  //接地搜索功能
  async grounding(e) {
    const query = e.msg.replace(/^#gemini接地/, '').trim();

    if (!query) {
      await e.reply('请输入有效的问题。', true);
      return;
    }
    // 模型选择：主人用主人模型，其他人用通用模型
    const model = this?.e?.isMaster ? masterModel : generalModel;

    try {
      const geminiModelodel = this.genAI.getGenerativeModel(
        {
          model: model,
          tools: [
            {
              googleSearchRetrieval: {
                dynamicRetrievalConfig: {
                  mode: DynamicRetrievalMode.MODE_DYNAMIC,
                  dynamicThreshold: 0.5, // 阈值：在 API 请求中，您可以指定带有阈值的动态检索配置。阈值是一个介于 [0,1] 范围内的浮点值，默认为 0.7。如果阈值为零，则回答始终依托 Google 搜索进行接地。
                },
              },
            },
          ],
        },
        { apiVersion: "v1beta" },
      );

      const result = await geminiModelodel.generateContent([prompt + query]);

      if (result?.response?.candidates?.[0]) {
        // 提取文本内容
        const text = result.response.candidates[0].content?.parts?.[0]?.text;
        if (text) {
          await e.reply(text, true);
        }

        // 提取引用源信息
        const groundingChunks = result.response.candidates[0].groundingMetadata?.groundingChunks;
        if (groundingChunks?.length > 0) {
          const forwardMessages = groundingChunks
            .filter(chunk => chunk.web?.title && chunk.web?.uri)
            .map((chunk, index) => ({
              message: {
                type: "text",
                text: `来源 ${index + 1}:\n标题: ${chunk.web.title}\n链接: ${chunk.web.uri}`
              },
              nickname: e.sender.card || e.user_id,
              user_id: e.user_id,
            }));

          if (forwardMessages.length > 0) {
            await e.reply(Bot.makeForwardMsg(forwardMessages));
          }
        }
      } else {
        await e.reply('无法处理您的请求。', true);
      }

    } catch (error) {
      console.error(`Gemini API 错误: ${error.message}`, error);

      if (error.response) {
        console.error(`API 响应状态: ${error.response.status}`);
        await e.reply(`API 错误: ${error.response.statusText}`, true);
      } else {
        await e.reply('处理请求时发生错误。', true);
      }
    }
  }

    /**
     * 扩展 2.0 Gemini搜索能力
     * @param e
     * @param query
     * @returns {Promise<*>}
     */
    async extendsSearchQuery(e, query) {
      const model = e?.isMaster ? masterModel : generalModel;
      logger.mark(`[R插件补集][Gemini] 当前使用的模型为：${ model }`);

      const completion = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiApiKey}`,
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

    const ans = completion.data.candidates?.[0].content?.parts?.[0]?.text;
    await e.reply(ans, true);

    // 搜索的一些来源
    const searchChunks = completion.data.candidates?.[0].groundingMetadata?.groundingChunks;
    if (searchChunks !== undefined) {
        const searchChunksRes = searchChunks.map(item => {
            const web = item.web;
            return {
                message: { type: "text", text: `📌 网站${web.title}\n🌍 来源：${web.uri}` || "" },
                nickname: e.sender.card || e.user_id,
                user_id: e.user_id,
            };
        });
        // 发送搜索来源
        await e.reply(Bot.makeForwardMsg(searchChunksRes));
    }
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
    // 音频
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.aiff': 'audio/aiff',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',

    // 图片
    '.png': 'image/png',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',

    // 视频
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mov': 'video/mov',
    '.avi': 'video/avi',
    '.flv': 'video/x-flv',
    '.mpg': 'video/mpg',
    '.webm': 'video/webm',
    '.wmv': 'video/wmv',
    '.3gpp': 'video/3gpp',

    // 文档
    '.pdf': 'application/pdf',
    '.js': 'text/javascript',
    '.py': 'text/x-python',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.md': 'text/md',
    '.csv': 'text/csv',
    '.xml': 'text/xml',
    '.rtf': 'text/rtf',
  };
