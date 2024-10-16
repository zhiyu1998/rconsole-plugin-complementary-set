export class kimiJS extends plugin {
    constructor() {
        super({
            name: 'Moonshot AI',
            dsc: 'Moonshot AI Assistant',
            event: 'message',
            priority: 1,
            rule: [
                {
                    reg: '^#R文档(.*)$',
                    fnc: 'chat'
                }
            ]
        });
        // 设置基础 URL 和 headers
        this.baseURL = "http://47.108.85.208:8003";
        this.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NTg2N2YxZmU3ZjY0YzgwOWUzZDdmMDRmNTkzMWM3NyIsImV4cCI6MTczNzk3OTc3MiwibmJmIjoxNzIyNDI3NzcyLCJpYXQiOjE3MjI0Mjc3NzIsImp0aSI6IjAwN2MxMzEzZjUxMDRiMTg4NmFiZDhlOGQ4Zjg3YzAzIiwidWlkIjoiNjUwOTU0ODNmOWY5MTI1MjQ5ZDBiNTk1IiwidHlwZSI6InJlZnJlc2gifQ.p-SI9bJUhxwf2JJIzhYf3FzDThWPsBWEjQ2gU84m0xE"
        };
    }

    async chat(e) {
        const query = e.msg.replace(/^#R文档/, '').trim();
        // 请求Kimi
        const completion = await fetch(this.baseURL + "/v1/chat/completions", {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                model: "670739a6850a81d1ed06bb87",
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
