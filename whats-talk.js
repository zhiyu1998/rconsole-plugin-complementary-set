import config from "../model/config.js";

const HISTORY_LENS = 200;

export class WhatsTalk extends plugin {
    constructor() {
        super({
            name: "他们在聊什么",
            dsc: "通过获取聊天记录再AI总结得到群友最近在聊什么话题",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^#他们在聊什么",
                    fnc: "whatsTalk",
                }
            ]
        })
        // 配置文件
        this.toolsConfig = config.getConfig("tools");
        // 设置基础 URL 和 headers
        this.baseURL = this.toolsConfig.aiBaseURL;
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.toolsConfig.aiApiKey
        };
    }

    async getHistoryChat(e) {
        const data = await e.bot.sendApi("get_group_msg_history", {
            "group_id": e.group_id,
            "count": HISTORY_LENS
        })
        const messages = data?.data.messages;
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

    async whatsTalk(e) {
        const messages = await this.getHistoryChat(e);
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        "role": "system",
                        "content": "你是一个群友聊天总结专家，帮助新来的群友总结最近聊了什么内容，下面是我发送给你的聊天记录其中分号左边是用户名字，右边是说话内容。要求格式不使用markdown，重点标出总结内容中的用户即可。"
                    },
                    {
                        role: "user",
                        content: messages.join("\n")
                    },
                ],
            }),
            timeout: 100000
        });
        const content = (await completion.json()).choices[0].message.content;
        await e.reply(Bot.makeForwardMsg(this.textArrayToMakeForward(e, [content]), true));
    }
}
