import config from "../model/config.js";

// 默认每小时推送一次，每2小时推送cron：0 */2 * * *
const PUSH_CRON = "0 8-20 * * *";
// 挖掘的历史消息
const HISTORY_LENS = 200;
// 推送的群组
const groupList = [];
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

    async getGroupMemberCount(e, group_id = "") {
        const data = await Bot.sendApi("get_group_info", {
            "group_id": group_id || e.group_id,
        })
        return data?.data.member_count;
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
                // 获取群人数
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
                // 跳过当前迭代，继续下一个群的推送
                // continue;
            }
        }
    }

    async whatsTalk(e) {
        // 获取聊天历史
        const messages = await this.getHistoryChat(e);
        // 获取群人数
        const memberCount = await this.getGroupMemberCount(e);
        const content = await this.chat(messages, memberCount);
        await e.reply(Bot.makeForwardMsg(this.textArrayToMakeForward(e, [content]), true));
    }

    async chat(messages, memberCount){
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        "role": "system",
                        "content":
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
                            `   - 活跃人数比例：基于群总人数（${memberCount}人），30%（90人）视为最大活跃度，对应5⭐，活跃度按以下标准评分：\n` +
                            "     - ⭐⭐⭐⭐⭐（≥30%），⭐⭐⭐⭐（20%-30%），⭐⭐⭐（10%-20%），⭐⭐（5%-10%），⭐（<5%）\n" +
                            "   - 信息熵：衡量用户发言内容的分布均衡性，信息熵越高表示讨论越均衡和多样，5⭐表示高度均衡。\n" +
                            "   - 话题多样性：统计活跃话题数量及其分布，更多高质量话题对应更高评分。\n" +
                            "   - 深度评分：依据讨论的广度和深度评估，例如是否超越表面问题。\n" +
                            "4. 在互动评价之后，增加一个整体总结模块，概述聊天内容的主题特点、活跃情况及整体讨论的质量。\n" +
                            "5. 确保总结条理清晰，重点突出，评价内容准确客观。\n" +
                            "\n" +
                            "## Workflows\n" +
                            "1. 接收聊天记录，解析并归类为不同话题。\n" +
                            "2. 按话题梳理讨论内容，提炼关键信息。\n" +
                            "3. 突出对话中的关键用户，标注其参与的具体内容。\n" +
                            "4. 量化群内互动情况，并按以下方式评估：\n" +
                            `   - **活跃人数比例**：统计发言人数与群总人数（${memberCount}人）的比值，以30%为5⭐标准线。\n` +
                            "   - **信息熵**：计算发言频率的分布均衡性，公式为 \\( H = -\\sum (p_i \\cdot \\log_2 p_i) \\)，\\( p_i \\) 为用户发言比例。\n" +
                            "   - **话题多样性**：统计活跃话题数量，并评估各话题的讨论平衡性。\n" +
                            "   - **深度评分**：分析讨论是否超越基础问题，涉及深入见解或知识拓展。\n" +
                            "5. 综合量化数据与文字描述，完成以下输出：\n" +
                            "   - 话题划分与总结。\n" +
                            "   - 多维度互动评价。\n" +
                            "   - 整体总结。\n" +
                            "\n" +
                            "## OutputFormat\n" +
                            "1. 每个话题编号呈现，并按以下格式输出：\n" +
                            "   - **话题编号：话题标题**\n" +
                            "   - **主要讨论内容**：\n" +
                            "     - 内容1\n" +
                            "     - 内容2\n" +
                            "   - **关键贡献用户**：用户A（贡献内容简述），用户B（贡献内容简述）\n" +
                            "2. 总结结尾处提供互动评价，格式如下：\n" +
                            "   - **活跃人数**：{活跃人数}（占群总人数的{比例}%），评分：⭐（{评分依据}）\n" +
                            "   - **信息熵**：{信息熵值}，评分：⭐（{评分依据}）\n" +
                            "   - **话题多样性**：{话题数量}，评分：⭐（{评分依据}）\n" +
                            "   - **深度评分**：⭐（{评分依据}）\n" +
                            "3. 在互动评价后，增加整体总结模块，格式如下：\n" +
                            "   - **整体总结**：\n" +
                            "     - 本次群内讨论主要围绕以下主题展开：{主题概述}。\n" +
                            "     - 群内整体活跃情况为{活跃评价}，讨论质量{讨论质量评价}。\n" +
                            "     - 突出特点为：{总结群讨论的特色，例如高效解决问题、多样化话题等}。\n" +
                            "\n" +
                            "## 示例\n" +
                            "**话题1：技术问题讨论**\n" +
                            "- **主要讨论内容**：\n" +
                            "  - 内容1\n" +
                            "  - 内容2\n" +
                            "- **关键贡献用户**：用户A（描述），用户B（描述）\n" +
                            "\n" +
                            "**互动评价**：\n" +
                            "- **活跃人数**：60人（占群总人数的20%），评分：⭐⭐⭐⭐（活跃度较高）\n" +
                            "- **信息熵**：3.85，评分：⭐⭐⭐（讨论稍有不均衡）\n" +
                            "- **话题多样性**：3个话题，评分：⭐⭐⭐⭐（话题较为丰富）\n" +
                            "- **深度评分**：⭐⭐⭐（讨论深度一般，集中于基础问题）\n" +
                            "\n" +
                            "**整体总结**：\n" +
                            "- 本次群内讨论主要围绕以下主题展开：技术问题解决与经验分享。\n" +
                            "- 群内整体活跃情况为较高，讨论质量中等偏上。\n" +
                            "- 突出特点为：快速高效的问题解答，讨论集中但缺乏深入拓展。\n"
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
