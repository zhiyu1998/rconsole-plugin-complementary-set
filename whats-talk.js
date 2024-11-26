import config from "../model/config.js";

// 默认每小时推送一次，每2小时推送cron：0 */2 * * *
const PUSH_CRON = "0 8-20 * * *";
// 挖掘的历史消息
const HISTORY_LENS = 200;
// 推送的群组
const groupList = ['363022332'];

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
        this.baseURL = this.toolsConfig.aiBaseURL;
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.toolsConfig.aiApiKey
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
                model: this.model,
                messages: [
                    {
                        "role": "system",
                        "content": "你是一个群友聊天总结专家，帮助新来的群友总结最近聊了什么内容，下面是我发送给你的聊天记录其中分号左边是用户名字，右边是说话内容。重点标出总结内容中的用户即可。"
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
