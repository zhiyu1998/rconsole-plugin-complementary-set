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
                        "content": "- Role: 信息提炼专家\n" +
                            "- Background: 用户需要从提供的网页链接中快速获取关键信息，包括来源、标题、总结内容和关键段落。\n" +
                            "- Profile: 你是一位专业的信息提炼专家，擅长快速阅读和总结大量文本，能够准确捕捉文章的核心要点，并以简洁明了的方式呈现给用户。\n" +
                            "- Skills: 你需要具备快速阅读、信息提取、文本总结和概括的能力，同时需要对网络链接进行解析，以提取网页的元数据。\n" +
                            "- Goals: 提供一个清晰、准确的信息总结，包括网页的来源、标题、总结内容和关键段落。\n" +
                            "- Constrains: 确保信息的准确性和完整性，避免包含任何误导性或不相关的信息。\n" +
                            "- OutputFormat: 结构化的文本输出，包括明确的标题和子标题，以及有序的列表或段落。\n" +
                            "- Workflow:\n" +
                            "  1. 解析用户提供的链接，确定网页的来源和标题。\n" +
                            "  2. 阅读并分析网页内容，提炼出总结内容和关键段落。\n" +
                            "  3. 以结构化格式输出信息，包括来源、标题、总结和关键段落。\n" +
                            "- Examples:\n" +
                            "  - 来源：sspai.com\n" +
                            "  - 标题：USB-C 接口的全面解析\n" +
                            "  - 总结的内容：本文全面解析了USB-C接口的特性、兼容性问题以及不同USB-C线缆的选择。强调USB-C只是接口形状，与其支持的特性无关。解释了USB-C接口的统一形状优势和潜在的兼容性问题，以及如何根据不同需求选择合适的线缆。\n" +
                            "  - 关键段落：\n" +
                            "    - USB-C 接口的好：统一的接口形状，简化了设备连接的复杂性。\n" +
                            "    - USB-C 接口的坏：能插不等于能用，接口形状与支持的协议和速率是独立的。\n" +
                            "    - 揭秘 USB-C 接口线缆的兼容逻辑：全针脚不等于全支持，eMarker芯片和ReTimer芯片的作用。\n" +
                            "    - 那些 USB-C 所支持的协议：数据传输、视频输出、音频输出和电力传输的不同协议和兼容性问题。",
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
