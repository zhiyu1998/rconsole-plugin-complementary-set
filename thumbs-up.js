import fs from 'fs';
import axios from 'axios';
import schedule from 'node-schedule'

// 存储位置
const thumbsUpMeListPath = './data/thumbsUpMeList.json';
// 在内存中点赞QQ
const thumbsUpMeList = loadSet();
// 每次点赞数量，点到点不动为止
const THUMBSUPME_SUM = 10
// napcat开启http的地址
const NAPCAT_HTTP_URL = 'http://localhost:2537/send_like';

export class thumbsUp extends plugin {
    constructor() {
        super({
            name: "[R插件补集]橘之点赞",
            dsc: "通过http进行点赞",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^(点赞|赞我|全部赞我|超我|全部超我)$",
                    fnc: "like",
                },
                {
                    reg: "^订阅赞$",
                    fnc: "addLike",
                }
            ]
        })

    }

    async like(e) {
        const isThumbsUp = await sendLikeRequest(e.sender.user_id, THUMBSUPME_SUM);
        e.reply(isThumbsUp);
    }

    async addLike(e) {
        const user_id = e.sender.user_id
        if (thumbsUpMeList.has(user_id)) {
            e.reply(`你已经订阅了哦~`);
            return;
        }
        thumbsUpMeList.add(user_id);
        // 保存一下
        saveSet(thumbsUpMeList);
        e.reply(`添加 ${ e.sender.user_id } 到订阅成功，每天凌晨12点为你点赞~`);
    }
}

/**
 * 休眠函数
 * @time 毫秒
 */
async function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

/**
 * 持久化点赞qq
 * @param set
 */
function saveSet(set) {
    const data = JSON.stringify([...set]);
    fs.writeFileSync(thumbsUpMeListPath, data);
}

/**
 * 加载点赞qq
 * @returns {Set<any>}
 */
function loadSet() {
    if (fs.existsSync(thumbsUpMeListPath)) {
        const data = fs.readFileSync(thumbsUpMeListPath, 'utf-8');
        return new Set(JSON.parse(data));
    }
    return new Set();
}

// 点赞定时器
schedule.scheduleJob('30 0 0 * * *', async () => {
    for (const qq of thumbsUpMeList) {
        await sendLikeRequest(qq, THUMBSUPME_SUM)
        logger.mark(`[R插件][自动点赞] 已给 ${ qq } 点赞 ${ THUMBSUPME_SUM } 次`)
        await sleep(5000) // 等5秒在下一个
    }
})

// 定义一个函数发送 send_like 请求
async function sendLikeRequest(userId, times = 1) {

    const data = {
        user_id: userId, // 要点赞的目标 QQ 号
        times: times // 点赞次数，默认为 1
    };

    // 使用 axios 发送 POST 请求到 OneBot HTTP API
    return axios.post(NAPCAT_HTTP_URL, data)
        .then(response => {
            const res = response.data;
            if (res.status === 'ok') {
                // 点赞成功，继续点赞
                sendLikeRequest(userId, times);
                return "点赞成功"
            } else if (res.status === 'failed' && res.message.includes('已达上限')) {
                logger.warn(`点赞失败：${ res.message }`);
                // 停止点赞，因为点赞数已达上限
                return '已达到点赞上限，停止点赞。'
            } else {
                // 处理其他错误
                logger.error(`点赞失败：${ res.message || '未知错误' }`);
                return '点赞失败';
            }
        })
        .catch(error => {
            logger.error('点赞请求发送失败:', error);
        });
}
