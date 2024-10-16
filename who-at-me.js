import moment from "moment"

await init()

let time = 48 //这里设置at数据保留多久,默认24小时后清除,单位:小时。填大于0的纯数字

Bot.on("message.group", async (e) => {
    let imgUrls = []
    let faceId = []
    let AtQQ = []
    for (let msg of e.message) {

        if (msg.type == 'at') {

            AtQQ.push(msg.qq)
        }
        if (msg.type == 'image') {
            imgUrls.push(msg.url)
        }
        if (msg.type == 'face') {
            faceId.push(msg.id)
        }

    }

    if (!AtQQ.length) return false

    let dateTime = moment(Date.now()).add(time, 'hours').format('YYYY-MM-DD HH:mm:ss')
    let new_date = (new Date(dateTime).getTime() - new Date().getTime()) / 1000
    let redis_data
    let reply
    let data
    let atName
    e.raw_message = e.raw_message.replace(/\[.*\]/g, '').trim()
    if (e.atall) {
        let groupMember = []
        let gm = await e.group.getMemberMap()
        for (let i of gm) {
            groupMember.push(i[0])
        }
        AtQQ = groupMember
    }
    for (let i = 0; i < AtQQ.length; i++) {
        data = JSON.parse(await redis.get(`Yz:whoAtme:${e.group_id}_${AtQQ[i]}`))
        if (e.source) {
            reply = (await e.group.getChatHistory(e.source.seq, 1)).pop()
            atName = e.raw_message.split(' ')
            e.raw_message = e.raw_message.replace(new RegExp(atName[0], 'g'), '')
        }
        if (data) {
            redis_data = {
                User: e.user_id,
                message: e.raw_message,
                image: imgUrls,
                name: e.nickname,
                faceId: faceId,
                time: e.time,
                messageId: reply ? reply.message_id : ''
            }

            data.push(redis_data)

            new_date = (new Date(data[0].endTime).getTime() - new Date().getTime()) / 1000
            await redis.set(`Yz:whoAtme:${e.group_id}_${AtQQ[i]}`, JSON.stringify(data), {
                EX: parseInt(new_date)
            })

            continue
        }


        redis_data = [{
            User: e.user_id,
            message: e.raw_message,
            image: imgUrls,
            name: e.nickname,
            faceId: faceId,
            time: e.time,
            endTime: dateTime,
            messageId: reply ? reply.message_id : ''
        }]

        await redis.set(`Yz:whoAtme:${e.group_id}_${AtQQ[i]}`, JSON.stringify(redis_data), {
            EX: parseInt(new_date)
        })
    }
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
        let data
        if (e.atBot) {
            e.at = Bot.uin
        }
        if (!e.msg.includes('我'))
            data = JSON.parse(await redis.get(`Yz:whoAtme:${e.group_id}_${e.at}`))
        else
            data = JSON.parse(await redis.get(`Yz:whoAtme:${e.group_id}_${e.user_id}`))

        if (!data) {
            e.reply('目前还没有人艾特', true)
            return false
        }
        let msgList = []

        for (let i = 0; i < data.length; i++) {
            let msg = []
            msg.push(data[i].messageId ? {
                type: 'reply',
                id: data[i].messageId
            } : '')
            msg.push(data[i].message)
            for (let face of data[i].faceId) {
                msg.push(segment.face(face))
            }

            for (let img of data[i].image) {
                msg.push(segment.image(img))
            }

            msgList.push({
                message: msg,
                user_id: data[i].User,
                nickname: data[i].name,
                time: data[i].time
            })
        }

        // 根据时间排序
        msgList.sort((a, b) => b.time - a.time)

        let forwardMsg = await e.group.makeForwardMsg(msgList)
        if (typeof (forwardMsg.data) === 'object') {
            let detail = forwardMsg.data?.meta?.detail
            if (detail) {
                detail.news = [{ text: dec }]
            }
        } else {
            forwardMsg.data = forwardMsg.data
                .replace(/\n/g, '')
                .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
                .replace(/___+/, `<title color="#777777" size="26">${dec}</title>`)
        }
        await e.reply(forwardMsg)
        return false
    }
    async clearAt(e) {
        if (!e.isGroup) {
            e.reply('只支持群聊使用')
            return false
        }
        let data = await redis.get(`Yz:whoAtme:${e.group_id})_${e.user_id}`)
        if (!data) {
            e.reply('目前数据库没有你的at数据,无法清除', true)
            return false
        }
        await redis.del(`Yz:whoAtme:${e.group_id}_${e.user_id}`)
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


//数据库格式化
async function init() {
    let atData = await redis.get('Yz:whoAtme_init')
    if (atData) return
    let data = await redis.keys('Yz:whoAtme:*')
    for (let i of data) {
        await redis.del(i)
    }
    await redis.set('Yz:whoAtme_init', 1)
}