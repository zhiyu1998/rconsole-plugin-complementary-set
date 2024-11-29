import config from "../model/config.js";

export class kimiJS extends plugin {
    constructor() {
        super({
            name: 'Moonshot AI',
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
        logger.info(logger.info(`当前模型：${this.toolsConfig.aiModel}`));
        // 请求Kimi
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.toolsConfig.aiModel,
                messages: [

                    {
                        role: "user",
                        content: query
                    },
                ],
            }),
            timeout: 100000
        });
        const content = (await completion.json()).choices[0].message.content;
        const contentSplit = content.split("搜索结果来自：")
        await e.reply(contentSplit[0], true);
        if (contentSplit?.[1] !== undefined) {
            await e.reply(Bot.makeForwardMsg(contentSplit[1]
                .trim()
                .split("\n")
                .map(item => {
                    return {
                        message: {type: "text", text: item || ""},
                        nickname: e.sender.card || e.user_id,
                        user_id: e.user_id,
                    }
                })))
        }
        return true;
    }
}
