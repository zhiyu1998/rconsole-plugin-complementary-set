const whiteUserList = []; // 白名单用户示例: [12345, 67890]
const whiteGroupList = []; // 白名单群示例: [1234567, 8765432]
const sleepTime = 1;
const all = true;

Bot.on('message.group', async (e) => {
    e.isGroup = true;
    const emoji = new botResponseEmoji(e);
    await emoji.botEmoji(e);
});

export class botResponseEmoji extends plugin {
    constructor(e) {
        super({
            name: '回应表情',
            dsc: '回应表情',
            event: 'message.group',
            priority: 0,
            handler: [{ key: 'bot.tool.emoji', fn: 'botToolEmoji' }]
        });
    }

    async botToolEmoji(e) {
        if (!e?.message_id) return false;
        if (e?.message?.length === 0) return false;
        e.isResEmoji = true;
        if (!this.isWhite(e)) {
            return await this.botEmoji(e);
        }
        return true;
    }

    // 判断是否是白名单群或者白名单用户
    isWhite(e) {
        if (whiteGroupList.length && !whiteGroupList.includes(e.group_id)) {
            return false;
        }
        if (whiteUserList.length && !whiteUserList.includes(e.user_id)) {
            return false;
        }
        return true;
    }

    async botEmoji(e) {
        if (e.bot?.adapter?.name !== 'OneBotv11') {
            return;
        }
        if (this.isConfig(e) || e.isResEmoji) {
            if (all) {
                const face = [];
                e.message.forEach((i) => {
                    if (i.type === 'face') {
                        face.push({ id: i.id });
                    } else if (i.type === 'text') {
                        const emojiList = this.extractEmojis(i.text);
                        if (emojiList.length) {
                            for (const emoji of emojiList) {
                                const id = emoji.codePointAt(0);
                                face.push({ id });
                            }
                        }
                    }
                });
                if (face.length) {
                    const seq = e?.message_id;
                    for (const i of face) {
                        if (sleepTime > 0) await sleep(sleepTime);
                        logger.info(`表情复读faceId：${ i.id }`);
                        await e.bot.sendApi('set_msg_emoji_like', { message_id: seq, emoji_id: String(i.id) });
                    }
                }
            }

            return false;
        }
    }

    // 判断配置
    isConfig(e) {
        if (!e.isGroup) return false;
        if (whiteGroupList.length && !whiteGroupList.includes(e.group_id)) {
            return false;
        }
        if (whiteUserList.length && !whiteUserList.includes(e.user_id)) {
            return false;
        }
        return true;
    }

    extractEmojis(text) {
        const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;
        const emojis = text.match(emojiRegex);
        return emojis || [];
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
