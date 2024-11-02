const voiceList = Object.freeze({
    "小新": "lucy-voice-laibixiaoxin",
    "猴哥": "lucy-voice-houge",
    "四郎": "lucy-voice-silang",
    "东北老妹儿": "lucy-voice-guangdong-f1",
    "广西大表哥": "lucy-voice-guangxi-m1",
    "妲己": "lucy-voice-daji",
    "霸道总裁": "lucy-voice-lizeyan",
    "酥心御姐": "lucy-voice-suxinjiejie",
    "说书先生": "lucy-voice-m8",
    "憨憨小弟": "lucy-voice-male1",
    "憨厚老哥": "lucy-voice-male3",
    "吕布": "lucy-voice-lvbu",
    "元气少女": "lucy-voice-xueling",
    "文艺少女": "lucy-voice-f37",
    "磁性大叔": "lucy-voice-male2",
    "邻家小妹": "lucy-voice-female1",
    "低沉男声": "lucy-voice-m14",
    "傲娇少女": "lucy-voice-f38",
    "爹系男友": "lucy-voice-m101",
    "暖心姐姐": "lucy-voice-female2",
    "温柔妹妹": "lucy-voice-f36",
    "书香少女": "lucy-voice-f34"
})

export class NcqqAiVoice extends plugin {
    constructor () {
        super({
            name: '语音包',
            dsc: '语音包',
            // 匹配的消息类型，参考https://oicqjs.github.io/oicq/#events
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: `^(${Object.keys(voiceList).join('|')})说(.*)`,
                    fnc: 'voicePack'
                },
                {
                    reg: "^语音列表$",
                    fnc: 'voiceList'
                }
            ]
        })
    }

    async voicePack(e) {
        const parts  = e.msg.trim()
        const part1 = parts.split("说", 1)[0];
        const part2 = parts.substring(parts.indexOf("说") + 1).replaceAll(" ", "，");

        await e.bot.sendApi('send_group_ai_record', {
            character: voiceList[part1],
            group_id: e.group_id,
            text: part2
        });

        return true
    }

    async voiceList(e) {
        e.reply(Bot.makeForwardMsg([{
            message: { type: "text", text: Object.keys(voiceList).join("\n") },
            nickname: e.sender.card || e.user_id,
            user_id: e.user_id,
        }]));
        return true
    }
}
