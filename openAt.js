import YAML from 'yaml';
import fs from 'node:fs';

// 无权限提示
const refuse_tip = segment.image('https://gchat.qpic.cn/gchatpic_new/0/0-0-3227FF42D7F43A01E82EADF507AEC490/0');

// 配置文件路径，无特殊情况不要动
const file = './config/config/group.yaml';

export class OpenAt extends plugin {
    constructor() {
        super({
            name: '[R插件补集]开at',
            dsc: '控制机器人在指定群at开关',
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: '^#?(开|关)(at|艾特)$',
                    fnc: 'at'
                }
            ]
        });
    }

    /**
     * 解析 YAML 文件并保留注释
     * @param {string} filePath - YAML 文件的路径
     * @returns {YAML.Document} 解析后的 YAML 文档对象
     */
    parseYAML(filePath) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return YAML.parseDocument(fileContent);
    }

    /**
     * 将修改后的 YAML 文档写回文件
     * @param {string} filePath - YAML 文件的路径
     * @param {YAML.Document} document - 要写入的 YAML 文档对象
     */
    writeYAML(filePath, document) {
        const yamlString = document.toString();
        fs.writeFileSync(filePath, yamlString, 'utf8');
    }

    /**
     * 开at，指令需要艾特触发
     * @param {Object} e - 消息事件
     */
    async at(e) {
        if (!(e.isMaster || e.member.is_admin || e.member.is_owner)) {
            return e.reply(refuse_tip);
        }
        if (e.isGroup) {
            let document = this.parseYAML(file);
            e.msg.includes("开") ? document.set(e.group_id, { onlyReplyAt: 1 }) : document.set(e.group_id, { onlyReplyAt: 0 });
            this.writeYAML(file, document);
            return e.reply('已开启仅at和仅别名回复,at后开机即可解除此状态');
        } else {
            return e.reply('请在群聊中使用');
        }
    }
}
