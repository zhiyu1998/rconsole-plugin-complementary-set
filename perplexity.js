export class PerplexityJS extends plugin {
    constructor() {
        super({
            name: 'Perplexity AI',
            dsc: 'Perplexity AI Assistant',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: '^#pplx(.*)$',
                    fnc: 'chat'
                }
            ]
        });
        // 设置基础 URL 和 headers
        this.baseURL = "http://127.0.0.1:8081"; // 请求网址
        this.model = "Claude 3.5 Sonnet"; // API 模型 (可更改)

        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer sk-xxxx"
        };
    }

    async chat(e) {
        const query = e.msg.replace(/^#perp/, '').trim();

        // 请求 Perplexity API
        logger.info(this.baseURL + "/v1/messages");
        const stream = await fetch(this.baseURL + "/v1/messages", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: "user",
                        content: query
                    }
                ],
                // system: "请使用中文回答用户提出的问题",
                stream: true,
            }),
            timeout: 100000
        });

        let res = "";
        let buffer = "";

        for await (const chunk of stream.body) {
            buffer += Buffer.from(chunk).toString();

            let boundary;
            while ((boundary = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 1);

                // 检查行是否是 `data: {...}`
                if (line.startsWith("data: {")) {
                    try {
                        // 去掉 "data: " 前缀，再解析 JSON
                        const jsonData = JSON.parse(line.slice(6));

                        // 检查 `type` 是否为 `content_block_delta`
                        if (jsonData.type === "content_block_delta") {
                            const delta = jsonData.delta;
                            if (delta && delta.text) {
                                res += delta.text;
                            }
                        }
                    } catch (error) {
                        logger.error("Error parsing JSON line:", error);
                    }
                }
            }
        }

        await e.reply(res);

        return true;
    }
}
