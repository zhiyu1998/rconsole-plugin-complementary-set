import config from "../model/config.js";

// 默认每小时推送一次，每2小时推送cron：0 */2 * * *
const PUSH_CRON = "0 8-20 * * *";
// 挖掘的历史消息
const HISTORY_LENS = 200;
// 推送的群组
const groupList = [];
// ai 地址，不需要加/v1
const aiBaseURL = "";
// ai Key
const aiApiKey = "";
// ai 模型
const model = "deepseek-chat";

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
        });

        this.task = {
            cron: PUSH_CRON,
            name: "推送群友在聊什么",
            fnc: () => this.pushWhatsTalk(),
            log: false
        };

        this.toolsConfig = config.getConfig("tools");
        this.baseURL = aiBaseURL || this.toolsConfig.aiBaseURL;
        this.apiKey = aiApiKey || this.toolsConfig.aiApiKey;
        this.model = model;

        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.apiKey
        };
    }

    async getHistoryChat(e, group_id = "") {
        const data = await Bot.sendApi("get_group_msg_history", {
            group_id: group_id || e?.group_id,
            count: HISTORY_LENS
        });

        const messages = data?.data?.messages || [];
        logger.info(messages);

        return messages
            .map(message => {
                const card = message?.sender?.card || message?.sender?.nickname || "未知用户";
                const msgList = Array.isArray(message?.message) ? message.message : [];

                const textMessages = msgList
                    .filter(msg => msg?.type === "text" && msg?.data?.text)
                    .map(msg => msg.data.text.trim())
                    .filter(Boolean);

                return textMessages.map(text => `${card}:${text}`);
            })
            .flat()
            .filter(Boolean);
    }

    async getGroupMemberCount(e, group_id = "") {
        const data = await Bot.sendApi("get_group_info", {
            group_id: group_id || e?.group_id,
        });
        return data?.data?.member_count || 0;
    }

    textArrayToMakeForward(e, textArray) {
        return textArray.map(item => {
            return {
                message: { type: "text", text: item },
                nickname: e?.sender?.card || e?.sender?.nickname || String(e?.user_id || Bot.info.user_id),
                user_id: e?.user_id || Bot.info.user_id,
            };
        });
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async pushWhatsTalk() {
        if (groupList.length <= 0) {
            return false;
        }

        logger.info("[群友在聊什么]推送中...");

        for (let i = 0; i < groupList.length; i++) {
            try {
                await Bot.sendApi("send_group_msg", {
                    group_id: groupList[i],
                    message: "正在推送群友正在聊的内容...",
                });

                const messages = await this.getHistoryChat(null, groupList[i]);
                const memberCount = await this.getGroupMemberCount(null, groupList[i]);
                const content = await this.chat(messages, memberCount);

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
            }
        }
    }

    async whatsTalk(e) {
        try {
            const messages = await this.getHistoryChat(e);

            if (!messages.length) {
                await e.reply("最近没有可供总结的文本聊天记录。");
                return;
            }

            const memberCount = await this.getGroupMemberCount(e);
            const content = await this.chat(messages, memberCount);

            await e.reply(Bot.makeForwardMsg(this.textArrayToMakeForward(e, [content]), true));
        } catch (err) {
            logger.error("[他们在聊什么]执行失败:", err);
            await e.reply(`总结失败：${err.message || err}`);
        }
    }

    async chat(messages, memberCount) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return "最近暂无足够的文本聊天记录可供总结。";
        }

        const payload = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content:
                        "# Role: 群友聊天总结专家\n" +
                        "\n" +
                        "## Profile\n" +
                        "- author: LangGPT \n" +
                        "- version: 1.3\n" +
                        "- language: 中文\n" +
                        "- description: 你是一名专业的群友聊天总结专家，擅长以话题为单位总结群内的讨论内容，帮助新来的群友快速了解最近的聊天动态，并通过活跃度、信息熵、话题多样性等多维度提供互动评价，同时对聊天内容进行全面概括。\n" +
                        "\n" +
                        "## Skills\n" +
                        "1. 按照话题单位划分总结内容，确保逻辑清晰。\n" +
                        "2. 提取关键信息并以简洁条目形式呈现。\n" +
                        "3. 突出在讨论中贡献显著或关键用户的内容。\n" +
                        "4. 量化群内互动情况，包括活跃度、信息熵、话题多样性和讨论深度等。\n" +
                        "5. 提供对整体聊天内容的全面总结，突出群讨论的主题特点和质量。\n" +
                        "\n" +
                        "## Rules\n" +
                        "1. 将聊天记录归纳为多个话题，并以编号形式呈现。\n" +
                        "2. 在每个话题中，列出主要讨论内容，标注具有显著贡献的用户。\n" +
                        "3. 在总结的结尾部分，提供基于以下多维度的互动评价：\n" +
                        `   - 活跃人数比例：基于群总人数（${memberCount}人），30%视为最大活跃度，对应5⭐。\n` +
                        "   - 信息熵：衡量用户发言内容的分布均衡性。\n" +
                        "   - 话题多样性：统计活跃话题数量及其分布。\n" +
                        "   - 深度评分：依据讨论的广度和深度评估。\n" +
                        "4. 在互动评价之后，增加一个整体总结模块。\n" +
                        "5. 确保总结条理清晰，重点突出，评价内容准确客观。\n"
                },
                {
                    role: "user",
                    content: messages.join("\n")
                },
            ],
        };

        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(payload)
        });

        let result;
        try {
            result = await completion.json();
        } catch (err) {
            throw new Error(`AI接口返回非JSON内容，HTTP状态码：${completion.status}`);
        }

        if (!completion.ok) {
            logger.error("[AI接口请求失败]", result);

            const errMsg = result?.error?.message || result?.message || completion.statusText || "未知错误";

            if (
                errMsg.includes("Insufficient quota") ||
                result?.error?.code === "payment_required"
            ) {
                throw new Error("AI接口余额不足或额度已用尽，请更换 API Key、充值，或切换到其他可用模型。");
            }

            throw new Error(`AI接口请求失败：${errMsg}`);
        }

        const content = result?.choices?.[0]?.message?.content;
        if (!content) {
            logger.error("[AI接口返回异常]", result);
            throw new Error(`AI接口返回数据缺少 choices[0].message.content，实际返回：${JSON.stringify(result)}`);
        }

        return content;
    }
}
