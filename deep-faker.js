import fs from "fs";
import FormData from 'form-data'
import axios from 'axios'

const DOWNLOAD_PATH = "./data/";

const voiceList = Object.freeze([
    "丁真",
    "AD学姐",
    "赛马娘",
    "黑手",
    "蔡徐坤",
    "孙笑川",
    "邓紫棋",
    "东雪莲",
    "塔菲",
    "央视配音",
    "流萤",
    "郭德纲",
    "雷军",
    "周杰伦",
    "懒洋洋",
    "女大学生",
    "烧姐姐",
    "麦克阿瑟",
    "马老师",
    "孙悟空",
    "海绵宝宝",
    "光头强",
    "陈泽",
    "村民",
    "猪猪侠",
    "猪八戒",
    "薛之谦",
    "大司马",
    "刘华强",
    "特朗普",
    "满穗",
    "桑帛",
    "李云龙",
    "卢本伟",
    "pdd",
    "tvb",
    "王者语音播报",
    "爱莉希雅",
    "岳山",
    "妖刀姬",
    "少萝宝宝",
    "天海",
    "王者耀",
    "蜡笔小新",
    "琪",
    "茉莉",
    "蔚蓝档案桃井",
    "胡桃",
    "磊哥游戏",
    "洛天依",
    "派大星",
    "章鱼哥",
    "蔚蓝档案爱丽丝",
    "阿梓",
    "科比",
    "于谦老师",
    "嘉然",
    "乃琳",
    "向晚",
    "优优",
    "茶总",
    "小然",
    "泽北",
    "夯大力",
    "奶龙",
])

export class example extends plugin {
    constructor () {
        super({
            name: '[R插件补集]语音包',
            dsc: '语音包',
            // 匹配的消息类型，参考https://oicqjs.github.io/oicq/#events
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: `^(${voiceList.join('|')})说(.*)`,
                    fnc: 'voicePack'
                },
                {
                    reg: "^语音列表$",
                    fnc: 'voiceList'
                }
            ]
        })
    }

    /**
     * 下载MP3文件并保存到指定路径
     * @param {string} url - MP3文件的URL
     * @param {string} savePath - 保存文件的路径
     */
    async downloadMp3(url, savePath) {
        try {
            if (!fs.existsSync(DOWNLOAD_PATH)) {
                fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
            }

            // 使用 axios 发送 GET 请求，设置 responseType 为 'stream'
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream'
            });

            // 创建文件写入流
            const writer = fs.createWriteStream(savePath);

            // 管道流将响应数据写入到文件中
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

        } catch (error) {
            console.error(`下载 MP3 文件出错: ${error.message}`);
        }
    }

    async voicePack(e) {
        const parts  = e.msg.trim()
        const part1 = parts.split("说", 1)[0];
        const part2 = parts.substring(parts.indexOf("说") + 1).replaceAll(" ", "，");
        logger.info(part1)
        logger.info(part2)
        // 创建 FormData 对象
        const form = new FormData();
        // 添加字段
        form.append('role', part1);
        form.append('text', part2);

        const ret = await axios.post("https://yy.lolimi.cn/index/audio", form, {
            headers: form.getHeaders() // 获取适当的请求头
        })

        const voiceData = ret.data.data;
        await this.downloadMp3(voiceData, DOWNLOAD_PATH + "voicePack.mp3");
        e.reply(segment.record(fs.readFileSync(DOWNLOAD_PATH + "voicePack.mp3")));
        return true
    }

    async voiceList(e) {
        e.reply(Bot.makeForwardMsg([{
            message: { type: "text", text: voiceList.join("\n") },
            nickname: e.sender.card || e.user_id,
            user_id: e.user_id,
        }]));
        return true
    }
}
