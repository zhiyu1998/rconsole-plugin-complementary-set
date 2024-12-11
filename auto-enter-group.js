import plugin from '../../lib/plugins/plugin.js';

// 在此处输入正确答案，例如 const ans = [`是`, `不是`]
const ans = ['', ''];
// 在此处输入处理的群号，例如 const groupid = [`123456789`]
const groupid = [``];
// 设置是否启用精确匹配 true = 精确匹配，false = 模糊匹配
const exactMatch = false;

export class example2 extends plugin {
    constructor() {
        super({
            name: '加群申请处理',
            dsc: '',
            event: 'request.group.add',
            priority: 0,
        });
    }

    async accept(e) {
        if (groupid.indexOf(`${e.group_id}`) != -1) {
            let msg = [`收到加群事件：\n用户：${e.user_id}\n留言：${e.comment}`];
            Bot.pickGroup(`${e.group_id}`).sendMsg(msg);

            // 提取用户的留言
            const userAnswer = e.comment; // 直接读取用户的留言内容
            if (!userAnswer || userAnswer.trim() === '') {
                Bot.pickGroup(`${e.group_id}`).sendMsg(`未检测到答案格式，请重新申请！`);
                return false;
            }

            // 判断答案
            for (let i in ans) {
                if (
                    (exactMatch && userAnswer.trim() == ans[i]) || // 精确匹配
                    (!exactMatch && userAnswer.includes(ans[i])) // 模糊匹配
                ) {
                    Bot.pickGroup(`${e.group_id}`).sendMsg(`答案判断成功！已自动处理申请`);
                    e.approve(true);
                    return false;
                }
            }

            // 如果所有答案都未匹配，拒绝申请
            Bot.pickGroup(`${e.group_id}`).sendMsg(`答案判断失败！请检查答案是否正确后重新申请。`);
        }
        return false;
    }
}
