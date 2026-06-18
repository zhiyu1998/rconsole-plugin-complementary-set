import fs from 'fs';
import schedule from 'node-schedule'

// 存储位置
const thumbsUpMeListPath = './data/thumbsUpMeList.json';
// 在内存中点赞QQ
const thumbsUpMeList = loadSet();
// 每次点赞数量，点到点不动为止
const THUMBSUPME_SUM = 10

export class thumbsUp extends plugin {
    constructor() {
        super({
            name: "[R插件补集]橘之点赞",
            dsc: "通过内置API进行点赞",
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
        const isThumbsUp = await sendLikeRequest(e, e.sender.user_id, THUMBSUPME_SUM);
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
        e.reply(`添加 ${e.sender.user_id} 到订阅成功，每天凌晨12点为你点赞~`);
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
    // 获取第一个可用的 Bot 实例
    const bot = Bot?.[0] || Bot;
    if (!bot) {
        logger.error('[自动点赞] 未找到 Bot 实例');
        return;
    }
    
    for (const qq of thumbsUpMeList) {
        await sendLikeRequestInternal(bot, qq, THUMBSUPME_SUM)
        logger.mark(`[R插件][自动点赞] 已给 ${qq} 点赞 ${THUMBSUPME_SUM} 次`)
        await sleep(5000) // 等5秒在下一个
    }
})

/**
 * 内部调用 Bot API 点赞（供定时器使用）
 */
async function sendLikeRequestInternal(bot, userId, times = 1) {
    try {
        const res = await bot.sendApi('send_like', {
            user_id: userId,
            times: times
        });
        
        if (res?.status === 'ok' || res?.retcode === 0) {
            // 继续点赞直到上限
            await sleep(1000);
            return await sendLikeRequestInternal(bot, userId, times);
        } else if (res?.message?.includes('已达上限') || res?.msg?.includes('已达上限')) {
            return '已达到点赞上限';
        } else {
            logger.warn(`点赞失败:`, res?.message || res?.msg || '未知错误');
            return '点赞失败';
        }
    } catch (error) {
        // 通常是达到上限了
        if (error.message?.includes('已达上限') || error.message?.includes('limit')) {
            return '已达到今日点赞上限';
        }
        logger.error('点赞请求失败:', error.message);
        return '点赞失败';
    }
}

/**
 * 发送点赞请求（供消息触发使用）
 */
async function sendLikeRequest(e, userId, times = 1) {
    try {
        const res = await e.bot.sendApi('send_like', {
            user_id: userId,
            times: times
        });
        
        if (res?.status === 'ok' || res?.retcode === 0) {
            // 继续点赞直到上限
            await sleep(1000);
            return await sendLikeRequest(e, userId, times);
        } else if (res?.message?.includes('已达上限') || res?.msg?.includes('已达上限')) {
            return '已达到点赞上限，停止点赞。';
        } else {
            logger.warn(`点赞失败:`, res?.message || res?.msg || '未知错误');
            return '点赞失败';
        }
    } catch (error) {
        // 通常是达到上限了
        if (error.message?.includes('已达上限') || error.message?.includes('limit') || error.message?.includes('100')) {
            return '已达到今日点赞上限 👍';
        }
        logger.error('点赞请求失败:', error.message);
        return '点赞失败: ' + error.message;
    }
}
