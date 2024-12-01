import fs from "fs";
import path from "path";

// 群历史消息最大搜索程度
const MAX_GROUP_COUNT = 20;
// 存储指定对象的位置
const recallObjsPath = "./data/recallObjs.json";

const recallUsers = loadArrayFromFile(recallObjsPath);

export class BatchRecall extends plugin {
    constructor() {
        super({
            name: "[R插件补集]批量撤回",
            dsc: "批量撤回以及指定某个用户撤回",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^批量撤回",
                    fnc: "recall",
                },
                {
                    reg: "^添加撤回对象",
                    fnc: "addRecallObj"
                }
            ]
        })
    }

    async recall(e) {
        if (!e.isMaster) {
            logger.info("批量撤回非主人调用");
            return true;
        }
        if (e.msg.includes("指定对象")) {
            await this.batchRecallSpecifiedObj(e);
            return true;
        }
        const recallCount = /^批量撤回(\d+)$/.exec(e.msg)[1] || 2;
        const groupMsg = await e.bot.sendApi("get_group_msg_history", {
            group_id: e.group_id,
            count: MAX_GROUP_COUNT
        });
        const messages = groupMsg.data.messages;
        const msgIds = messages.map(item => item.message_id).slice(-recallCount);
        for (const msgId of msgIds) {
            await e.bot.sendApi("delete_msg", {
                message_id: msgId
            });
        }
        return true;
    }

    async batchRecallSpecifiedObj(e) {
        const groupMsg = await e.bot.sendApi("get_group_msg_history", {
            group_id: e.group_id,
            count: MAX_GROUP_COUNT
        });
        const messages = groupMsg.data.messages;
        logger.info(recallUsers);
        const msgIds = messages.filter(item => recallUsers.includes(String(item.user_id))).map(item => item.message_id);
        for (const msgId of msgIds) {
            await e.bot.sendApi("delete_msg", {
                message_id: msgId
            });
        }
        return true;
    }

    async addRecallObj(e) {
        if (!e.isMaster) {
            logger.info("添加撤回对象非主人调用");
            return true;
        }

        let userId = null;
        // 获取用户
        if (e.at) {
            // 通过 at 添加
            userId = e.at;
        } else {
            userId = e?.reply_id !== undefined ?
                (await e.getReply()).user_id :
                e.msg.replace(/添加撤回对象/g, "").trim();
        }
        // 判断是否存在
        if (!userId || !(/^-?\d+$/.test(userId))) {
            e.reply("无法获取到用户信息，或者这是一个无效的用户信息，请重试", true);
            return true;
        }
        recallUsers.push(userId);
        e.reply("添加撤回用户信息成功！✌️");
        saveArrayToFile(recallUsers, recallObjsPath);
        return true;
    }
}

/**
 * 将数组对象持久化到指定文件中
 * @param {Array} array - 要保存的数组对象
 * @param {string} filePath - 保存文件的路径
 */
function saveArrayToFile(array, filePath) {
    // 将数组对象转换为 JSON 字符串
    const jsonString = JSON.stringify(array, null, 2);

    // 确保目录存在，如果不存在则创建
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    // 将 JSON 字符串写入文件
    fs.writeFileSync(filePath, jsonString);
}

/**
 * 从指定文件中加载数组对象
 * @param {string} filePath - 要加载的文件路径
 * @returns {Array} - 加载的数组对象
 */
function loadArrayFromFile(filePath) {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
        return [];
    }

    // 读取文件内容
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // 将文件内容解析为数组对象
    return JSON.parse(fileContent);
}
