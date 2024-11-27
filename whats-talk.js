import config from "../model/config.js";

// 默认每小时推送一次，每2小时推送cron：0 */2 * * *
const PUSH_CRON = "0 8-20 * * *";
// 挖掘的历史消息
const HISTORY_LENS = 200;
// 推送的群组
const groupList = [''];
// ai 地址
const aiBaseURL = "";
// ai Key
const aiApiKey = "";
// ai 模型
const model = "moonshot-v1-auto"

export class WhatsTalk extends plugin {
    constructor() {
        super({
            name: "他们在聊什么",
            dsc: "通过获取聊天记录再AI总结得到群友最近在聊什么话题",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^#(他们|群友)在聊什么",
                    fnc: "whatsTalk",
                }
            ]
        })
        // eslint-disable-next-line no-unused-expressions
        this.task = {
            cron: PUSH_CRON,
            name: '推送群友在聊什么',
            fnc: () => this.pushWhatsTalk(),
            log: false
            // eslint-disable-next-line no-sequences
        };
        // 配置文件
        this.toolsConfig = config.getConfig("tools");
        // 设置基础 URL 和 headers
        this.baseURL = aiBaseURL || this.toolsConfig.aiBaseURL;
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + (aiApiKey || this.toolsConfig.aiApiKey)
        };
    }

    async getHistoryChat(e, group_id = "") {
        const data = await Bot.sendApi("get_group_msg_history", {
            "group_id": group_id || e.group_id,
            "count": HISTORY_LENS
        })
        const messages = data?.data.messages;
        logger.info(messages);
        // 处理消息
        return messages
            .map(message => {
                // 获取 card 和消息内容
                const card = message.sender.card || message.sender.nickname; // 使用 card 或 fallback 为 nickname
                const textMessages = message.message
                    .filter(msg => msg.type === "text") // 筛选出 type 为 text 的消息
                    .map(msg => msg.data.text); // 获取 text 数据

                // 格式化结果
                return textMessages.map(text => `${card}:${text}`);
            })
            .flat(); // 将嵌套数组展平
    }

    textArrayToMakeForward(e, textArray) {
        return textArray.map(item => {
            return {
                message: { type: "text", text: item },
                nickname: e.sender.card || e.user_id,
                user_id: e.user_id,
            };
        })
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    async pushWhatsTalk() {
        if (groupList.length <= 0) {
            return false;
        }
        logger.info('[群友在聊什么]推送中...');
        for (let i = 0; i < groupList.length; i++) {
            // 告知当前群要推送了
            await Bot.sendApi("send_group_msg", {
                "group_id": groupList[i],
                "message": "正在推送群友正在聊的内容...",
            })
            // 推送过程
            const messages = await this.getHistoryChat(null, groupList[i]);
            const content = await this.chat(messages);
            const forwardMsg = [content].map(item => {
                return {
                    message: { type: "text", text: item },
                    nickname: Bot.info.nickname,
                    user_id: Bot.info.user_id,
                };
            })
            await Bot.pickGroup(groupList[i]).sendMsg(Bot.makeForwardMsg(forwardMsg));
            await this.sleep(2000);
        }
    }

    async whatsTalk(e) {
        const messages = await this.getHistoryChat(e);
        const content = await this.chat(messages);
        await e.reply(Bot.makeForwardMsg(this.textArrayToMakeForward(e, [content]), true));
    }

    async chat(messages) {
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        "role": "system",
                        "content": "# Role: 群友聊天总结专家\n" +
                            "## Profile\n" +
                            "- author: LangGPT \n" +
                            "- version: 1.0\n" +
                            "- language: 中文\n" +
                            "- description: 你是一名专业的群友聊天总结专家，擅长从聊天记录中提取关键信息，为新来的群友提供简明扼要的总结，同时突出重点用户的参与内容。\n" +
                            "## Skills\n" +
                            "1. 能够快速阅读和理解多条聊天记录。\n" +
                            "2. 提取主要话题、讨论重点和关键用户的观点。\n" +
                            "3. 将总结内容组织成条理清晰、易于理解的形式。\n" +
                            "4. 高效标注聊天记录中具有显著贡献或关键作用的用户。\n" +
                            "## Rules\n" +
                            "1. 从聊天记录中提取核心话题和重要信息，确保总结简洁但信息量充足。\n" +
                            "2. 在总结中明确标注重点用户及其贡献内容。\n" +
                            "3. 避免遗漏重要内容，同时过滤无关或重复的对话。\n" +
                            "4. 输出结果应简明易懂，方便新来的群友快速了解群内动态。\n" +
                            "## Workflows\n" +
                            "1. 接收聊天记录，按照分号解析每条记录。\n" +
                            "2. 根据聊天内容归纳主要话题，提炼关键信息。\n" +
                            "3. 标记并突出对话中贡献显著的用户及其相关内容。\n" +
                            "4. 整理总结并呈现为清晰的段落或列表格式。\n" +
                            "## Init\n" +
                            "请发送聊天记录，我将为您生成清晰的总结，并标注其中的重点用户和内容。\n"
                    },
                    {
                        role: "user",
                        content: messages.join("\n")
                    },
                ],
            }),
            timeout: 100000
        });
        return (await completion.json()).choices[0].message.content;
    }
}
