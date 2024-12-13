import axios from "axios";

const REMOVEBG_KEY = "";

export class RemoveBg2 extends plugin {
    constructor() {
        super({
            name: "扣扣",
            dsc: "去除图片的背景",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^扣扣$",
                    fnc: "removeBG",
                }
            ]
        })
    }

    /**
     * 图片下载
     * @param url
     * @returns {Promise<unknown | void>}
     */
    async downloadImage(url) {
        try {
            const response = await axios({
                url,
                method: "GET",
                responseType: "arraybuffer", // 使用 arraybuffer 以获取二进制数据
            });

            const buffer = Buffer.from(response.data);  // 获取图片数据的 Buffer

            // 将 Buffer 转换成 Blob
            return new Blob([buffer]);  // 返回 Blob 对象
        } catch (err) {
            logger.error("图片下载失败:", err.message);
            throw new Error("图片下载失败");
        }
    }

    /**
     * 获取最新的聊天记录
     * @param e
     * @returns {Promise<*|string>}
     */
    async getLatestImage(e) {
        // 获取最新的聊天记录，阈值为5
        const latestChat = await e.bot.sendApi("get_group_msg_history", {
            group_id: e.group_id,
            count: 10
        });
        const messages = latestChat.data.messages;
        // 找到最新的图片
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages?.[i]?.message;
            if (message?.[0]?.type === "image") {
                return message?.[0].data?.url;
            }
        }
        return "";
    }

    /**
     * 将removeBgCore重命名并重构为通用的图片处理函数
     * @param blob
     * @returns {Promise<ArrayBuffer>}
     */
    async processImage(blob) {
        const formData = new FormData();
        formData.append("size", "auto");
        formData.append("image_file", blob);

        const response = await fetch("https://api.remove.bg/v1.0/removebg", {
            method: "POST",
            headers: { "X-Api-Key": REMOVEBG_KEY },
            body: formData,
        });

        if (response.ok) {
            return await response.arrayBuffer();
        } else {
            throw new Error(`${response.status}: ${response.statusText}`);
        }
    }

    /**
     * 去除图片背景
     * @param e
     * @returns {Promise<boolean>}
     */
    async removeBG(e) {
        let url;
        if (e?.reply_id !== undefined) {
            logger.info("正在上传引用图片，请稍候...");
            const replyMsg = await e.getReply();
            const message = replyMsg?.message;
            url = message?.[0].url;
        } else if (e.at) {
            url = `http://q1.qlogo.cn/g?b=qq&nk=${e.at}&s=640`;
        } else {
            logger.info("正在获取聊天最新的图片，请稍候...");
            url = await this.getLatestImage(e);
            if (url === "") {
                e.reply("没有找到聊天最新的图片", true);
                return false;
            }
        }

        // 下载图片
        let imageBlob = await this.downloadImage(url);
        if (!imageBlob) {
            e.reply("下载图片失败", true);
            return false;
        }

        // 去除背景
        try {
            const rbgResultData = await this.processImage(imageBlob);
            logger.info(Buffer.from(rbgResultData));
            e.reply(segment.image(Buffer.from(rbgResultData)));
            return true;
        } catch (err) {
            e.reply("去除背景失败", true);
            return false;
        }
    }
}
