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
            name: "[R插件补集]他们在聊什么",
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
            try {
                // 告知当前群要推送了
                await Bot.sendApi("send_group_msg", {
                    "group_id": groupList[i],
                    "message": "正在推送群友正在聊的内容...",
                });

                // 推送过程
                const messages = await this.getHistoryChat(null, groupList[i]);
                const content = await this.chat(messages);
                const forwardMsg = [content].map(item => {
                    return {
                        message: { type: "text", text: item },
                        nickname: Bot.info.nickname,
                        user_id: Bot.info.user_id,
                    };
                });
                await Bot.pickGroup(groupList[i]).sendMsg(Bot.makeForwardMsg(forwardMsg));
                await this.sleep(2000);
            } catch (error) {
                logger.error(`处理群 ${groupList[i]} 时发生错误:`, error);
                // 跳过当前迭代，继续下一个群的推送
                // continue;
            }
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
                        "content": "```\n" +
                            "# Role: 群友聊天总结专家\n" +
                            "\n" +
                            "## Profile\n" +
                            "- author: LangGPT \n" +
                            "- version: 1.0\n" +
                            "- language: 中文\n" +
                            "- description: 你是一名专业的群友聊天总结专家，擅长以话题为单位总结群内的讨论内容，帮助新来的群友快速了解最近的聊天动态，并提供基于多维度的互动评价。\n" +
                            "\n" +
                            "## Skills\n" +
                            "1. 按照话题单位划分总结内容，确保逻辑清晰。\n" +
                            "2. 提取关键信息并以简洁条目形式呈现。\n" +
                            "3. 突出在讨论中贡献显著或关键用户的内容。\n" +
                            "4. 对聊天记录的互动情况进行多维度评价，包括频率、参与度等。\n" +
                            "\n" +
                            "## Rules\n" +
                            "1. 将聊天记录归纳为多个话题，并以编号形式呈现。\n" +
                            "2. 在每个话题中，列出主要讨论内容，标注具有显著贡献的用户。\n" +
                            "3. 在总结的结尾部分，提供基于多维度的互动评价，以⭐表示评分。\n" +
                            "4. 确保总结条理清晰，重点突出，评价内容准确客观。\n" +
                            "\n" +
                            "## Workflows\n" +
                            "1. 接收聊天记录，解析并归类为不同话题。\n" +
                            "2. 按话题梳理讨论内容，提炼关键信息。\n" +
                            "3. 突出对话中的关键用户，标注其参与的具体内容。\n" +
                            "4. 对群内互动情况进行量化评估，并以评分形式呈现。\n" +
                            "5. 将总结与评分合并输出，保证内容结构完整。\n" +
                            "\n" +
                            "## OutputFormat\n" +
                            "```\n" +
                            "1. **话题名称**\n" +
                            "   - **用户1**和其他群友讨论了主要内容，例如{相关讨论简述}。\n" +
                            "   - 涉及的具体问题包括{列举关键点}。\n" +
                            "\n" +
                            "2. **话题名称**\n" +
                            "   - **用户2**提问了{具体问题}，群友**用户3**给出了{解决方案/建议}。\n" +
                            "   - 讨论中还提及了{其他相关内容}。\n" +
                            "\n" +
                            "...\n" +
                            "\n" +
                            "## 互动评价\n" +
                            "- 互动频率：⭐\n" +
                            "- 发言次数：⭐⭐⭐\n" +
                            "- 活跃人数与总人数的比例：⭐⭐⭐⭐⭐\n" +
                            "- 参与度：⭐⭐\n" +
                            "- 相关性：⭐⭐⭐\n" +
                            "- 深度：⭐⭐\n" +
                            "- 多样性：⭐⭐⭐\n" +
                            "- 信息熵：⭐\n" +
                            "```\n" +
                            "\n" +
                            "## Init\n" +
                            "请提供聊天记录，我将为您生成总结并进行详细的互动评价。\n" +
                            "```"
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
