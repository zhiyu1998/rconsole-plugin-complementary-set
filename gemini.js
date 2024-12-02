/**
20241201更新：
使用File API代替base64上传文件
新增#gemini帮助指令
新增gemini接地搜索功能（测试中，免费API无法使用）
*/

import axios from "axios";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI, DynamicRetrievalMode } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

// Gemini提示词 (可修改)
const prompt = "请用中文回答问题";
// Gemini API key (必须)
const aiApiKey = "";
// Gemini 模型 (可修改)
const model = "gemini-1.5-flash";

const helpContent = `指令：
(1) 多模态助手：[引用文件(可选)] + #gemini + [问题(可选)]
(2) 接地搜索(测试中，免费API无法使用)：#gemini搜索 + [问题]

支持引用的文件格式有：
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
            reg: '^#gemini(?!搜索|帮助)\\s*.*$',  // 使用否定前瞻(?!pattern)
            fnc: 'chat'
        },
        {
            reg: '^#gemini搜索\\s*.*$',
            fnc: 'grounding'
        },
        {
            reg: '^#gemini帮助\\s*.*$',
            fnc: 'gemiHelp'
        }
    ],
    });
    this.genAI = new GoogleGenerativeAI(aiApiKey);
    this.fileManager = new GoogleAIFileManager(aiApiKey);
    console.log('Gemini插件已初始化');
  }


  // gemini帮助
  async gemiHelp(e) {
    await e.reply(helpContent, true);
  }

  // 图片下载
  async downloadImage(url, imgPath) {
    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
      });
      return new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(imgPath))
          .on('finish', () => {
            logger.info('图片下载完成，准备上传给Gemini');
            resolve();
          })
          .on('error', (err) => {
            logger.error('图片下载失败:', err.message);
            reject(err);
          });
      });
    } catch (err) {
      logger.error('图片地址访问失败:', err.message);
      throw err;
    }
  }

  // 文档下载
  async downloadFile(url, outputPath) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      await fs.promises.writeFile(outputPath, response.data);
      logger.info(`文件已成功下载至 ${outputPath}`);
    } catch (error) {
      logger.error('无法下载文件:', error);
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

  // 获取文件地址和后缀
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

  // 多模态功能
  async chat(e) {
    try {
        let query = e.msg.replace(/^#gemini/, '').trim();
        const { url, fileExt, fileType } = await this.autoGetUrl(e);
        // logger.info({ url, fileExt, fileType });

        if (url !== "" && fileType !== "text") {
            const downloadFileName = path.resolve(`./data/tmp.${fileExt}`);
            let defaultQuery = "";

            if (fileType === "image") {
                await this.downloadImage(url, downloadFileName);
                defaultQuery = "请描述一下图片";
            } else {
                await this.downloadFile(url, downloadFileName);
                defaultQuery = "请描述一下这个文件里的内容";
            }

            // 初始化 model
            const geminiModel = this.genAI.getGenerativeModel({ model: model });

            setTimeout(async () => {
                try {
                    const uploadResponse = await this.fileManager.uploadFile(downloadFileName, {
                        mimeType: getMimeType(downloadFileName),
                        displayName: `file_${Date.now()}`
                    });

                    logger.info(
                      `[R插件扩展][Gemini]上传文件： ${uploadResponse.file.displayName} as: ${uploadResponse.file.uri}`,
                    );

                    // 等待视频处理完成
                    let file = await this.fileManager.getFile(uploadResponse.file.name);
                    while (file.state === FileState.PROCESSING) {
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        file = await this.fileManager.getFile(uploadResponse.file.name);
                    }

                    if (file.state === FileState.FAILED || file.state !== FileState.ACTIVE) {
                        throw new Error("视频处理失败，请稍后重试");
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
                } catch (error) {
                    logger.error('处理文件时出错:', error);
                    await e.reply('处理文件时出现错误，请稍后重试', true);
                }
            }, 1000);

            return true;
        }

        // 如果引用的是一个文本
        if (fileType === "text") {
            query += `引用："${url}"`;
        }

        // 纯文本对话
        const geminiModel = this.genAI.getGenerativeModel({ model: model });
        const result = await geminiModel.generateContent([prompt, query]);
        await e.reply(result.response.text(), true);
        return true;
    } catch (error) {
        logger.error('Gemini API调用失败:', error);
        await e.reply('抱歉，处理请求时出现错误，请稍后再试');
        return false;
    }
}


  //文本搜索功能
  async grounding(e) {
    const query = e.msg.replace(/^#gemini搜索/, '').trim();

    if (!query) {
      await e.reply('请输入有效的问题。', true);
      return;
    }

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


/**
 * 辅助函数：根据文件扩展名获取MIME类型
 * @param {string} filePath - 文件路径
 * @returns {string} MIME类型
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

