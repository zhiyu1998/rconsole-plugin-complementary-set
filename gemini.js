// 0207更新：
// 1.删除了“#gemini搜索”和“#gemini接地”命令，gemini-2.0-flash和gemini-2.0-pro-exp-02-05模型可自动判断是否需要搜索，thinking和lite模型不支持搜索。
// 2.修复视频和图片无法分析的bug。
// 3.使用 #gemini帮助 可查看指令。不支持引用合并转发的消息。
// 4.增加 #gemini修改备注 功能，使用 #gemini帮助 可以查看备注。可以把长模型名称放到备注里避免忘记。

import axios from "axios";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

// 提示词
const prompt = "请用中文回答问题";
// 默认查询，也就是你只发送'#gemini'时，默认使用的发送，建议写的通用一些，这样可以使用在不限于video、image、file等
const defaultQuery = "描述一下内容";
// ai Key
const aiApiKey = "";
// ai 模型，masterModel -- 主人专用模型，generalModel -- 通用模型，其他群友使用的模型
let masterModel = "gemini-2.0-flash";
let generalModel = "gemini-2.0-flash";
// 上传最大文件大小限制(单位:字节)(最大2GB)
const maxFileSize = 2 * 1024 * 1024 * 1024; // 2GB
// 每日 8 点 03 分自动清理临时文件
const CLEAN_CRON = "3 8 * * *";
// 备注功能
let note = `
gemini-2.0-flash
gemini-2.0-pro-exp-02-05
gemini-2.0-flash-thinking-exp-01-21
gemini-2.0-flash-lite-preview-02-05
`

export class Gemini extends plugin {
  constructor() {
    super({
      name: '[R插件补集]谷歌 Gemini',
      dsc: '谷歌 Gemini 多模态助手',
      event: 'message',
      priority: 1,
      rule: [
        {
          reg: '^#[Gg][Ee][Mm][Ii][Nn][Ii](?!帮助|设置模型|设置备注|更新)\\s*.*$',  // 使用否定前瞻(?!pattern)
          fnc: 'chat'
        },
        {
          reg: '^#[Gg][Ee][Mm][Ii][Nn][Ii]帮助\\s*.*$',
          fnc: 'gemiHelp'
        },
        {
          reg: '^#[Gg][Ee][Mm][Ii][Nn][Ii]设置模型\\s*(.*)\\s*(.*)$',
          fnc: 'setModels'
        },
        {
          reg: '^#[Gg][Ee][Mm][Ii][Nn][Ii]更新\\s*.*$',
          fnc: 'update'
        },
        {
          reg: '^#[Gg][Ee][Mm][Ii][Nn][Ii]设置备注\\s*.*$',
          fnc: 'remark'
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
    await e.reply(getHelpContent(), true);
  }

  // 备注功能
  async remark(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能修改备注', true);
      return;
    }
    const matches = e.msg.match(/^#[Gg][Ee][Mm][Ii][Nn][Ii]设置备注([\s\S]*)$/);
    const newNote = matches ? matches[1].trim() : '';
    if (!newNote) {
      await e.reply('请输入新的备注内容', true);
      return;
    }
    // 更新全局的备注变量
    note = newNote;
    await e.reply('备注修改成功，请使用 #gemini帮助 查看', true);
  }

  //模型修改功能 
  async setModels(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能修改模型设置', true);
      return;
    }

    // 检查命令后是否有参数
    const input = e.msg.replace(/^#[Gg][Ee][Mm][Ii][Nn][Ii]设置模型/, '').trim();
    if (!input) {
      await e.reply('请指定要设置的模型名称\n格式：#gemini设置模型 [主人模型] [通用模型](可选)', true);
      return;
    }

    const match = e.msg.match(/^#[Gg][Ee][Mm][Ii][Nn][Ii]设置模型\s+(.+?)(?:\s+(.+))?$/);
    if (!match) {
      await e.reply('命令格式错误\n格式：#gemini设置模型 [主人模型] [通用模型](可选)', true);
      return;
    }

    const [, newMasterModel, newGeneralModel] = match;
    masterModel = newMasterModel;
    generalModel = newGeneralModel || newMasterModel;
    await e.reply(`模型设置已更新：\n主人模型: ${masterModel}\n通用模型: ${generalModel}`, true);
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
            fileExt = await this.extractFileExtension(msg.data?.file);
            replyMessages.push({
              url,
              fileExt,
              fileType
            });
          } else if (fileType === "video") {
            // 如果是一个视频
            url = msg.data?.path;
            fileExt = await this.extractFileExtension(msg.data?.file);
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
          fileExt: await this.extractFileExtension(msg.data?.file),
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
    let query = e.msg.replace(/^#[Gg][Ee][Mm][Ii][Nn][Ii]/, '').trim();
    const replyMessages = await this.autoGetUrl(e);
    const collection = [];

    for (let [index, replyItem] of replyMessages.entries()) {
      // 最多循环2次，之后放弃请求api，防止api被滥用
      if (index >= 2) break;

      const { url, fileExt, fileType } = replyItem;

      if (fileType === "image" || fileType === "video" || fileType === "file") {
        const downloadFileName = path.resolve(`./data/tmp${index}.${fileExt}`);

        if (fileType === "image") {
          await this.downloadFile(url, downloadFileName, true);
        } else {
          await this.downloadFile(url, downloadFileName, false);
        }

        // 检查文件大小
        const stats = fs.statSync(downloadFileName);
        const fileSizeInBytes = stats.size;
        const fileSizeInMB = fileSizeInBytes / (1024 * 1024);
        console.log(`[R插件补集][Gemini] 文件大小: ${fileSizeInMB.toFixed(2)} MB`);

        if (stats.size > maxFileSize) {
          await e.reply(`文件大小超过限制，最大允许${maxFileSize / (1024 * 1024 * 1024)}GB`, true);
          return false;
        }

        collection.push(downloadFileName);

        // 模型选择：主人用主人模型，其他人用通用模型
        const model = this?.e?.isMaster ? masterModel : generalModel;

        // 初始化 model，根据模型名称决定是否添加搜索工具
        const geminiModel = this.genAI.getGenerativeModel(
          {
            model: model,
            tools: (model.toLowerCase().includes("thinking") || model.toLowerCase().includes("lite"))
              ? []
              : [
                {
                  googleSearch: {},
                },
              ],
          },
          { apiVersion: "v1beta" },
        );

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

              // 有两段text，第一段是思考过程，第二段是回复内容，因此提取最后一个文本内容
              if (result?.response?.candidates?.[0]) {
                const parts = result.response.candidates[0].content?.parts;
                const text = parts?.filter(part => part.text).pop()?.text;
                if (text) {
                  await e.reply(text, true);
                }
              }
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
      // 模型选择：主人用主人模型，其他人用通用模型
      const model = this?.e?.isMaster ? masterModel : generalModel;
      // 初始化 model，根据模型名称决定是否添加搜索工具
      const geminiModel = this.genAI.getGenerativeModel(
        {
          model: model,
          tools: (model.toLowerCase().includes("thinking") || model.toLowerCase().includes("lite"))
            ? []
            : [
              {
                googleSearch: {},
              },
            ],
        },
        { apiVersion: "v1beta" },
      );
      // 生成内容
      const result = await geminiModel.generateContent([prompt, query]);

      // 有两段text，第一段是思考过程，第二段是回复内容，因此提取最后一个文本内容
      if (result?.response?.candidates?.[0]) {
        const parts = result.response.candidates[0].content?.parts;
        const text = parts?.filter(part => part.text).pop()?.text;
        if (text) {
          await e.reply(text, true);
        }
      }
      // 提取引用源信息
      const groundingChunks = result.response.candidates[0].groundingMetadata?.groundingChunks;
      if (groundingChunks?.length > 0) {
        const forwardMessages = groundingChunks
          .filter(chunk => chunk.web?.title && chunk.web?.uri)
          .map((chunk, index) => ({
            message: {
              type: "text",
              text: `来源 ${index + 1}:\n网站: ${chunk.web.title}\n链接: ${chunk.web.uri}`
            },
            nickname: e.sender.card || e.user_id,
            user_id: e.user_id,
          }));

        if (forwardMessages.length > 0) {
          await e.reply(Bot.makeForwardMsg(forwardMessages));
        }
      }
    }

    // 清理临时消息
    await this.clearTmpMsg(e);
    return true;
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
                  const fileExt = item.data?.file?.match(/\.(jpg|jpeg|png|heic|heif|webp)(?=\.|$)/i)?.[1] || 'jpg';
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


  //更新
  async update(e) {
    if (e?.isMaster === false) {
      logger.mark("[R插件补集] Gemini 多模态助手：检测到不是主人更新");
      return false;
    }

    const giteeUrl = 'https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/gemini.js';
    const githubUrl = 'https://raw.githubusercontent.com/zhiyu1998/rconsole-plugin-complementary-set/refs/heads/master/gemini.js';
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
      const variablesToPreserve = ['prompt', 'aiApiKey', 'masterModel', 'generalModel','note'];
      // 开始替换
      const updatedContent = preserveVariables(newContent, oldContent, variablesToPreserve);

      fs.writeFileSync(localFilePath, updatedContent, 'utf8');
    } catch (error) {
      logger.error(`下载更新时出错: ${error.message}`);
      throw error;
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

// 获取帮助内容
function getHelpContent() {
  // 将 mimeTypes 对象转换为易读的字符串
  const mimeTypesString = Object.entries(mimeTypes)
    .map(([ext, mime]) => `${ext}: ${mime}`)
    .join('\n  ');

  return `指令：
  (1) 多模态助手：[引用文件/文字/图片](可选) #gemini [问题](可选)
  (2) 设置模型：#gemini设置模型 [主人模型] [通用模型](可选，留空则用相同模型)
  (3) 更新：#gemini更新
  (4) 设置备注：#gemini设置备注 [备注内容]
  (5) 帮助：#gemini帮助, 可以查看当前备注和当前模型。
  
  当前模型： ${masterModel} (主人)| ${generalModel} (通用)
  
  备注：
  ${note}
  `;
}
