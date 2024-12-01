import config from "../model/config.js";

export class kimiJS extends plugin {
    constructor() {
        super({
            name: '[R插件补集]Moonshot AI',
            dsc: 'Moonshot AI Assistant',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: '^#kimi(.*)$',
                    fnc: 'chat'
                }
            ]
        });
        // 配置文件
        this.toolsConfig = config.getConfig("tools");
        // 设置基础 URL 和 headers
        this.baseURL = this.toolsConfig.aiBaseURL;
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.toolsConfig.aiApiKey
        };
    }

    async chat(e) {
        const query = e.msg.replace(/^#kimi/, '').trim();
        logger.info(query);
        logger.info(logger.info(`当前模型：${ this.toolsConfig.aiModel }`));
        // 请求Kimi
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.toolsConfig.aiModel,
                messages: [
                    {
                        "role": "system",
                        "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"
                    },
                    {
                        role: "user",
                        content: query
                    },
                ],
            }),
            timeout: 100000
        });
        const content = (await completion.json()).choices[0].message.content;
        const contentSplit = content.split("搜索结果来自：");
        await e.reply(contentSplit[0], true);
        if (contentSplit?.[1] !== undefined) {
            await e.reply(Bot.makeForwardMsg(contentSplit[1]
                .trim()
                .split("\n")
                .map(item => {
                    return {
                        message: { type: "text", text: item || "" },
                        nickname: e.sender.card || e.user_id,
                        user_id: e.user_id,
                    };
                })));
        }
        return true;
    }
}
