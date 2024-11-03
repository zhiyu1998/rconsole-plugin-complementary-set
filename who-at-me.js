import plugin from '../../lib/plugins/plugin.js'
import moment from "moment"

let time = 48 //这里设置at数据保留多久,默认24小时后清除,单位:小时。填大于0的纯数字

Bot.on('message', async (e) => {
    if(e.message_type !== 'group') return false
    let AtQQ
    for (let msg of e.message) {
        if (msg.type === 'at') {
            AtQQ = msg.qq
        }
    }
    if (!AtQQ ) return false
    let dateTime = moment(Date.now()).add(time, 'hours').format('YYYY-MM-DD HH:mm:ss')
    let new_date = (new Date(dateTime).getTime() - new Date().getTime()) / 1000
    await redis.set(`Yz:whoAtme:${e.group_id}_${AtQQ}:${Date.now()}`, JSON.stringify(e.message_id), { new_date })

})

export class whoAtme extends plugin {
    constructor() {
        super({
            name: '谁艾特我',
            dsc: '看看哪个狗崽子天天艾特人',
            event: 'message',
            priority: -114514,
            rule: [{
                reg: '^(谁(艾特|@|at)(我|他|她|它)|哪个逼(艾特|@|at)我)$',
                fnc: 'whoAtme',
            },
                {
                    reg: '^(/clear_at|清除(艾特|at)数据)$',
                    fnc: 'clearAt',
                },
                {
                    reg: '^(/clear_all|清除全部(艾特|at)数据)$',
                    fnc: 'clearAll',
                    permission: 'master'
                }
            ]
        })
    }

    async whoAtme(e, dec = '不玩原神导致的') {
        if (!e.isGroup) {
            e.reply('只支持群聊使用')
            return false
        }
        if (e.atBot) {
            e.at = Bot.uin
        }

        const key = `Yz:whoAtme:${e.group_id}_${e.at || e.user_id}:*`
        const list = await redis.keys(key)
        if (!list.length) return e.reply('没有人@你哦', { reply: true })
        const message = []

        for (const key of list) {
            const data = await redis.get(key)
            const message_id = JSON.parse(data)
            message.push({ type: 'node', data: { id: message_id }})
        }


        logger.info(message)
        const params = { group_id: e.group_id, message }
        await e.bot.sendApi('send_group_forward_msg', params)
        return false

    }

    async clearAt(e) {
        if (!e.isGroup) {
            e.reply('只支持群聊使用')
            return false
        }
        const key = `Yz:whoAtme:${e.group_id}_${e.at || e.user_id}:*`
        const list = await redis.keys(key)
        if (!list.length) return e.reply('没有人@你哦', { reply: true })
        for (const key of list) {
            await redis.del(key)

        }
        e.reply('已成功清除', true)
    }

    async clearAll(e) {
        let data = await redis.keys('Yz:whoAtme:*')
        for (let i of data) {
            await redis.del(i)
        }
        e.reply('已成功清除全部艾特数据')
    }
}
