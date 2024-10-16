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
        // 请求Kimi
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: "moonshot-v1-8k",
                messages: [
                    {
                        "role": "system",
                        "content": this.prompt,
                    },
                    {
                        role: "user",
                        content: query
                    },
                ],
            }),
            timeout: 100000
        });
        await e.reply((await completion.json()).choices[0].message.content, true);
        return true;
    }
}
